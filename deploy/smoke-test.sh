#!/bin/bash
# Smoke test AI live worker — dijalankan DI POD RunPod setelah redeploy-worker.sh.
#
# Memverifikasi perbaikan yang menutup temuan audio/video P0:
#   - Semua klip avatar seragam 720x1280 / 25 fps / ada audio
#   - Semua varian perintah FFmpeg broadcaster menghasilkan parameter stream identik
#   - Output MuseTalk nyata benar-benar 720x1280 25 fps
#   - Penamaan prioritas (prio_) untuk jawaban komentar berfungsi
#   - Tidak ada proses FFmpeg yatim yang tertinggal
#
# Usage:
#   bash /workspace/ai_live_worker/smoke-test.sh
#
# Jangan jalankan saat sedang siaran: langkah render menambah beban GPU.

set -uo pipefail

WORKER_DIR="${WORKER_DIR:-/workspace/ai_live_worker}"
API="${API:-http://localhost:8000}"
ASSETS_DIR="${ASSETS_DIR:-$WORKER_DIR/assets/3d}"
AVATAR_NAME="${AVATAR_NAME:-namira}"

PASS=0
FAIL=0

ok()   { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
info() { echo "         $1"; }
head2() { echo ""; echo "--- $1"; }

echo "============================================================"
echo " Smoke Test — AI Live Worker"
echo " $(date)"
echo "============================================================"

# ---------------------------------------------------------------- 1. Lingkungan
head2 "1. Lingkungan"

for bin in ffmpeg ffprobe python3 curl; do
	if command -v "$bin" >/dev/null 2>&1; then
		ok "$bin tersedia"
	else
		bad "$bin TIDAK ditemukan"
	fi
done

CPUS=$(nproc 2>/dev/null || echo 0)
if [ "$CPUS" -ge 8 ]; then
	ok "vCPU = $CPUS (memenuhi minimum 8)"
else
	bad "vCPU = $CPUS — di bawah 8. Pipeline CPU-bound (blending MuseTalk + libx264 + master FFmpeg) akan tersendat."
fi

RAM_GB=$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null || echo 0)
if [ "$RAM_GB" -ge 20 ]; then
	ok "RAM = ${RAM_GB} GB"
else
	bad "RAM = ${RAM_GB} GB — cache aset avatar di RAM berisiko kena OOM."
fi

if command -v nvidia-smi >/dev/null 2>&1; then
	info "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)"
fi

# ------------------------------------------------------- 2. Keseragaman aset
head2 "2. Keseragaman klip avatar (syarat mutlak master -c:v copy)"

if [ ! -d "$ASSETS_DIR" ]; then
	bad "Folder aset tidak ditemukan: $ASSETS_DIR"
