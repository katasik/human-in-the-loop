# backend/app.py

"""
Inner Council – FastAPI backend

- Uses Ollama (local LLM) to generate a 3-voice debate:
  Intuition, Reason, Fear.
- Optionally uses ElevenLabs for TTS:
  one voice per persona, returning /audio/*.mp3.
- Exposes:
    POST /api/podcast  -> returns list of turns (speaker, text, audio_url, raw_dialogue)

Prerequisites:
- Install Ollama from https://ollama.com
    - ollama pull llama3.2
- Install dependencies:
    - pip install fastapi uvicorn[standard] requests python-dotenv elevenlabs
- Set ELEVEN_API_KEY in your environment (.env or export) if you want ElevenLabs TTS.
- Then run:
    uvicorn app:app --reload
"""

import os
import uuid
from typing import List, Optional

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from elevenlabs import ElevenLabs
from dotenv import load_dotenv

from prompts import PODCAST_SYSTEM_PROMPT

load_dotenv()

# ------------------------
# Config
# ------------------------

# Map each persona to a real ElevenLabs voice ID
INTUITION_VOICE_ID = os.getenv("INTUITION_VOICE_ID", "yM93hbw8Qtvdma2wCnJG")   # warm
REASON_VOICE_ID    = os.getenv("REASON_VOICE_ID", "24EI9FmmGvJruwUi7TJM")      # logical
FEAR_VOICE_ID      = os.getenv("FEAR_VOICE_ID", "ZF6FPAbjXT4488VcRRnw")        # protective

# Turn ElevenLabs on/off via env: ENABLE_TTS=true / false
ENABLE_TTS = True

# Ollama model name
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")


# ------------------------
# LLM helper (Ollama)
# ------------------------

def llm_chat(system_prompt: str, user_text: str) -> str:
    """
    Call local Ollama via /api/generate using a single prompt
    that includes the system instruction and the user text.
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
    Returns a URL path (e.g. "/audio/xyz.mp3").

    If ENABLE_TTS is False, returns "" so the frontend falls back
    to browser speech synthesis (two/three different browser voices).
    """
    if not ENABLE_TTS:
        return ""

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

app = FastAPI(title="Inner Council – Three-Voice Debate")

# CORS for local frontend (file:// or localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # in prod, restrict
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated audio files
audio_dir_path = os.path.join(os.path.dirname(__file__), "audio")
os.makedirs(audio_dir_path, exist_ok=True)
app.mount("/audio", StaticFiles(directory=audio_dir_path), name="audio")


# ------------------------
# Request / response models
# ------------------------

class PodcastTurn(BaseModel):
    speaker: str      # "Intuition" | "Reason" | "Fear"
    text: str
    audio_url: str    # "/audio/....mp3" or ""


class PodcastRequest(BaseModel):
    text: str          # user challenge
    turns: int = 18    # requested lines (we clamp to max 20)


class PodcastResponse(BaseModel):
    turns: List[PodcastTurn]
    raw_dialogue: Optional[str] = None  # for debugging


# ------------------------
# Parsing helper
# ------------------------

def parse_inner_council_dialogue(dialogue: str, desired_lines: int) -> List[PodcastTurn]:
    """
    Parse the LLM output into structured turns.

    PASS 1: Strictly require "Intuition:", "Reason:", or "Fear:" prefixes.
    PASS 2: If nothing parsed, fall back to round-robin Intuition → Reason → Fear
            over non-empty lines.
    """
    lines = [l.strip() for l in dialogue.splitlines() if l.strip()]
    turns: List[PodcastTurn] = []

    # ---------- PASS 1: Strict prefix parsing ----------
    for line in lines:
        if ":" not in line:
            continue

        speaker_raw, content = line.split(":", 1)
        speaker_key = speaker_raw.strip().lower()
        spoken_text = content.strip()

        if not spoken_text:
            continue

        if speaker_key == "intuition":
            speaker = "Intuition"
            voice_id = INTUITION_VOICE_ID
        elif speaker_key == "reason":
            speaker = "Reason"
            voice_id = REASON_VOICE_ID
        elif speaker_key == "fear":
            speaker = "Fear"
            voice_id = FEAR_VOICE_ID
        else:
            continue

        audio_url = text_to_speech(spoken_text, voice_id)
        turns.append(PodcastTurn(speaker=speaker, text=spoken_text, audio_url=audio_url))

        if len(turns) >= desired_lines:
            return turns

    if turns:
        return turns

    # ---------- PASS 2: Round-robin fallback ----------
    role_cycle = [
        ("Intuition", INTUITION_VOICE_ID),
        ("Reason", REASON_VOICE_ID),
        ("Fear", FEAR_VOICE_ID),
    ]

    fallback_turns: List[PodcastTurn] = []
    for idx, line in enumerate(lines):
        if idx >= desired_lines:
            break

        # Strip any “X:” prefix and keep content
        if ":" in line:
            _, content = line.split(":", 1)
            spoken_text = content.strip() or line
        else:
            spoken_text = line

        speaker, voice_id = role_cycle[idx % len(role_cycle)]
        audio_url = text_to_speech(spoken_text, voice_id)
        fallback_turns.append(
            PodcastTurn(speaker=speaker, text=spoken_text, audio_url=audio_url)
        )

    return fallback_turns


# ------------------------
# Routes
# ------------------------

@app.post("/api/podcast", response_model=PodcastResponse)
def generate_podcast(req: PodcastRequest):
    """
    Generate a short Inner Council debate between Intuition, Reason, and Fear
    about the user's situation.

    - Lines 1–3: intros from each voice.
    - Remaining lines: interactive debate.
    """
    desired_lines = min(max(req.turns, 3), 20)

    user_msg = (
        f"User's situation: {req.text}\n\n"
        f"Write exactly {desired_lines} lines of dialogue."
    )

    dialogue = llm_chat(PODCAST_SYSTEM_PROMPT, user_msg)

    # Log raw dialogue for debugging
    print("\n================ RAW LLM DIALOGUE ================\n")
    print(dialogue)
    print("\n==================================================\n")

    turns = parse_inner_council_dialogue(dialogue, desired_lines)

    return PodcastResponse(turns=turns, raw_dialogue=dialogue)