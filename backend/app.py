# backend/app.py

"""
FastAPI backend for "The Ensemble – Work–Life Reset"

- Uses a local LLM via Ollama (no API keys needed)
- Uses ElevenLabs for TTS (Guide + Challenger voices)
- Exposes:
    POST /api/ensemble  -> returns Guide + Challenger replies (texts + audio URLs)
    POST /api/summary   -> returns a 3-line Reset Card

Prerequisites:
- Install Ollama from https://ollama.com
    - ollama pull llama3.2
- Install dependencies:
    - pip install fastapi uvicorn[standard] requests python-dotenv elevenlabs
- Set ELEVEN_API_KEY in your environment (.env or export).
- Then run:
    uvicorn app:app --reload
"""

import os
import uuid
from typing import List

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from elevenlabs import ElevenLabs
from dotenv import load_dotenv
load_dotenv()


from prompts import (
    GUIDE_SYSTEM_PROMPT,
    CHALLENGER_SYSTEM_PROMPT,
    SUMMARY_SYSTEM_PROMPT,
    PODCAST_SYSTEM_PROMPT
)


# ------------------------
# Config
# ------------------------

# TODO: replace these with your real ElevenLabs voice IDs
GUIDE_VOICE_ID = "yM93hbw8Qtvdma2wCnJG"
CHALLENGER_VOICE_ID = "24EI9FmmGvJruwUi7TJM"
ENABLE_TTS=False
OLLAMA_MODEL = "llama3.2:1b"

# ------------------------
# LLM helper (Ollama)
# ------------------------


def llm_chat(system_prompt: str, user_text: str) -> str:
    """
    Call local Ollama via /api/generate using a single prompt
    that includes the system instruction and the user text.
    Works even on Ollama versions without /api/chat.
    """
    url = "http://localhost:11434/api/generate"

    prompt = (
        f"{system_prompt.strip()}\n\n"
        f"User: {user_text.strip()}\n\n"
        f"Assistant:"
    )

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "temperature": 0.5,
    }

    resp = requests.post(url, json=payload)
    resp.raise_for_status()
    data = resp.json()
    # /api/generate returns: {"response": "...", ...}
    return data["response"].strip()

# ------------------------
# ElevenLabs TTS helper
# ------------------------

eleven_api_key = os.getenv("ELEVEN_API_KEY") if ENABLE_TTS else None

if ENABLE_TTS:
    if not eleven_api_key:
        raise RuntimeError("ELEVEN_API_KEY is not set but ENABLE_TTS is true.")
    tts_client = ElevenLabs(api_key=eleven_api_key)
else:
    tts_client = None


def text_to_speech(text: str, voice_id: str) -> str:
    """
    Converts text → audio and saves to /audio folder.
    Returns a URL for the frontend.

    If ENABLE_TTS is False, return an empty string so the
    frontend can fall back to browser speech synthesis.
    """
    if not ENABLE_TTS:
        return ""  # no ElevenLabs call at all

    audio_dir = os.path.join(os.path.dirname(__file__), "audio")
    os.makedirs(audio_dir, exist_ok=True)

    file_id = f"{uuid.uuid4()}.mp3"
    out_path = os.path.join(audio_dir, file_id)

    audio_stream = tts_client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_turbo_v2",
        output_format="mp3_44100_128",
    )

    with open(out_path, "wb") as f:
        for chunk in audio_stream:
            if isinstance(chunk, bytes):
                f.write(chunk)

    return f"/audio/{file_id}"
# ------------------------
# FastAPI setup
# ------------------------

app = FastAPI(title="Ensemble Work–Life Reset")

# CORS for local frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # in production you'd restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated audio files
app.mount("/audio", StaticFiles(directory="audio"), name="audio")


# ------------------------
# Request / response models
# ------------------------


class PodcastTurn(BaseModel):
    speaker: str      # "Guide" or "Challenger"
    text: str
    audio_url: str    # /audio/....mp3


class PodcastRequest(BaseModel):
    text: str
    turns: int = 2    # approx rounds per speaker; 2 rounds = 4 lines total


class PodcastResponse(BaseModel):
    turns: List[PodcastTurn]

# ------------------------
# Routes
# ------------------------



@app.post("/api/podcast", response_model=PodcastResponse)
def generate_podcast(req: PodcastRequest):
    """
    Generate a short "podcast" conversation between Guide and Challenger
    about the user's situation.

    - LLM produces a scripted dialogue:
        Guide: ...
        Challenger: ...
        ...
    - We parse that into turns, TTS each turn with the right voice,
      and return them in order.
    """
    desired_lines = 20  # hard target

    user_msg = (
        f"User's situation: {req.text}\n\n"
        f"Write exactly {desired_lines} lines of dialogue."
    )

    dialogue = llm_chat(PODCAST_SYSTEM_PROMPT, user_msg)

    turns: List[PodcastTurn] = []

    for raw_line in dialogue.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        lower = line.lower()
        if lower.startswith("guide:"):
            speaker = "Guide"
            spoken_text = line.split(":", 1)[1].strip()
            voice_id = GUIDE_VOICE_ID
        elif lower.startswith("challenger:"):
            speaker = "Challenger"
            spoken_text = line.split(":", 1)[1].strip()
            voice_id = CHALLENGER_VOICE_ID
        else:
            continue

        if not spoken_text:
            continue

        # If we already reached 20 valid lines, stop adding more
        if len(turns) >= desired_lines:
            break

        audio_url = text_to_speech(spoken_text, voice_id)
        turns.append(PodcastTurn(speaker=speaker, text=spoken_text, audio_url=audio_url))

    # Optional: if fewer than 20 lines return, you still get something rather than error
    return PodcastResponse(turns=turns)