else
	CLIP_COUNT=0
	BAD_CLIPS=0
	for clip in "$ASSETS_DIR"/*.mp4; do
		[ -e "$clip" ] || continue
		CLIP_COUNT=$((CLIP_COUNT + 1))
		V=$(ffprobe -v error -select_streams v:0 \
			-show_entries stream=width,height,r_frame_rate \
			-of csv=p=0 "$clip" 2>/dev/null)
		A=$(ffprobe -v error -select_streams a:0 \
			-show_entries stream=codec_name -of csv=p=0 "$clip" 2>/dev/null)
		NAME=$(basename "$clip")
		if [ "$V" != "720,1280,25/1" ]; then
			bad "$NAME → video '$V' (harus 720,1280,25/1)"
			BAD_CLIPS=$((BAD_CLIPS + 1))
		elif [ -z "$A" ]; then
			bad "$NAME → tidak punya stream audio (acrossfade akan gagal)"
			BAD_CLIPS=$((BAD_CLIPS + 1))
		else
			ok "$NAME → 720x1280 25fps, audio $A"
		fi
	done

	if [ "$CLIP_COUNT" -eq 0 ]; then
		bad "Tidak ada file .mp4 di $ASSETS_DIR"
	elif [ "$BAD_CLIPS" -gt 0 ]; then
		info "Aset belum tersinkron. Jalankan: FORCE_ASSETS=1 bash $WORKER_DIR/sync-worker.sh"
	fi
fi

# --------------------------------------------- 3. Invariant perintah FFmpeg
head2 "3. Invariant perintah FFmpeg broadcaster (7 varian)"

if [ -f "$WORKER_DIR/verify_stream_invariants.py" ]; then
	if (cd "$WORKER_DIR" && python3 verify_stream_invariants.py > /tmp/invariants.log 2>&1); then
		ok "Semua varian perintah menghasilkan parameter stream identik"
		grep -E "^(OK|queue ordering)" /tmp/invariants.log | sed 's/^/         /'
	else
		bad "Verifikasi invariant GAGAL — lihat detail di bawah"
		tail -30 /tmp/invariants.log | sed 's/^/         /'
	fi
else
	bad "verify_stream_invariants.py tidak ada di $WORKER_DIR (sync belum jalan?)"
fi

# ------------------------------------------------------------- 4. API worker
head2 "4. API worker"

HEALTH=$(curl -s --max-time 10 "$API/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"status"'; then
	ok "GET /health merespons"
	info "$HEALTH"
else
	bad "GET /health tidak merespons. Cek: tail -f $WORKER_DIR/api_server.log"
	echo ""
	echo "Ringkasan: $PASS lulus, $FAIL gagal (dihentikan — API mati)."
	exit 1
fi

STRAY_BEFORE=$(pgrep -c ffmpeg 2>/dev/null || echo 0)
info "Proses ffmpeg sebelum tes: $STRAY_BEFORE"

# ---------------------------------------------- 5. Render nyata + penamaan
head2 "5. Render MuseTalk nyata (butuh ~10-60 detik, memuat model)"

render_and_check() {
	local label="$1" priority="$2" expect_prefix="$3"
	local body resp job_id video_url out_file

	body=$(python3 -c "
import json
print(json.dumps({
    'text': 'Tes suara satu dua tiga, ini uji coba siaran.',
    'avatar_name': '$AVATAR_NAME',
    'tone': 'Persuasif',
    'wait': True,
    'priority': $priority,
}))")

	resp=$(curl -s --max-time 300 -X POST "$API/stream/generate-neural-video" \
		-H "Content-Type: application/json" -d "$body" 2>/dev/null)

	job_id=$(echo "$resp" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('job_id',''))
except Exception: print('')
" 2>/dev/null)

	if [ -z "$job_id" ]; then
		bad "$label — render gagal"
		info "respons: $(echo "$resp" | head -c 400)"
		return
	fi

	case "$job_id" in
		"$expect_prefix"*) ok "$label — job_id '$job_id' memakai prefix '$expect_prefix'" ;;
		*) bad "$label — job_id '$job_id' TIDAK memakai prefix '$expect_prefix'" ;;
	esac

	out_file=$(find "$WORKER_DIR" -name "${job_id}*.mp4" -print -quit 2>/dev/null)
	if [ -z "$out_file" ]; then
		out_file=$(find /workspace -name "${job_id}*.mp4" -print -quit 2>/dev/null)
	fi

	if [ -z "$out_file" ]; then
		bad "$label — file output tidak ditemukan untuk $job_id"
		return
	fi

	local params
	params=$(ffprobe -v error -select_streams v:0 \
		-show_entries stream=width,height,r_frame_rate -of csv=p=0 "$out_file" 2>/dev/null)
	if [ "$params" = "720,1280,25/1" ]; then
		ok "$label — output 720x1280 25fps ($(basename "$out_file"))"
	else
		bad "$label — output '$params', seharusnya 720,1280,25/1"
	fi
}

render_and_check "Segmen otonom" "False" "task_"
render_and_check "Jawaban komentar (prioritas)" "True" "prio_task_"

# ------------------------------------------------------------ 6. Queue status
head2 "6. Queue status"

QS=$(curl -s --max-time 15 "$API/stream/queue-status" 2>/dev/null)
if echo "$QS" | grep -q "buffer_seconds"; then
	ok "GET /stream/queue-status merespons"
	echo "$QS" | python3 -c "
import json,sys
d = json.load(sys.stdin)
for k in ('buffer_seconds','is_broadcasting','rtmp_connected'):
    if k in d:
        print(f'         {k} = {d[k]}')
files = d.get('video_files') or []
print(f'         video_files = {len(files)}')
for name in files[:6]:
    print(f'           {name}')
" 2>/dev/null
	info "Urutan di atas harus menempatkan file prio_ lebih dulu."
else
	bad "queue-status tidak merespons dengan benar"
fi

# --------------------------------------------------------- 7. Proses yatim
head2 "7. Proses FFmpeg yatim"

curl -s --max-time 20 -X POST "$API/stream/stop-broadcast" >/dev/null 2>&1
sleep 3
STRAY_AFTER=$(pgrep -c ffmpeg 2>/dev/null || echo 0)

if [ "$STRAY_AFTER" -le "$STRAY_BEFORE" ]; then
	ok "Tidak ada FFmpeg yatim setelah stop-broadcast (sebelum=$STRAY_BEFORE, sesudah=$STRAY_AFTER)"
else
	bad "Ada $((STRAY_AFTER - STRAY_BEFORE)) FFmpeg tertinggal setelah stop-broadcast"
	pgrep -a ffmpeg 2>/dev/null | sed 's/^/         /'
fi

# ------------------------------------------------------------------ Ringkasan
echo ""
echo "============================================================"
echo " Ringkasan: $PASS lulus, $FAIL gagal"
echo "============================================================"

if [ "$FAIL" -eq 0 ]; then
	echo " Worker siap. Lanjutkan uji siaran manual dari dashboard."
	echo " Pantau log: tail -f $WORKER_DIR/api_server.log"
	echo "             tail -f $WORKER_DIR/live_videos/broadcaster.log"
	exit 0
fi

echo " Perbaiki item [FAIL] di atas sebelum uji siaran."
exit 1
