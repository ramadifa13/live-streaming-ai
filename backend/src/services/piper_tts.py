#!/usr/bin/env python3
"""
Piper TTS helper — dipanggil oleh Node.js backend via child_process.spawn.
Input : teks via stdin (UTF-8)
Output: audio WAV 16kHz mono via stdout (raw bytes)
Usage : python piper_tts.py [--model path/to/voice.onnx] [--length-scale 1.0]
"""

import sys
import io
import wave
import argparse
import os

def main():
    parser = argparse.ArgumentParser(description="Piper TTS synthesizer")
    parser.add_argument(
        "--model",
        default=os.environ.get(
            "PIPER_VOICE_MODEL",
            os.path.join(os.path.dirname(__file__), "piper_voices", "id_ID-google-medium.onnx"),
        ),
        help="Path ke file ONNX voice model",
    )
    parser.add_argument(
        "--length-scale",
        type=float,
        default=float(os.environ.get("PIPER_LENGTH_SCALE", "0.95")),
        help="Kecepatan bicara: <1=lebih cepat, >1=lebih lambat",
    )
    args = parser.parse_args()

    # Baca teks dari stdin
    text = sys.stdin.read().strip()
    if not text:
        sys.exit(1)

    try:
        from piper import PiperVoice  # type: ignore
    except ImportError:
        sys.stderr.write("ERROR: piper-tts belum terinstall. Jalankan: pip install piper-tts\n")
        sys.exit(2)

    if not os.path.isfile(args.model):
        sys.stderr.write(f"ERROR: Voice model tidak ditemukan: {args.model}\n")
        sys.stderr.write("Download model dengan: python -m piper.download --language id\n")
        sys.exit(3)

    # Load voice (cached per-process — proses di-spawn sekali per utterance oleh Node)
    voice = PiperVoice.load(args.model)

    # Synthesize ke buffer WAV in-memory
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        voice.synthesize(
            text,
            wav_file,
            length_scale=args.length_scale,
        )

    buf.seek(0)
    # Tulis bytes WAV ke stdout agar Node.js bisa baca
    sys.stdout.buffer.write(buf.read())
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
