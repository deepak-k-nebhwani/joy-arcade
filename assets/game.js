// Flappy Fish Game Logic
// ====== Utility: DPR-friendly canvas sizing ======
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function fitCanvas() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssW = canvas.clientWidth | 0;
  const cssH = canvas.clientHeight | 0;
  if (!cssW || !cssH) return;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw using CSS pixels
}
new ResizeObserver(fitCanvas).observe(canvas);
window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 120));

// ====== Simple Audio (WebAudio, no external libs) ======
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null; // created lazily on first user gesture
let soundEnabled = true;
const soundBtn = document.getElementById('soundBtn');

function initAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
}
function playBeep({freq=600, time=0.07, type='sine', gain=0.08}={}) {
  if (!soundEnabled) return;
  try {
    initAudio();
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + time);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + time);
  } catch {}
}
function playSwim(){ playBeep({freq: 520, time: .06, type:'triangle', gain:.06}); }
function playScore(){ playBeep({freq: 800, time: .09, type:'square', gain:.06}); }
function playHit(){ playBeep({freq: 120, time: .16, type:'sawtooth', gain:.08}); }

soundBtn.addEventListener('click', () => {
  soundEnabled = !soundEnabled; soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(!soundEnabled));
  if (soundEnabled) initAudio();
});

// ====== Game State ======
const startOverlay = document.getElementById('startOverlay');
const howOverlay = document.getElementById('howOverlay');
const closeHow = document.getElementById('closeHow');
const playBtn = document.getElementById('playBtn');
const howBtn = document.getElementById('howBtn');
const pauseBtn = document.getElementById('pauseBtn');
const scorePill = document.getElementById('scorePill');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const retryBtn = document.getElementById('retryBtn');
const shareBtn = document.getElementById('shareBtn');
const finalScoreEl = document.getElementById('finalScore');
const bestScoreEl = document.getElementById('bestScore');
const bestStartEl = document.getElementById('bestStart');

const interstitial = document.getElementById('interstitial');
const closeInterstitial = document.getElementById('closeInterstitial');

let running = false, paused = false, gameOver = false;
let score = 0; let best = Number(localStorage.getItem('ff_best')||0);
bestStartEl.textContent = best;

const G = 1250;          // gravity px/s^2
const FLAP = -450;       // impulse velocity
const MAX_VY = 720;      // clamp fall speed

// fish properties (in CSS pixels)
const fish = { x: 90, y: 280, vy: 0, r: 14, rot: 0 };

// Obstacles
const pipes = []; // each: {x, gapY}
const pipeGap = 200;           // vertical gap size
const pipeW = 50;              // pipe width
const pipeSpacing = 220;       // distance between pipes
const pipeSpeed = 150;         // px/s leftward

// Spawn management
let lastSpawnX = 0;

function resetGame() {
  running = true; paused = false; gameOver = false; score = 0;
  fish.x = 90; fish.y = canvas.clientHeight * 0.45; fish.vy = 0; fish.rot = 0;
  pipes.length = 0; lastSpawnX = 0;
  scorePill.textContent = `Score: ${score}`;
  hide(gameOverOverlay); hide(startOverlay); hide(howOverlay);
  fitCanvas();
}

function show(el){ el.style.display = '' }
function hide(el){ el.style.display = 'none' }

playBtn.addEventListener('click', () => { initAudio(); resetGame(); });
howBtn.addEventListener('click', () => { show(howOverlay); });
closeHow.addEventListener('click', () => { hide(howOverlay); });
retryBtn.addEventListener('click', () => { maybeShowInterstitial(); resetGame(); });

pauseBtn.addEventListener('click', () => { if (!running) return; paused = !paused; pauseBtn.textContent = paused ? '▶️' : '⏸️'; });

shareBtn.addEventListener('click', async () => {
  const text = `I scored ${score} in Flappy Fish! Can you beat me?`;
  try { if (navigator.share) { await navigator.share({ text, url: location.href, title: 'Flappy Fish' }); return; } } catch {}
  navigator.clipboard?.writeText(`${text} ${location.href}`);
  alert('Share text copied to clipboard!');
});

// Interstitial: every 3rd fail
let failCount = Number(localStorage.getItem('ff_fails')||0);
function maybeShowInterstitial(){
  failCount++; localStorage.setItem('ff_fails', String(failCount));
  if (failCount % 3 === 0) {
    interstitial.style.display = 'grid';
  }
}
closeInterstitial.addEventListener('click', (e) => {
  e.stopPropagation();
  interstitial.style.display = 'none';
});
// Also allow clicking outside the content to close
interstitial.addEventListener('click', (e) => {
  if (e.target === interstitial) interstitial.style.display = 'none';
});

// Controls
function flap(){ if (!running || paused || gameOver) return; fish.vy = FLAP; playSwim(); }
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); if (!running) resetGame(); else flap(); }
  if (e.code === 'KeyP') { paused = !paused; pauseBtn.textContent = paused ? '▶️' : '⏸️'; }
}, {passive:false});
canvas.addEventListener('pointerdown', (e)=>{ e.preventDefault(); if (!running) resetGame(); else flap(); }, {passive:false});

