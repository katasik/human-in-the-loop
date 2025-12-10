# backend/app.py

"""
FastAPI backend for "The Ensemble – Work–Life Reset"

- Uses a local LLM via Ollama (no API keys needed)
- Exposes:
    POST /api/ensemble  -> returns Guide + Challenger replies (texts)
    POST /api/summary   -> returns a 3-line Reset Card

Prerequisites:
- Install Ollama from https://ollama.com
- Pull a model, e.g.:  `ollama pull llama3.2`
- Make sure Ollama is running (it usually is after install)
- Then run this app with:
    uvicorn app:app --reload
"""

from typing import Optional

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from prompts import (
    GUIDE_SYSTEM_PROMPT,
    CHALLENGER_SYSTEM_PROMPT,
    SUMMARY_SYSTEM_PROMPT,
)

# ------------------------
# LLM helper (Ollama)
# ------------------------


def llm_chat(system_prompt: str, user_text: str) -> str:
    """
    Call local Ollama chat API with a system + user message.

    Assumes:
    - Ollama is running on http://localhost:11434
    - A model named 'llama3.2' is available (via `ollama pull llama3.2`)

    If your model name differs (e.g. 'llama3'), change the `model` below.
    """
    url = "http://localhost:11434/api/chat"
    payload = {
        "model": "llama3.2",  # change to "llama3" or another if needed
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
# FastAPI setup
# ------------------------

app = FastAPI(title="Ensemble Work–Life Reset")

# Allow frontend / local files to call the API (hackathon-simple CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # in production you'd restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------
# Request / response models
# ------------------------

class EnsembleRequest(BaseModel):
    text: str


class EnsembleResponse(BaseModel):
    guide_text: str
    challenger_text: str


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
    - returns both texts
    """
    user_text = req.text

    guide_text = llm_chat(GUIDE_SYSTEM_PROMPT, user_text)
    challenger_text = llm_chat(CHALLENGER_SYSTEM_PROMPT, user_text)

    return EnsembleResponse(
        guide_text=guide_text,
        challenger_text=challenger_text,
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