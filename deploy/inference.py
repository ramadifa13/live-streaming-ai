import os
import cv2
import math
import copy
import torch
import glob
import shutil
import pickle
import argparse
import json
import numpy as np
import subprocess
import threading
from tqdm import tqdm
from omegaconf import OmegaConf
from transformers import WhisperModel
import sys

from musetalk.utils.blending import get_image_prepare_material, get_image_blending, get_image
from musetalk.utils.face_parsing import FaceParsing
from musetalk.utils.audio_processor import AudioProcessor
from musetalk.utils.utils import get_file_type, get_video_fps, datagen, load_all_model

# Jangan import musetalk.utils.preprocessing di top-level:
# file itu load mmpose + init DWPose saat import. Cukup definisi sentinel di sini.
coord_placeholder = (0.0, 0.0, 0.0, 0.0)

try:
    from gpu_compat import log_gpu_status, resolve_use_float16
except ImportError:
    _worker_root = os.environ.get("WORKER_ROOT", "/workspace/ai_live_worker")
    if _worker_root not in sys.path:
        sys.path.insert(0, _worker_root)
    from gpu_compat import log_gpu_status, resolve_use_float16

try:
    from video_canvas import CANVAS_H, CANVAS_W, fit_bgr
except ImportError:
    _worker_root = os.environ.get("WORKER_ROOT", "/workspace/ai_live_worker")
    if _worker_root not in sys.path:
        sys.path.insert(0, _worker_root)
    try:
        from video_canvas import CANVAS_H, CANVAS_W, fit_bgr
    except ImportError:
        CANVAS_W, CANVAS_H = 720, 1280

        def fit_bgr(frame, width=CANVAS_W, height=CANVAS_H):
            return frame


def _env_flag(name: str, default: str = "1") -> bool:
    return (os.environ.get(name, default) or default).strip().lower() not in (
        "0",
        "false",
        "off",
        "no",
        "none",
    )


def musetalk_visual_params():
    """Crop wajah untuk MuseTalk — cukup rahang agar mulut bisa buka."""
    bbox_shift = int(os.environ.get("MUSETALK_BBOX_SHIFT", "0"))
    extra_margin = int(os.environ.get("MUSETALK_EXTRA_MARGIN", "10"))
    upper_boundary_ratio = float(os.environ.get("MUSETALK_UPPER_BOUNDARY", "0.50"))
    # Preset lama menekan gerak bibir (hanya kedip).
    if bbox_shift == -5 and extra_margin <= 4 and upper_boundary_ratio >= 0.56:
        print(
            "[MuseTalk] Crop lama (bbox=-5, margin<=4, upper>=0.56) — "
            "dipakai crop rahang bbox=0 extra=10 upper=0.50"
        )
        bbox_shift, extra_margin, upper_boundary_ratio = 0, 10, 0.50
    return {
        "bbox_shift": bbox_shift,
        "extra_margin": extra_margin,
        "parsing_mode": (os.environ.get("MUSETALK_PARSING_MODE") or "jaw").strip() or "jaw",
        "upper_boundary_ratio": upper_boundary_ratio,
        "square_pad": _env_flag("MUSETALK_SQUARE_PAD", "1"),
        "left_cheek_width": int(os.environ.get("MUSETALK_CHEEK_WIDTH", "80")),
        "right_cheek_width": int(os.environ.get("MUSETALK_CHEEK_WIDTH", "80")),
    }


def square_pad_face(crop: np.ndarray):
    """Pad crop wajah ke persegi sebelum di-resize 256 — cegah mulut ketarik vertikal."""
    if crop is None or crop.size == 0:
        return crop, (0, 0, 0, 0)
    h, w = crop.shape[:2]
    if h <= 0 or w <= 0:
        return crop, (0, 0, 0, 0)
    side = max(h, w)
    top = (side - h) // 2
    bottom = side - h - top
    left = (side - w) // 2
    right = side - w - left
    if top == 0 and bottom == 0 and left == 0 and right == 0:
        return crop, (0, 0, 0, 0)
    padded = cv2.copyMakeBorder(
        crop, top, bottom, left, right, cv2.BORDER_REPLICATE
    )
    return padded, (top, bottom, left, right)


