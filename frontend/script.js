// =======================
// CONFIG
// =======================

const apiBase = "http://127.0.0.1:8000";

// =======================
// STATE
// =======================

let conversation = null;
let isActive = false;

// DOM elements (initialized on DOMContentLoaded)
let startBtn, centerSpeaker, speakerLabel, speakerStatus, summaryArea, summaryPlaceholder;
let personaCircles = {};

// Six Hats Persona definitions
// Based on Edward de Bono's Six Thinking Hats
const personas = {
  facts: { name: 'Facts', color: 'facts' },       // White Hat - Data, information
  heart: { name: 'Heart', color: 'heart' },       // Red Hat - Emotions, feelings
  caution: { name: 'Caution', color: 'caution' }, // Black Hat - Risks, problems
  optimist: { name: 'Optimist', color: 'optimist' }, // Yellow Hat - Benefits, value
  creator: { name: 'Creator', color: 'creator' }, // Green Hat - Ideas, alternatives
  guide: { name: 'Guide', color: 'guide' },       // Blue Hat - Process, overview
  user: { name: 'You', color: 'user' }
};

// =======================
// UI FUNCTIONS
// =======================

function setActivePersona(personaKey) {
  // Clear all active states
  Object.values(personaCircles).forEach(circle => circle?.classList.remove('active'));
  centerSpeaker.className = 'center-speaker';

  if (personaKey && personas[personaKey]) {
    const persona = personas[personaKey];

    // Update center speaker
    centerSpeaker.classList.add('active', persona.color);
    speakerLabel.textContent = persona.name;

    // Highlight the corresponding circle
    if (personaCircles[personaKey]) {
      personaCircles[personaKey].classList.add('active');
    }
  }
}

function setStatus(status) {
  speakerStatus.textContent = status;
}

function resetUI() {
  centerSpeaker.className = 'center-speaker';
  speakerLabel.textContent = 'Ready';
  speakerStatus.textContent = 'Tap to begin';
  Object.values(personaCircles).forEach(circle => circle?.classList.remove('active'));
}

// Store pending persona changes
let pendingPersonaChanges = [];
let currentSummaryElement = null;

// Show a summary for the current persona
function showSummary(personaKey, text) {
  // Hide placeholder
  if (summaryPlaceholder) {
    summaryPlaceholder.style.display = 'none';
  }

  // Remove previous summary
  if (currentSummaryElement && currentSummaryElement.parentNode) {
    currentSummaryElement.remove();
  }

  const persona = personas[personaKey] || personas.guide;

  const summary = document.createElement('div');
  summary.className = `summary-text ${persona.color}`;
  summary.textContent = text;

  summaryArea.appendChild(summary);
  currentSummaryElement = summary;
}

// Clear the summary area
function clearSummary() {
  if (currentSummaryElement && currentSummaryElement.parentNode) {
    currentSummaryElement.remove();
  }
  currentSummaryElement = null;
  if (summaryPlaceholder) {
    summaryPlaceholder.style.display = 'block';
  }
}

// Cancel all pending persona changes
function cancelPendingChanges() {
  pendingPersonaChanges.forEach(timeout => clearTimeout(timeout));
  pendingPersonaChanges = [];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =======================
// PERSONA DETECTION & PARSING
// =======================

// Split a message containing multiple persona responses into separate segments
function splitByPersona(text) {
  const personaLabels = ['Facts:', 'Heart:', 'Caution:', 'Optimist:', 'Creator:', 'Guide:'];
  const personaMap = {
    'facts:': 'facts',
    'heart:': 'heart',
    'caution:': 'caution',
    'optimist:': 'optimist',
    'creator:': 'creator',
    'guide:': 'guide'
  };

  // Create regex to split by persona labels
  const regex = new RegExp(`(${personaLabels.join('|')})`, 'gi');
  const parts = text.split(regex).filter(part => part.trim());

  const segments = [];
  let currentPersona = 'guide';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    const lowerPart = part.toLowerCase();

    // Check if this part is a persona label
    if (personaMap[lowerPart]) {
      currentPersona = personaMap[lowerPart];
    } else if (part) {
      // This is content - add it with the current persona
      segments.push({
        persona: currentPersona,
        text: part
      });
    }
  }

  // If no segments were created, return the whole text as guide
  if (segments.length === 0) {
    return [{ persona: 'guide', text: text }];
  }

  return segments;
}

