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
)


# ------------------------
# Config
# ------------------------

# TODO: replace these with your real ElevenLabs voice IDs
GUIDE_VOICE_ID = "24EI9FmmGvJruwUi7TJM"
CHALLENGER_VOICE_ID = "yM93hbw8Qtvdma2wCnJG"

OLLAMA_MODEL = "llama3.2"  # change if you pulled another model name

# ------------------------
# LLM helper (Ollama)
# ------------------------


def llm_chat(system_prompt: str, user_text: str) -> str:
    """
    Call local Ollama chat API with a system + user message.

    Assumes:
    - Ollama is running on http://localhost:11434
    - A model named OLLAMA_MODEL is available (via `ollama pull <model>`).
    """
    url = "http://localhost:11434/api/chat"
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "stream": False,
    }
    resp = requests.post(url, json=payload)
    resp.raise_for_status()
    data = resp.json()
    # Ollama returns: {"message": {"role": "...", "content": "..."}, ...}
    return data["message"]["content"].strip()


# ------------------------
# ElevenLabs TTS helper
# ------------------------

eleven_api_key = os.getenv("ELEVEN_API_KEY")
if not eleven_api_key:
    raise RuntimeError("ELEVEN_API_KEY is not set. Check your environment or .env file.")
tts_client = ElevenLabs(api_key=eleven_api_key)


def text_to_speech(text: str, voice_id: str) -> str:
    """
    Converts text → audio and saves to /audio folder.
    Returns a URL for the frontend.
    """
    # Make sure the audio directory exists
    audio_dir = os.path.join(os.path.dirname(__file__), "audio")
    os.makedirs(audio_dir, exist_ok=True)

    file_id = f"{uuid.uuid4()}.mp3"
    out_path = os.path.join(audio_dir, file_id)

    # ElevenLabs SDK returns a generator of bytes chunks
    audio_stream = tts_client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id="eleven_turbo_v2",      # or eleven_multilingual_v2, etc.
        output_format="mp3_44100_128",   # standard mp3
    )

    with open(out_path, "wb") as f:
        for chunk in audio_stream:
            if isinstance(chunk, bytes):
                f.write(chunk)

    # This path is relative to the StaticFiles mount at /audio
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

class EnsembleRequest(BaseModel):
    text: str


class EnsembleResponse(BaseModel):
    guide_text: str
    challenger_text: str
    guide_audio_url: str
    challenger_audio_url: str


class SummaryRequest(BaseModel):
    transcript: str


class SummaryResponse(BaseModel):
    summary_text: str


# ------------------------
# Routes
# ------------------------

@app.post("/api/ensemble", response_model=EnsembleResponse)
def run_ensemble(req: EnsembleRequest):
    """
    Main endpoint:
    - takes the user's description of their work–life challenge
    - runs Guide + Challenger agents (two different system prompts)
    - generates ElevenLabs audio for each
    - returns texts + audio URLs
    """
    user_text = req.text

    # 1) LLM texts
    guide_text = llm_chat(GUIDE_SYSTEM_PROMPT, user_text)
    challenger_text = llm_chat(CHALLENGER_SYSTEM_PROMPT, user_text)

    # 2) TTS audio for both agents
    guide_audio_url = text_to_speech(guide_text, GUIDE_VOICE_ID)
    challenger_audio_url = text_to_speech(challenger_text, CHALLENGER_VOICE_ID)

    return EnsembleResponse(
        guide_text=guide_text,
        challenger_text=challenger_text,
        guide_audio_url=guide_audio_url,
        challenger_audio_url=challenger_audio_url,
    )


@app.post("/api/summary", response_model=SummaryResponse)
def summarize_conversation(req: SummaryRequest):
    """
    Takes a transcript (user + guide + challenger turns) and generates a Reset Card.

    Output is exactly three lines:
    - Biggest tension: ...
    - Trade-off I'm accepting: ...
    - My 7-day commitment: ...
    (as defined in SUMMARY_SYSTEM_PROMPT)
    """
    summary_text = llm_chat(SUMMARY_SYSTEM_PROMPT, req.transcript)
    return SummaryResponse(summary_text=summary_text)