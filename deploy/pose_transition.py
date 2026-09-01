"""Pose-morph bridge — dipakai broadcaster.py untuk transisi antar dua klip
aksi avatar yang berbeda.

Teknik: dense optical flow (Farneback) dua arah antara frame akhir klip
sumber dan frame awal klip tujuan, lalu warp+blend beberapa frame antara
(bidirectional warping, sama seperti teknik "view morphing" klasik). Hasilnya
gerakan terlihat "mengalir" mengikuti arah pixel yang benar-benar bergerak,
bukan sekadar dua gambar bertumpuk transparan (seperti fade biasa) yang
terlihat seperti "hantu ganda" saat pose kedua klip berbeda.

Selalu gagal secara aman (return False) — pemanggil WAJIB fallback ke
crossfade fade biasa supaya siaran tidak pernah terhenti karena fitur ini.
"""

import os
import cv2
import numpy as np


def _read_edge_frame(video_path, from_end):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None
    frame = None
    try:
        if from_end:
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total > 0:
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total - 1))
            ok, frame = cap.read()
            if not ok:
                # Beberapa container tidak melaporkan frame count akurat —
                # baca sekuensial dan simpan frame valid terakhir.
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                last_ok = None
                while True:
                    ok2, f2 = cap.read()
                    if not ok2:
                        break
                    last_ok = f2
                frame = last_ok
        else:
            ok, frame = cap.read()
            if not ok:
                frame = None
    finally:
        cap.release()
    return frame


def _warp_by_flow(frame, flow, t):
    h, w = frame.shape[:2]
    grid_x, grid_y = np.meshgrid(np.arange(w), np.arange(h))
    map_x = (grid_x + flow[..., 0] * t).astype(np.float32)
    map_y = (grid_y + flow[..., 1] * t).astype(np.float32)
    return cv2.remap(
        frame, map_x, map_y,
        interpolation=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE,
    )


def build_morph_clip(from_path, to_path, output_path, morph_seconds=0.2, fps=25):
    """Render klip morph pendek (silent) dari frame akhir from_path ke frame
    awal to_path. Return True bila berhasil ditulis ke output_path."""
    try:
        frame_a = _read_edge_frame(from_path, from_end=True)
        frame_b = _read_edge_frame(to_path, from_end=False)
        if frame_a is None or frame_b is None:
            return False

        h, w = frame_a.shape[:2]
        if frame_b.shape[:2] != (h, w):
            frame_b = cv2.resize(frame_b, (w, h))

        gray_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY)
        gray_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY)

        flow_ab = cv2.calcOpticalFlowFarneback(
            gray_a, gray_b, None, 0.5, 3, 21, 3, 5, 1.2, 0
        )
        flow_ba = cv2.calcOpticalFlowFarneback(
            gray_b, gray_a, None, 0.5, 3, 21, 3, 5, 1.2, 0
        )

        num_frames = max(2, int(round(morph_seconds * fps)))
        writer = cv2.VideoWriter(
            output_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h)
        )
        if not writer.isOpened():
            return False

        try:
            for i in range(num_frames):
                t = (i + 1) / (num_frames + 1)
                warped_a = _warp_by_flow(frame_a, flow_ab, t)
                warped_b = _warp_by_flow(frame_b, flow_ba, 1.0 - t)
                blended = cv2.addWeighted(warped_a, 1.0 - t, warped_b, t, 0)
                writer.write(blended)
        finally:
            writer.release()

        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        print(f"[POSE MORPH] Gagal generate morph {from_path} -> {to_path}: {e}")
        return False
