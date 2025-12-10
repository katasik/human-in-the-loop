const apiBase = "http://127.0.0.1:8000";

const inputEl = document.getElementById("input");
const runBtn = document.getElementById("runBtn");
const summaryBtn = document.getElementById("summaryBtn");
const micBtn = document.getElementById("micBtn");

const agentsBox = document.getElementById("agents");
const guideTextEl = document.getElementById("guideText");
const challengerTextEl = document.getElementById("challengerText");

const guideSpeakBtn = document.getElementById("guideSpeakBtn");
const challengerSpeakBtn = document.getElementById("challengerSpeakBtn");

const resetCard = document.getElementById("resetCard");
const resetTextEl = document.getElementById("resetText");

// Keep last results for summary
let lastUserText = "";
let lastGuideText = "";
let lastChallengerText = "";

// ---- Speech synthesis (for Guide & Challenger) ----

let voices = [];
let guideVoice = null;
let challengerVoice = null;

function loadVoices() {
  voices = window.speechSynthesis.getVoices();

  if (voices.length > 0) {
    guideVoice = voices[0];
    challengerVoice = voices[Math.min(1, voices.length - 1)];
  }
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function speak(text, voice) {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis not supported in this browser.");
    return;
  }
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// ---- Speech recognition (mic → text) ----

let recognition = null;

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    inputEl.value = transcript; // fill the textarea
  };

  recognition.onerror = (event) => {
    console.error("STT error:", event);
    alert("Speech recognition error. Try again or type instead.");
  };
} else {
  micBtn.disabled = true;
  micBtn.textContent = "🎙️ Not supported in this browser";
}

micBtn.addEventListener("click", () => {
  if (!recognition) return;
  window.speechSynthesis.cancel(); // stop any speaking
  recognition.start();
  micBtn.textContent = "🎙️ Listening...";
  recognition.onend = () => {
    micBtn.textContent = "🎙️ Speak instead of typing";
  };
});

// ---- Call /api/ensemble (single-turn v1) ----

runBtn.addEventListener("click", async () => {
  const text = inputEl.value.trim();
  if (!text) {
    alert("Please write (or say) something about your situation first.");
    return;
  }

  runBtn.disabled = true;
  summaryBtn.disabled = true;
  resetCard.style.display = "none";
  runBtn.textContent = "Thinking...";

  try {
    const resp = await fetch(`${apiBase}/api/ensemble`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!resp.ok) {
      throw new Error("Backend error: " + resp.status);
    }

    const data = await resp.json();
    const guide = data.guide_text;
    const challenger = data.challenger_text;

    lastUserText = text;
    lastGuideText = guide;
    lastChallengerText = challenger;

    guideTextEl.textContent = guide;
    challengerTextEl.textContent = challenger;

    agentsBox.style.display = "grid";
    summaryBtn.disabled = false;
  } catch (err) {
    console.error(err);
    alert("Something went wrong: " + err.message);
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = "Talk to the Ensemble";
  }
});

// ---- Generate Reset Card via /api/summary ----

summaryBtn.addEventListener("click", async () => {
  if (!lastUserText || !lastGuideText || !lastChallengerText) {
    alert("Run the Ensemble at least once first.");
    return;
  }

  summaryBtn.disabled = true;
  summaryBtn.textContent = "Summarizing...";

  const transcript = [
    `User: ${lastUserText}`,
    "",
    `Guide: ${lastGuideText}`,
    "",
    `Challenger: ${lastChallengerText}`,
  ].join("\n");

  try {
    const resp = await fetch(`${apiBase}/api/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });

    if (!resp.ok) {
      throw new Error("Backend error: " + resp.status);
    }

    const data = await resp.json();
    resetTextEl.textContent = data.summary_text;
    resetCard.style.display = "block";
  } catch (err) {
    console.error(err);
    alert("Something went wrong: " + err.message);
  } finally {
    summaryBtn.disabled = false;
    summaryBtn.textContent = "Generate Reset Card";
  }
});

// ---- Voice playback buttons ----

guideSpeakBtn.addEventListener("click", () => {
  speak(guideTextEl.textContent, guideVoice);
});

challengerSpeakBtn.addEventListener("click", () => {
  speak(challengerTextEl.textContent, challengerVoice);
});