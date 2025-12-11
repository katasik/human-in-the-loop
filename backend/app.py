import os
import uuid
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse, FileResponse
from pydantic import BaseModel
from elevenlabs import ElevenLabs
from dotenv import load_dotenv

from prompts import PODCAST_SYSTEM_PROMPT

load_dotenv()

# ------------------------
# Config
# ------------------------

# Persona → ElevenLabs voice IDs (for TTS fallback)
INTUITION_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"   # Sarah - Intuition (warm)
REASON_VOICE_ID    = "CwhRBWXzGAHq8TQ4Fs17"   # Roger - Reason (calm)
FEAR_VOICE_ID      = "IKne3meq5aSn9XLyUdCD"   # Charlie - Fear (intense)

# Inner Council Agent ID (for real-time voice conversation)
INNER_COUNCIL_AGENT_ID = os.getenv("INNER_COUNCIL_AGENT_ID", "agent_6001kc72tf64eyybgqxes28z1zvd")

ENABLE_TTS = True

# Local LLM model name for Ollama
OLLAMA_MODEL = "llama3.2:1b"

# ------------------------
# LLM helper (Ollama)
# ------------------------

def llm_chat(system_prompt: str, user_text: str) -> str:
    """
    Call local Ollama via /api/generate with a single combined prompt.
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
        "temperature": 0.6,
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
        raise RuntimeError("ELEVEN_API_KEY is set to true but ELEVEN_API_KEY is missing.")
    tts_client = ElevenLabs(api_key=eleven_api_key)
else:
    tts_client = None


def text_to_speech(text: str, voice_id: str) -> str:
    """
    Converts text → audio and saves to /audio/<uuid>.mp3.
    Returns a URL string that the frontend can play.

    If ENABLE_TTS is False, returns an empty string so the
    frontend can fall back to browser voices.
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

app = FastAPI(title="Inner Council – Work–Life Debate")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated audio
audio_dir = os.path.join(os.path.dirname(__file__), "audio")
os.makedirs(audio_dir, exist_ok=True)
app.mount("/audio", StaticFiles(directory=audio_dir), name="audio")

# Serve frontend static files
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="frontend")

# Serve index.html at root
@app.get("/")
def serve_index():
    index_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Frontend not found. Place index.html in frontend/"}

# ------------------------
# Models
# ------------------------

class PodcastTurn(BaseModel):
    speaker: str              # "Intuition" | "Reason" | "Fear"
    text: str
    audio_url: Optional[str]  # may be "" when TTS disabled

class PodcastRequest(BaseModel):
    # IMPORTANT: the frontend must send { "text": "..."}
    text: str
    turns: int = 2  # kept for backwards-compatibility, not used now

class PodcastResponse(BaseModel):
    turns: List[PodcastTurn]

class TTSSingleRequest(BaseModel):
    speaker: str   # "Intuition" | "Reason" | "Fear"
    text: str

class TTSSingleResponse(BaseModel):
    audio_url: str

# ------------------------
# Helpers
# ------------------------

def persona_to_voice_id(speaker: str) -> str:
    s = speaker.lower()
    if s == "intuition":
        return INTUITION_VOICE_ID
    if s == "reason":
        return REASON_VOICE_ID
    if s == "fear":
        return FEAR_VOICE_ID
    # fallback
    return INTUITION_VOICE_ID

# ------------------------
# Routes
# ------------------------

@app.post("/api/podcast", response_model=PodcastResponse)
def generate_podcast(req: PodcastRequest):
    """
    Generate an 'Inner Council' debate between Intuition, Reason, and Fear.

    Contract with the LLM (reinforced in PODCAST_SYSTEM_PROMPT):
    - Use EXACT speaker labels: Intuition:, Reason:, Fear:
    - Speak in first person ("I think", "I'm afraid", "I feel...").
    - Total length between 6 and 15 lines.
    - FINAL LINE MUST BE:  Reason: I wonder what she thinks.
    """
    MIN_LINES = 6
    MAX_LINES = 15

    user_msg = (
        "Here is the person's situation, in their own words:\n"
        f"{req.text}\n\n"
        "Please follow the instructions above. "
        "Write between six and fifteen lines of dialogue. "
        "End the conversation with exactly this final line:\n"
        "Reason: I wonder what she thinks."
    )

    raw_dialogue = llm_chat(PODCAST_SYSTEM_PROMPT, user_msg)

    turns: List[PodcastTurn] = []

    for raw_line in raw_dialogue.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
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
            # Ignore lines with unknown prefixes
            continue

        if len(turns) >= MAX_LINES:
            break

        audio_url = text_to_speech(spoken_text, voice_id)
        turns.append(
            PodcastTurn(
                speaker=speaker,
                text=spoken_text,
                audio_url=audio_url,
            )
        )

    # If the model ignored our ending instruction, enforce it
    if turns:
        last = turns[-1]
        expected_last_text = "I wonder what she thinks."
        if not (last.speaker == "Reason" and last.text.strip().lower() == expected_last_text.lower()):
            # Only append if we still have room
            if len(turns) < MAX_LINES:
                final_text = "I wonder what she thinks."
                audio_url = text_to_speech(final_text, REASON_VOICE_ID)
                turns.append(
                    PodcastTurn(
                        speaker="Reason",
                        text=final_text,
                        audio_url=audio_url,
                    )
                )

    # If the model produced fewer than MIN_LINES, we still return what we have.
    return PodcastResponse(turns=turns)


@app.post("/api/tts", response_model=TTSSingleResponse)
def tts_single(req: TTSSingleRequest):
    """
    Generate TTS for a single line (persona + text).
    You can call this lazily from the frontend if you ever want
    to avoid pre-generating all mp3s.
    """
    voice_id = persona_to_voice_id(req.speaker)
    audio_url = text_to_speech(req.text, voice_id)
    return TTSSingleResponse(audio_url=audio_url)


# ------------------------
# Real-time Voice Conversation (ElevenLabs Agents)
# ------------------------

@app.get("/api/signed-url", response_class=PlainTextResponse)
def get_signed_url():
    """
    Get a signed WebSocket URL for connecting to the Inner Council agent.
    This keeps the API key secure on the server.
    """
    if not eleven_api_key:
        raise HTTPException(status_code=500, detail="ElevenLabs API key not configured")

    url = f"https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id={INNER_COUNCIL_AGENT_ID}"

    headers = {
        "xi-api-key": eleven_api_key
    }

    resp = requests.get(url, headers=headers)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Failed to get signed URL: {resp.text}"
        )

    data = resp.json()
    return data.get("signed_url", "")


@app.get("/api/agent-id")
def get_agent_id():
    """
    Get the Inner Council agent ID for public agent access.
    Use this if the agent is configured as public (no auth required).
    """
    return {"agent_id": INNER_COUNCIL_AGENT_ID}