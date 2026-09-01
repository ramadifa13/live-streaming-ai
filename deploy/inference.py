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
from musetalk.utils.preprocessing import coord_placeholder

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

def _extract_landmarks_from_frames(frames, bbox_shift=0):
    """
    Ekstraksi landmark dan bounding box langsung dari list frame array numpy (RAM).
    Tidak menggunakan penulisan/pembacaan file PNG ke disk sehingga bebas error imread.
    """
    try:
        from musetalk.utils.preprocessing import model as dwpose_model, fa as face_align_model
        from mmpose.apis import inference_topdown
        from mmpose.structures import merge_data_samples

        coords_list = []
        for frame in frames:
            try:
                results = inference_topdown(dwpose_model, frame)
                results = merge_data_samples(results)
                keypoints = results.pred_instances.keypoints
                face_land_mark = keypoints[0][23:91].astype(np.int32)

                bbox = face_align_model.get_detections_for_batch(np.asarray([frame]))
                f = bbox[0] if bbox else None
                if f is None:
                    coords_list.append(coord_placeholder)
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
            except Exception:
                try:
                    bbox = face_align_model.get_detections_for_batch(np.asarray([frame]))
                    if bbox and bbox[0] is not None:
                        coords_list.append(tuple(map(int, bbox[0])))
                    else:
                        coords_list.append(coord_placeholder)
                except Exception:
                    coords_list.append(coord_placeholder)
        return coords_list
    except Exception as e:
        print(f"[Landmarks] Fallback center bbox: {e}")
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
                print("[MuseTalk-Cache] ✅ All models resident in VRAM. Ready for sub-second inference.")

    return _models_cache[cache_key]


def _get_avatar_materials(video_path, bbox_shift, extra_margin, version, parsing_mode, vae, fp, default_fps=25):
    """
    Pre-cache all decoded frames, landmark bounding boxes, VAE latents, and blending masks in RAM.
    Subsequent tasks for the same avatar will fetch materials instantly in 0 ms.
    """
    global _avatar_assets_cache
    cache_key = (
        os.path.abspath(video_path),
        bbox_shift,
        extra_margin,
        version,
        parsing_mode,
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
            "format": 2,
            "frames": len(frame_list),
            "width": frame_w,
            "height": frame_h,
            "bbox_shift": bbox_shift,
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
        
        for bbox, frame in zip(coord_list, frame_list):
            if bbox == coord_placeholder:
                continue
            x1, y1, x2, y2 = bbox
            if version == "v15":
                y2 = y2 + extra_margin
                y2 = min(y2, frame.shape[0])
            crop_frame = frame[y1:y2, x1:x2]
            crop_frame_resized = cv2.resize(crop_frame, (256, 256), interpolation=cv2.INTER_LANCZOS4)
            latents = vae.get_latents_for_unet(crop_frame_resized)
            input_latent_list.append(latents)

            # Pre-compute face blending mask and crop_box for instant blending during inference
            try:
                mask_array, crop_box = get_image_prepare_material(
                    frame, [x1, y1, x2, y2], fp=fp, mode=parsing_mode
                )
                mask_materials.append((mask_array, crop_box, [x1, y1, x2, y2]))
            except Exception:
                mask_materials.append(None)

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

            bbox_shift = 0 if args.version == "v15" else task_info.get("bbox_shift", args.bbox_shift)

            # 3. Retrieve pre-cached avatar materials (0 ms)
            materials = _get_avatar_materials(
                video_path=video_path,
                bbox_shift=bbox_shift,
                extra_margin=args.extra_margin,
                version=args.version,
                parsing_mode=args.parsing_mode,
                vae=vae,
                fp=fp,
                default_fps=args.fps
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
                    x1, y1, x2, y2 = face_box
                    try:
                        res_frame_resized = cv2.resize(res_frame.astype(np.uint8), (x2 - x1, y2 - y1))
                        combine_frame = get_image_blending(ori_frame, res_frame_resized, face_box, mask_array, crop_box)
                    except Exception:
                        combine_frame = ori_frame
                else:
                    bbox = coord_list_cycle[cycle_idx]
                    x1, y1, x2, y2 = bbox
                    if args.version == "v15":
                        y2 = min(y2 + args.extra_margin, ori_frame.shape[0])
                    try:
                        res_frame_resized = cv2.resize(res_frame.astype(np.uint8), (x2 - x1, y2 - y1))
                        combine_frame = get_image(ori_frame, res_frame_resized, [x1, y1, x2, y2], mode=args.parsing_mode, fp=fp)
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
