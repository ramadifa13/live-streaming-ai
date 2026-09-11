"""Gagal cepat di pod/sync — cegah regresi RTMP + lip-sync + continuity."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _fail(msg: str) -> None:
    print(f"[INVARIANT] FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def check_rtmp_utils() -> None:
    sys.path.insert(0, str(ROOT))
    from rtmp_utils import extract_rtmp_hostname, is_deferred_rtmp_ack, validate_publish_url

    url = "rtmps://edgetee-upload-sin11-1.xx.fbcdn.net:443/rtmp/dummykey"
    host = extract_rtmp_hostname(url)
    if "fbcdn.net" not in host:
        _fail(f"extract_rtmp_hostname salah: {host!r}")
    validate_publish_url(url)
    if not is_deferred_rtmp_ack(url):
        _fail("Instagram/FB URL harus deferred ACK")
    print("[INVARIANT] rtmp_utils OK")


def check_lipsync_not_forced_on_any_clip() -> None:
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    tree = ast.parse(src)
    text = src.replace("\r\n", "\n")
    # Regresi: whisper_idx saja tidak boleh memaksa lipsync tanpa cek clip talk.
    bad = (
        "if whisper_idx is not None:\n            pkt.needs_lipsync = True"
        in text
        or "if whisper_idx is not None:\n        pkt.needs_lipsync = True" in text
    )
    if bad:
        _fail("lipsync dipaksa hanya karena whisper_idx (harus cek clip talk)")
    has_pin = any(
        isinstance(n, ast.FunctionDef) and n.name == "pin_talk_body" for n in ast.walk(tree)
    )
    if not has_pin:
        _fail("pin_talk_body hilang dari VideoStateMachine")
    print("[INVARIANT] ai_worker lipsync/pin OK")


def check_seamless_contract() -> None:
    """is_seamless_loop harus pakai seamless_score, bukan base==end index."""
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    if "seamless_score" not in src:
        _fail("ClipAsset.seamless_score hilang")
    if "SEAMLESS_THRESHOLD" not in src:
        _fail("SEAMLESS_THRESHOLD hilang")
    # Regresi bug lama: base_pose_frame == end_pose sebagai satu-satunya cek.
    bad = (
        "return self.base_pose_frame == self.end_pose" in src
        and "seamless_score" not in src.split("def is_seamless_loop")[1][:400]
    )
    # Soft check: pastikan property memakai seamless_score
    if "def is_seamless_loop" in src:
        body = src.split("def is_seamless_loop")[1][:500]
        if "seamless_score" not in body:
            _fail("is_seamless_loop tidak memakai seamless_score")
    if "PIN_TALK_SCENE" not in src:
        _fail("PIN_TALK_SCENE (continuous body timeline) hilang")
    if "MOUTH_MISS_BODY_ONLY" not in src:
        _fail("MOUTH_MISS_BODY_ONLY hilang")
    if "if MOUTH_MISS_BODY_ONLY" not in src:
        _fail("MOUTH_MISS_BODY_ONLY tidak dipakai — mouth miss mematikan pipeline")
    if "LIPSYNC_HARD_PREROLL" not in src:
        _fail("LIPSYNC_HARD_PREROLL hilang")
    lipsync_loop = ""
    if "def lipsync_worker_loop" in src:
        lipsync_loop = src.split("def lipsync_worker_loop", 1)[1].split(
            "def _put_raw_frame", 1
        )[0]
    if "stop_event.set()" in lipsync_loop:
        _fail("lipsync_worker_loop tidak boleh stop_event.set() (stream freeze)")
    for needle in (
        'CONTINUOUS_CLIP_NAME = "continuous"',
        "target=continuous_broadcaster_loop",
        "full-prerender contract violated",
        "if consumed_seq:",
    ):
        if needle not in src:
            _fail(f"continuous-only contract missing: {needle}")
    if "broadcast_lag_catchup" in src and "metrics.inc(\"broadcast_lag_catchup\")" in src:
        _fail("broadcast_lag_catchup masih aktif (penyebab loncat/audio cepat)")
    if "broadcast_seq_fast_forward" in src and "metrics.inc(\"broadcast_seq_fast_forward\")" in src:
        _fail("broadcast_seq_fast_forward masih aktif")
    if "RENDER_QUEUE_SIZE = 240" in src or "maxsize=300" in src:
        _fail("render queue terlalu dalam (harus pendek + backpressure)")
    print("[INVARIANT] seamless/continuity contract OK")


def check_validate_assets_script() -> None:
    candidates = [
        ROOT / "validate_idle_assets.py",
        ROOT / "scripts" / "validate_idle_assets.py",
        ROOT.parent / "deploy" / "scripts" / "validate_idle_assets.py",
    ]
    path = next((p for p in candidates if p.is_file()), None)
    if path is None:
        _fail("validate_idle_assets.py hilang (root atau scripts/)")
    text = path.read_text(encoding="utf-8", errors="replace")
    for needle in ("seamless_score", "write-meta", "_ssim_gray"):
        if needle not in text:
            _fail(f"validate_idle_assets.py missing {needle}")
    print("[INVARIANT] validate_idle_assets.py OK")


def check_single_pipeline() -> None:
    core = (ROOT / "core_pipeline.py").read_text(encoding="utf-8", errors="replace")
    if "class StreamBroadcaster" in core or "class NewAIVisualWorker" in core:
        _fail("core_pipeline masih memiliki duplicate worker/broadcaster")
    if "NewAIVisualWorker = AIVisualWorker" not in core:
        _fail("core_pipeline bukan compatibility adapter")
    api = (ROOT / "api_server.py").read_text(encoding="utf-8", errors="replace")
    if "broadcast boot cancelled before pipeline start" not in api:
        _fail("cancelled cold-start masih dapat membuat orphan broadcaster")
    print("[INVARIANT] single pipeline adapter OK")


def check_fps_lock() -> None:
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    bridge = (ROOT / "speech_bridge.py").read_text(encoding="utf-8", errors="replace")
    for name, text in (("ai_worker", src), ("speech_bridge", bridge)):
        if "from av_timing import" not in text:
            _fail(f"{name} tidak memakai shared A/V clock")
    print("[INVARIANT] shared FPS clock OK")


def check_24fps_pacer() -> None:
    src = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    loop = ""
    if "def continuous_broadcaster_loop" in src:
        loop = src.split("def continuous_broadcaster_loop", 1)[1].split(
            "class AIVisualWorker", 1
        )[0]
    if "timeout=0.25" in loop:
        _fail("continuous_broadcaster_loop wait 0.25s (lag spike)")
    if "broadcast_pace_hold" not in loop:
        _fail("24fps hold-on-late-packet hilang")
    if "_advance_broadcast_clock" not in src:
        _fail("pacer 24fps (_advance_broadcast_clock) hilang")
    if "_broadcast_queue_wait" not in src:
        _fail("_broadcast_queue_wait hilang")
    if "RAW_QUEUE_BLOCK_SEC = 0.25" in src:
        _fail("raw queue block 0.25s — harus 1 tick 24fps")
    fetcher = ""
    if "def frame_fetcher_loop" in src:
        fetcher = src.split("def frame_fetcher_loop", 1)[1].split(
            "class StreamBroadcaster", 1
        )[0]
    if "_advance_broadcast_clock" not in fetcher:
        _fail("frame_fetcher_loop tidak di-pace 24fps")
    lipsync_loop = ""
    if "def lipsync_worker_loop" in src:
        lipsync_loop = src.split("def lipsync_worker_loop", 1)[1].split(
            "def _put_raw_frame", 1
        )[0]
    if "timeout=0.25" in lipsync_loop:
        _fail("lipsync_worker_loop put timeout 0.25s (lag spike)")
    stop_fn = ""
    if "def stop(self" in src:
        stop_fn = src.split("def stop(self", 1)[1].split("def is_running", 1)[0]
    shut_at = stop_fn.find("self._broadcaster.shutdown")
    join_at = stop_fn.find(".join(")
    if shut_at < 0 or join_at < 0 or shut_at > join_at:
        _fail("stop() harus shutdown FFmpeg sebelum join() — cegah hang /health")
    print("[INVARIANT] 24fps pacer OK")


def check_audio_sample_rate_contract() -> None:
    timing = (ROOT / "av_timing.py").read_text(encoding="utf-8", errors="replace")
    if "WHISPER_SAMPLE_RATE = 16_000" not in timing:
        _fail("av_timing harus tetap 16 kHz untuk Whisper/MuseTalk")
    if "BROADCAST_SAMPLE_RATE = 48_000" not in timing:
        _fail("av_timing harus 48 kHz untuk PCM siaran")
    worker = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    bridge = (ROOT / "speech_bridge.py").read_text(encoding="utf-8", errors="replace")
    if '"44100"' in worker:
        _fail("FFmpeg AAC siaran masih 44100; harus 48 kHz")
    advance = ""
    if "def _advance_frame_index" in worker:
        advance = worker.split("def _advance_frame_index", 1)[1].split(
            "def _drain_action_queue", 1
        )[0]
    if "if not is_speech:" in advance:
        _fail("idle freeze (hold last pose) masih di _advance_frame_index")
    if 'IDLE_CLIP_NAME = "idle_2s"' not in worker:
        _fail("idle_2s clip name hilang")
    if 'BOOT_IDLE_CLIP_NAME = "idle"' not in worker:
        _fail("BOOT_IDLE_CLIP_NAME idle (namira_idle.mp4) hilang")
    if "speech_may_start" not in worker:
        _fail("speech_may_start hilang — boot idle tidak boleh pindah ke talk sebelum bicara")
    if "hold_talk = (not leftover)" in advance:
        _fail("hold_talk dari next_ready masih memaksa talk tanpa PCM")
    if "whisper_idx: Optional[int] = None" not in advance and "whisper_idx" not in advance:
        _fail("_advance_frame_index harus melihat whisper_idx untuk talk-only-when-speech")
    if "def _switch_at_boundary" not in worker:
        _fail("boundary playthrough (_switch_at_boundary) hilang")
    if "def allows_next_utterance_start" not in worker:
        _fail("visual gate allows_next_utterance_start hilang")
    if "set_visual_gate" not in bridge:
        _fail("SpeechBridge.set_visual_gate hilang")
    if "def enter_boot_idle" not in worker:
        _fail("enter_boot_idle hilang — Go Live harus loop namira_idle dulu")
    if "BETWEEN_UTTERANCE_GAP_FRAMES: int = max(" not in bridge:
        _fail("jeda antar kalimat harus 12–24 frame (default 18 / 0.75s)")
    if 'return "INTER_GAP"' not in bridge and "INTER_GAP" not in bridge:
        _fail("fase INTER_GAP hilang dari SpeechBridge")
    if "def in_between_utterance_gap" not in bridge:
        _fail("in_between_utterance_gap hilang — end_utterance bisa potong jeda")
    if "in_between_utterance_gap" not in worker:
        _fail("frame_fetcher tidak menghormati jeda antar kalimat sebelum end_utterance")
    if 'os.environ.get("AI_WORKER_GO_LIVE_MIN_UTTERANCES", "3")' not in bridge:
        _fail("SpeechBridge opening gate harus default 3 kalimat READY")
    idle_asset = ROOT / "assets" / "3d" / "namira_idle.mp4"
    if not idle_asset.is_file():
        _fail("assets/3d/namira_idle.mp4 hilang")
    if "samples_for_frame" not in timing:
        _fail("av_timing tidak memiliki samples_for_frame")
    print("[INVARIANT] audio sample-rate contract OK")


def check_start_sweeps_previous_session() -> None:
    api = (ROOT / "api_server.py").read_text(encoding="utf-8", errors="replace")
    sup = (ROOT / "broadcast_supervisor.py").read_text(encoding="utf-8", errors="replace")
    if "def reset_session_runtime" not in sup:
        _fail("reset_session_runtime hilang")
    if "cycle_state.json" not in sup:
        _fail("reset_session_runtime harus hapus cycle_state.json")
    if "_sweep_previous_session" not in api:
        _fail("start-broadcast harus sapu sesi lama")
    if "_session_encoder_alive" not in api or "_should_skip_start" not in api:
        _fail("skip start harus cek encoder hidup, bukan hanya rtmp_status.txt")
    start_fn = ""
    if "def _start_broadcast_sync" in api:
        start_fn = api.split("def _start_broadcast_sync", 1)[1].split(
            "async def stop_broadcast", 1
        )[0]
    if "_sweep_previous_session" not in start_fn:
        _fail("_start_broadcast_sync tidak menyapu sesi lama")
    if "keep model + antrian ucapan" in start_fn:
        _fail("start masih mempertahankan antrian ucapan lama")
    skip_fn = ""
    if "def start_broadcast" in api:
        skip_fn = api.split("def start_broadcast", 1)[1].split(
            "def _materialize_background", 1
        )[0]
    if "_should_skip_start" not in skip_fn:
        _fail("start-broadcast skip tanpa cek encoder hidup")
    print("[INVARIANT] start sapu sesi lama OK")


def check_runtime_isolation() -> None:
    live = (ROOT / "live_worker.py").read_text(encoding="utf-8", errors="replace")
    start = (ROOT / "start.sh").read_text(encoding="utf-8", errors="replace")
    infer = (ROOT / "inference.py").read_text(encoding="utf-8", errors="replace")
    if "WORKER_RUNTIME_ROOT" not in live or "WORKER_SHARED_ROOT" not in live:
        _fail("live_worker harus memisahkan shared root vs runtime root")
    if 'self.output_dir = os.path.join(self.runtime_root, "output")' not in live:
        _fail("output_dir harus di runtime lokal, bukan volume shared")
    if "WORKER_RUNTIME_ROOT" not in start:
        _fail("start.sh harus inject WORKER_RUNTIME_ROOT")
    if "rm -rf \"$WORKER_DIR/output\"" in start or "rm -rf $WORKER_DIR/output" in start:
        _fail("start.sh tidak boleh menyapu output di volume shared")
    if "MUSETALK_SHARED_CACHE_READONLY" not in infer:
        _fail("inference cache shared harus read-only dengan fallback lokal")
    print("[INVARIANT] runtime isolation OK")


def check_paired_av() -> None:
    worker = (ROOT / "ai_worker.py").read_text(encoding="utf-8", errors="replace")
    if "class PairedAVQueue" not in worker:
        _fail("PairedAVQueue hilang — dual writer harus admit A/V atomik")
    if "self._a_q.put(pcm" in worker and "self._v_q.put(video_buf" in worker:
        _fail("enqueue A/V independen masih ada (orphan PCM)")
    print("[INVARIANT] paired A/V OK")


def main() -> None:
    check_rtmp_utils()
    check_lipsync_not_forced_on_any_clip()
    check_seamless_contract()
    check_single_pipeline()
    check_validate_assets_script()
    check_fps_lock()
    check_24fps_pacer()
    check_audio_sample_rate_contract()
    check_start_sweeps_previous_session()
    check_runtime_isolation()
    check_paired_av()
    print("[INVARIANT] semua cek lolos")


if __name__ == "__main__":
    main()
