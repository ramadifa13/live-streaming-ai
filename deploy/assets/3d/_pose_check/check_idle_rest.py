import cv2
import numpy as np
from pathlib import Path

root = Path(r"d:\work\live-streaming-ai\deploy\assets\3d")
out = root / "_pose_check"
out.mkdir(exist_ok=True)

clips = [f"namira_idle_{i}.mp4" for i in range(1, 5)]


def mse(a, b):
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    return float(np.mean((a - b) ** 2))


def mae(a, b):
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    return float(np.mean(np.abs(a - b)))


def psnr(a, b):
    m = mse(a, b)
    if m <= 1e-9:
        return 99.0
    return float(20 * np.log10(255.0 / np.sqrt(m)))


frames = {}

for name in clips:
    path = root / name
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        print(f"FAIL open {name}")
        continue
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    ok, first = cap.read()
    if not ok:
        print(f"FAIL read first {name}")
        cap.release()
        continue

    if n > 1:
        cap.set(cv2.CAP_PROP_POS_FRAMES, n - 1)
    ok2, last = cap.read()
    if not ok2:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        last = first.copy()
        count = 1
        while True:
            ok3, fr = cap.read()
            if not ok3:
                break
            last = fr
            count += 1
        n = count
    cap.release()

    cap = cv2.VideoCapture(str(path))
    mid_idx = max(0, n // 2)
    cap.set(cv2.CAP_PROP_POS_FRAMES, mid_idx)
    okm, mid = cap.read()
    cap.release()
    if not okm:
        mid = first

    key_num = name.replace("namira_idle_", "").replace(".mp4", "")
    cv2.imwrite(str(out / f"idle_{key_num}_first.png"), first)
    cv2.imwrite(str(out / f"idle_{key_num}_last.png"), last)
    cv2.imwrite(str(out / f"idle_{key_num}_mid.png"), mid)
    cv2.imwrite(str(out / f"idle_{key_num}_diff.png"), cv2.absdiff(first, last))

    key = name.replace(".mp4", "")
    frames[key] = (first, last, mid, n, fps, w, h)
    m = mse(first, last)
    a = mae(first, last)
    p = psnr(first, last)
    motion = mse(first, mid)
    verdict = "PASS" if m < 5 else ("WEAK" if m < 50 else "FAIL")
    print(f"{key}: frames={n} fps={fps:.2f} {w}x{h}")
    print(f"  first<->last  MSE={m:.2f}  MAE={a:.2f}  PSNR={p:.1f}dB  -> {verdict}")
    print(f"  first<->mid   MSE={motion:.2f}  (motion in middle)")

print("\n=== Cross-clip rest (vs idle_1 frame0) ===")
base = frames.get("namira_idle_1")
if base:
    b0 = base[0]
    for key, (first, last, mid, n, fps, w, h) in frames.items():
        m0 = mse(b0, first)
        mL = mse(b0, last)
        v0 = "OK" if m0 < 20 else ("WEAK" if m0 < 80 else "MISMATCH")
        vL = "OK" if mL < 20 else ("WEAK" if mL < 80 else "MISMATCH")
        print(f"  idle_1.f0 <-> {key}.f0   MSE={m0:.2f} [{v0}]")
        print(f"  idle_1.f0 <-> {key}.last MSE={mL:.2f} [{vL}]")

print("\nThreshold: PASS MSE<5 (near exact), WEAK <50, FAIL >=50")
print(f"Diff images: {out}")
