from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_shared_cache_readonly_writes_local():
    text = (ROOT / "inference.py").read_text(encoding="utf-8")
    assert "MUSETALK_SHARED_CACHE_READONLY" in text
    assert "MUSETALK_RUNTIME_CACHE_ROOT" in text
    assert "local_path" in text


def test_live_worker_output_not_on_shared_volume():
    src = (ROOT / "live_worker.py").read_text(encoding="utf-8")
    assert 'self.output_dir = os.path.join(self.runtime_root, "output")' in src
    assert 'self.temp_dir = os.path.join(self.runtime_root, "temp")' in src
    assert "WORKER_RUNTIME_ROOT" in src
    assert "WORKER_SHARED_ROOT" in src
