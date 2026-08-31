"""Ad-hoc verification of broadcaster FFmpeg command construction.

Builds each command variant the broadcast loop can emit and actually runs it,
so an invalid filter graph fails here instead of mid-stream on the pod.
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from broadcaster import AIBroadcaster

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "3d")
IDLE = os.path.join(ASSETS, "namira_idle.mp4")
AI_CLIP = os.path.join(ASSETS, "namira_talk_expressive.mp4")
GESTURE = os.path.join(ASSETS, "namira_laugh.mp4")

b = object.__new__(AIBroadcaster)
b.output_folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_verify_out")
os.makedirs(b.output_folder, exist_ok=True)
b.idle_video = IDLE
b.output_width = 720
b.output_height = 1280
b.output_fps = 25
b.crossfade_seconds = 0.5
b.fade_seconds = 0.4
b.idle_chunk_seconds = 1.5
b.overlay_png_path = None
b._duration_cache = {}
b._audio_cache = {}
b._shutting_down = False
b._current_worker = None

# Build a real overlay PNG to exercise the overlay branch.
overlay_path = os.path.join(b.output_folder, "overlay.png")
subprocess.run(
    ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
     "color=c=red@0.4:s=720x1280,format=rgba", "-frames:v", "1", overlay_path],
    check=True,
)

cases = []
cases.append(("idle chunk (loop + silent)", b._build_worker_command(
    IDLE, max_duration=b.idle_chunk_seconds, loop_input=True, silent_audio=True)))
cases.append(("AI segment, no overlay, no fade", b._build_worker_command(AI_CLIP)))
cases.append(("AI segment, fade in", b._build_worker_command(
    AI_CLIP, fade_in=b.fade_seconds)))
cases.append(("crossfade AI -> gesture", b._build_crossfade_command(AI_CLIP, GESTURE)))

b.overlay_png_path = overlay_path
cases.append(("idle chunk + overlay", b._build_worker_command(
    IDLE, max_duration=b.idle_chunk_seconds, loop_input=True, silent_audio=True)))
cases.append(("AI segment + overlay + fade", b._build_worker_command(
    AI_CLIP, fade_in=b.fade_seconds)))
cases.append(("crossfade + overlay", b._build_crossfade_command(AI_CLIP, GESTURE)))

print(f"has_audio(idle)={b._has_audio(IDLE)} has_audio(talk)={b._has_audio(AI_CLIP)}")

# Urutan tayang: jawaban komentar (prio_) selalu di depan, sisanya menurut
# epoch_ms saat job disubmit — bukan menurut waktu selesai render.
unordered = [
    "task_1756600000500_ffffffff.mp4",
    "task_1756600000100_aaaaaaaa.mp4",
    "prio_task_1756600000900_cccccccc.mp4",
    "task_1756600000300_bbbbbbbb.mp4",
    "prio_task_1756600000700_dddddddd.mp4",
    "legacy_output.mp4",
]
ordered = sorted(unordered, key=b._sequence_key)
expected = [
    "prio_task_1756600000700_dddddddd.mp4",
    "prio_task_1756600000900_cccccccc.mp4",
    "task_1756600000100_aaaaaaaa.mp4",
    "task_1756600000300_bbbbbbbb.mp4",
    "task_1756600000500_ffffffff.mp4",
    "legacy_output.mp4",
]
order_ok = ordered == expected
print(f"\nqueue ordering {'OK' if order_ok else 'FAIL'}")
for name in ordered:
    print(f"      {name}")
if not order_ok:
    print("      expected:")
    for name in expected:
        print(f"        {name}")
print()

failures = 0
for label, cmd in cases:
    out_file = os.path.join(b.output_folder, "probe.ts")
    run_cmd = [a for a in cmd]
    assert run_cmd[-1] == "pipe:1"
    run_cmd[-1] = out_file
    run_cmd = [a for a in run_cmd if a != "-re"]  # skip realtime pacing for the test
    proc = subprocess.run(run_cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        failures += 1
        print(f"\nFAIL  {label}")
        print("  " + " ".join(cmd))
        print("  " + (proc.stderr or "").strip()[-700:])
        continue
    meta = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
         "-of", "csv=p=0", out_file],
        capture_output=True, text=True,
    ).stdout.strip().replace("\n", " | ")
    print(f"OK    {label}\n      {meta}")

print(f"\n{len(cases) - failures}/{len(cases)} command variants valid")

shutil.rmtree(b.output_folder, ignore_errors=True)

sys.exit(1 if (failures or not order_ok) else 0)
