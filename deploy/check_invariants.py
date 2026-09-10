"""Gagal cepat di pod/sync — cegah regresi RTMP + lip-sync + continuity."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _fail(msg: str) -> None:
    print(f"[INVARIANT] FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def check_rtmp_utils() -> None:
    sys.path.insert(0, str(ROOT))
    from rtmp_utils import extract_rtmp_hostname, is_deferred_rtmp_ack, validate_publish_url

    url = "rtmps://edgetee-upload-sin11-1.xx.fbcdn.net:443/rtmp/dummykey"
    host = extract_rtmp_hostname(url)
    if "fbcdn.net" not in host:
        _fail(f"extract_rtmp_hostname salah: {host!r}")
    validate_publish_url(url)
    if not is_deferred_rtmp_ack(url):
        _fail("Instagram/FB URL harus deferred ACK")
    print("[INVARIANT] rtmp_utils OK")


def check_lipsync_not_forced_on_any_clip() -> None:
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    tree = ast.parse(src)
    text = src.replace("\r\n", "\n")
    # Regresi: whisper_idx saja tidak boleh memaksa lipsync tanpa cek clip talk.
    bad = (
        "if whisper_idx is not None:\n            pkt.needs_lipsync = True"
        in text
        or "if whisper_idx is not None:\n        pkt.needs_lipsync = True" in text
    )
    if bad:
        _fail("lipsync dipaksa hanya karena whisper_idx (harus cek clip talk)")
    has_pin = any(
        isinstance(n, ast.FunctionDef) and n.name == "pin_talk_body" for n in ast.walk(tree)
    )
    if not has_pin:
        _fail("pin_talk_body hilang dari VideoStateMachine")
    print("[INVARIANT] ai_worker lipsync/pin OK")


def check_seamless_contract() -> None:
    """is_seamless_loop harus pakai seamless_score, bukan base==end index."""
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    if "seamless_score" not in src:
        _fail("ClipAsset.seamless_score hilang")
    if "SEAMLESS_THRESHOLD" not in src:
        _fail("SEAMLESS_THRESHOLD hilang")
    # Regresi bug lama: base_pose_frame == end_pose sebagai satu-satunya cek.
    bad = (
        "return self.base_pose_frame == self.end_pose" in src
        and "seamless_score" not in src.split("def is_seamless_loop")[1][:400]
    )
    # Soft check: pastikan property memakai seamless_score
    if "def is_seamless_loop" in src:
        body = src.split("def is_seamless_loop")[1][:500]
        if "seamless_score" not in body:
            _fail("is_seamless_loop tidak memakai seamless_score")
    if "PIN_TALK_SCENE" not in src:
        _fail("PIN_TALK_SCENE (continuous body timeline) hilang")
    if "MOUTH_MISS_BODY_ONLY" not in src:
        _fail("MOUTH_MISS_BODY_ONLY hilang")
    if "LIPSYNC_HARD_PREROLL" not in src:
        _fail("LIPSYNC_HARD_PREROLL hilang")
    for needle in (
        'CONTINUOUS_CLIP_NAME = "continuous"',
        "target=continuous_broadcaster_loop",
        "full-prerender contract violated",
        "if consumed_seq:",
    ):
        if needle not in src:
            _fail(f"continuous-only contract missing: {needle}")
    if "broadcast_lag_catchup" in src and "metrics.inc(\"broadcast_lag_catchup\")" in src:
        _fail("broadcast_lag_catchup masih aktif (penyebab loncat/audio cepat)")
    if "broadcast_seq_fast_forward" in src and "metrics.inc(\"broadcast_seq_fast_forward\")" in src:
        _fail("broadcast_seq_fast_forward masih aktif")
    if "RENDER_QUEUE_SIZE = 240" in src or "maxsize=300" in src:
        _fail("render queue terlalu dalam (harus pendek + backpressure)")
    print("[INVARIANT] seamless/continuity contract OK")


def check_validate_assets_script() -> None:
    candidates = [
        ROOT / "validate_idle_assets.py",
        ROOT / "scripts" / "validate_idle_assets.py",
        ROOT.parent / "deploy" / "scripts" / "validate_idle_assets.py",
    ]
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        _fail("validate_idle_assets.py hilang (root atau scripts/)")
    text = path.read_text(encoding="utf-8", errors="replace")
    for needle in ("seamless_score", "write-meta", "_ssim_gray"):
        if needle not in text:
            _fail(f"validate_idle_assets.py missing {needle}")
    print("[INVARIANT] validate_idle_assets.py OK")


def check_single_pipeline() -> None:
    core = (ROOT / "core_pipeline.py").read_text(encoding="utf-8", errors="replace")
    if "class StreamBroadcaster" in core or "class NewAIVisualWorker" in core:
        _fail("core_pipeline masih memiliki duplicate worker/broadcaster")
    if "NewAIVisualWorker = AIVisualWorker" not in core:
        _fail("core_pipeline bukan compatibility adapter")
    api = (ROOT / "api_server.py").read_text(encoding="utf-8", errors="replace")
    if "broadcast boot cancelled before pipeline start" not in api:
        _fail("cancelled cold-start masih dapat membuat orphan broadcaster")
    print("[INVARIANT] single pipeline adapter OK")


def check_fps_lock() -> None:
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    bridge = (ROOT / "speech_bridge.py").read_text(encoding="utf-8", errors="replace")
    for name, text in (("ai_worker", src), ("speech_bridge", bridge)):
        if "from av_timing import" not in text:
            _fail(f"{name} tidak memakai shared A/V clock")
    print("[INVARIANT] shared FPS clock OK")


def check_audio_sample_rate_contract() -> None:
    timing = (ROOT / "av_timing.py").read_text(encoding="utf-8", errors="replace")
    if "WHISPER_SAMPLE_RATE = 16_000" not in timing:
        _fail("av_timing harus tetap 16 kHz untuk Whisper/MuseTalk")
    if "BROADCAST_SAMPLE_RATE = 48_000" not in timing:
        _fail("av_timing harus 48 kHz untuk PCM siaran")
    worker = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    if '"44100"' in worker:
        _fail("FFmpeg AAC siaran masih 44100; harus 48 kHz")
    if "if not is_speech:" not in worker:
        _fail("idle freeze (hold last pose) hilang dari VideoStateMachine")
    if "samples_for_frame" not in timing:
        _fail("av_timing tidak memiliki samples_for_frame")
    print("[INVARIANT] audio sample-rate contract OK")


def main() -> None:
    check_rtmp_utils()
    check_lipsync_not_forced_on_any_clip()
    check_seamless_contract()
    check_single_pipeline()
    check_validate_assets_script()
    check_fps_lock()
    check_audio_sample_rate_contract()
    print("[INVARIANT] semua cek lolos")


if __name__ == "__main__":
    main()
