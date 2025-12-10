# backend/eleven.py

import os
from elevenlabs import ElevenLabs, save

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

if not ELEVENLABS_API_KEY:
    raise RuntimeError("ELEVENLABS_API_KEY not set")

client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

# Replace with your actual voice IDs from ElevenLabs
GUIDE_VOICE_ID = "GUIDE_VOICE_ID_HERE"
CHALLENGER_VOICE_ID = "CHALLENGER_VOICE_ID_HERE"
SUMMARY_VOICE_ID = "SUMMARY_VOICE_ID_HERE"


def tts_to_file(text: str, voice_id: str, out_path: str) -> str:
    """
    Synthesize `text` with ElevenLabs voice and save to `out_path`.
    Returns the relative path that the API can serve.
    """
    audio = client.generate(
        voice=voice_id,
        model="eleven_multilingual_v2",
        text=text,
    )
    save(audio, out_path)
    return out_path