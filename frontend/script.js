// frontend/script.js

const API_BASE = "http://127.0.0.1:8000";

// DOM elements
const startButton = document.getElementById("startButton");
const micButton = document.getElementById("micButton");
const challengeInput = document.getElementById("challengeInput");

const councilSection = document.getElementById("councilSection");
const dialogueSection = document.getElementById("dialogueSection");
const dialogueContainer = document.getElementById("dialogueContainer");
const playAllButton = document.getElementById("playAllButton");
const currentLineSpan = document.getElementById("currentLine");
const totalLinesSpan = document.getElementById("totalLines");
const audioPlayer = document.getElementById("audioPlayer");

// Voice cards
const voiceCards = {
  Intuition: document.querySelector('[data-voice="Intuition"]'),
  Reason: document.querySelector('[data-voice="Reason"]'),
  Fear: document.querySelector('[data-voice="Fear"]'),
};

// State
let currentTurns = [];
let currentIndex = 0;
let isPlayingSequence = false;
let elevenLabsMode = false; // inferred from audio_url presence

// =======================
// Browser TTS voices
// =======================

let allVoices = [];
let intuitionVoice = null;
let reasonVoice = null;
let fearVoice = null;

function chooseBrowserVoices() {
  allVoices = window.speechSynthesis.getVoices() || [];
  if (!allVoices.length) return;

  const enVoices = allVoices.filter((v) =>
    v.lang && v.lang.toLowerCase().startsWith("en")
  );

  const pool = enVoices.length >= 3 ? enVoices : allVoices;

  intuitionVoice = pool[0] || null;
  reasonVoice = pool[1] || pool[0] || null;
  fearVoice = pool[2] || pool[1] || pool[0] || null;

  console.log("Intuition voice:", intuitionVoice?.name);
  console.log("Reason voice:", reasonVoice?.name);
  console.log("Fear voice:", fearVoice?.name);
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = chooseBrowserVoices;
  chooseBrowserVoices();
}

// Helper: browser TTS per persona
function speakWithBrowserTTS(text, speaker) {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis not supported in this browser.");
    return;
  }
  if (!text) return;

  const utterance = new SpeechSynthesisUtterance(text);
  let voice = null;
  if (speaker === "Intuition") voice = intuitionVoice || reasonVoice || fearVoice;
  else if (speaker === "Reason") voice = reasonVoice || intuitionVoice || fearVoice;
  else if (speaker === "Fear") voice = fearVoice || reasonVoice || intuitionVoice;

  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// =======================
// UI helpers
// =======================

function setLoading(loading) {
  const textSpan = startButton.querySelector(".button-text");
  if (loading) {
    startButton.disabled = true;
    if (textSpan) textSpan.textContent = "Summoning the Inner Council…";
  } else {
    startButton.disabled = false;
    if (textSpan) textSpan.textContent = "Let the Inner Council speak";
  }
}

function clearDialogue() {
  dialogueContainer.innerHTML = "";
  currentLineSpan.textContent = "0";
  totalLinesSpan.textContent = "0";
  currentTurns = [];
  currentIndex = 0;
}

function addMessage(turn) {
  const div = document.createElement("div");
  div.className = `dialogue-message ${turn.speaker}`;

  div.innerHTML = `
    <div class="message-header">${turn.speaker}</div>
    <div class="message-text">${escapeHtml(turn.text)}</div>
  `;

  dialogueContainer.appendChild(div);
  dialogueContainer.scrollTop = dialogueContainer.scrollHeight;
}

function highlightSpeaker(speaker) {
  Object.values(voiceCards).forEach((card) =>
    card.classList.remove("speaking")
  );
  const card = voiceCards[speaker];
  if (card) card.classList.add("speaking");
}