function detectPersonaFromText(text) {
  const lower = text.toLowerCase();

  // Check for explicit persona markers first (e.g., "Facts:", "Heart:", etc.)
  if (lower.includes('facts:') || lower.includes('**facts:**')) return 'facts';
  if (lower.includes('heart:') || lower.includes('**heart:**')) return 'heart';
  if (lower.includes('caution:') || lower.includes('**caution:**')) return 'caution';
  if (lower.includes('optimist:') || lower.includes('**optimist:**')) return 'optimist';
  if (lower.includes('creator:') || lower.includes('**creator:**')) return 'creator';
  if (lower.includes('guide:') || lower.includes('**guide:**')) return 'guide';

  // Detect by content patterns

  // Facts (White Hat) - Data, numbers, information
  if (lower.includes('the data shows') || lower.includes('the numbers') ||
      lower.includes('according to') || lower.includes('the facts are') ||
      lower.includes('we know that') || lower.includes('the information')) {
    return 'facts';
  }

  // Heart (Red Hat) - Emotions, feelings, intuition
  if (lower.startsWith('i feel') || lower.includes('my gut says') ||
      lower.includes('emotionally') || lower.includes('i sense') ||
      lower.includes('my heart') || lower.includes('intuitively')) {
    return 'heart';
  }

  // Caution (Black Hat) - Risks, problems, dangers
  if (lower.includes('the risk') || lower.includes('be careful') ||
      lower.includes('the danger') || lower.includes('could fail') ||
      lower.includes('the problem') || lower.includes('what if it') ||
      lower.includes("i'm worried") || lower.includes('concerned about')) {
    return 'caution';
  }

  // Optimist (Yellow Hat) - Benefits, value, positives
  if (lower.includes('the benefit') || lower.includes('the advantage') ||
      lower.includes('the opportunity') || lower.includes('this could work') ||
      lower.includes('the upside') || lower.includes('positive')) {
    return 'optimist';
  }

  // Creator (Green Hat) - Ideas, alternatives, creativity
  if (lower.includes('what if we') || lower.includes('another idea') ||
      lower.includes('we could try') || lower.includes('alternatively') ||
      lower.includes('imagine if') || lower.includes('how about')) {
    return 'creator';
  }

  // Guide (Blue Hat) - Process, summary, next steps
  if (lower.includes('let\'s summarize') || lower.includes('to wrap up') ||
      lower.includes('the next step') || lower.includes('our process') ||
      lower.includes('let me guide') || lower.includes('in summary')) {
    return 'guide';
  }

  // Default to guide if can't detect
  return null;
}

// =======================
// CONVERSATION HANDLING
// =======================