document.addEventListener('visibilitychange', () => { if (document.hidden) paused = true; });

// ====== Game Loop ======
let last = performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  if (!running || paused) { draw(); return; }
  update(dt); draw();
}

function update(dt){
  // Spawn pipes as world scrolls
  const needSpawn = (pipes.length === 0) || (canvas.clientWidth - (pipes[pipes.length-1]?.x ?? 0) >= pipeSpacing);
  if (needSpawn){
    const margin = 80; // keep gap fully on screen
    const h = canvas.clientHeight;
    const gapY = Math.random() * (h - margin*2 - pipeGap) + margin + pipeGap/2;
    pipes.push({ x: canvas.clientWidth + pipeW, gapY, scored: false });
  }

  // Move pipes
  for (const p of pipes) p.x -= pipeSpeed * dt;
  // Drop off-screen pipes
  while (pipes.length && pipes[0].x + pipeW < 0) pipes.shift();

  // Physics
  fish.vy = Math.min(MAX_VY, fish.vy + G * dt);
  fish.y += fish.vy * dt;
  fish.rot = Math.atan2(fish.vy, 300);

  // Collisions & scoring
  const top = 0, bottom = canvas.clientHeight;
  if (fish.y - fish.r < top || fish.y + fish.r > bottom){ endGame(); return; }

  for (const p of pipes){
    const inX = fish.x + fish.r > p.x && fish.x - fish.r < p.x + pipeW;
    const gapTop = p.gapY - pipeGap/2; const gapBot = p.gapY + pipeGap/2;
    if (inX){
      if (fish.y - fish.r < gapTop || fish.y + fish.r > gapBot){ endGame(); return; }
    }
    if (!p.scored && p.x + pipeW < fish.x - fish.r){ p.scored = true; score++; scorePill.textContent = `Score: ${score}`; playScore(); }
  }
}

function endGame(){
  running = false; gameOver = true; playHit();
  best = Math.max(best, score); localStorage.setItem('ff_best', String(best));
  finalScoreEl.textContent = score; bestScoreEl.textContent = best;
  show(gameOverOverlay);
}

function draw(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  // Clear water background with gradient bands
  ctx.clearRect(0,0,w,h);
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0, '#07324b');
  grad.addColorStop(.6, '#062b40');
  grad.addColorStop(1, '#041c2a');
  ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);

  // Bubbles (lightweight procedural)
  const t = performance.now() * 0.001;
  for (let i=0;i<16;i++){
    const bx = (i*97 % w);
    const by = (h - ((t*30 + i*30) % (h+40)));
    ctx.globalAlpha = 0.10 + (i%5)*0.03;
    ctx.beginPath(); ctx.arc(bx, by, 3 + (i%3), 0, Math.PI*2); ctx.fillStyle = '#93c5fd'; ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Draw pipes as coral columns
  for (const p of pipes){
    ctx.fillStyle = '#ea580c';
    const gapTop = p.gapY - pipeGap/2; const gapBot = p.gapY + pipeGap/2;
    // top coral
    roundRect(ctx, p.x, -2, pipeW, gapTop+2, 10);
    // bottom coral
    roundRect(ctx, p.x, gapBot, pipeW, h-gapBot+2, 10);
    // subtle texture lines
    ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x+8, 0); ctx.lineTo(p.x+8, h); ctx.stroke();
  }

  // Draw fish
  ctx.save();
  ctx.translate(fish.x, fish.y); ctx.rotate(fish.rot);
  // body
  ctx.fillStyle = '#22d3ee';
  ellipse(ctx, 0, 0, 22, 14);
  // tail
  ctx.fillStyle = '#0ea5e9';
  ctx.beginPath(); ctx.moveTo(-18, -6); ctx.lineTo(-32, 0); ctx.lineTo(-18, 6); ctx.closePath(); ctx.fill();
  // eye
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(8, -3, 3.5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#001018'; ctx.beginPath(); ctx.arc(9, -3, 1.5, 0, Math.PI*2); ctx.fill();
  // bubble from mouth
  ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(20 + Math.sin(t*6)*2, -6 + Math.cos(t*8), 2.2, 0, Math.PI*2); ctx.fillStyle = '#bde0ff'; ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();

  // Ground gradient at bottom
  const seabed = ctx.createLinearGradient(0, h-100, 0, h);
  seabed.addColorStop(0, 'rgba(234,88,12,.08)');
  seabed.addColorStop(1, 'rgba(2,19,30,1)');
  ctx.fillStyle = seabed; ctx.fillRect(0, h-100, w, 100);
}

function roundRect(ctx, x,y,w,h,r){
  const rr = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath(); ctx.fill();
}
function ellipse(ctx, x,y, rx, ry){ ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); }

// Boot
fitCanvas(); requestAnimationFrame(loop);
// Show start overlay initially
show(startOverlay);
