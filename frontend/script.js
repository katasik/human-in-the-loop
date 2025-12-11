// =======================
// CONFIG
// =======================

const apiBase = "http://127.0.0.1:8000";

// =======================
// DOM + STATE
// =======================

let currentDialogue = [];
let currentIndex = 0;
let isPaused = false;
let currentAudio = null;

// Inner Council UI elements (from your index.html)
const startButton = document.getElementById("startButton");
const challengeInput = document.getElementById("challengeInput");
const inputSection = document.getElementById("inputSection");
const councilSection = document.getElementById("councilSection");
const dialogueSection = document.getElementById("dialogueSection");
const dialogueContainer = document.getElementById("dialogueContainer");
const pauseButton = document.getElementById("pauseButton");
const currentMessageSpan = document.getElementById("currentMessage");
const totalMessagesSpan = document.getElementById("totalMessages");

// optional mic button (if you have one)
const micButton =
  document.getElementById("micBtn") ||
  document.getElementById("micButton") ||
  document.getElementById("speakInsteadBtn") ||
  null;

// persona cards
const voiceCards = {
  Intuition: document.querySelector('[data-voice="intuition"]'),
  Reason: document.querySelector('[data-voice="reason"]'),
  Fear: document.querySelector('[data-voice="fear"]'),
};

// =======================
// BROWSER TTS VOICES
// =======================

let allVoices = [];
let intuitionVoice = null;
let reasonVoice = null;
let fearVoice = null;

function pickBrowserVoices() {
  if (!("speechSynthesis" in window)) return;

  allVoices = window.speechSynthesis.getVoices() || [];
  if (!allVoices.length) return;

  // Prefer English voices if possible
  const enVoices = allVoices.filter(
    (v) => v.lang && v.lang.toLowerCase().startsWith("en")
  );
  const pool = enVoices.length >= 3 ? enVoices : allVoices;

  intuitionVoice = pool[0] || null;
  reasonVoice = pool[1] || pool[0] || null;
  fearVoice = pool[2] || pool[1] || pool[0] || null;

  console.log("🎙 Intuition voice:", intuitionVoice?.name);
  console.log("🎙 Reason voice   :", reasonVoice?.name);
  console.log("🎙 Fear voice     :", fearVoice?.name);
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = pickBrowserVoices;
  pickBrowserVoices();
}

