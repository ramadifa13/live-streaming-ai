"""Deteksi kompatibilitas GPU dengan stack PyTorch worker (2.1 + CUDA 11.8)."""

from __future__ import annotations

import os

import torch


def gpu_label(gpu_id: int = 0) -> str:
    if not torch.cuda.is_available():
        return "cpu"
    try:
        return torch.cuda.get_device_name(gpu_id)
    except Exception:
        return f"cuda:{gpu_id}"


def cuda_basic_ok(gpu_id: int = 0) -> tuple[bool, str]:
    if not torch.cuda.is_available():
        return False, "CUDA tidak tersedia"
    try:
        device = torch.device(f"cuda:{gpu_id}")
        x = torch.ones(2, 2, device=device, dtype=torch.float32)
        _ = x @ x
        torch.cuda.synchronize(device)
        return True, ""
    except RuntimeError as exc:
        return False, str(exc)


def cuda_fp16_ok(gpu_id: int = 0) -> bool:
    try:
        device = torch.device(f"cuda:{gpu_id}")
        x = torch.ones(2, 2, device=device, dtype=torch.float16)
        _ = x @ x
        torch.cuda.synchronize(device)
        return True
    except RuntimeError:
        return False


def gpu_mismatch_help(gpu_name: str, err: str) -> str:
    cuda_ver = getattr(torch.version, "cuda", "?")
    return (
        f"GPU '{gpu_name}' tidak kompatibel dengan PyTorch {torch.__version__} (CUDA {cuda_ver}). "
        f"Detail: {err}\n"
        "Solusi cepat: pakai pod RTX 4090 / 3090 / L4 / A5000 "
        '(RUNPOD_GPU_TYPE="NVIDIA GeForce RTX 4090").\n'
        "GPU Blackwell (RTX PRO 4500/4000) butuh PyTorch CUDA 12.4+ — belum didukung setup saat ini."
    )


def resolve_use_float16(requested: bool, gpu_id: int = 0) -> bool:
    env = os.environ.get("MUSETALK_USE_FLOAT16", "").strip().lower()
    if env in ("0", "false", "no"):
        return False
    if env in ("1", "true", "yes"):
        if not torch.cuda.is_available():
            return False
        ok, err = cuda_basic_ok(gpu_id)
        if not ok:
            raise RuntimeError(gpu_mismatch_help(gpu_label(gpu_id), err))
        return True

    if not requested or not torch.cuda.is_available():
        return False

    ok, err = cuda_basic_ok(gpu_id)
    if not ok:
        raise RuntimeError(gpu_mismatch_help(gpu_label(gpu_id), err))

    if not cuda_fp16_ok(gpu_id):
        print(
            f"[MuseTalk] GPU {gpu_label(gpu_id)} tidak mendukung FP16 — memakai FP32",
            flush=True,
        )
        return False

    return True


def log_gpu_status(gpu_id: int = 0) -> None:
    if not torch.cuda.is_available():
        print("[GPU] CUDA tidak tersedia — inferensi akan lambat (CPU)", flush=True)
        return
    name = gpu_label(gpu_id)
    cap = torch.cuda.get_device_capability(gpu_id)
    fp16 = cuda_fp16_ok(gpu_id)
    print(
        f"[GPU] {name} | compute {cap[0]}.{cap[1]} | "
        f"torch {torch.__version__} cu{torch.version.cuda} | fp16={'yes' if fp16 else 'no'}",
        flush=True,
    )
