// ---- Config ----
// Dynamic list populated by scanning the videos/ directory index
let videoList = [];
let videoListLoaded = false;

const BUBBLE_LIFETIME_MS = 15000; // auto-despawn if ignored
const BUBBLE_POP_DELAY_MS = 3500; // lifespan after expand
const RESPAWN_DELAY_MS = 7000;    // spawn a new one after pop
const ROTATE_VIDEO_EVERY_MS = 45000; // background video change cadence

// Sound
let soundEnabled = false;
let audioCtx = null; // legacy: WebAudio (unused for receive now)
const RECEIVE_VOL = 0.12; // legacy envelope amount
let receiveAudio = null; // HTMLAudioElement for notification
let receiveAudioDurationSec = 0.35; // updated after metadata load
let lastBubbleSpawnAt = 0; // ms since epoch
let secretPaused = false; // Ctrl+O pause toggle
let disclaimerOpen = false;


let bubblesPaused = false; // pause spawns and hide others during an expanded message

// ---- Glitch trigger ----
function triggerGlitch() {
  const g = document.getElementById('glitch-layer');
  if (!g) return;
  g.style.animation = 'glitch 520ms';
  g.onanimationend = () => (g.style.animation = '');
}

// ---- Video rotation ----
function setRandomVideo(notThis) {
  const current = notThis;
  if (!videoListLoaded || !videoList.length) return; // wait until loaded
  const candidates = videoList.filter(v => v !== current);
  const next = candidates[Math.floor(Math.random() * candidates.length)] || videoList[0];
  const vid = document.getElementById('bg-video');
  const src = document.getElementById('bg-source');
  if (!vid || !src) return;
  src.src = next;
  // Force reload of source
  vid.load();
  // Keep current mute state; after first gesture we can play with sound
  vid.play().catch(() => {/* autoplay might be blocked until interaction */});
  if (secretPaused) {
    // Respect paused state even after source change
    try { vid.pause(); } catch (_) {}
  }
  triggerGlitch();
  bannerRandomizeColor();
  equalizeTitleWidth();
}

function startVideoRotation() {
  const src = document.getElementById('bg-source');
  if (!src) return;
  setInterval(() => setRandomVideo(src.getAttribute('src')), ROTATE_VIDEO_EVERY_MS);
}

// ---- Bubbles ----
function spawnBubble() {
  if (bubblesPaused) return null;
  const now = Date.now();
  const minInterval = getMinSpawnIntervalMs();
  const since = now - lastBubbleSpawnAt;
  if (since < minInterval) {
    // Try again when allowed
    setTimeout(spawnBubble, Math.max(50, minInterval - since));
    return null;
  }
  const layer = document.getElementById('bubble-layer');
  if (!layer) return;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.style.left = `${Math.random() * 80 + 10}%`;
  bubble.style.top = `${Math.random() * 70 + 15}%`;
  bubble.style.opacity = (Math.random() * 0.25 + 0.75).toFixed(2);
  bubble.style.transform = `scale(${(Math.random() * 0.5 + 1.0).toFixed(2)})`;

  layer.appendChild(bubble);
  lastBubbleSpawnAt = Date.now();

  // Play 'message received' sound on bubble appearance
  setTimeout(() => playReceiveAudio(), Math.random() * 60);

  const cleanup = () => {
    if (bubble && bubble.parentNode) {
      bubble.remove();
    }
  };

  const autoRemove = setTimeout(cleanup, BUBBLE_LIFETIME_MS);

  bubble.addEventListener('click', () => {
    enableSound();
    bubblesPaused = true;
    // Hide other bubbles while message is visible
    document.querySelectorAll('.bubble').forEach(el => {
      if (el !== bubble) el.classList.add('hidden');
    });
    clearTimeout(autoRemove);
    bubble.classList.add('expanded');
    const msg = (window.messages && window.messages.length)
      ? window.messages[Math.floor(Math.random() * window.messages.length)]
      : '...';
    bubble.textContent = msg;
    triggerGlitch();
    setTimeout(() => {
      cleanup();
      // Unhide remaining bubbles and resume spawning
      document.querySelectorAll('.bubble.hidden').forEach(el => el.classList.remove('hidden'));
      bubblesPaused = false;
      const elapsedSinceSpawn = Date.now() - lastBubbleSpawnAt;
      const minWait = getMinSpawnIntervalMs();
      const delay = Math.max(RESPAWN_DELAY_MS, minWait - elapsedSinceSpawn, 0);
      setTimeout(() => { if (!bubblesPaused) spawnBubble(); }, delay);
    }, BUBBLE_POP_DELAY_MS);
  }, { once: true });

  return bubble;
}