async function startConversation() {
  console.log("startConversation called, isActive:", isActive);

  if (isActive) {
    await endConversation();
    return;
  }

  try {
    // Request microphone permission
    console.log("Requesting microphone permission...");
    await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log("Microphone permission granted");

    // Update UI
    startBtn.disabled = true;
    startBtn.textContent = 'Connecting...';
    setStatus('Connecting...');

    // Get signed URL from backend
    console.log("Fetching signed URL...");
    const signedUrlResp = await fetch(`${apiBase}/api/signed-url`);
    if (!signedUrlResp.ok) {
      throw new Error("Failed to get signed URL: " + await signedUrlResp.text());
    }
    const signedUrl = await signedUrlResp.text();
    console.log("Got signed URL");

    // Wait for SDK to be available
    let attempts = 0;
    while (!window.ElevenLabsConversation && attempts < 20) {
      console.log("Waiting for SDK...", attempts);
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }

    const Conversation = window.ElevenLabsConversation;
    if (!Conversation) {
      throw new Error("ElevenLabs SDK not loaded. Please refresh the page.");
    }
    console.log("SDK loaded");

    // Clear previous summary
    clearSummary();

    // Start the conversation session
    console.log("Starting session...");
    conversation = await Conversation.startSession({
      signedUrl: signedUrl,

      onConnect: ({ conversationId }) => {
        console.log("🟢 [onConnect] Connected to Inner Council, ID:", conversationId);
        isActive = true;
        startBtn.disabled = false;
        startBtn.textContent = 'End Conversation';
        startBtn.classList.add('active');

        setActivePersona('user');
        setStatus('Listening...');
      },

      onDebug: (props) => {
        // Log ALL debug events to see what's available
        console.log("🔍 [onDebug]", props.type || 'unknown', props);

        // Check if this contains agent_response or voice-related data
        if (props.type === 'agent_response' || props.agent_response) {
          console.log("🎤 [agent_response EVENT]", props);
        }
        if (props.type === 'audio' || props.audio) {
          console.log("🔊 [audio EVENT]", props);
        }
        if (props.type === 'user_transcript' || props.user_transcript) {
          console.log("🗣️ [user_transcript EVENT]", props);
        }
      },

      onDisconnect: () => {
        console.log("🔴 [onDisconnect] Disconnected from Inner Council");
        endConversation();
      },

      onMessage: (props) => {
        // SDK sends { message: string, source: "user" | "ai" }
        console.log("💬 [onMessage]", JSON.stringify(props, null, 2));

        const { message, source } = props;

        if (!message || message.trim() === '') {
          return;
        }

        if (source === 'ai') {
          // Cancel any pending changes from previous messages
          cancelPendingChanges();

          // AI response - split by persona labels and show each separately
          const segments = splitByPersona(message);
          console.log("🎭 [Parsed segments]:", segments);

          // Set the FIRST persona immediately when message arrives (= audio starts)
          if (segments.length > 0) {
            console.log(`🎭 [Persona] Setting FIRST persona immediately: ${segments[0].persona}`);
            setActivePersona(segments[0].persona);
            // Show summary for first persona
            showSummary(segments[0].persona, segments[0].text);
          }

          // Schedule persona changes with BIGGER breaks between them
          if (segments.length > 1) {
            // Speaking rate estimate: ~60ms per character
            const msPerCharSpoken = 60;
            // Bigger pause between personas (800ms)
            const pauseBetweenPersonas = 800;
            let cumulativeDelay = 0;

            segments.forEach((segment, index) => {
              if (index === 0) {
                // First segment already shown - calculate when it finishes
                cumulativeDelay += segment.text.length * msPerCharSpoken + pauseBetweenPersonas;
                return;
              }

              const switchDelay = cumulativeDelay;
              console.log(`🎭 [Persona] Scheduling ${segment.persona} at ${switchDelay}ms`);

              const timeout = setTimeout(() => {
                console.log(`🎭 [Persona] NOW switching to: ${segment.persona}`);
                setActivePersona(segment.persona);
                showSummary(segment.persona, segment.text);
              }, switchDelay);

              pendingPersonaChanges.push(timeout);
              cumulativeDelay += segment.text.length * msPerCharSpoken + pauseBetweenPersonas;
            });
          }
        } else if (source === 'user') {
          // User's transcribed speech - show as summary
          showSummary('user', message);
          setActivePersona('user');
        }
      },

      onModeChange: (mode) => {
        console.log("🔄 [onModeChange]", JSON.stringify(mode, null, 2));

        if (mode.mode === 'speaking') {
          setStatus('Speaking...');
          // The actual persona will be set when we receive the message
        } else if (mode.mode === 'listening') {
          // Clear any pending persona changes since agent is done speaking
          cancelPendingChanges();
          setActivePersona('user');
          setStatus('Listening...');
          // Clear the summary to show fresh state for user input
          clearSummary();
        }
      },

      onStatusChange: (status) => {
        console.log("📶 [onStatusChange]", JSON.stringify(status, null, 2));
      },

      onCanSendFeedbackChange: (canSend) => {
        console.log("👍 [onCanSendFeedbackChange]", canSend);
      },

      // STREAMING TEXT - This gives us text chunks as they're generated!
      onAgentChatResponsePart: (props) => {
        console.log("📝 [onAgentChatResponsePart] STREAMING TEXT:", props);
        // This might give us real-time text we can use to detect persona changes
        if (props && props.text) {
          const detectedPersona = detectPersonaFromText(props.text);
          if (detectedPersona) {
            console.log(`🎭 [STREAM] Detected persona from streaming text: ${detectedPersona}`);
            setActivePersona(detectedPersona);
          }
        }
      },

      // Audio callback - called with each audio chunk
      onAudio: (base64Audio) => {
        console.log("🔊 [onAudio] Audio chunk received, length:", base64Audio?.length);
      },

      // Interruption callback
      onInterruption: (props) => {
        console.log("⚡ [onInterruption]", props);
      },

      onError: (error) => {
        console.error("❌ [onError]", error);
        alert("Voice conversation error: " + (error.message || error));
        endConversation();
      }
    });

    // Log all available methods/properties on the conversation object
    console.log("📋 [Conversation object keys]:", Object.keys(conversation));
    console.log("📋 [Conversation object]:", conversation);

  } catch (err) {
    console.error("Failed to start conversation:", err);
    alert("Failed to start conversation: " + err.message);
    startBtn.disabled = false;
    startBtn.textContent = 'Start Conversation';
    resetUI();
  }
}

async function endConversation() {
  // Cancel any pending changes
  cancelPendingChanges();

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
  startBtn.textContent = 'Start Conversation';
  startBtn.classList.remove('active');
  resetUI();
}

// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing...");

  // Initialize DOM elements
  startBtn = document.getElementById("startBtn");
  centerSpeaker = document.getElementById("centerSpeaker");
  speakerLabel = document.getElementById("speakerLabel");
  speakerStatus = document.getElementById("speakerStatus");
  summaryArea = document.getElementById("summaryArea");
  summaryPlaceholder = document.getElementById("summaryPlaceholder");

  personaCircles = {
    facts: document.querySelector('.persona-circle.facts'),
    heart: document.querySelector('.persona-circle.heart'),
    caution: document.querySelector('.persona-circle.caution'),
    optimist: document.querySelector('.persona-circle.optimist'),
    creator: document.querySelector('.persona-circle.creator'),
    guide: document.querySelector('.persona-circle.guide')
  };

  console.log("startBtn:", startBtn);

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      console.log("Button clicked!");
      startConversation();
    });
    console.log("Click listener added");
  } else {
    console.error("startBtn not found!");
  }
});
