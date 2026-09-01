"""Pose-aware morph — warp berbasis triangulasi Delaunay dari keypoint tubuh
& tangan (DWPose), bukan optical flow generik (bandingkan dengan
pose_transition.py). Setiap frame antara dihasilkan dengan mewarp segitiga
dari frame A & B menuju posisi interpolasi keypoint, lalu di-blend — teknik
klasik "triangulation-based morphing" (dipakai juga di face-morphing).

Kenapa bukan Thin-Plate-Spline: TPS di OpenCV
(cv2.createThinPlateSplineShapeTransformer) ada di paket opencv-contrib,
sedangkan worker cuma punya opencv-python-headless. Triangulasi Delaunay
(cv2.Subdiv2D) tersedia di opencv inti — tidak perlu ganti/tambah dependency.

Selalu gagal secara aman (return False) bila keypoint tidak cukup/valid —
pemanggil WAJIB fallback ke pose_transition.py (optical flow) atau crossfade
fade biasa.
"""

import os

import cv2
import numpy as np

from pose_extractor import extract_part_keypoints

MIN_SHARED_KEYPOINTS = 6
MIN_TRIANGLES = 4


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


def _anchor_points(w, h):
    """Titik jangkar di tepi & tengah kanvas — menstabilkan triangulasi &
    mencegah area background (di luar tubuh) ikut terdistorsi liar."""
    return np.array(
        [
            [0, 0], [w // 2, 0], [w - 1, 0],
            [0, h // 2], [w - 1, h // 2],
            [0, h - 1], [w // 2, h - 1], [w - 1, h - 1],
        ],
        dtype=np.float32,
    )


def _collect_point_pairs(frame_a, frame_b, min_score=0.3):
    """Gabungkan keypoint body+hand yang valid di KEDUA frame. Titik yang
    hilang/rendah confidence di salah satu sisi di-skip supaya tidak merusak
    triangulasi (mis. tangan keluar kanvas di salah satu klip)."""
    parts_a = extract_part_keypoints(frame_a, min_score=min_score)
    parts_b = extract_part_keypoints(frame_b, min_score=min_score)
    if not parts_a or not parts_b:
        return None, None

    pts_a, pts_b = [], []
    for name in parts_a:
        pa, mask_a = parts_a[name]
        pb, mask_b = parts_b[name]
        mask = mask_a & mask_b
        if mask.any():
            pts_a.append(pa[mask])
            pts_b.append(pb[mask])
    if not pts_a:
        return np.zeros((0, 2), np.float32), np.zeros((0, 2), np.float32)
    return np.concatenate(pts_a, axis=0), np.concatenate(pts_b, axis=0)


def _delaunay_triangles(points, w, h):
    subdiv = cv2.Subdiv2D((0, 0, w, h))
    for p in points:
        subdiv.insert((float(p[0]), float(p[1])))
    point_index = {(round(float(p[0]), 1), round(float(p[1]), 1)): i for i, p in enumerate(points)}
    triangles = []
    for t in subdiv.getTriangleList():
        tri_pts = [(t[0], t[1]), (t[2], t[3]), (t[4], t[5])]
        idxs = []
        for pt in tri_pts:
            key = (round(pt[0], 1), round(pt[1], 1))
            if key not in point_index:
                idxs = None
                break
            idxs.append(point_index[key])
        if idxs and len(set(idxs)) == 3:
            triangles.append(tuple(idxs))
    return triangles


def _warp_triangle_bbox(src, tri_src, tri_dst_local, size_dst):
    rect_src = cv2.boundingRect(np.float32([tri_src]))
    if rect_src[2] <= 0 or rect_src[3] <= 0:
        return None
    tri_src_offset = [(p[0] - rect_src[0], p[1] - rect_src[1]) for p in tri_src]
    src_crop = src[rect_src[1]:rect_src[1] + rect_src[3], rect_src[0]:rect_src[0] + rect_src[2]]
    if src_crop.size == 0:
        return None
    mat = cv2.getAffineTransform(np.float32(tri_src_offset), np.float32(tri_dst_local))
    return cv2.warpAffine(
        src_crop, mat, size_dst, None,
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101,
    )


def _render_morph_frame(frame_a, frame_b, pts_a, pts_b, pts_t, triangles, t):
    h, w = frame_a.shape[:2]
    out_frame = np.zeros_like(frame_a)
    for (i0, i1, i2) in triangles:
        tri_a = [tuple(pts_a[i0]), tuple(pts_a[i1]), tuple(pts_a[i2])]
        tri_b = [tuple(pts_b[i0]), tuple(pts_b[i1]), tuple(pts_b[i2])]
        tri_t = [tuple(pts_t[i0]), tuple(pts_t[i1]), tuple(pts_t[i2])]

        rect_t = cv2.boundingRect(np.float32([tri_t]))
        if rect_t[2] <= 0 or rect_t[3] <= 0:
            continue
        size_dst = (rect_t[2], rect_t[3])
        tri_t_local = [(p[0] - rect_t[0], p[1] - rect_t[1]) for p in tri_t]

        warped_a = _warp_triangle_bbox(frame_a, tri_a, tri_t_local, size_dst)
        warped_b = _warp_triangle_bbox(frame_b, tri_b, tri_t_local, size_dst)
        if warped_a is None or warped_b is None:
            continue

        blended = cv2.addWeighted(warped_a, 1.0 - t, warped_b, t, 0)
        mask = np.zeros((rect_t[3], rect_t[2]), dtype=np.uint8)
        cv2.fillConvexPoly(mask, np.int32([tri_t_local]), 255)
        mask_bool = mask.astype(bool)

        y0, x0 = rect_t[1], rect_t[0]
        region = out_frame[y0:y0 + rect_t[3], x0:x0 + rect_t[2]]
        if region.shape[:2] != mask_bool.shape:
            continue
        region[mask_bool] = blended[mask_bool]
    return out_frame


def build_skeleton_morph_clip(from_path, to_path, output_path, morph_seconds=0.2, fps=25, min_score=0.3):
    """Return True bila berhasil ditulis ke output_path. Butuh keypoint valid
    di kedua frame (>= MIN_SHARED_KEYPOINTS) — bila tidak, return False dan
    caller wajib fallback ke pose_transition.py / crossfade biasa."""
    try:
        frame_a = _read_edge_frame(from_path, from_end=True)
        frame_b = _read_edge_frame(to_path, from_end=False)
        if frame_a is None or frame_b is None:
            return False

        h, w = frame_a.shape[:2]
        if frame_b.shape[:2] != (h, w):
            frame_b = cv2.resize(frame_b, (w, h))

        pts_a, pts_b = _collect_point_pairs(frame_a, frame_b, min_score=min_score)
        if pts_a is None or len(pts_a) < MIN_SHARED_KEYPOINTS:
            return False

        anchors = _anchor_points(w, h)
        pts_a = np.concatenate([pts_a, anchors], axis=0)
        pts_b = np.concatenate([pts_b, anchors], axis=0)

        triangles = _delaunay_triangles(pts_a, w, h)
        if len(triangles) < MIN_TRIANGLES:
            return False

        num_frames = max(2, int(round(morph_seconds * fps)))
        writer = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
        if not writer.isOpened():
            return False

        try:
            for i in range(num_frames):
                t = (i + 1) / (num_frames + 1)
                pts_t = (1 - t) * pts_a + t * pts_b
                writer.write(_render_morph_frame(frame_a, frame_b, pts_a, pts_b, pts_t, triangles, t))
        finally:
            writer.release()

        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        print(f"[POSE SKELETON MORPH] Gagal generate morph {from_path} -> {to_path}: {e}")
        return False