function speakWithBrowserTTS(text, speaker) {
  if (!("speechSynthesis" in window)) return;
  if (!text) return;

  const u = new SpeechSynthesisUtterance(text);

  let v = intuitionVoice;
  if (speaker === "Reason") v = reasonVoice || intuitionVoice;
  if (speaker === "Fear") v = fearVoice || reasonVoice || intuitionVoice;

  if (v) u.voice = v;

  // Stop any ongoing TTS but not audio elements
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// =======================
// UI HELPERS
// =======================

function setButtonLoading(loading) {
  if (!startButton) return;

  const buttonText = startButton.querySelector(".button-text");
  const buttonLoader = startButton.querySelector(".button-loader");

  if (loading) {
    startButton.disabled = true;
    if (buttonText) buttonText.style.display = "none";
    if (buttonLoader) buttonLoader.style.display = "flex";
  } else {
    startButton.disabled = false;
    if (buttonText) buttonText.style.display = "inline";
    if (buttonLoader) buttonLoader.style.display = "none";
  }
}

function clearActiveSpeakers() {
  Object.values(voiceCards).forEach((card) => {
    if (card) card.classList.remove("speaking");
  });
}

function setActiveSpeaker(speaker) {
  clearActiveSpeakers();
  const key = speaker.toLowerCase(); // intuition / reason / fear
  const card = document.querySelector(`[data-voice="${key}"]`);
  if (card) card.classList.add("speaking");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function addMessageToDialogue(turn) {
  if (!dialogueContainer) return;

  const cls = turn.speaker.toLowerCase(); // intuition / reason / fear
  const messageDiv = document.createElement("div");
  messageDiv.className = `dialogue-message ${cls}`;

  messageDiv.innerHTML = `
    <div class="message-header">
      <span class="message-speaker">${turn.speaker}</span>
    </div>
    <div class="message-text">${escapeHtml(turn.text)}</div>
  `;

  dialogueContainer.appendChild(messageDiv);
  dialogueContainer.scrollTop = dialogueContainer.scrollHeight;
}

// =======================
// AUDIO LOGIC (ONE TURN)
// =======================

async function playTurn(turn) {
  // Stop previous audio + browser speech
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  // A) If backend already gave us ElevenLabs mp3
  if (turn.audio_url && turn.audio_url.trim() !== "") {
    const audio = new Audio(apiBase + turn.audio_url);
    currentAudio = audio;

    return new Promise((resolve) => {
      audio.onended = resolve;
      audio.onerror = () => {
        console.error("Error playing audio_url, falling back to browser TTS");
        speakWithBrowserTTS(turn.text, turn.speaker);
        setTimeout(resolve, 1500);
      };

      audio
        .play()
        .catch((err) => {
          console.error("Play error, falling back to browser TTS:", err);
          speakWithBrowserTTS(turn.text, turn.speaker);
          setTimeout(resolve, 1500);
        });
    });
  }

  // B) If audio_url missing (in theory) → ask backend /api/tts
  try {
    const resp = await fetch(`${apiBase}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker: turn.speaker, text: turn.text }),
    });

    if (!resp.ok) throw new Error("TTS backend error: " + resp.status);

    const data = await resp.json();
    const audioUrl = data.audio_url;

    if (audioUrl && audioUrl.trim() !== "") {
      turn.audio_url = audioUrl;

      const audio = new Audio(apiBase + audioUrl);
      currentAudio = audio;

      return new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = () => {
          console.error(
            "Error playing generated audio, falling back to browser TTS"
          );
          speakWithBrowserTTS(turn.text, turn.speaker);
          setTimeout(resolve, 1500);
        };

        audio
          .play()
          .catch((err) => {
            console.error("Play error, falling back to browser TTS:", err);
            speakWithBrowserTTS(turn.text, turn.speaker);
            setTimeout(resolve, 1500);
          });
      });
    }
  } catch (err) {
    console.error("Error calling /api/tts:", err);
  }

  // C) Final fallback if everything fails
  speakWithBrowserTTS(turn.text, turn.speaker);
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

// =======================
// PLAYING THE DEBATE
// =======================

async function playNextMessage() {
  if (isPaused) return;
  if (currentIndex >= currentDialogue.length) {
    clearActiveSpeakers();
    if (pauseButton) pauseButton.style.display = "none";
    return;
  }

  const turn = currentDialogue[currentIndex];

  if (currentMessageSpan)
    currentMessageSpan.textContent = String(currentIndex + 1);

  setActiveSpeaker(turn.speaker);
  addMessageToDialogue(turn);

  await playTurn(turn);

  if (!isPaused) {
    currentIndex += 1;
    playNextMessage();
  }
}

// =======================
// START SESSION
// =======================

async function startSession() {
  try {
    setButtonLoading(true);

    const userText = (challengeInput?.value || "").trim();

    // Backend PodcastRequest expects { text, turns }
    const body = {
      text:
        userText ||
        "I feel torn between work and life and I'm not sure how to move forward.",
      turns: 3, // not really used, but accepted
    };

    const resp = await fetch(`${apiBase}/api/podcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error("Failed to start debate");
    }

    const data = await resp.json();
    const turns = data.turns || [];
    if (!turns.length) {
      throw new Error("No debate returned from backend");
    }

    currentDialogue = turns;
    currentIndex = 0;
    isPaused = false;

    if (dialogueContainer) dialogueContainer.innerHTML = "";
    if (totalMessagesSpan)
      totalMessagesSpan.textContent = String(currentDialogue.length);
    if (currentMessageSpan) currentMessageSpan.textContent = "0";

    // Show the council + dialogue, optionally hide input
    if (inputSection) inputSection.style.display = "none";
    if (councilSection) councilSection.style.display = "block";
    if (dialogueSection) dialogueSection.style.display = "block";
    if (pauseButton) pauseButton.style.display = "inline-flex";

    await playNextMessage();
  } catch (err) {
    console.error(err);
    alert("Something went wrong: " + err.message);
  } finally {
    setButtonLoading(false);
  }
}

// =======================
// PAUSE / RESUME
// =======================

function togglePause() {
  isPaused = !isPaused;
  if (!pauseButton) return;

  const pauseIcon = pauseButton.querySelector(".pause-icon");
  const playIcon = pauseButton.querySelector(".play-icon");

  if (isPaused) {
    if (currentAudio) currentAudio.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (pauseIcon) pauseIcon.style.display = "none";
    if (playIcon) playIcon.style.display = "inline";
  } else {
    if (pauseIcon) pauseIcon.style.display = "inline";
    if (playIcon) playIcon.style.display = "none";
    playNextMessage();
  }
}

// =======================
// SPEECH-TO-TEXT (MIC)
// =======================

let recognition = null;

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (challengeInput) challengeInput.value = transcript;
  };

  recognition.onerror = (event) => {
    console.error("STT error:", event);
    alert("Speech recognition error. Try again or type instead.");
  };
} else if (micButton) {
  micButton.disabled = true;
  micButton.textContent = "Speech not supported";
}

if (micButton && recognition) {
  micButton.addEventListener("click", () => {
    if (!recognition) return;

    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (currentAudio) currentAudio.pause();

    recognition.start();
    const original = micButton.textContent;
    micButton.textContent = "Listening…";
    recognition.onend = () => {
      micButton.textContent = original;
    };
  });
}

// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", () => {
  if (startButton) startButton.addEventListener("click", startSession);
  if (pauseButton) pauseButton.addEventListener("click", togglePause);
});

// Spacebar = pause/resume when dialogue visible
document.addEventListener("keydown", (e) => {
  if (!dialogueSection) return;
  if (e.code === "Space" && dialogueSection.style.display !== "none") {
    e.preventDefault();
    togglePause();
  }
});