def unpad_generated_face(generated, bbox_w: int, bbox_h: int) -> np.ndarray:
    """Resize hasil 256x256 ke persegi bbox, lalu crop kembali ke rasio asli."""
    bw = max(1, int(bbox_w))
    bh = max(1, int(bbox_h))
    side = max(bw, bh)
    square = cv2.resize(
        generated.astype(np.uint8), (side, side), interpolation=cv2.INTER_CUBIC
    )
    top = (side - bh) // 2
    left = (side - bw) // 2
    return square[top : top + bh, left : left + bw]


def encode_face_for_vae(crop: np.ndarray, square_pad: bool = True) -> np.ndarray:
    """Siapkan crop wajah 256x256 untuk VAE tanpa merusak rasio aspek."""
    src = crop
    if square_pad:
        src, _ = square_pad_face(crop)
    return cv2.resize(src, (256, 256), interpolation=cv2.INTER_LANCZOS4)


def resize_generated_to_bbox(
    generated, bbox, square_pad: bool = True
) -> np.ndarray:
    x1, y1, x2, y2 = [int(v) for v in bbox]
    bw, bh = max(1, x2 - x1), max(1, y2 - y1)
    if square_pad:
        return unpad_generated_face(generated, bw, bh)
    return cv2.resize(
        generated.astype(np.uint8), (bw, bh), interpolation=cv2.INTER_CUBIC
    )


