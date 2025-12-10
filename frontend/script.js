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

// Store latest audio URLs from backend
let guideAudioUrl = null;
let challengerAudioUrl = null;

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
  recognition.start();
  micBtn.textContent = "🎙️ Listening...";
  recognition.onend = () => {
    micBtn.textContent = "🎙️ Speak instead of typing";
  };
});

// ---- Helper: play ElevenLabs audio ----

function playAudio(url) {
  if (!url) {
    alert("No audio available yet – run the Ensemble first.");
    return;
  }
  const audio = new Audio(url);
  audio.play();
}

// ---- Call /api/ensemble ----

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

    // Save last texts for summary
    lastUserText = text;
    lastGuideText = guide;
    lastChallengerText = challenger;

    // Set texts on UI
    guideTextEl.textContent = guide;
    challengerTextEl.textContent = challenger;

    // Build full URLs for audio (backend returns paths like "/audio/xxxx.mp3")
    guideAudioUrl = apiBase + data.guide_audio_url;
    challengerAudioUrl = apiBase + data.challenger_audio_url;

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

// ---- Voice playback buttons (now using ElevenLabs audio) ----

guideSpeakBtn.addEventListener("click", () => {
  playAudio(guideAudioUrl);
});

challengerSpeakBtn.addEventListener("click", () => {
  playAudio(challengerAudioUrl);
});