function spawnRandomBubbles() {
  // Enforce global min interval: only one initial spawn
  spawnBubble();
}

// Ensure bubbles continue to appear over time
function sustainBubbles() {
  setInterval(() => {
    if (bubblesPaused) return;
    const existing = document.querySelectorAll('.bubble:not(.expanded)').length;
    if (existing < 3 && canSpawnNow()) spawnBubble();
  }, 6000);
}

// ---- Messages readiness ----
function whenMessagesReady() {
  if (window.messagesReady && typeof window.messagesReady.then === 'function') {
    return window.messagesReady;
  }
  // Fallback: resolve immediately with empty list
  return Promise.resolve();
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', () => {
  // Attempt to start playback; some browsers require a user gesture
  const vid = document.getElementById('bg-video');
  vid.play().catch(() => {
    // On first user gesture, unmute and try again
    const resume = () => {
      enableSound();
      ensureAudioContext();
      tryUnlockReceiveAudio();
      vid.play().finally(() => document.removeEventListener('pointerdown', resume));
    };
    document.addEventListener('pointerdown', resume);
  });

  // Begin loading list of videos from the directory index
  loadVideoListFromDir().catch(() => {/* ignore, will fallback to initial src only */});

  // Initial banner color
  bannerRandomizeColor();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => equalizeTitleWidth());
  }
  setTimeout(equalizeTitleWidth, 50);

  // Change video on silhouette (video) click
  vid.addEventListener('click', () => {
    enableSound();
    ensureAudioContext();
    tryUnlockReceiveAudio();
    const src = document.getElementById('bg-source');
    if (src) setRandomVideo(src.getAttribute('src'));
  });

  // Disable auto-rotation: only change video on explicit click
  // startVideoRotation();

  whenMessagesReady().then(() => {
    spawnRandomBubbles();
    sustainBubbles();
  });

  // Secret pause toggle: Ctrl+O
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault(); // prevent browser 'Open' dialog
      const v = document.getElementById('bg-video');
      if (!v) return;
      if (!secretPaused) {
        try { v.pause(); } catch (_) {}
        secretPaused = true;
      } else {
        enableSound();
        ensureAudioContext();
        try { v.currentTime = 0; } catch (_) {}
        v.play().catch(() => {});
        secretPaused = false;
      }
    }
  });

  // Disclaimer trigger
  const dl = document.getElementById('disclaimer-link');
  if (dl) {
    dl.addEventListener('click', () => {
      openDisclaimer();
    });
  }
  
  // Re-equalize on resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(equalizeTitleWidth, 120);
  });
});

// ---- Sound control ----
function enableSound() {
  if (soundEnabled) return;
  const vid = document.getElementById('bg-video');
  if (!vid) return;
  try {
    vid.muted = false;
    vid.removeAttribute('muted');
    vid.volume = 1.0;
    soundEnabled = true;
    vid.play().catch(() => {});
  } catch (_) { /* ignore */ }
}

// ---- WebAudio support for receive blip ----
function ensureAudioContext() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return true;
  } catch (_) {
    return false;
  }
}

// ---- HTMLAudio-based notification ----
function initReceiveAudio() {
  if (receiveAudio) return receiveAudio;
  try {
    receiveAudio = new Audio('sounds/new-notification.mp3');
    receiveAudio.preload = 'auto';
    receiveAudio.volume = 0.6; // adjust to taste
    receiveAudio.addEventListener('loadedmetadata', () => {
      if (!isNaN(receiveAudio.duration) && receiveAudio.duration > 0) {
        receiveAudioDurationSec = receiveAudio.duration;
      }
    });
  } catch (_) { /* ignore */ }
  return receiveAudio;
}

function tryUnlockReceiveAudio() {
  const a = initReceiveAudio();
  if (!a) return;
  // Attempt a quick play/pause to satisfy gesture requirement
  a.muted = false;
  a.play().then(() => {
    a.pause();
    a.currentTime = 0;
  }).catch(() => {/* likely blocked until gesture; later tries will succeed */});
}

function playReceiveAudio() {
  const a = initReceiveAudio();
  if (!a) return;
  // If another is playing, restart (we enforce min interval so unlikely)
  try {
    a.currentTime = 0;
    a.play().catch(() => {});
  } catch (_) { /* ignore */ }
}

function getMinSpawnIntervalMs() {
  const sec = (receiveAudioDurationSec || 0.35) + 1.0; // audio duration + 1s offset
  return Math.ceil(sec * 1000);
}

function canSpawnNow() {
  return !bubblesPaused && (Date.now() - lastBubbleSpawnAt >= getMinSpawnIntervalMs());
}

