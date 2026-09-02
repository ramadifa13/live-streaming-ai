"""Lightweight runtime telemetry for AI visual worker (no behavior change).

Exposes P50/P95/P99/max latency histograms, counters, and gauges for
benchmarking before pipeline refactors. All recording is thread-safe and
cheap (rolling window, no external deps).
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Any, Deque, Dict, List, Optional

try:
    import torch
except ImportError:
    torch = None  # type: ignore

_WINDOW = int(os.environ.get("AI_WORKER_METRICS_WINDOW", "4096"))
_LOG_INTERVAL_SEC = float(os.environ.get("AI_WORKER_METRICS_LOG_SEC", "0") or "0")


def _percentile(sorted_vals: List[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    rank = (len(sorted_vals) - 1) * (pct / 100.0)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac


class _LatencyHist:
    __slots__ = ("_samples", "_maxlen")

    def __init__(self, maxlen: int = _WINDOW):
        self._samples: Deque[float] = deque(maxlen=maxlen)
        self._maxlen = maxlen

    def record(self, value_ms: float) -> None:
        if value_ms >= 0:
            self._samples.append(float(value_ms))

    def summary(self) -> Dict[str, float]:
        if not self._samples:
            return {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
        vals = sorted(self._samples)
        return {
            "count": float(len(vals)),
            "p50": round(_percentile(vals, 50), 3),
            "p95": round(_percentile(vals, 95), 3),
            "p99": round(_percentile(vals, 99), 3),
            "max": round(vals[-1], 3),
        }


class WorkerTelemetry:
    """Process-wide metrics singleton."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latencies: Dict[str, _LatencyHist] = {}
        self._counters: Dict[str, int] = {}
        self._gauges: Dict[str, float] = {}
        self._started_at = time.perf_counter()
        self._last_log_at = 0.0
        self._broadcast_times: Deque[float] = deque(maxlen=120)

    def record_latency(self, name: str, value_ms: float) -> None:
        with self._lock:
            hist = self._latencies.setdefault(name, _LatencyHist())
        hist.record(value_ms)

    @contextmanager
    def measure(self, name: str):
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.record_latency(name, (time.perf_counter() - t0) * 1000.0)

    def inc(self, name: str, delta: int = 1) -> None:
        with self._lock:
            self._counters[name] = self._counters.get(name, 0) + int(delta)

    def set_gauge(self, name: str, value: float) -> None:
        with self._lock:
            self._gauges[name] = float(value)

    def note_broadcast_frame(self) -> None:
        """Track wall-clock times for actual output FPS."""
        now = time.perf_counter()
        with self._lock:
            self._broadcast_times.append(now)
            if len(self._broadcast_times) >= 2:
                span = self._broadcast_times[-1] - self._broadcast_times[0]
                if span > 0.25:
                    fps = (len(self._broadcast_times) - 1) / span
                    self._gauges["actual_output_fps"] = round(fps, 2)

    def _gpu_snapshot(self) -> Dict[str, float]:
        if torch is None or not torch.cuda.is_available():
            return {}
        try:
            return {
                "vram_allocated_mb": round(
                    torch.cuda.memory_allocated() / (1024 * 1024), 1
                ),
                "vram_reserved_mb": round(
                    torch.cuda.memory_reserved() / (1024 * 1024), 1
                ),
            }
        except Exception:
            return {}

    def snapshot(self, *, target_fps: Optional[float] = None) -> Dict[str, Any]:
        with self._lock:
            latencies = {k: v.summary() for k, v in self._latencies.items()}
            counters = dict(self._counters)
            gauges = dict(self._gauges)
            uptime = time.perf_counter() - self._started_at

        if target_fps is not None:
            gauges.setdefault("target_fps", float(target_fps))

        out: Dict[str, Any] = {
            "uptime_sec": round(uptime, 1),
            "monotonic_clock": "perf_counter",
            "latencies_ms": latencies,
            "counters": counters,
            "gauges": gauges,
            "gpu": self._gpu_snapshot(),
        }
        return out

    def maybe_log_summary(self, *, target_fps: Optional[float] = None) -> None:
        if _LOG_INTERVAL_SEC <= 0:
            return
        now = time.perf_counter()
        if now - self._last_log_at < _LOG_INTERVAL_SEC:
            return
        self._last_log_at = now
        snap = self.snapshot(target_fps=target_fps)
        lat = snap.get("latencies_ms") or {}
        cnt = snap.get("counters") or {}
        gau = snap.get("gauges") or {}
        gpu = snap.get("gpu") or {}
        parts = [
            f"uptime={snap.get('uptime_sec')}s",
            f"out_fps={gau.get('actual_output_fps', '?')}",
            f"target_fps={gau.get('target_fps', target_fps or '?')}",
            f"raw_q={gau.get('raw_queue_depth', '?')}",
            f"render_q={gau.get('render_queue_depth', '?')}",
            f"utter_q={gau.get('utterance_queue_depth', '?')}",
            f"dup={cnt.get('frames_duplicated', 0)}",
            f"raw_drop={cnt.get('raw_queue_dropped', 0)}",
            f"render_drop={cnt.get('render_queue_dropped', 0)}",
            f"lip_miss={cnt.get('lipsync_cache_miss', 0)}",
        ]
        if "musetalk_batch_ms" in lat:
            b = lat["musetalk_batch_ms"]
            parts.append(
                f"mt_batch p50={b.get('p50')} p95={b.get('p95')} max={b.get('max')}"
            )
        if gpu:
            parts.append(
                f"vram={gpu.get('vram_allocated_mb')}MB"
            )
        print(f"[Metrics] {' | '.join(parts)}", flush=True)

    def reset(self) -> None:
        with self._lock:
            self._latencies.clear()
            self._counters.clear()
            self._gauges.clear()
            self._broadcast_times.clear()
            self._started_at = time.perf_counter()
            self._last_log_at = 0.0


_telemetry: Optional[WorkerTelemetry] = None
_telemetry_lock = threading.Lock()


def get_telemetry() -> WorkerTelemetry:
    global _telemetry
    with _telemetry_lock:
        if _telemetry is None:
            _telemetry = WorkerTelemetry()
        return _telemetry
