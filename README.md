# The Inner Council

A real-time voice conversation app that lets you talk with your three inner voices: **Intuition**, **Reason**, and **Fear**. Built with ElevenLabs Conversational AI for the ElevenLabs Hackathon.

## Quick Start

### 1. Install uv (Python package manager)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2. Set up environment

```bash
cp .env.example .env
```

Edit `.env` and add your ElevenLabs API key:
- `ELEVENLABS_API_KEY` - Get your API key at [elevenlabs.io](https://elevenlabs.io)

(The agent ID is pre-configured)

### 3. Install dependencies

```bash
uv sync
```

### 4. Run the server

```bash
uv run python backend/app.py
```

Or with uvicorn directly:

```bash
uv run uvicorn backend.app:app --reload --port 8000
```

### 5. Open the app

Visit [http://localhost:8000](http://localhost:8000)

## How It Works

- Click "Start Conversation" to begin talking with your Inner Council
- The three personas (Intuition, Reason, Fear) respond in real-time via ElevenLabs voice AI
- The active speaker is shown in the center with a pulsing animation
- Captions appear below as the conversation progresses

## Tech Stack

- **Backend**: FastAPI + Python 3.12+
- **Frontend**: Vanilla HTML/CSS/JS
- **Voice AI**: ElevenLabs Conversational AI SDK
- **Package Manager**: uv
