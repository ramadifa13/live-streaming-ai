import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai_worker import PairedAVQueue


def test_paired_admit_is_atomic():
    q = PairedAVQueue(maxsize=1)
    assert q.admit(b"v1", b"a1", seq=1, timeout=0.2) is True
    assert q.admit(b"v2", b"a2", seq=2, timeout=0.05) is False
    slot_v = q._v_side.get_nowait()
    slot_a = q._a_side.get_nowait()
    assert slot_v is slot_a
    assert slot_v.seq == 1
    assert slot_v.video == b"v1"
    assert slot_a.pcm == b"a1"


def test_paired_retry_is_idempotent():
    q = PairedAVQueue(maxsize=1)
    assert q.admit(b"v1", b"a1", seq=7, timeout=0.2) is True
    slot = q._v_side.get_nowait()
    q._a_side.get_nowait()
    slot.video_done.set()
    slot.audio_done.set()
    q.mark_complete(slot)
    assert q.admit(b"v1-dup", b"a1-dup", seq=7, timeout=0.2) is True
    assert q._v_side.empty()


def test_both_writers_see_same_slot():
    q = PairedAVQueue(maxsize=2)
    seen = []

    def video_writer():
        item = q._v_side.get(timeout=1)
        seen.append(("v", item.seq, id(item)))
        item.video_done.set()
        q.mark_complete(item)

    def audio_writer():
        item = q._a_side.get(timeout=1)
        seen.append(("a", item.seq, id(item)))
        item.audio_done.set()
        q.mark_complete(item)

    threads = [
        threading.Thread(target=video_writer),
        threading.Thread(target=audio_writer),
    ]
    for t in threads:
        t.start()
    assert q.admit(b"video", b"pcm", seq=3, timeout=1) is True
    for t in threads:
        t.join(timeout=1)
    assert {row[0] for row in seen} == {"v", "a"}
    assert seen[0][1] == seen[1][1] == 3
    assert seen[0][2] == seen[1][2]
