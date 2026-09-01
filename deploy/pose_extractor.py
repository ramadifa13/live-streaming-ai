"""Ekstraksi keypoint tubuh & tangan (COCO-WholeBody, model DWPose) dari frame video.

Model yang dipakai SAMA PERSIS dengan yang sudah dipakai MuseTalk untuk deteksi
wajah (lihat MuseTalk/musetalk/utils/preprocessing.py) — modul ini cuma
mengambil bagian keypoint yang selama ini dibuang MuseTalk (tubuh & tangan).
Tidak ada model/dependency baru; mmpose/mmcv sudah terpasang via setup-safe.sh.

Layout indeks COCO-WholeBody (133 titik per orang):
  0:17    -> tubuh (body)
  17:23   -> kaki (feet)
  23:91   -> wajah (face) — sudah dipakai MuseTalk untuk lip-sync
  91:112  -> tangan kiri (21 titik)
  112:133 -> tangan kanan (21 titik)
"""

import os
import sys

import numpy as np

BODY_SLICE = slice(0, 17)
FEET_SLICE = slice(17, 23)
FACE_SLICE = slice(23, 91)
LEFT_HAND_SLICE = slice(91, 112)
RIGHT_HAND_SLICE = slice(112, 133)

# Bagian yang relevan untuk morph pose/gestur (wajah biar diurus MuseTalk lip-sync).
POSE_SLICES = {
    "body": BODY_SLICE,
    "left_hand": LEFT_HAND_SLICE,
    "right_hand": RIGHT_HAND_SLICE,
}

_dwpose_model = None
_base_dir = None
_musetalk_dir = None


def configure(base_dir, musetalk_dir):
    """Panggil sekali di awal proses — dipakai saat model di-load lazy nanti."""
    global _base_dir, _musetalk_dir
    _base_dir = base_dir
    _musetalk_dir = musetalk_dir


def _ensure_model_loaded():
    global _dwpose_model
    if _dwpose_model is not None:
        return _dwpose_model
    if not _musetalk_dir or not os.path.isdir(_musetalk_dir):
        raise RuntimeError(
            "pose_extractor.configure(base_dir, musetalk_dir) belum dipanggil "
            "atau folder MuseTalk tidak ditemukan."
        )
    original_cwd = os.getcwd()
    if _base_dir and _base_dir not in sys.path:
        sys.path.insert(0, _base_dir)
    if _musetalk_dir not in sys.path:
        sys.path.insert(0, _musetalk_dir)
    try:
        # preprocessing.py memuat config/checkpoint dengan path relatif
        # ("./musetalk/...", "./models/...") — wajib chdir ke folder MuseTalk.
        os.chdir(_musetalk_dir)
        from musetalk.utils.preprocessing import model as dwpose_model
        _dwpose_model = dwpose_model
    finally:
        os.chdir(original_cwd)
    return _dwpose_model


def extract_keypoints(frame):
    """Return (keypoints[133,2] float32, scores[133] float32), atau (None, None) bila gagal."""
    try:
        model = _ensure_model_loaded()
        from mmpose.apis import inference_topdown
        from mmpose.structures import merge_data_samples

        results = inference_topdown(model, frame)
        results = merge_data_samples(results)
        keypoints = np.asarray(results.pred_instances.keypoints[0], dtype=np.float32)
        scores = getattr(results.pred_instances, "keypoint_scores", None)
        scores = (
            np.asarray(scores[0], dtype=np.float32)
            if scores is not None
            else np.ones(keypoints.shape[0], dtype=np.float32)
        )
        return keypoints, scores
    except Exception as e:
        print(f"[POSE EXTRACTOR] Gagal ekstraksi keypoint: {e}")
        return None, None


def extract_part_keypoints(frame, min_score=0.3):
    """Return dict {part_name: (points[N,2], valid_mask[N] bool)} untuk
    body/left_hand/right_hand, atau None bila deteksi gagal total."""
    keypoints, scores = extract_keypoints(frame)
    if keypoints is None:
        return None
    parts = {}
    for name, sl in POSE_SLICES.items():
        parts[name] = (keypoints[sl], scores[sl] >= min_score)
    return parts
