"""CLI offline untuk pratinjau transisi antar dua klip aksi avatar — dipakai
untuk QA visual manual sebelum fitur pose-morph disambungkan ke broadcaster
live. Tidak menyentuh siaran yang sedang berjalan.

Contoh pakai (dari root repo, di server/WSL yang punya MuseTalk+mmpose siap):

    python deploy/tools/preview_transition.py \\
        --from deploy/assets/3d/namira_wave.mp4 \\
        --to deploy/assets/3d/namira_nod.mp4 \\
        --out-dir preview_out --engine both

Output:
  preview_out/skeleton_morph.mp4   klip morph berbasis keypoint (bila berhasil)
  preview_out/flow_morph.mp4       klip morph berbasis optical flow (pembanding)
  preview_out/frames/*.png         setiap frame morph didump sebagai gambar
"""

import argparse
import os
import sys

import cv2

DEPLOY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if DEPLOY_DIR not in sys.path:
    sys.path.insert(0, DEPLOY_DIR)

from pose_transition import build_morph_clip  # noqa: E402
import pose_extractor  # noqa: E402


def _default_base_dir():
    return (
        "/workspace/ai_live_worker"
        if os.path.exists("/workspace/ai_live_worker")
        else DEPLOY_DIR
    )


def _dump_frames(video_path, out_dir, prefix):
    os.makedirs(out_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[PREVIEW] Tidak bisa buka {video_path} untuk dump frame.")
        return
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        cv2.imwrite(os.path.join(out_dir, f"{prefix}_{idx:03d}.png"), frame)
        idx += 1
    cap.release()
    print(f"[PREVIEW] {idx} frame di-dump ke {out_dir} (prefix={prefix})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from", dest="from_path", required=True, help="Path klip A (sumber)")
    parser.add_argument("--to", dest="to_path", required=True, help="Path klip B (tujuan)")
    parser.add_argument("--out-dir", default="preview_out", help="Folder output preview")
    parser.add_argument(
        "--engine", choices=["skeleton", "flow", "both"], default="both",
        help="Engine morph yang dijalankan",
    )
    parser.add_argument("--duration", type=float, default=0.2, help="Durasi morph (detik)")
    parser.add_argument("--fps", type=int, default=25)
    parser.add_argument("--base-dir", default=None, help="Override WORKER_ROOT (default: auto-detect)")
    parser.add_argument("--musetalk-dir", default=None, help="Override lokasi folder MuseTalk")
    args = parser.parse_args()

    if not os.path.exists(args.from_path):
        print(f"[PREVIEW ERROR] File tidak ditemukan: {args.from_path}")
        sys.exit(1)
    if not os.path.exists(args.to_path):
        print(f"[PREVIEW ERROR] File tidak ditemukan: {args.to_path}")
        sys.exit(1)

    base_dir = args.base_dir or _default_base_dir()
    musetalk_dir = args.musetalk_dir or os.path.join(base_dir, "MuseTalk")
    pose_extractor.configure(base_dir, musetalk_dir)

    os.makedirs(args.out_dir, exist_ok=True)

    if args.engine in ("skeleton", "both"):
        # Import ditunda: butuh mmpose siap, jangan sampai gagal duluan sebelum
        # engine flow (yang lebih ringan) sempat dicoba.
        from pose_skeleton_morph import build_skeleton_morph_clip

        skeleton_out = os.path.join(args.out_dir, "skeleton_morph.mp4")
        ok = build_skeleton_morph_clip(
            args.from_path, args.to_path, skeleton_out,
            morph_seconds=args.duration, fps=args.fps,
        )
        if ok:
            print(f"[PREVIEW] ✅ Skeleton morph berhasil: {skeleton_out}")
            _dump_frames(skeleton_out, os.path.join(args.out_dir, "frames"), "skeleton")
        else:
            print(
                "[PREVIEW] ❌ Skeleton morph gagal (keypoint kurang/tidak valid). "
                "Cek log [POSE SKELETON MORPH]/[POSE EXTRACTOR] di atas."
            )

    if args.engine in ("flow", "both"):
        flow_out = os.path.join(args.out_dir, "flow_morph.mp4")
        ok = build_morph_clip(
            args.from_path, args.to_path, flow_out,
            morph_seconds=args.duration, fps=args.fps,
        )
        if ok:
            print(f"[PREVIEW] ✅ Optical-flow morph berhasil: {flow_out}")
            _dump_frames(flow_out, os.path.join(args.out_dir, "frames"), "flow")
        else:
            print("[PREVIEW] ❌ Optical-flow morph gagal.")

    print(f"\n[PREVIEW] Selesai. Buka folder '{args.out_dir}' untuk cek hasilnya manual.")


if __name__ == "__main__":
    main()
