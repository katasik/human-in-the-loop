const apiBase = "http://127.0.0.1:8000";

const inputEl = document.getElementById("input");
const podcastBtn = document.getElementById("podcastBtn");
const micBtn = document.getElementById("micBtn");

const podcastContainer = document.getElementById("podcastContainer");
const turnsEl = document.getElementById("turns");
const playAllBtn = document.getElementById("playAllBtn");

// Will store the last podcast response so we can play it all
let currentPodcastTurns = [];

// =======================
//  BROWSER VOICES SETUP
// =======================

let voices = [];
let guideVoice = null;
let challengerVoice = null;

function pickVoices() {
  voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return;

  // Prefer English voices so they sound natural for your content
  const enVoices = voices.filter(v =>
    v.lang && v.lang.toLowerCase().startsWith("en")
  );

  if (enVoices.length >= 2) {
    guideVoice = enVoices[0];
    challengerVoice = enVoices[1];
  } else {
    // Fallback: first two available
    guideVoice = voices[0];
    challengerVoice = voices[Math.min(1, voices.length - 1)];
  }

  console.log("Guide voice:", guideVoice?.name, guideVoice?.lang);
  console.log("Challenger voice:", challengerVoice?.name, challengerVoice?.lang);
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = pickVoices;
  pickVoices();
}

// Helper: speak a single line with browser TTS
function speakWithBrowserTTS(text, speaker) {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis not supported in this browser.");
    return;
  }
  if (!text) return;

  const utterance = new SpeechSynthesisUtterance(text);
  const voice =
    speaker === "Guide"
      ? guideVoice || challengerVoice
      : challengerVoice || guideVoice;

  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// =======================
//  PLAYING INDIVIDUAL TURNS
// =======================

// If ElevenLabs is enabled, we expect turn.audio_url to be a non-empty string.
// If it's empty or missing, we fall back to browser TTS.
function playTurnAudio(turn) {
  if (turn.audio_url && turn.audio_url.trim() !== "") {
    const audio = new Audio(`${apiBase}${turn.audio_url}`);
    audio.play().catch(err => {
      console.error("Error playing ElevenLabs audio:", err);
      // fallback to browser TTS if audio fails
      speakWithBrowserTTS(turn.text, turn.speaker);
    });
  } else {
    // No ElevenLabs audio → use browser voices
    speakWithBrowserTTS(turn.text, turn.speaker);
  }
}

// =======================
//  PLAY FULL CONVERSATION
// =======================

function playFullConversation() {
  if (!currentPodcastTurns.length) {
    alert("Generate a conversation first.");
    return;
  }

  const hasAudioUrls = currentPodcastTurns.some(
    t => t.audio_url && t.audio_url.trim() !== ""
  );

  // --- Case A: ElevenLabs TTS mode (ENABLE_TTS = true) ---
  if (hasAudioUrls) {
    let idx = 0;

    const playNext = () => {
      if (idx >= currentPodcastTurns.length) return;

      const turn = currentPodcastTurns[idx];
      if (turn.audio_url && turn.audio_url.trim() !== "") {
        const audio = new Audio(`${apiBase}${turn.audio_url}`);
        audio.onended = () => {
          idx += 1;
          playNext();
        };
        audio.play().catch(err => {
          console.error("Error playing ElevenLabs audio:", err);
          idx += 1;
          playNext();
        });
      } else {
        // If some turn has no audio_url, fall back to browser TTS for that turn
        speakWithBrowserTTS(turn.text, turn.speaker);
        idx += 1;
        // small delay before next to avoid overlap
        setTimeout(playNext, 500);
      }
    };

    playNext();
    return;
  }

  // --- Case B: Debug / browser-only TTS mode (ENABLE_TTS = false) ---
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis not supported in this browser.");
    return;
  }

  window.speechSynthesis.cancel();

  const utterances = currentPodcastTurns.map(turn => {
    const u = new SpeechSynthesisUtterance(turn.text);
    const voice =
      turn.speaker === "Guide"
        ? guideVoice || challengerVoice
        : challengerVoice || guideVoice;
    if (voice) u.voice = voice;
    return u;
  });

  for (let i = 0; i < utterances.length - 1; i++) {
    utterances[i].onend = () => {
      window.speechSynthesis.speak(utterances[i + 1]);
    };
  }

  if (utterances.length > 0) {
    window.speechSynthesis.speak(utterances[0]);
  }
}

// =======================
//  SPEECH RECOGNITION
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

// =======================
//  CALL /api/podcast
// =======================

podcastBtn.addEventListener("click", async () => {
  const text = inputEl.value.trim();
  if (!text) {
    alert("Please write (or say) something about your situation first.");
    return;
  }

  podcastBtn.disabled = true;
  podcastBtn.textContent = "Letting them talk...";
  podcastContainer.style.display = "none";
  turnsEl.innerHTML = "";
  currentPodcastTurns = [];
  window.speechSynthesis.cancel();
  playAllBtn.disabled = true;

  try {
    const resp = await fetch(`${apiBase}/api/podcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, turns: 6 }), // your ~12 lines
    });

    if (!resp.ok) {
      throw new Error("Backend error: " + resp.status);
    }

    const data = await resp.json();
    const podcastTurns = data.turns || [];

    if (!podcastTurns.length) {
      alert("No podcast turns returned from backend.");
      return;
    }

    currentPodcastTurns = podcastTurns;
    podcastContainer.style.display = "block";
    turnsEl.innerHTML = "";
    playAllBtn.disabled = false;

    podcastTurns.forEach((turn) => {
      const wrapper = document.createElement("div");
      wrapper.className = "turn";

      const header = document.createElement("div");
      header.className = "turn-header";

      const pill = document.createElement("span");
      pill.className = "pill";
      if (turn.speaker === "Challenger") {
        pill.classList.add("challenger");
      }
      pill.textContent = turn.speaker;

      const listenBtn = document.createElement("button");
      listenBtn.className = "secondary-btn small-btn";
      listenBtn.textContent = "🔊 Listen";

      header.appendChild(pill);
      header.appendChild(listenBtn);

      const textP = document.createElement("p");
      textP.textContent = turn.text;

      wrapper.appendChild(header);
      wrapper.appendChild(textP);
      turnsEl.appendChild(wrapper);

      // Per-turn audio behavior:
      // - ElevenLabs mode: play mp3
      // - Debug / browser mode: use system TTS with persona-specific voice
      listenBtn.addEventListener("click", () => {
        playTurnAudio(turn);
      });
    });
  } catch (err) {
    console.error(err);
    alert("Something went wrong: " + err.message);
  } finally {
    podcastBtn.disabled = false;
    podcastBtn.textContent = "Let them talk it out";
  }
});

// Full conversation button
playAllBtn.addEventListener("click", () => {
  playFullConversation();
});