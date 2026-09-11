import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from broadcast_supervisor import reset_session_runtime


def test_reset_session_runtime_drops_leftover_video_and_flags():
    with tempfile.TemporaryDirectory() as folder:
        leftover = os.path.join(folder, "task_old.mp4")
        Path(leftover).write_bytes(b"0" * 2048)
        ffseg = os.path.join(folder, "task_old.ffseg")
        os.makedirs(ffseg)
        Path(os.path.join(ffseg, "ready.flag")).write_text("1", encoding="utf-8")
        for name in (
            "playback_active.flag",
            "stream_paused.flag",
            "rtmp_connected.flag",
            "cycle_state.json",
        ):
            Path(os.path.join(folder, name)).write_text("stale", encoding="utf-8")
        idle = os.path.join(folder, "namira_idle.mp4")
        Path(idle).write_bytes(b"1" * 2048)

        reset_session_runtime(folder, idle_abs=os.path.abspath(idle))

        assert not os.path.exists(leftover)
        assert not os.path.exists(ffseg)
        assert not os.path.exists(os.path.join(folder, "playback_active.flag"))
        assert not os.path.exists(os.path.join(folder, "stream_paused.flag"))
        assert not os.path.exists(os.path.join(folder, "rtmp_connected.flag"))
        assert not os.path.exists(os.path.join(folder, "cycle_state.json"))
        assert os.path.exists(idle)
