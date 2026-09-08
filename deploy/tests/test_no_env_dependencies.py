from pathlib import Path


TARGETS = [
    "ai_worker.py",
    "core_pipeline.py",
    "video_canvas.py",
    "speech_bridge.py",
    "worker_telemetry.py",
    "live_worker.py",
]


def test_ai_worker_modules_do_not_read_environment_variables():
    root = Path(__file__).resolve().parents[1]
    for rel in TARGETS:
        text = (root / rel).read_text(encoding="utf-8")
        assert "os.environ" not in text, f"{rel} still reads os.environ"
        assert "os.getenv" not in text, f"{rel} still uses os.getenv"
