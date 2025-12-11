// =======================
// CONFIG
// =======================

const apiBase = "http://127.0.0.1:8000";

// =======================
// STATE
// =======================

let conversation = null;
let isActive = false;

// =======================
// DOM ELEMENTS
// =======================

const startBtn = document.getElementById("startBtn");
const centerSpotlight = document.getElementById("centerSpotlight");
const centerIcon = document.getElementById("centerIcon");
const centerLabel = document.getElementById("centerLabel");
const centerStatus = document.getElementById("centerStatus");
const captionsArea = document.getElementById("captionsArea");
const captionPlaceholder = document.getElementById("captionPlaceholder");

const personaOrbs = {
  intuition: document.querySelector('.persona-orb.intuition'),
  reason: document.querySelector('.persona-orb.reason'),
  fear: document.querySelector('.persona-orb.fear')
};

// Persona definitions
const personas = {
  intuition: { icon: '💙', name: 'Intuition', color: 'intuition' },
  reason: { icon: '🧠', name: 'Reason', color: 'reason' },
  fear: { icon: '🛡️', name: 'Fear', color: 'fear' },
  user: { icon: '🎤', name: 'You', color: 'user' }
};

// =======================
// UI FUNCTIONS
// =======================

function setActivePersona(personaKey) {
  // Clear all active states
  Object.values(personaOrbs).forEach(orb => orb?.classList.remove('active'));
  centerSpotlight.className = 'center-spotlight';

  if (personaKey && personas[personaKey]) {
    const persona = personas[personaKey];

    // Update center spotlight
    centerSpotlight.classList.add('active', persona.color);
    centerIcon.textContent = persona.icon;
    centerLabel.textContent = persona.name;

    // Highlight the corresponding orb
    if (personaOrbs[personaKey]) {
      personaOrbs[personaKey].classList.add('active');
    }
  }
}

function setStatus(status) {
  centerStatus.textContent = status;
}

function resetUI() {
  centerSpotlight.className = 'center-spotlight';
  centerIcon.textContent = '🎭';
  centerLabel.textContent = 'Ready';
  centerStatus.textContent = 'Click below to begin';
  Object.values(personaOrbs).forEach(orb => orb?.classList.remove('active'));
}

function addCaption(personaKey, text) {
  // Remove placeholder if present
  if (captionPlaceholder) {
    captionPlaceholder.style.display = 'none';
  }

  const persona = personas[personaKey] || personas.user;

  const entry = document.createElement('div');
  entry.className = `caption-entry ${persona.color}`;
  entry.innerHTML = `
    <div class="caption-speaker">${persona.icon} ${persona.name}</div>
    <div class="caption-text">${escapeHtml(text)}</div>
  `;

  captionsArea.appendChild(entry);
  captionsArea.scrollTop = captionsArea.scrollHeight;
}

function clearCaptions() {
  captionsArea.innerHTML = '';
  if (captionPlaceholder) {
    captionsArea.appendChild(captionPlaceholder);
    captionPlaceholder.style.display = 'block';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =======================
// PERSONA DETECTION
// =======================

function detectPersonaFromText(text) {
  const lower = text.toLowerCase();

  // Check for explicit persona markers
  if (lower.includes('**intuition:**') || lower.includes('intuition:') ||
      lower.startsWith('i feel') || lower.startsWith('i sense')) {
    return 'intuition';
  }
  if (lower.includes('**reason:**') || lower.includes('reason:') ||
      lower.startsWith('i think') || lower.startsWith('i notice')) {
    return 'reason';
  }
  if (lower.includes('**fear:**') || lower.includes('fear:') ||
      lower.includes("i'm scared") || lower.includes("i'm worried") ||
      lower.includes("i'm tightening")) {
    return 'fear';
  }

  // Default to null (will show as council/agent)
  return null;
}

// =======================
// CONVERSATION HANDLING
// =======================

async function startConversation() {
  if (isActive) {
    await endConversation();
    return;
  }

  try {
    // Request microphone permission
    await navigator.mediaDevices.getUserMedia({ audio: true });

    // Update UI
    startBtn.disabled = true;
    startBtn.textContent = '⏳ Connecting...';
    setStatus('Connecting to the Council...');

    // Get signed URL from backend
    const signedUrlResp = await fetch(`${apiBase}/api/signed-url`);
    if (!signedUrlResp.ok) {
      throw new Error("Failed to get signed URL: " + await signedUrlResp.text());
    }
    const signedUrl = await signedUrlResp.text();

    // Wait for SDK to be available
    let attempts = 0;
    while (!window.ElevenLabsConversation && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }

    const Conversation = window.ElevenLabsConversation;
    if (!Conversation) {
      throw new Error("ElevenLabs SDK not loaded. Please refresh the page.");
    }

    // Clear previous captions
    clearCaptions();

    // Start the conversation session
    conversation = await Conversation.startSession({
      signedUrl: signedUrl,

      onConnect: () => {
        console.log("🎤 Connected to Inner Council");
        isActive = true;
        startBtn.disabled = false;
        startBtn.textContent = '🛑 End Conversation';
        startBtn.classList.add('active');

        setActivePersona('user');
        setStatus('Listening to you...');
      },

      onDisconnect: () => {
        console.log("📴 Disconnected from Inner Council");
        endConversation();
      },

      onMessage: (message) => {
        console.log("💬 Message:", message);

        if (message.source === 'ai' || message.source === 'agent') {
          // Detect which persona is speaking from the text
          const text = message.message || '';
          const persona = detectPersonaFromText(text);

          // Add caption
          addCaption(persona || 'reason', text); // Default to reason if can't detect

          // Update active persona based on text
          if (persona) {
            setActivePersona(persona);
          }
        } else if (message.source === 'user') {
          addCaption('user', message.message || '');
        }
      },

      onModeChange: (mode) => {
        console.log("🔄 Mode:", mode);

        if (mode.mode === 'speaking') {
          setStatus('Council is speaking...');
          // The actual persona will be set when we receive the message
        } else if (mode.mode === 'listening') {
          setActivePersona('user');
          setStatus('Listening to you...');
        }
      },

      onError: (error) => {
        console.error("❌ Error:", error);
        alert("Voice conversation error: " + (error.message || error));
        endConversation();
      }
    });

  } catch (err) {
    console.error("Failed to start conversation:", err);
    alert("Failed to start conversation: " + err.message);
    startBtn.disabled = false;
    startBtn.textContent = '🎤 Start Conversation';
    resetUI();
  }
}

async function endConversation() {
  if (conversation) {
    try {
      await conversation.endSession();
    } catch (e) {
      console.log("Session end error (may be already ended):", e);
    }
    conversation = null;
  }

  isActive = false;
  startBtn.disabled = false;
  startBtn.textContent = '🎤 Start Conversation';
  startBtn.classList.remove('active');
  resetUI();
}

// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", () => {
  if (startBtn) {
    startBtn.addEventListener("click", startConversation);
  }
});