// ---- Discover videos by scraping the directory index ----
function loadVideoListFromDir() {
  return fetch('videos/', { cache: 'no-store' })
    .then(r => r.ok ? r.text() : Promise.reject(new Error('dir index failed')))
    .then(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const anchors = Array.from(doc.querySelectorAll('a[href]'));
      const files = anchors
        .map(a => (a.getAttribute('href') || '').trim())
        .filter(href => href && !href.includes('..'))
        .filter(href => /\.(mp4|webm|ogv)(?:\?.*)?$/i.test(href))
        .map(href => {
          // Normalize to 'videos/filename.ext'
          if (href.startsWith('http')) return href; // absolute
          if (href.startsWith('/')) return `videos${href}`.replace(/\\/g,'/');
          if (href.startsWith('videos/')) return href;
          return `videos/${href}`;
        });
      // Deduplicate
      const seen = new Set();
      videoList = files.filter(f => {
        const key = f.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      videoListLoaded = true;
      return videoList;
    })
    .catch(err => {
      console.warn('Video list discovery failed; using initial source only.', err);
      videoListLoaded = false;
    });
}

// ---- CLICK! banner color control ----
function bannerRandomizeColor() {
  const el = document.getElementById('click-banner');
  if (!el) return;
  const palette = [
    '#00F0FF', '#FF0055', '#B5FF00', '#FFD400', '#A75DFF', '#FF7A00', '#00FFA6', '#FF4D4D'
  ];
  const color = palette[Math.floor(Math.random() * palette.length)];
  el.style.color = color;
  // retrigger pulse animation
  el.classList.remove('pulse');
  // force reflow
  void el.offsetWidth;
  el.classList.add('pulse');
}

// ---- Make title width match CLICK! width ----
function equalizeTitleWidth() {
  const title = document.getElementById('title-banner');
  const click = document.getElementById('click-banner');
  if (!title || !click) return;
  const clickW = click.getBoundingClientRect().width;
  const titleW = title.getBoundingClientRect().width;
  if (!clickW || !titleW) return;
  const currentSize = parseFloat(getComputedStyle(title).fontSize);
  if (!currentSize) return;
  const scale = clickW / titleW;
  const newSize = Math.max(12, Math.min(200, currentSize * scale));
  title.style.fontSize = newSize + 'px';
}

// ---- Disclaimer modal-like bubble ----
function openDisclaimer() {
  if (disclaimerOpen) return;
  disclaimerOpen = true;
  bubblesPaused = true;
  // Hide other bubbles
  document.querySelectorAll('.bubble').forEach(el => el.classList.add('hidden'));

  const layer = document.getElementById('bubble-layer');
  if (!layer) return;
  const bubble = document.createElement('div');
  bubble.id = 'disclaimer-bubble';
  bubble.className = 'bubble expanded disclaimer';
  bubble.innerHTML = `
    <div class="disclaimer-content">
      <h2>Disclaimer</h2>
      <p>Loop_Room is an artistic, experimental installation of looping video, sound, and interactive symbols. It is presented “as is” without warranties of any kind.</p>
      <p>Audio/visual content is provided by the artist <a href="https://sergiob79.github.io/Noctarion_page/#" target="_blank" rel="noopener noreferrer">Noctarian</a>. Glitch/flash effects may affect photosensitive viewers. Use discretion and adjust your volume appropriately.</p>
      <p>Privacy: this page may record an aggregate click count (a single number shared by all visitors) using Firebase Realtime Database. No personal data is collected, stored, or tracked by this project.</p>
      <p>Typography: Ressa3D by <a href="https://www.1001fonts.com/users/vladimirnikolic/" target="_blank" rel="noopener noreferrer">Vladimir Nikolic</a>, used under the 1001Fonts Free For Commercial Use (FFC) license. See fonts/1001fonts-ressa-eula.txt for terms.</p>
      <div class="disclaimer-actions">
        <span class="disclaimer-close" role="button" tabindex="0">close</span>
      </div>
    </div>
  `;
  layer.appendChild(bubble);

  const closeEl = bubble.querySelector('.disclaimer-close');
  const finishClose = () => {
    bubble.remove();
    disclaimerOpen = false;
    // Unhide other bubbles and resume
    document.querySelectorAll('.bubble.hidden').forEach(el => el.classList.remove('hidden'));
    bubblesPaused = false;
    const dl = document.getElementById('disclaimer-link');
    if (dl) dl.setAttribute('aria-expanded', 'false');
  };
  closeEl.addEventListener('click', finishClose);
  closeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      finishClose();
    }
  });

  const dl = document.getElementById('disclaimer-link');
  if (dl) dl.setAttribute('aria-expanded', 'true');
}
