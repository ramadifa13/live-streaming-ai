# Backend voice references

Each voice used by Pocket TTS has one `reference.wav` file in its own directory.
Reference audio is intentionally owned by the backend; the AI worker receives
already-rendered WAV audio and does not store or synchronize voice profiles.

## Reference voice requirements

For the most consistent cloning result, use a recording with:

- 8-12 seconds of active speech. The model supports up to 30 seconds, but longer clips often add unnecessary prosody, room noise, and breathing patterns.
- One speaker only, speaking Indonesian naturally at a steady pace.
- No music, echo, reverb, background conversation, or sound effects.
- The same microphone and speaking style that should be used in the final live stream.
- Clear pronunciation with 2-4 complete sentences and normal pauses.
- WAV, mono, PCM 16-bit. Other sample rates are accepted and normalized by the TTS runner, but 24 kHz is preferred.

Avoid clips that are clipped, extremely quiet, whispered, heavily compressed, or contain long silence. The runner automatically converts stereo to mono, removes leading and trailing silence, normalizes the peak, resamples to 24 kHz, and uses at most 12 seconds for voice conditioning.