def _extract_landmarks_from_frames(frames, bbox_shift=0):
    """
    Ekstraksi landmark dan bounding box langsung dari list frame array numpy (RAM).
    Tidak menggunakan penulisan/pembacaan file PNG ke disk sehingga bebas error imread.
    """
    try:
        from musetalk.utils.preprocessing import model as dwpose_model, fa as face_align_model
        from mmpose.apis import inference_topdown
        from mmpose.structures import merge_data_samples

        print(f"[Landmarks] Extracting landmarks for {len(frames)} frames (bbox_shift={bbox_shift})")
        coords_list = []
        failed_frames = 0
        for i, frame in enumerate(frames):
            try:
                results = inference_topdown(dwpose_model, frame)
                results = merge_data_samples(results)
                keypoints = results.pred_instances.keypoints
                face_land_mark = keypoints[0][23:91].astype(np.int32)

                bbox = face_align_model.get_detections_for_batch(np.asarray([frame]))
                f = bbox[0] if bbox else None
                if f is None:
                    coords_list.append(coord_placeholder)
                    failed_frames += 1
                    continue

                half_face_coord = face_land_mark[29].copy()
                if bbox_shift != 0:
                    half_face_coord[1] = bbox_shift + half_face_coord[1]

                half_face_dist = np.max(face_land_mark[:, 1]) - half_face_coord[1]
                upper_bond = max(0, half_face_coord[1] - half_face_dist)

                f_landmark = (
                    int(np.min(face_land_mark[:, 0])),
                    int(upper_bond),
                    int(np.max(face_land_mark[:, 0])),
                    int(np.max(face_land_mark[:, 1])),
                )
                x1, y1, x2, y2 = f_landmark
                if y2 - y1 <= 0 or x2 - x1 <= 0 or x1 < 0:
                    coords_list.append(tuple(map(int, f)))
                else:
                    coords_list.append(f_landmark)
            except Exception as e:
                failed_frames += 1
                if failed_frames <= 3:
                    print(f"[Landmarks] Frame {i} landmark extraction failed: {e}")
                try:
                    bbox = face_align_model.get_detections_for_batch(np.asarray([frame]))
                    if bbox and bbox[0] is not None:
                        coords_list.append(tuple(map(int, bbox[0])))
                    else:
                        coords_list.append(coord_placeholder)
                except Exception as e2:
                    if failed_frames <= 3:
                        print(f"[Landmarks] Frame {i} face_align fallback failed: {e2}")
                    coords_list.append(coord_placeholder)
        
        if failed_frames > 0:
            print(f"[Landmarks] WARNING: {failed_frames}/{len(frames)} frames failed landmark extraction")
        return coords_list
    except Exception as e:
        import traceback
        print(f"[Landmarks] ERROR: Failed to initialize landmark models: {e}")
        traceback.print_exc()
        print("[Landmarks] CRITICAL: Falling back to center bbox - lip-sync will NOT work correctly!")
        h, w = frames[0].shape[:2]
        cx, cy = w // 2, h // 2
        fw, fh = int(w * 0.45), int(h * 0.55)
        fallback_bbox = (max(0, cx - fw // 2), max(0, cy - fh // 2), min(w, cx + fw // 2), min(h, cy + fh // 2))
        return [fallback_bbox] * len(frames)

# Enable cuDNN benchmark for faster convolutions on fixed-size tensors
if torch.cuda.is_available():
    torch.backends.cudnn.benchmark = True

_lock = threading.Lock()
_models_cache = {}
_avatar_assets_cache = {}


def _want_raw_feed() -> bool:
    flag = (os.environ.get("MUSETALK_RAW_FEED") or "").strip().lower()
    if flag in ("1", "true", "yes", "on"):
        return True
    if flag in ("0", "false", "no", "off"):
        return False
    mode = (os.environ.get("BROADCAST_MODE") or "").strip().lower()
    return mode in ("frame_feed", "frame-feed", "continuous")


def _want_skip_mp4(raw_feed: bool) -> bool:
    """Di mode frame_feed, skip H264 — hemat waktu & hindari double-encode."""
    if not raw_feed:
        return False
    flag = (os.environ.get("MUSETALK_SKIP_MP4") or "1").strip().lower()
    return flag not in ("0", "false", "no", "off")


def _cycle_state_path(args) -> str:
    explicit = os.environ.get("MUSETALK_CYCLE_STATE", "").strip()
    if explicit:
        return explicit
    return os.path.join(getattr(args, "result_dir", "./results") or "./results", "cycle_state.json")


def _load_cycle_offset(video_path: str, args) -> int:
    """Lanjutkan indeks cycle antar clip supaya pose tubuh tidak reset ke frame-0."""
    path = _cycle_state_path(args)
    try:
        if not os.path.exists(path):
            return 0
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        key = os.path.abspath(video_path)
        return int(data.get(key, data.get("last_offset", 0)) or 0)
    except Exception:
        return 0


def _save_cycle_offset(video_path: str, offset: int, args) -> None:
    path = _cycle_state_path(args)
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        data = {}
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh) or {}
            except Exception:
                data = {}
        key = os.path.abspath(video_path)
        data[key] = int(offset)
        data["last_offset"] = int(offset)
        data["last_video"] = key
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
    except Exception as err:
        print(f"[MuseTalk] cycle state notice: {err}")


def fast_check_ffmpeg():
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return True
    except Exception:
        return False


def _nn_device(module) -> str:
    """Device of an nn.Module without raising StopIteration (empty params)."""
    if module is None:
        return "none"
    try:
        params = getattr(module, "parameters", None)
        if callable(params):
            first = next(params(), None)
            if first is not None:
                return str(first.device)
        buffers = getattr(module, "buffers", None)
        if callable(buffers):
            first = next(buffers(), None)
            if first is not None:
                return str(first.device)
        device = getattr(module, "device", None)
        if device is not None:
            return str(device)
    except Exception as err:
        return f"n/a ({err})"
    return "n/a"


def _load_models_cached(args):
    global _models_cache
    gpu_id = getattr(args, "gpu_id", 0)
    use_float16 = resolve_use_float16(getattr(args, "use_float16", True), gpu_id)
    cache_key = (
        gpu_id,
        use_float16,
        getattr(args, "version", "v15"),
        getattr(args, "left_cheek_width", 90),
        getattr(args, "right_cheek_width", 90),
        getattr(args, "unet_model_path", "./models/musetalkV15/unet.pth"),
        getattr(args, "unet_config", "./models/musetalkV15/musetalk.json"),
        getattr(args, "whisper_dir", "./models/whisper"),
        getattr(args, "vae_type", "sd-vae-ft-mse"),
    )

    if cache_key not in _models_cache:
        with _lock:
            if cache_key not in _models_cache:
                device = torch.device(f"cuda:{gpu_id}" if torch.cuda.is_available() else "cpu")
                print(f"[MuseTalk-Cache] 🚀 Loading all models to {device} (fp16={use_float16})...")
                
                # Verify model files exist
                for model_path, name in [
                    (args.unet_model_path, "UNet"),
                    (args.unet_config, "UNet config"),
                    (args.whisper_dir, "Whisper"),
                ]:
                    if not os.path.exists(model_path):
                        raise FileNotFoundError(f"{name} not found at {model_path}")
                
                vae, unet, pe = load_all_model(
                    unet_model_path=args.unet_model_path,
                    vae_type=args.vae_type,
                    unet_config=args.unet_config,
                    device=device
                )
                timesteps = torch.tensor([0], device=device)

                if use_float16:
                    pe = pe.half()
                    vae.vae = vae.vae.half()
                    unet.model = unet.model.half()

                pe = pe.to(device).eval()
                vae.vae = vae.vae.to(device).eval()
                unet.model = unet.model.to(device).eval()

                audio_processor = AudioProcessor(feature_extractor_path=args.whisper_dir)
                weight_dtype = unet.model.dtype
                whisper = WhisperModel.from_pretrained(args.whisper_dir)
                whisper = whisper.to(device=device, dtype=weight_dtype).eval()
                whisper.requires_grad_(False)

                if getattr(args, "version", "v15") == "v15":
                    fp = FaceParsing(
                        left_cheek_width=getattr(args, "left_cheek_width", 90),
                        right_cheek_width=getattr(args, "right_cheek_width", 90)
                    )
                else:
                    fp = FaceParsing()

                print("[MuseTalk-Cache] Validating models...")
                print(f"  - VAE: {vae.__class__.__name__}, device={_nn_device(getattr(vae, 'vae', vae))}")
                print(f"  - UNet: {unet.model.__class__.__name__}, device={_nn_device(unet.model)}")
                print(f"  - PE: {pe.__class__.__name__}, device={_nn_device(pe)}")
                print(f"  - Whisper: {whisper.__class__.__name__}, device={_nn_device(whisper)}")
                print(f"  - FaceParsing: {fp.__class__.__name__}")
                print(f"  - dtype: {weight_dtype}")

                _models_cache[cache_key] = {
                    'vae': vae,
                    'unet': unet,
                    'pe': pe,
                    'whisper': whisper,
                    'fp': fp,
                    'audio_processor': audio_processor,
                    'device': device,
                    'weight_dtype': weight_dtype,
                    'timesteps': timesteps,
                }
                print("[MuseTalk-Cache] ✅ All models loaded and validated successfully")

    return _models_cache[cache_key]


def _get_avatar_materials(
    video_path,
    bbox_shift,
    extra_margin,
    version,
    parsing_mode,
    vae,
    fp,
    default_fps=25,
    upper_boundary_ratio=None,
    square_pad=None,
):
    """
    Pre-cache all decoded frames, landmark bounding boxes, VAE latents, and blending masks in RAM.
    Subsequent tasks for the same avatar will fetch materials instantly in 0 ms.
    """
    global _avatar_assets_cache
    vis = musetalk_visual_params()
    if upper_boundary_ratio is None:
        upper_boundary_ratio = vis["upper_boundary_ratio"]
    if square_pad is None:
        square_pad = vis["square_pad"]
    global _avatar_assets_cache
    cache_key = (
        os.path.abspath(video_path),
        bbox_shift,
        extra_margin,
        version,
        parsing_mode,
        round(float(upper_boundary_ratio), 3),
        bool(square_pad),
        CANVAS_W,
        CANVAS_H,
    )

    if cache_key in _avatar_assets_cache:
        return _avatar_assets_cache[cache_key]

    with _lock:
        if cache_key in _avatar_assets_cache:
            return _avatar_assets_cache[cache_key]

        print(f"[AvatarCache] ⏳ Pre-processing avatar assets in RAM for: {os.path.basename(video_path)}...")
        
        # 1. Read frames using OpenCV VideoCapture directly (no PNG dump to disk)
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or default_fps
        frame_list = []
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break
            frame_list.append(fit_bgr(frame, CANVAS_W, CANVAS_H))
        cap.release()

        if not frame_list:
            raise ValueError(f"Could not read frames from video: {video_path}")

        # 2. Get landmarks / bounding boxes
        input_basename = os.path.splitext(os.path.basename(video_path))[0]
        pkl_path = os.path.join(os.path.dirname(video_path), f"{input_basename}_coords.pkl")
        
        frame_h, frame_w = frame_list[0].shape[:2]
        cache_signature = {
            "format": 3,
            "frames": len(frame_list),
            "width": frame_w,
            "height": frame_h,
            "bbox_shift": bbox_shift,
            "extra_margin": extra_margin,
            "upper_boundary_ratio": round(float(upper_boundary_ratio), 3),
            "square_pad": bool(square_pad),
        }

        # Cache landmark disimpan sebagai koordinat piksel absolut, jadi cache
        # menjadi salah begitu klip diganti atau diubah resolusinya. Nama file
        # pkl tidak menyimpan resolusi maupun bbox_shift, sehingga tanpa
        # validasi ini cache basi akan dipakai diam-diam dan wajah ter-crop di
        # posisi yang salah sepanjang siaran.
        coord_list = None
        if os.path.exists(pkl_path):
            try:
                with open(pkl_path, 'rb') as f:
                    cached = pickle.load(f)
                if (
                    isinstance(cached, dict)
                    and cached.get("signature") == cache_signature
                ):
                    coord_list = cached["coords"]
                else:
                    print(
                        f"[AvatarCache] ♻️ Cache landmark {os.path.basename(pkl_path)} "
                        "tidak cocok dengan klip saat ini — mengekstrak ulang."
                    )
            except Exception as cache_err:
                print(f"[AvatarCache] Cache landmark gagal dibaca: {cache_err}")

        if coord_list is None:
            coord_list = _extract_landmarks_from_frames(frame_list, bbox_shift)
            try:
                with open(pkl_path, 'wb') as f:
                    pickle.dump(
                        {"signature": cache_signature, "coords": coord_list}, f
                    )
            except Exception:
                pass

        # 3. Calculate VAE latents for cropped face frames
        input_latent_list = []
        mask_materials = []
        last_bbox = None

        for bbox, frame in zip(coord_list, frame_list):
            use_bbox = bbox
            if bbox == coord_placeholder:
                use_bbox = last_bbox
            if use_bbox is None or use_bbox == coord_placeholder:
                input_latent_list.append(None)
                mask_materials.append(None)
                continue
            last_bbox = use_bbox
            x1, y1, x2, y2 = [int(v) for v in use_bbox]
            x1 = max(0, min(x1, frame.shape[1] - 2))
            x2 = max(x1 + 1, min(x2, frame.shape[1]))
            y1 = max(0, min(y1, frame.shape[0] - 2))
            if version == "v15":
                y2 = y2 + extra_margin
            y2 = max(y1 + 1, min(y2, frame.shape[0]))
            crop_frame = frame[y1:y2, x1:x2]
            if crop_frame.size == 0:
                input_latent_list.append(None)
                mask_materials.append(None)
                continue
            crop_frame_resized = encode_face_for_vae(crop_frame, square_pad=square_pad)
            latents = vae.get_latents_for_unet(crop_frame_resized)
            input_latent_list.append(latents)

            try:
                mask_array, crop_box = get_image_prepare_material(
                    frame,
                    [x1, y1, x2, y2],
                    upper_boundary_ratio=float(upper_boundary_ratio),
                    fp=fp,
                    mode=parsing_mode,
                )
                mask_materials.append((mask_array, crop_box, [x1, y1, x2, y2]))
            except Exception as e:
                print(f"[AvatarCache] Frame {len(input_latent_list)-1}: mask generation failed: {e}")
                mask_materials.append(None)

        # Fill any missing latents from nearest neighbour so index == frame index
        valid_idx = next((i for i, lat in enumerate(input_latent_list) if lat is not None), None)
        if valid_idx is None:
            raise ValueError(f"No face detected in avatar video: {video_path}")
        last_lat = input_latent_list[valid_idx]
        last_mat = mask_materials[valid_idx]
        for i in range(len(input_latent_list)):
            if input_latent_list[i] is None:
                input_latent_list[i] = last_lat
                mask_materials[i] = last_mat
            else:
                last_lat = input_latent_list[i]
                if mask_materials[i] is not None:
                    last_mat = mask_materials[i]

        # Smooth cycle (forward + backward)
        frame_list_cycle = frame_list + frame_list[::-1]
        coord_list_cycle = coord_list + coord_list[::-1]
        input_latent_list_cycle = input_latent_list + input_latent_list[::-1]
        mask_materials_cycle = mask_materials + mask_materials[::-1]

        material_bundle = {
            'fps': float(default_fps) or 25.0,
            'frame_list_cycle': frame_list_cycle,
            'coord_list_cycle': coord_list_cycle,
            'input_latent_list_cycle': input_latent_list_cycle,
            'mask_materials_cycle': mask_materials_cycle,
            'height': frame_list[0].shape[0],
            'width': frame_list[0].shape[1],
        }
        _avatar_assets_cache[cache_key] = material_bundle
        print(f"[AvatarCache] ✅ Avatar {input_basename} cached ({len(frame_list)} frames, {len(input_latent_list_cycle)} cycles).")
        return material_bundle


@torch.no_grad()
def main(args):
    # Configure ffmpeg path if provided
    if args.ffmpeg_path and os.path.exists(args.ffmpeg_path):
        path_separator = ';' if sys.platform == 'win32' else ':'
        os.environ["PATH"] = f"{args.ffmpeg_path}{path_separator}{os.environ['PATH']}"
    
    # 1. Load cached models (0 ms after first warm task)
    models = _load_models_cached(args)
    vae = models['vae']
    unet = models['unet']
    pe = models['pe']
    whisper = models['whisper']
    fp = models['fp']
    audio_processor = models['audio_processor']
    device = models['device']
    weight_dtype = models['weight_dtype']
    timesteps = models['timesteps']

    # 2. Load inference tasks config
    inference_config = OmegaConf.load(args.inference_config)

    for task_id in inference_config:
        try:
            task_info = inference_config[task_id]
            video_path = task_info["video_path"]
            audio_path = task_info["audio_path"]
            
            if not os.path.exists(video_path):
                raise FileNotFoundError(f"Video file not found: {video_path}")
            if not os.path.exists(audio_path):
                raise FileNotFoundError(f"Audio file not found: {audio_path}")

            output_vid_name = task_info.get("result_name") or args.output_vid_name
            if not output_vid_name:
                input_basename = os.path.splitext(os.path.basename(video_path))[0]
                audio_basename = os.path.splitext(os.path.basename(audio_path))[0]
                output_vid_name = f"{input_basename}_{audio_basename}.mp4"

            # Set output directory
            temp_dir = os.path.join(args.result_dir, f"{args.version}")
            os.makedirs(temp_dir, exist_ok=True)
            final_output_path = os.path.join(temp_dir, output_vid_name)

            vis = musetalk_visual_params()
            bbox_shift = vis["bbox_shift"] if args.version == "v15" else task_info.get("bbox_shift", args.bbox_shift)
            extra_margin = vis["extra_margin"]
            if args.extra_margin != 10:
                extra_margin = args.extra_margin
            if args.version != "v15" and args.bbox_shift:
                bbox_shift = args.bbox_shift

            # 3. Retrieve pre-cached avatar materials (0 ms)
            materials = _get_avatar_materials(
                video_path=video_path,
                bbox_shift=bbox_shift,
                extra_margin=extra_margin,
                version=args.version,
                parsing_mode=args.parsing_mode,
                vae=vae,
                fp=fp,
                default_fps=args.fps,
                upper_boundary_ratio=vis["upper_boundary_ratio"],
                square_pad=vis["square_pad"],
            )
            frame_list_cycle = materials['frame_list_cycle']
            coord_list_cycle = materials['coord_list_cycle']
            input_latent_list_cycle = materials['input_latent_list_cycle']
            mask_materials_cycle = materials['mask_materials_cycle']
            fps = float(getattr(args, "fps", 25) or 25)
            vid_w, vid_h = CANVAS_W, CANVAS_H

            # 4. Extract audio Whisper features (~100-200ms)
            whisper_input_features, librosa_length = audio_processor.get_audio_feature(audio_path)
            whisper_chunks = audio_processor.get_whisper_chunk(
                whisper_input_features,
                device,
                weight_dtype,
                whisper,
                librosa_length,
                fps=fps,
                audio_padding_length_left=args.audio_padding_length_left,
                audio_padding_length_right=args.audio_padding_length_right,
            )

            # 5. Fast Batch Inference (~1-2s with batch_size >= 16)
            # delay_frame = offset cycle dari clip sebelumnya → tubuh tidak loncat ke frame-0.
            video_num = len(whisper_chunks)
            batch_size = max(1, args.batch_size)
            delay_frame = _load_cycle_offset(video_path, args) % max(1, len(input_latent_list_cycle))
            gen = datagen(
                whisper_chunks=whisper_chunks,
                vae_encode_latents=input_latent_list_cycle,
                batch_size=batch_size,
                delay_frame=delay_frame,
                device=device,
            )

            res_frame_list = []
            for whisper_batch, latent_batch in gen:
                audio_feature_batch = pe(whisper_batch)
                latent_batch = latent_batch.to(dtype=weight_dtype)
                pred_latents = unet.model(latent_batch, timesteps, encoder_hidden_states=audio_feature_batch).sample
                recon = vae.decode_latents(pred_latents)
                for res_frame in recon:
                    res_frame_list.append(res_frame)

            # 6. Blend + handoff: raw .ffseg (frame_feed) dan/atau MP4 (segment)
            raw_feed = _want_raw_feed()
            skip_mp4 = _want_skip_mp4(raw_feed)
            num_cycles = len(frame_list_cycle)
            stem = os.path.splitext(os.path.basename(output_vid_name))[0]
            ffseg_dir = os.path.join(temp_dir, f"{stem}.ffseg")

            ffmpeg_proc = None
            if not skip_mp4:
                ffmpeg_cmd = [
                    "ffmpeg",
                    "-y",
                    "-v", "error",
                    "-f", "rawvideo",
                    "-pix_fmt", "bgr24",
                    "-s", f"{vid_w}x{vid_h}",
                    "-r", str(fps),
                    "-i", "pipe:0",
                    "-i", audio_path,
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-b:v", "2500k",
                    "-maxrate", "3000k",
                    "-bufsize", "6000k",
                    "-g", "50",
                    "-keyint_min", "50",
                    "-sc_threshold", "0",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-ar", "44100",
                    "-shortest",
                    final_output_path
                ]
                ffmpeg_proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

            # Import lokal agar path MuseTalk/worker tetap valid saat chdir.
            write_ffseg = None
            audio_to_pcm_s16le = None
            FfsegWriter = None
            try:
                from ffseg import audio_to_pcm_s16le, write_ffseg, FfsegWriter
            except ImportError:
                worker_root = os.environ.get("WORKER_ROOT", "/workspace/ai_live_worker")
                for p in (
                    worker_root,
                    os.path.dirname(os.path.abspath(__file__)),
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                ):
                    if p and p not in sys.path:
                        sys.path.insert(0, p)
                try:
                    from ffseg import audio_to_pcm_s16le, write_ffseg, FfsegWriter
                except ImportError:
                    pass

            ffseg_writer = None
            if raw_feed and FfsegWriter is not None:
                try:
                    ffseg_writer = FfsegWriter(
                        ffseg_dir,
                        width=int(vid_w),
                        height=int(vid_h),
                        fps=float(fps),
                        sample_rate=44100,
                        channels=2,
                    )
                except Exception as open_err:
                    print(f"[MuseTalk-Fast] ffseg writer notice: {open_err}")
                    ffseg_writer = None

            for i, res_frame in enumerate(res_frame_list):
                cycle_idx = (delay_frame + i) % num_cycles
                ori_frame = frame_list_cycle[cycle_idx]
                mat = mask_materials_cycle[cycle_idx]

                if mat is not None:
                    mask_array, crop_box, face_box = mat
                    try:
                        res_frame_resized = resize_generated_to_bbox(
                            res_frame, face_box, square_pad=vis["square_pad"]
                        )
                        combine_frame = get_image_blending(ori_frame, res_frame_resized, face_box, mask_array, crop_box)
                    except Exception:
                        combine_frame = ori_frame
                else:
                    bbox = coord_list_cycle[cycle_idx]
                    x1, y1, x2, y2 = bbox
                    if args.version == "v15":
                        y2 = min(y2 + extra_margin, ori_frame.shape[0])
                    try:
                        res_frame_resized = resize_generated_to_bbox(
                            res_frame, [x1, y1, x2, y2], square_pad=vis["square_pad"]
                        )
                        combine_frame = get_image(
                            ori_frame,
                            res_frame_resized,
                            [x1, y1, x2, y2],
                            upper_boundary_ratio=vis["upper_boundary_ratio"],
                            mode=args.parsing_mode,
                            fp=fp,
                        )
                    except Exception:
                        combine_frame = ori_frame

                combine_frame = fit_bgr(combine_frame, CANVAS_W, CANVAS_H)

                if ffseg_writer is not None:
                    ffseg_writer.write_frame(combine_frame)

                if ffmpeg_proc is not None and ffmpeg_proc.stdin is not None:
                    try:
                        ffmpeg_proc.stdin.write(combine_frame.tobytes())
                    except (BrokenPipeError, IOError):
                        pass

            if ffmpeg_proc is not None:
                if ffmpeg_proc.stdin:
                    try:
                        ffmpeg_proc.stdin.close()
                    except Exception:
                        pass
                ffmpeg_proc.wait()

            if ffseg_writer is not None:
                pcm = b""
                if audio_to_pcm_s16le is not None:
                    pcm = audio_to_pcm_s16le(audio_path, sample_rate=44100, channels=2)
                try:
                    written = ffseg_writer.finalize(pcm)
                    print(f"[MuseTalk-Fast] 📦 Raw ffseg siap: {written} ({ffseg_writer.frame_count} frames)")
                except Exception as ffseg_err:
                    print(f"[MuseTalk-Fast] ffseg notice: {ffseg_err}")
                    try:
                        ffseg_writer.abort()
                    except Exception:
                        pass
                    if skip_mp4:
                        raise

            next_offset = (delay_frame + len(res_frame_list)) % max(1, num_cycles)
            _save_cycle_offset(video_path, next_offset, args)
            out_label = ffseg_dir if (raw_feed and skip_mp4) else final_output_path
            print(
                f"[MuseTalk-Fast] 🚀 Generated: {out_label} "
                f"(cycle {delay_frame}→{next_offset}, raw={raw_feed}, skip_mp4={skip_mp4})"
            )

        except Exception as e:
            print(f"[MuseTalk-Fast ERROR] Failed processing {task_id}: {e}")
            raise e


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg_path", type=str, default="", help="Path to ffmpeg executable")
    parser.add_argument("--gpu_id", type=int, default=0, help="GPU ID to use")
    parser.add_argument("--vae_type", type=str, default="sd-vae-ft-mse", help="Type of VAE model")
    parser.add_argument("--unet_config", type=str, default="./models/musetalkV15/musetalk.json", help="Path to UNet config")
    parser.add_argument("--unet_model_path", type=str, default="./models/musetalkV15/unet.pth", help="Path to UNet model weights")
    parser.add_argument("--whisper_dir", type=str, default="./models/whisper", help="Directory containing Whisper model")
    parser.add_argument("--inference_config", type=str, default="configs/inference/test_img.yaml", help="Inference config")
    parser.add_argument("--bbox_shift", type=int, default=0, help="Bounding box shift value")
    parser.add_argument("--result_dir", default='./results', help="Directory for output results")
    parser.add_argument("--extra_margin", type=int, default=10, help="Extra margin for face cropping")
    parser.add_argument("--fps", type=int, default=25, help="Video frames per second")
    parser.add_argument("--audio_padding_length_left", type=int, default=2, help="Left padding length for audio")
    parser.add_argument("--audio_padding_length_right", type=int, default=2, help="Right padding length for audio")
    parser.add_argument("--batch_size", type=int, default=16, help="Batch size for inference")
    parser.add_argument("--output_vid_name", type=str, default=None, help="Name of output video file")
    parser.add_argument("--use_saved_coord", action="store_true", help='Use saved coordinates')
    parser.add_argument("--saved_coord", action="store_true", help='Save coordinates')
    parser.add_argument("--use_float16", action="store_true", default=True, help="Use float16")
    parser.add_argument("--parsing_mode", default='jaw', help="Face blending parsing mode")
    parser.add_argument("--left_cheek_width", type=int, default=90, help="Width of left cheek region")
    parser.add_argument("--right_cheek_width", type=int, default=90, help="Width of right cheek region")
    parser.add_argument("--version", type=str, default="v15", choices=["v1", "v15"], help="Model version")
    args = parser.parse_args()
    main(args)