function clearSpeakerHighlight() {
  Object.values(voiceCards).forEach((card) =>
    card.classList.remove("speaking")
  );
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// =======================
// Audio playback logic
// =======================

function playSingleTurn(turn) {
  // If ElevenLabs audio_url exists, play mp3, else browser TTS
  if (turn.audio_url && turn.audio_url.trim() !== "") {
    const url = `${API_BASE}${turn.audio_url}`;
    const audio = new Audio(url);
    audio.play().catch((err) => {
      console.error("Error playing ElevenLabs audio:", err);
      speakWithBrowserTTS(turn.text, turn.speaker);
    });
  } else {
    speakWithBrowserTTS(turn.text, turn.speaker);
  }
}

// Sequential autoplay (full debate)
function playSequence(startIndex = 0) {
  if (!currentTurns.length) {
    alert("Generate a debate first.");
    return;
  }
  currentIndex = startIndex;
  isPlayingSequence = true;
  playNextInSequence();
}

function playNextInSequence() {
  if (!isPlayingSequence || currentIndex >= currentTurns.length) {
    isPlayingSequence = false;
    clearSpeakerHighlight();
    return;
  }

  const turn = currentTurns[currentIndex];
  currentLineSpan.textContent = String(currentIndex + 1);
  highlightSpeaker(turn.speaker);

  // ElevenLabs mode if ANY turn has audio_url
  if (elevenLabsMode && turn.audio_url && turn.audio_url.trim() !== "") {
    audioPlayer.src = `${API_BASE}${turn.audio_url}`;
    audioPlayer.onended = () => {
      currentIndex += 1;
      playNextInSequence();
    };
    audioPlayer.onerror = () => {
      console.error("Audio error, skipping to next.");
      currentIndex += 1;
      playNextInSequence();
    };
    audioPlayer.play().catch((err) => {
      console.error("Error playing audio:", err);
      currentIndex += 1;
      playNextInSequence();
    });
  } else {
    // Browser TTS path
    if (!("speechSynthesis" in window)) {
      alert("Speech synthesis not supported.");
      isPlayingSequence = false;
      return;
    }

    const u = new SpeechSynthesisUtterance(turn.text);
    let voice = null;
    if (turn.speaker === "Intuition")
      voice = intuitionVoice || reasonVoice || fearVoice;
    else if (turn.speaker === "Reason")
      voice = reasonVoice || intuitionVoice || fearVoice;
    else if (turn.speaker === "Fear")
      voice = fearVoice || reasonVoice || intuitionVoice;

    if (voice) u.voice = voice;

    u.onend = () => {
      currentIndex += 1;
      playNextInSequence();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}

// =======================
// Backend call
// =======================

async function startInnerCouncil() {
  clearDialogue();
  setLoading(true);
  councilSection.style.display = "none";
  dialogueSection.style.display = "none";

  const text = challengeInput.value.trim() || "I feel stuck about my work–life balance and I am not sure what to change.";

  try {
    const resp = await fetch(`${API_BASE}/api/podcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, turns: 20 }),
    });

    if (!resp.ok) {
      throw new Error("Backend error: " + resp.status);
    }

    const data = await resp.json();
    const turns = data.turns || [];

    if (!turns.length) {
      alert("No debate returned from backend.");
      return;
    }

    currentTurns = turns;
    totalLinesSpan.textContent = String(turns.length);
    elevenLabsMode = turns.some(
      (t) => t.audio_url && t.audio_url.trim() !== ""
    );

    councilSection.style.display = "block";
    dialogueSection.style.display = "block";

    turns.forEach((turn) => addMessage(turn));

    // Auto-start playback from first line
    playSequence(0);
  } catch (err) {
    console.error(err);
    alert("Something went wrong: " + err.message);
  } finally {
    setLoading(false);
  }
}

// =======================
// Speech recognition
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
    challengeInput.value = transcript;
  };

  recognition.onerror = (event) => {
    console.error("STT error:", event);
    alert("Speech recognition error. Try again or type instead.");
  };
} else {
  micButton.disabled = true;
  micButton.textContent = "🎙️ Mic not supported";
}

micButton.addEventListener("click", () => {
  if (!recognition) return;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  recognition.start();
});

// =======================
// Event listeners
// =======================

startButton.addEventListener("click", startInnerCouncil);
playAllButton.addEventListener("click", () => playSequence(0));