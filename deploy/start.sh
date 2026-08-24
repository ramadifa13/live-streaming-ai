#!/bin/bash
export COQUI_TOS_AGREED=1
cd /workspace/ai_live_worker

echo "Memulai AI Worker API (Port 8000)..."
python api_server.py > /workspace/ai_live_worker/api_server.log 2>&1 &

if [ "${START_BROADCASTER:-false}" = "true" ]; then
	echo "Memulai Broadcaster (RTMP Streaming)..."
	: "${RTMP_URL:?RTMP_URL wajib diisi jika START_BROADCASTER=true}"
	: "${STREAM_KEY:?STREAM_KEY wajib diisi jika START_BROADCASTER=true}"
	python broadcaster.py > /workspace/ai_live_worker/broadcaster.log 2>&1 &
else
	echo "Broadcaster Python tidak dijalankan; gunakan publisher Node utama."
fi

echo "Sistem berhasil dijalankan di background!"
# Menahan container agar tidak mati
sleep infinity
