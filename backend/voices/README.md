# Backend voice references

Each voice used by Pocket TTS has one `reference.wav` file in its own directory.
Reference audio is intentionally owned by the backend; the AI worker receives
already-rendered WAV audio and does not store or synchronize voice profiles.
