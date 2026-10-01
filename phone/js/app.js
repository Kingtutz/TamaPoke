// Phone front-end for TamaPoke. The pet's world (scene, sprite, bath, egg,
// evolution, ceremonies and the two mini-games) is drawn on a canvas with the
// firmware's drawing code; everything around it (needs, actions, Pokedex, stats,
// settings, dialogs) is plain HTML laid out for a portrait phone screen.
import { DEX, FW_VERSION } from './data.js';
import {
  Pet, millis, random, timeLeft, MINUTES_PER_LEVEL, CER_FAREWELL, CER_RUNAWAY,
  MOOD_SAD, MOOD_EATING, MOOD_SLEEPING, R_RARO, R_LEGENDARIO, MED_COUNT,
  SFX_TAP, SFX_EAT, SFX_PLAY, SFX_HEART, SFX_MEDAL, SFX_DENY, SFX_LEVEL,
} from './pet.js';
import {
  PmdMon, Thumbs, pmdActTotalMs, pmdFrameAt, INK_K,
  PMD_IDLE, PMD_WALKL, PMD_WALKR, PMD_SLEEP, PMD_EAT, PMD_HURT, PMD_POSE, PMD_NOD, PMD_BREATH,
} from './sprites.js';
import {
  Gfx, C565, lerp565, W, UI_INK, UI_INK_NIGHT, UI_TRACK,
  UI_BAR_OK, UI_BAR_WARN, UI_BAR_BAD, UI_WHITE, UI_BG_DAY, mapDataUrl, cssColor,
} from './gfx.js';
import {
  S, T, P, fmt, dexName, medalName, medalDesc, LANG_CODES, LANG_NAMES, getLang, setLang, isCjk, isCjkLang,
} from './i18n.js';
import { sfxPlay, audioUnlock, audioEnabled, audioSetEnabled, audioSetSleeping } from './audio.js';
import {
  pushAvailable, pushNeedsInstall, pushBlocked, pushEnabled, pushInit, pushEnable, pushDisable,
  pushSchedule, pushCancel, firstNeed, outOfQuietHours,
} from './push.js';

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const gfx = new Gfx(canvas);
const pet = new Pet(sfxPlay);
let pmd = new PmdMon();       // current pet, multi-action sprite
let evoPmd = new PmdMon();    // previous form during the evolution flash
const galleryPmd = new PmdMon();
const thumbs = new Thumbs();
let monFor = -2, monShinyFor = false;

const CX = W >> 1;
// stage geometry (logical units, 466 wide); height follows the phone's screen
let H = 466, GROUND = 304, HORIZON = 232;
function layoutStage() {
  H = gfx.h;
  GROUND = H - Math.max(36, Math.round(H * 0.14)); // tall phones: some meadow in front
  HORIZON = GROUND - Math.min(110, Math.max(84, Math.round(H * 0.15)));
}

// on-screen behaviour of the pet
const beh = { mode: 0, act: PMD_IDLE, t0: 0, until: 0, x: CX, targetX: CX };

let tab = 'home';
let bathUntil = 0, bathPending = false;
const bubbles = Array.from({ length: 14 }, () => ({ x: 0, y: 0, r: 0, ph: 0 }));
let feedMenuUntil = 0;
// ball minigame
let gameOpen = false, gameOverUntil = 0, gamePetX = CX;
let balls = []; // {x, y, vx, vy}: one at the start, more join as the score climbs
let lastGameStep = 0, gameScore = 0, gameMisses = 0, hitX = 0, hitY = 0, hitTime = 0, gameNewHi = false;
let extraBallAt = 0; // when the last extra ball joined (for the "+1" flash)
// punching bag
let sackOpen = false, sackUntil = 0, sackOverUntil = 0, sackHits = 0, sackShake = 0, sackGain = 0, sackNewHi = false;

const CRACK1 = [[15, 8], [16, 9], [15, 10]];
const CRACK2 = [[11, 13], [12, 14], [11, 15], [20, 12], [19, 13], [20, 14]];
const STARS = [[120, 140], [330, 120], [370, 210], [95, 230], [280, 90], [160, 95]];
const STARTER_DEX = [1, 4, 7];

// gesture in progress on the canvas
let pressed = false, tX0 = 0, tY0 = 0, tXl = 0, tYl = 0, tStart = 0, holdFired = false;
let gNight = false;
let frameDt = 100; // ms since the previous frame (the firmware ran at a fixed 10 fps)

// local wall-clock time as an epoch, like the board's RTC (which holds local time)
const epochNow = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 1000);

// ---------- canvas text helpers (same names as the firmware) ----------
const setSize = (n) => gfx.setTextSize(n);
const setCur = (x, y) => gfx.setCursor(x, y);
const printT = (s) => gfx.print(s);
const centerX = (s, n) => gfx.centerX(s, n);
const inkColor = () => (gNight ? UI_INK_NIGHT : UI_INK);
const drawMap = (name, x, y, s, sil) => gfx.drawMap(name, x, y, s, sil);

// ---------- DOM helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function setText(el, s) {
  if (el._t !== s) { el._t = s; el.textContent = s; }
}
function setHidden(el, h) {
  if (el.hidden !== h) el.hidden = h;
}
const barColor = (v) => (v >= 50 ? 'var(--ok)' : v >= 25 ? 'var(--warn)' : 'var(--bad)');
const petName = () => pet.nick || dexName(pet.speciesId);
const flame = '<svg viewBox="0 0 16 18" width="14" height="16" aria-hidden="true"><path d="M8 0 1 18h14z" fill="var(--bad)"/><path d="M8 7 4 18h8z" fill="var(--warn)"/></svg>';

// ---------- setup ----------
async function setup() {
  pet.begin();
  pet.syncClock(epochNow());
  buildTabs();
  buildActions();
  buildFeedMenu();
  applyLang();
  if (!pet.awaitingStarter() && !pet.isEgg()) ensureMon();
  new ResizeObserver(() => gfx.resize()).observe(canvas);
  pushInit().then(pushCancel).catch(() => {}); // we're here: drop reminders from last time
  await thumbs.load();
  buildDexGrid();
  buildStarter();
}

function ensureMon() {
  if (pet.speciesId === monFor && monShinyFor === pet.shiny) return;
  monFor = pet.speciesId;
  monShinyFor = pet.shiny;
  beh.x = beh.targetX = CX;
  beh.mode = 0;
  beh.until = 0;
  if (pet.speciesId >= 1 && pet.speciesId <= 151) pmd.load(pet.speciesId, pet.shiny);
  else pmd.unload();
}

let wasEvoReady = false, wasRunReady = false, lastClock = 0, lastFrame = 0, lastStats = 0;

function loop() {
  const now = millis();
  frameDt = lastFrame ? Math.min(now - lastFrame, 250) : 100;
  lastFrame = now;
  pet.update(now);
  audioSetSleeping(pet.sleeping);

  const evoReady = pet.wantEvolveButton();
  if (evoReady && !wasEvoReady) sfxPlay(SFX_MEDAL);
  wasEvoReady = evoReady;
  const runReady = pet.canRunawayNow();
  if (runReady && !wasRunReady) sfxPlay(SFX_DENY);
  wasRunReady = runReady;

  checkLongPress();
  ensureMon();
  if (pet.savePending()) pet.flushSave();

  if (now - lastClock > 30000) {
    lastClock = now;
    pet.lastSeenEpoch = epochNow();
  }

  const h = sceneHour();
  gNight = pet.sleeping || h < 6 || h >= 20;
  setNight(gNight);
  setHidden($('starter'), !pet.awaitingStarter());
  if (!pet.awaitingStarter()) {
    if (tab === 'home') {
      renderStage();
      updateHome();
    } else if (tab === 'stats') {
      if (now - lastStats > 1000) { lastStats = now; renderStats(); }
      drawMonFit($('stats-mon'), pmd, PMD_IDLE, now, false);
    }
  }
  if (!$('dexdetail').hidden) drawDexDetail();
  requestAnimationFrame(loop);
}

let nightShown = null;
function setNight(n) {
  if (n === nightShown) return;
  nightShown = n;
  document.body.classList.toggle('night', n);
  document.querySelector('meta[name="theme-color"]').content = n ? '#101829' : '#f7efe7';
}

// ---------- canvas touch ----------
const inPetZone = (x, y) => Math.abs(x - beh.x) < 120 && y > GROUND - 230 && y < GROUND + 16;

function toStage(e) {
  const r = canvas.getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audioUnlock();
  if (sackOpen) { sackTap(); return; } // every tap counts immediately (mash fast)
  const [x, y] = toStage(e);
  pressed = true;
  canvas.setPointerCapture(e.pointerId);
  tX0 = tXl = x;
  tY0 = tYl = y;
  tStart = millis();
  holdFired = false;
  if (gameOpen) { pressed = false; gameTap(x, y); } // react on touch-down, not release
});
canvas.addEventListener('pointermove', (e) => {
  if (pressed) [tXl, tYl] = toStage(e);
});
canvas.addEventListener('pointerup', (e) => {
  if (!pressed) return;
  pressed = false;
  [tXl, tYl] = toStage(e);
  if (!holdFired && millis() - tStart < 1500 && Math.abs(tXl - tX0) < 40 && Math.abs(tYl - tY0) < 40) onStageTap(tX0, tY0);
});
canvas.addEventListener('pointercancel', () => { pressed = false; });
document.addEventListener('contextmenu', (e) => e.preventDefault());
// first touch anywhere unlocks audio on iOS
document.addEventListener('pointerdown', audioUnlock, { capture: true });

// holding still on the pet for 3 s -> "release?" dialog
function checkLongPress() {
  if (!pressed || holdFired || gameOpen || sackOpen) return;
  if (millis() - tStart > 3000 && Math.abs(tXl - tX0) < 30 && Math.abs(tYl - tY0) < 30 && inPetZone(tX0, tY0)) {
    holdFired = true;
    if (askRelease() && navigator.vibrate) navigator.vibrate(30);
  }
}

function onStageTap(x, y) {
  if (pet.ceremony) return;
  if (feedMenuUntil) { closeFeedMenu(); return; }
  if (pet.isEgg()) {
    pet.eggTap();
    sfxPlay(SFX_TAP);
    return;
  }
  if (inPetZone(x, y)) {
    pet.caress();
    if (!pet.sleeping) sfxPlay(SFX_HEART);
  }
}

// ---------- tabs ----------
const TAB_ICONS = {
  home: '<path d="M12 3 2 11h3v10h5v-6h4v6h5V11h3z"/>',
  dex: '<path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>',
  stats: '<path d="M3 20h18v2H3zM4 12h4v7H4zm6-8h4v15h-4zm6 4h4v11h-4z"/>',
  settings: '<path d="M10 2h4l1 3 3 1.5 3-1 2 3.5-2.5 2v2l2.5 2-2 3.5-3-1L15 19l-1 3h-4l-1-3-3-1.5-3 1-2-3.5L3.5 13v-2L1 9l2-3.5 3 1L9 5zm2 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>',
};
const TAB_LABEL = { home: 'HOME', dex: 'DEX', stats: 'STATS', settings: 'SETTINGS' };

function buildTabs() {
  $('tabs').innerHTML = Object.keys(TAB_ICONS).map((k) =>
    `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">` +
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${TAB_ICONS[k]}</svg><span></span></button>`).join('');
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) { sfxPlay(SFX_TAP); showTab(b.dataset.tab); }
  });
}

function showTab(t) {
  closeFeedMenu();
  tab = t;
  for (const k of Object.keys(TAB_ICONS)) setHidden($(k), k !== t);
  for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  if (t === 'dex') refreshDexGrid();
  if (t === 'stats') { renaming = false; renderStats(true); $('stats-page').scrollTop = 0; }
  if (t === 'settings') renderSettings();
}

// ---------- home: actions, feed menu, needs ----------
const ACTIONS = [
  { icon: 'ICON_FOOD', label: 'FEED' },
  { icon: 'ICON_PLAY', label: 'PLAY' },
  { icon: 'ICON_LIGHT', label: 'LIGHT' },
  { icon: 'ICON_CLEAN', label: 'BATH' },
];
const FOODS = [
  { icon: 'ICON_FOOD', label: () => T(S.BERRY_RED) },
  { icon: 'ICON_BERRY_B', label: () => T(S.BERRY_BLUE) },
  { icon: 'ICON_BERRY_G', label: () => T(S.BERRY_GREEN) },
  { icon: 'ICON_CANDY', label: () => P('CANDY') },
];
const BARS = [
  { id: S.BAR_FOOD, get: () => pet.fullness },
  { id: S.BAR_JOY, get: () => pet.joy },
  { id: S.BAR_ENE, get: () => pet.energy },
  { id: S.BAR_HYG, get: () => pet.hygiene },
];

function buildActions() {
  $('actions').innerHTML = ACTIONS.map((a, i) =>
    `<button class="act" data-i="${i}"><img class="pixel" alt="" src="${mapDataUrl(a.icon)}"><span></span></button>`).join('');
  $('actions').addEventListener('click', (e) => {
    const b = e.target.closest('.act');
    if (!b || b.disabled) return;
    const i = Number(b.dataset.i);
    sfxPlay(SFX_TAP);
    if (i === 0) { if (feedMenuUntil) closeFeedMenu(); else openFeedMenu(); return; }
    closeFeedMenu();
    if (i === 1) startGame();
    else if (i === 2) pet.toggleLight();
    else startBath();
  });
  $('bars').innerHTML = BARS.map(() =>
    '<div class="bar"><span></span><div class="track"><div class="fill"></div></div></div>').join('');
}

function buildFeedMenu() {
  $('feedmenu').innerHTML = FOODS.map((f, i) =>
    `<button class="food" data-i="${i}"><img class="pixel" alt="" src="${mapDataUrl(f.icon)}"><span></span></button>`).join('');
  $('feedmenu').addEventListener('click', (e) => {
    const b = e.target.closest('.food');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (i === 3) pet.feedCandy();
    else pet.feedBerry(i);
    sfxPlay(SFX_EAT);
    closeFeedMenu();
  });
}
function openFeedMenu() {
  if (pet.sleeping || pet.isEgg() || pet.ceremony) return;
  feedMenuUntil = millis() + 6000;
  $('feedmenu').hidden = false;
}
function closeFeedMenu() {
  feedMenuUntil = 0;
  $('feedmenu').hidden = true;
}

function updateHome() {
  if (feedMenuUntil && !timeLeft(feedMenuUntil)) closeFeedMenu();
  const playing = gameOpen || sackOpen;
  document.body.classList.toggle('playing', playing);
  setHidden($('game-close'), !playing);

  // header over the sky
  let name, color, msg;
  if (pet.ceremony) {
    name = dexName(pet.speciesId);
    color = DEX[pet.speciesId].accent;
    msg = pet.ceremony === CER_FAREWELL ? T(S.FAREWELL) : pet.ceremony === CER_RUNAWAY ? T(S.RUNAWAY) : T(S.GOODBYE);
  } else if (pet.isEgg()) {
    name = T(S.EGG_HDR);
    color = inkColor();
    msg = eggMsg();
  } else {
    name = fmt(T(S.NAME_FMT), pet.shiny ? '*' : '', petName(), pet.level());
    color = gNight ? UI_INK_NIGHT : DEX[pet.speciesId].accent;
    msg = statusMsg();
  }
  setText($('hud-name'), name);
  $('hud-name').style.color = cssColor(color);
  setText($('hud-msg'), msg);
  $('hud-msg').style.color = cssColor(inkColor());
  const streak = !pet.isEgg() && !pet.ceremony && pet.streak >= 1;
  setHidden($('streak'), !streak);
  if (streak) {
    setText($('streak').lastElementChild, String(pet.streak));
    $('streak').style.color = cssColor(inkColor());
  }

  // medal / streak celebration
  let l1 = null, l2 = '';
  if (pet.showMedal()) {
    for (let i = 0; i < MED_COUNT; i++) if (pet.newMedal & (1 << i)) { l2 = medalName(i); break; }
    l1 = T(S.MEDAL_BANNER);
  } else if (pet.showMilestone()) {
    l1 = T(S.GREAT);
    l2 = fmt(T(S.STREAK_DAYS_FMT), pet.streak);
  }
  setHidden($('banner'), !l1 || playing);
  if (l1) { setText($('banner').firstElementChild, l1); setText($('banner').lastElementChild, l2); }

  // evolve / farewell / runaway call to action
  const big = $('bigbtn');
  let kind = null, label = '';
  if (!playing && $('modal').hidden) {
    if (pet.wantEvolveButton()) { kind = 'evolve'; label = T(S.EVO_TAP); }
    else if (pet.canRunawayNow()) { kind = 'runaway'; label = fmt(T(S.RUNAWAY_BTN), petName()); }
    else if (pet.wantFarewellButton()) { kind = 'farewell'; label = fmt(T(S.FAREWELL_BTN), petName()); }
  }
  setHidden(big, !kind);
  if (kind) {
    if (big.dataset.kind !== kind) { big.dataset.kind = kind; big.className = `pulse ${kind}`; }
    setText(big, label);
  }

  // needs / egg info
  const egg = pet.isEgg();
  setHidden($('bars'), egg);
  setHidden($('egginfo'), !egg);
  if (egg) {
    const r = pet.eggRarity();
    const rar = $('egg-rarity');
    setHidden(rar, r < R_RARO);
    if (r >= R_RARO) {
      setText(rar, r === R_LEGENDARIO ? T(S.EGG_LEGEND) : T(S.EGG_RARE));
      rar.className = r === R_LEGENDARIO ? 'legend' : 'rare';
    }
    setText($('egg-dex'), fmt(T(S.POKEDEX_FMT), pet.registeredCount()));
  } else {
    const rows = $('bars').children;
    BARS.forEach((b, i) => {
      const v = b.get();
      const fill = rows[i].lastElementChild.firstElementChild;
      const w = `${v}%`;
      if (fill.style.width !== w) { fill.style.width = w; fill.style.backgroundColor = barColor(v); }
    });
  }
  const acts = $('actions').children;
  const blocked = egg || !!pet.ceremony || pet.evolving();
  for (let i = 0; i < 4; i++) {
    const off = blocked || (pet.sleeping && i !== 2);
    if (acts[i].disabled !== off) acts[i].disabled = off;
  }
}

// ---------- dialogs ----------
let modalA = null, modalB = null;
function ask(q, a, aCls, b, bCls, onA, onB) {
  closeFeedMenu();
  setText($('modal-q'), q);
  setText($('modal-a'), a);
  setText($('modal-b'), b);
  $('modal-a').className = `btn ${aCls}`;
  $('modal-b').className = `btn ${bCls}`;
  modalA = onA;
  modalB = onB;
  $('modal').hidden = false;
}
function closeModal(fn) {
  $('modal').hidden = true;
  modalA = modalB = null;
  if (fn) fn();
}
$('modal-a').addEventListener('click', () => { sfxPlay(SFX_TAP); closeModal(modalA); });
$('modal-b').addEventListener('click', () => { sfxPlay(SFX_TAP); closeModal(modalB); });
// tapping outside the sheet just closes it, like the firmware's dialog timeout
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

// "release" sends it to the Professor: it can be swapped back from the Pokedex
function askRelease() {
  if (pet.isEgg() || pet.ceremony || pet.awaitingStarter()) return false;
  ask(fmt(P('SEND_PROF_Q'), petName()), T(S.YES), 'bad', T(S.NO), 'flat', () => {
    showTab('home');
    pet.release();
  });
  return true;
}

$('bigbtn').addEventListener('click', () => {
  sfxPlay(SFX_TAP);
  const k = $('bigbtn').dataset.kind;
  if (k === 'evolve') {
    ask(T(S.EVO_Q), T(S.EVO_TAP), 'bad', T(S.EVO_KEEP), 'flat', () => {
      // keep the old form's sprite for the flashing silhouettes
      const old = pmd;
      pmd = evoPmd;
      evoPmd = old;
      pmd.unload();
      monFor = -2; // reload (the new form, or the same one if evolve() declines)
      pet.evolve();
    }, () => pet.declineEvolve());
  } else if (k === 'runaway') {
    pet.startRunaway();
  } else if (k === 'farewell') {
    ask(T(S.FAR_Q), T(S.FAR_GO), 'warn', T(S.FAR_STAY), 'ok', () => pet.startFarewell(), () => pet.declineFarewell());
  }
});

$('game-close').addEventListener('click', () => {
  sfxPlay(SFX_TAP);
  gameOpen = false;
  sackOpen = false;
});

// ---------- starter pick ----------
function buildStarter() {
  $('starter-list').innerHTML = STARTER_DEX.map((d) => {
    const acc = DEX[d].accent;
    return `<button class="starter" data-dex="${d}" style="background:${cssColor(lerp565(acc, UI_WHITE, 6, 8))};border-color:${cssColor(acc)};color:#292831">` +
      `<canvas class="pixel" width="40" height="40"></canvas><span></span></button>`;
  }).join('');
  for (const b of $('starter-list').children) paintThumb(b.firstElementChild, Number(b.dataset.dex), false);
  refreshStarterText();
  $('starter-list').addEventListener('click', (e) => {
    const b = e.target.closest('.starter');
    if (!b) return;
    pet.chooseStarter(Number(b.dataset.dex));
    sfxPlay(SFX_TAP);
    showTab('home');
  });
}
function refreshStarterText() {
  setText($('starter-title'), T(S.CHOOSE_STARTER));
  for (const b of $('starter-list').children) setText(b.lastElementChild, dexName(Number(b.dataset.dex)));
}

// ---------- sprites in HTML ----------
function paintThumb(cv, dex, sil) {
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  const t = thumbs.get(dex, sil);
  if (!t) return false;
  c.imageSmoothingEnabled = false;
  c.drawImage(t.canvas, (cv.width - t.w) >> 1, (cv.height - t.h) >> 1);
  return true;
}

// an animated PMD sprite, scaled by a whole number to fit a small canvas
function drawMonFit(cv, m, actId, t, sil) {
  if (!cv) return false;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  if (!m.loaded || !m.has(actId)) return false;
  const a = m.acts[actId];
  const s = Math.max(1, Math.floor(Math.min((cv.width - 4) / a.w, (cv.height - 4) / ((a.base || a.h) - a.top))));
  const fi = pmdFrameAt(a, t, true);
  c.imageSmoothingEnabled = false;
  c.drawImage(m.frameCanvas(actId, fi, sil), (cv.width - a.w * s) >> 1, cv.height - 2 - (a.base || a.h) * s, a.w * s, a.h * s);
  return true;
}

// ---------- Pokedex ----------
function buildDexGrid() {
  const ballIcon = mapDataUrl('ICON_PLAY');
  let html = '';
  for (let d = 1; d <= 151; d++) {
    html += `<button class="cell" data-dex="${d}"><canvas class="pixel" width="40" height="40"></canvas>` +
      `<span class="no">${String(d).padStart(3, '0')}</span><span class="shiny" hidden>*</span>` +
      `<img class="boxed pixel" alt="" src="${ballIcon}" hidden></button>`;
  }
  $('dex-grid').innerHTML = html;
  $('dex-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.cell');
    if (b) openDexDetail(Number(b.dataset.dex));
  });
  refreshDexGrid();
}

function refreshDexGrid() {
  setText($('dex-title'), fmt(T(S.POKEDEX_FMT), pet.registeredCount()));
  for (const cell of $('dex-grid').children) {
    const d = Number(cell.dataset.dex);
    const reg = pet.isRegistered(d);
    const boxed = pet.boxOf(d).length > 0;
    const key = `${reg}${pet.isShinyRegistered(d)}${boxed}${thumbs.loaded}`;
    if (cell._k === key) continue;
    cell._k = key;
    cell.classList.toggle('unseen', !reg);
    cell.querySelector('.shiny').hidden = !pet.isShinyRegistered(d);
    cell.querySelector('.boxed').hidden = !boxed; // one of these is at the Professor's
    cell.setAttribute('aria-label', reg ? dexName(d) : `#${d}`);
    paintThumb(cell.firstElementChild, d, !reg);
  }
}

let detailDex = 0;
function openDexDetail(dex) {
  sfxPlay(SFX_TAP);
  detailDex = dex;
  galleryPmd.load(dex, pet.isShinyRegistered(dex));
  const reg = pet.isRegistered(dex);
  const d = DEX[dex];
  const name = $('dex-name');
  name.textContent = `N.${String(dex).padStart(3, '0')} ${pet.isShinyRegistered(dex) ? '*' : ''}${reg ? dexName(dex) : '???'}`;
  name.style.color = reg ? cssColor(d.accent) : '';
  $('dex-base').innerHTML = reg
    ? [['HP', d.bHp], [T(S.STAT_ATK), d.bAtk], [T(S.STAT_DEF), d.bDef], [T(S.STAT_SPE), d.bSpe]]
      .map(([l, v]) => statRow(l, v, 160, cssColor(d.accent))).join('')
    : `<p class="small" style="text-align:center">${esc(P('NOT_SEEN'))}</p>`;
  $('dex-box').innerHTML = dexBoxHtml(dex);
  $('dexdetail').hidden = false;
}

// the ones of this species you have had: with you, or at the Professor's
const levelAt = (ageMinutes) => Math.min(999, 1 + Math.floor(ageMinutes / MINUTES_PER_LEVEL));
const boxLabel = (p) => fmt(T(S.NAME_FMT), p.shiny ? '*' : '', p.nick || dexName(p.speciesId), levelAt(p.ageMinutes));
function dexBoxHtml(dex) {
  const here = pet.boxOf(dex);
  const mine = !pet.isEgg() && pet.speciesId === dex;
  if (!here.length && !mine) return '';
  let h = '';
  if (mine) h += `<div class="box-row"><span>${esc(boxLabel(pet))}</span><span class="small">${esc(P('WITH_YOU'))}</span></div>`;
  if (here.length) {
    h += `<p class="small">${esc(P('AT_PROF'))}</p>`;
    for (const p of here) {
      h += `<div class="box-row"><span>${esc(boxLabel(p))}</span>` +
        `<button class="btn ok" data-swap="${p.index}"${pet.canSwap() ? '' : ' disabled'}>${esc(P('SWAP'))}</button></div>`;
    }
    if (pet.isEgg()) h += `<p class="small">${esc(P('HATCH_FIRST'))}</p>`;
  }
  return h;
}

function askSwap(i) {
  const p = pet.box[i];
  if (!p) return;
  closeDexDetail();
  ask(fmt(P('SWAP_Q'), petName(), p.nick || dexName(p.speciesId)), T(S.YES), 'ok', T(S.NO), 'flat', () => {
    if (!pet.swapFromBox(i)) return;
    monFor = -2; // load the returning one's sprite
    sfxPlay(SFX_HEART);
    showTab('home');
  });
}
function drawDexDetail() {
  const reg = pet.isRegistered(detailDex);
  const cv = $('dex-mon');
  if (!drawMonFit(cv, galleryPmd, PMD_IDLE, reg ? millis() : 0, !reg)) {
    // sprite still loading (or offline): the thumbnail meanwhile
    const c = cv.getContext('2d');
    const t = thumbs.get(detailDex, !reg);
    if (t) {
      const s = Math.floor(Math.min(cv.width / t.w, cv.height / t.h));
      c.imageSmoothingEnabled = false;
      c.drawImage(t.canvas, (cv.width - t.w * s) >> 1, (cv.height - t.h * s) >> 1, t.w * s, t.h * s);
    }
  }
}
function closeDexDetail() {
  $('dexdetail').hidden = true;
  galleryPmd.unload();
}
// a tap anywhere closes the sheet, except on a "bring back" button
$('dexdetail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-swap]');
  if (b) { sfxPlay(SFX_TAP); askSwap(Number(b.dataset.swap)); return; }
  closeDexDetail();
});

function statRow(label, val, max, color) {
  const w = Math.min(100, Math.round((val * 100) / max));
  return `<div class="row"><span class="lbl">${esc(label)}</span>` +
    `<div class="track"><div class="fill" style="width:${w}%;background:${color}"></div></div>` +
    `<span class="val">${val}</span></div>`;
}

// ---------- Stats (the firmware's swipe-up card, as one scrolling page) ----------
let renaming = false, statsHtml = '';

function renderStats(force) {
  if (renaming && !force) return; // don't wipe the text field while typing
  const page = $('stats-page');
  let html;
  if (pet.isEgg()) {
    html = `<div class="card profile"><canvas id="stats-mon" hidden></canvas><div class="name">${esc(T(S.EGG_HDR))}</div>` +
      `<p class="line">${esc(eggMsg())}</p><p class="small">${esc(fmt(T(S.POKEDEX_FMT), pet.registeredCount()))}</p></div>`;
  } else {
    const d = DEX[pet.speciesId];
    const acc = cssColor(d.accent);
    const head = fmt(T(S.NAME_FMT), pet.shiny ? '*' : '', petName(), pet.level());
    const berry = !pet.berryKnown ? T(S.BERRY_UNK) : pet.lovesBerry(0) ? T(S.BERRY_RED)
      : pet.lovesBerry(1) ? T(S.BERRY_BLUE) : T(S.BERRY_GREEN);

    let evo, evoCol = 'inherit';
    if (d.evolvesTo === 0) evo = T(S.FINAL_FORM);
    else {
      const needed = d.evolveLevel + pet.careMistakes;
      if (pet.level() >= needed) {
        if (pet.lowestStat() >= 40) { evo = T(S.EVO_READY); evoCol = 'var(--ok)'; }
        else { evo = T(S.EVO_BLOCKED); evoCol = 'var(--bad)'; }
      } else evo = fmt(T(S.EVO_IN_FMT), needed - pet.level());
    }
    const into = pet.ageMinutes % MINUTES_PER_LEVEL;

    let medals = '', got = 0;
    for (let i = 0; i < MED_COUNT; i++) {
      const g = pet.hasMedal(1 << i);
      if (g) got++;
      medals += `<div class="medal${g ? ' got' : ''}"><i>${g ? 'v' : ''}</i><span>${esc(medalDesc(i))}</span></div>`;
    }

    const nameBlock = renaming
      ? `<form class="rename-form" id="rename-form"><input id="rename-input" maxlength="11" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" value="${esc(pet.nick)}" placeholder="${esc(dexName(pet.speciesId))}">` +
        `<button class="btn ok" type="submit">OK</button></form>`
      : `<button class="btn flat" data-act="rename">${esc(P('RENAME'))}</button>`;

    html =
      `<div class="card profile"><canvas id="stats-mon" class="pixel" width="96" height="96"></canvas>` +
      `<div class="name" style="color:${acc}">${esc(head)}</div>` +
      (pet.nick ? `<div class="small species">(${esc(dexName(pet.speciesId))})</div>` : '') +
      nameBlock + '</div>' +

      `<div class="card"><div class="line">${flame} ${esc(fmt(T(S.STREAK_FMT), pet.streak, pet.bestStreak))}</div>` +
      statRow(T(S.VIN), pet.bond, 100, 'var(--pink)') +
      `<div class="line">${esc(fmt(T(S.INFO_FMT), berry, Math.floor(pet.ageMinutes / 1440)))}</div></div>` +

      `<div class="card"><h2>${esc(T(S.BATTLE))}</h2>` +
      statRow(T(S.STAT_ATK), pet.atkStat(), 260, 'var(--bad)') +
      statRow(T(S.STAT_DEF), pet.defStat(), 260, 'var(--blue)') +
      statRow(T(S.STAT_SPE), pet.speStat(), 260, 'var(--warn)') +
      statRow(T(S.STAT_WGT), pet.weight, 100, 'var(--brown)') +
      `<button class="btn bad" data-act="train"${pet.sleeping || pet.ceremony ? ' disabled' : ''}>${esc(T(S.TRAIN_STR))}</button>` +
      `<p class="small">${esc(pet.sleeping ? P('WAKE_FIRST') : fmt(T(S.RECORD_FMT), pet.strHi))}</p></div>` +

      `<div class="card"><h2>${esc(T(S.PROGRESS))}</h2><div class="lv-big">${esc(fmt(T(S.LVL_FMT), pet.level()))}</div>` +
      `<div class="track"><div class="fill" style="width:${Math.round((into * 100) / MINUTES_PER_LEVEL)}%"></div></div>` +
      `<p class="line">${esc(fmt(T(S.NEXT_LVL_FMT), MINUTES_PER_LEVEL - into, pet.level() + 1))}</p>` +
      `<p class="small">${esc(T(S.EVO_LABEL))}</p><p class="line" style="color:${evoCol}">${esc(evo)}</p>` +
      `<p class="line" style="color:${pet.careMistakes > 0 ? 'var(--bad)' : 'inherit'}">${esc(fmt(T(S.MISTAKES_FMT), pet.careMistakes))}</p></div>` +

      `<div class="card"><h2>${esc(fmt(T(S.MEDALS_FMT), got, MED_COUNT))}</h2><div class="medals">${medals}</div></div>` +

      (pet.ceremony ? '' : `<button class="btn ghost" data-act="release">${esc(P('SEND_PROF'))}</button>`);
  }
  if (html === statsHtml && !force) return;
  statsHtml = html;
  page.innerHTML = html;
  if (renaming) {
    const inp = $('rename-input');
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}

$('stats-page').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  sfxPlay(SFX_TAP);
  const act = b.dataset.act;
  if (act === 'rename') { renaming = true; renderStats(true); }
  else if (act === 'train') { showTab('home'); startSack(); }
  else if (act === 'release') askRelease();
});
$('stats-page').addEventListener('submit', (e) => {
  e.preventDefault();
  // control characters out; the firmware allows 11 characters
  pet.rename($('rename-input').value.replace(/[\u0000-\u001f\u007f]/g, '').trim());
  renaming = false;
  renderStats(true);
});

// ---------- Settings (the firmware's swipe-down screen) ----------
function renderSettings() {
  const snd = audioEnabled();
  let notify = '';
  if (pushAvailable()) {
    notify = `<div class="card"><div class="toggle"><span>${esc(P('NOTIFY'))}</span>` +
      `<button class="switch" role="switch" aria-checked="${pushEnabled()}" aria-label="${esc(P('NOTIFY'))}" data-act="notify"></button></div>` +
      (pushBlocked() ? `<p class="small">${esc(P('NOTIFY_BLOCKED'))}</p>` : '') + '</div>';
  } else if (pushNeedsInstall()) {
    notify = `<div class="card"><div class="toggle"><span>${esc(P('NOTIFY'))}</span></div><p class="small">${esc(P('NOTIFY_IOS'))}</p></div>`;
  }
  $('settings-page').innerHTML =
    `<div class="card"><div class="toggle"><span>${esc(P('SOUND'))}</span>` +
    `<button class="switch" role="switch" aria-checked="${snd}" aria-label="${esc(P('SOUND'))}" data-act="sound"></button></div></div>` +
    notify +
    `<div class="card"><h2>${esc(P('LANGUAGE'))}</h2><div class="langs">` +
    LANG_NAMES.map((n, i) => `<button class="btn${isCjkLang(i) ? ' cjk' : ''}" data-lang="${i}" aria-pressed="${i === getLang()}">${n}</button>`).join('') +
    '</div></div>' +
    `<p class="small" style="text-align:center">TamaPoke v${FW_VERSION} (phone)</p>`;
}
$('settings-page').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'sound') {
    audioSetEnabled(!audioEnabled());
    sfxPlay(SFX_TAP);
  } else if (b.dataset.act === 'notify') {
    sfxPlay(SFX_TAP);
    b.disabled = true;
    (pushEnabled() ? pushDisable() : pushEnable()).catch(() => {}).finally(renderSettings);
    return;
  } else if (b.dataset.lang) {
    setLang(Number(b.dataset.lang));
    applyLang();
    sfxPlay(SFX_TAP);
  }
  renderSettings();
});

// every fixed label, after a language change
function applyLang() {
  gfx.cjk = isCjk();
  document.body.classList.toggle('cjk', isCjk());
  document.documentElement.lang = LANG_CODES[getLang()].toLowerCase();
  for (const b of $('tabs').children) setText(b.lastElementChild, P(TAB_LABEL[b.dataset.tab]));
  [...$('actions').children].forEach((b, i) => setText(b.lastElementChild, P(ACTIONS[i].label)));
  [...$('feedmenu').children].forEach((b, i) => setText(b.lastElementChild, FOODS[i].label()));
  BARS.forEach((b, i) => setText($('bars').children[i].firstElementChild, T(b.id)));
  $('game-close').setAttribute('aria-label', P('CANCEL'));
  refreshStarterText();
  for (const c of $('dex-grid').children) c._k = null; // aria labels are localised
  refreshDexGrid();
  statsHtml = '';
}

// ---------- background scene: biome + real time of day ----------
const sceneHour = () => (pet.lastSeenEpoch ? Math.floor(pet.lastSeenEpoch / 3600) % 24 : 13);

const BIOME_SOIL = [
  C565(0x7e, 0xc0, 0x7f), C565(0xdc, 0xca, 0x94), C565(0x4f, 0x8a, 0x55),
  C565(0x8a, 0x55, 0x44), C565(0xa8, 0x90, 0x6a), C565(0xe6, 0xee, 0xf5),
];

function skyColors(h, night) {
  if (night) return [C565(0x0c, 0x12, 0x24), C565(0x1e, 0x26, 0x46)];
  if (h < 8) return [C565(0xd1, 0x6a, 0x86), C565(0xf3, 0xb8, 0x7c)];
  if (h < 18) return [C565(0x8f, 0xc8, 0xea), C565(0xdc, 0xee, 0xe6)];
  return [C565(0xc7, 0x5a, 0x4a), C565(0xf0, 0xae, 0x64)];
}

function drawClouds(now, col, y) {
  for (let k = 0; k < 2; k++) {
    const cx = ((Math.floor(now / 50) + k * 250) % 560) - 40;
    const cy = y + k * 34;
    gfx.fillCircle(cx, cy, 16, col);
    gfx.fillCircle(cx + 18, cy + 3, 13, col);
    gfx.fillCircle(cx - 15, cy + 4, 12, col);
  }
}

function drawScene(biome, now, night) {
  const h = sceneHour();
  const [top, bot] = skyColors(h, night);
  for (let y = 0; y < HORIZON; y += 8) gfx.fillRect(0, y, W, 8, lerp565(top, bot, y, HORIZON));

  // sun, moon and stars sit below the name/status header
  const skyY = Math.max(130, Math.round(HORIZON * 0.42));
  const starK = HORIZON / 232;
  if (night) {
    gfx.fillCircle(360, skyY, 24, C565(0xe8, 0xee, 0xf5));
    gfx.fillCircle(370, skyY - 6, 22, lerp565(top, bot, skyY, HORIZON));
    for (const [sx, sy] of STARS) gfx.fillRect(sx, Math.round(sy * starK), 4, 4, UI_WHITE);
  } else if (h < 18) {
    gfx.fillCircle(360, skyY, 26, h < 8 ? C565(0xff, 0xd9, 0x8a) : C565(0xff, 0xe7, 0x9f));
    drawClouds(now, C565(0xff, 0xff, 0xff), skyY - 14);
  } else {
    gfx.fillCircle(CX, HORIZON - 6, 34, C565(0xff, 0xf1, 0xc8));
  }

  let soil = BIOME_SOIL[biome < 6 ? biome : 0];
  if (night) soil = lerp565(soil, C565(0x16, 0x1c, 0x30), 9, 16);
  if (biome === 1) {
    const sea = night ? C565(0x1c, 0x34, 0x52) : C565(0x4f, 0x96, 0xc4);
    gfx.fillRect(0, HORIZON - 26, W, 26, sea);
    for (let i = 0; i < 3; i++) {
      const wy = HORIZON - 22 + i * 7;
      const fc = night ? C565(0x3a, 0x58, 0x78) : C565(0xbf, 0xe6, 0xf5);
      gfx.fillRect(60 + ((Math.floor(now / 60) + i * 30) % 60), wy, 26, 2, fc);
      gfx.fillRect(300 - ((Math.floor(now / 60) + i * 20) % 60), wy, 26, 2, fc);
    }
  }

  gfx.fillRect(0, HORIZON, W, H - HORIZON, soil);
  const hill = lerp565(soil, night ? C565(0x0c, 0x12, 0x24) : C565(0xff, 0xff, 0xff), 3, 16);
  gfx.fillRoundRect(-60, HORIZON - 14, 586, 60, 30, hill);

  const dk = lerp565(soil, C565(0x10, 0x18, 0x20), night ? 11 : 7, 16);
  if (biome === 2) {
    for (const tx of [60, 150, 360, 416]) {
      gfx.fillTriangle(tx, HORIZON - 46, tx - 16, HORIZON, tx + 16, HORIZON, dk);
      gfx.fillTriangle(tx, HORIZON - 60, tx - 12, HORIZON - 28, tx + 12, HORIZON - 28, dk);
    }
  } else if (biome === 3) {
    gfx.fillTriangle(70, HORIZON, 40, HORIZON + 30, 100, HORIZON + 30, dk);
    gfx.fillTriangle(400, HORIZON + 4, 372, HORIZON + 30, 430, HORIZON + 30, dk);
    if (!night)
      for (let e = 0; e < 4; e++) gfx.fillRect(120 + e * 70, HORIZON + 8 + (e % 2) * 6, 4, 4, C565(0xff, 0x9b, 0x3a));
  } else if (biome === 4) {
    gfx.fillTriangle(140, HORIZON - 50, 60, HORIZON, 220, HORIZON, dk);
    gfx.fillTriangle(330, HORIZON - 38, 250, HORIZON, 410, HORIZON, dk);
  } else if (biome === 5 && !night) {
    for (let f = 0; f < 14; f++) {
      const fx = (f * 53 + Math.floor(now / 40)) % W;
      const fy = (f * 90 + Math.floor(now / 18)) % H;
      gfx.fillRect(fx, fy, 3, 3, UI_WHITE);
    }
  } else if (biome === 0) {
    for (const gx of [80, 175, 300, 395])
      for (let b = -1; b <= 1; b++) gfx.fillRect(gx + b * 5, HORIZON + 6, 2, 8 + (b === 0 ? 4 : 0), dk);
  }
}

// ---------- the stage ----------
function renderStage() {
  layoutStage();
  if (gameOpen) return renderGame();
  if (sackOpen) return renderSack();

  drawScene(pet.isEgg() ? 0 : DEX[pet.speciesId].biome, millis(), gNight);
  if (pet.ceremony) return drawCeremony();

  if (pet.isEgg()) {
    const room = GROUND - 110;
    const s = room >= 300 ? 6 : room >= 160 ? 5 : 4, x = CX - 16 * s, y = GROUND - 8 - 32 * s;
    drawMap('EGG', x, y, s, false);
    if (pet.eggCracks() >= 1) for (const c of CRACK1) gfx.fillRect(x + c[0] * s, y + c[1] * s, s, s, INK_K);
    if (pet.eggCracks() >= 2) for (const c of CRACK2) gfx.fillRect(x + c[0] * s, y + c[1] * s, s, s, INK_K);
    return;
  }
  drawPet();
  drawBath();
  drawPoops();
  if (pet.sleeping) {
    gfx.setTextColor(UI_INK_NIGHT);
    setSize(3);
    setCur(320, GROUND - 174);
    printT('Zz');
  }
}

// ---------- ball minigame ----------
const BALL_R = 24;
// Difficulty (phone only; the firmware's values are in the comments). Tuned
// harder than the device: a tighter hit area, a heavier ball and a ramp that
// keeps going: the time between taps goes from ~2.3 s at the start to ~1.7 s
// from score 25 (the firmware stays at ~2.8 s until 16, then ~2.2 s).
const GAME = {
  hitR: 44,          // tap distance that counts as a hit (fw 74)
  grav0: 0.5,        // gravity at score 0 (fw 0.4)
  gravStep: 0.02,    // extra gravity per point (fw 0.013)
  gravMax: 1.0,      // (fw 0.8)
  lift0: 7.0,        // upward kick per tap (fw 6.6)
  liftStep: 0.15,    // extra kick per point (fw 0.22)
  liftCapScore: 20,  // the kick stops growing here (fw 16, then a flat +3.5)
  side0: 2.0,        // sideways speed of a new ball (fw 1.6)
  sideStep: 0.08,    // (fw 0.05)
  sideMax: 5.0,      // (fw 4)
  spin: 0.14,        // how much an off-centre tap pushes it sideways (fw 0.12)
  spinMax: 8.0,      // (fw 6.5)
  extraAt: [5, 15, 30], // scores where one more ball joins (phone only: max 4 at once)
  speed0: 1.5,       // plays the whole game this much faster: same arcs, less time (fw 1)
  speedStep: 0.01,   // ...and a bit faster with every point
  speedMax: 2.0,     // reached at score 50
};
function startGame() {
  if (pet.isEgg() || pet.sleeping || pet.ceremony) return;
  gameOpen = true;
  gameOverUntil = 0;
  gameScore = 0;
  gameMisses = 0;
  gameNewHi = false;
  hitTime = 0;
  extraBallAt = 0;
  gamePetX = CX;
  lastGameStep = millis();
  balls = [newBall()];
}

function newBall() {
  const sp = Math.min(GAME.side0 + gameScore * GAME.sideStep, GAME.sideMax);
  return { x: 150 + random(166), y: 150, vx: random(2) ? sp : -sp, vy: 0 };
}

// one tap hits the nearest ball in reach
function gameTap(x, y) {
  if (gameOverUntil) return;
  let hit = null, best = GAME.hitR * GAME.hitR;
  for (const b of balls) {
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d < best) { best = d; hit = b; }
  }
  if (!hit) return;
  const dx = hit.x - x;
  gameScore++;
  sfxPlay(SFX_PLAY);
  hit.vy = -(GAME.lift0 + Math.min(gameScore, GAME.liftCapScore) * GAME.liftStep);
  hit.vx += dx * GAME.spin;
  if (hit.vx > GAME.spinMax) hit.vx = GAME.spinMax;
  if (hit.vx < -GAME.spinMax) hit.vx = -GAME.spinMax;
  hitX = hit.x;
  hitY = hit.y;
  hitTime = millis();
  if (balls.length <= GAME.extraAt.length && gameScore >= GAME.extraAt[balls.length - 1]) {
    balls.push(newBall());
    extraBallAt = millis();
  }
}

function stepGame() {
  const now = millis();
  let k = lastGameStep ? (now - lastGameStep) / 85 : 1;
  if (k > 3) k = 3;
  k *= Math.min(GAME.speed0 + gameScore * GAME.speedStep, GAME.speedMax);
  lastGameStep = now;
  const grav = Math.min(GAME.grav0 + gameScore * GAME.gravStep, GAME.gravMax);
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    b.vy += grav * k;
    b.x += b.vx * k;
    b.y += b.vy * k;
    // the round screen's rim becomes the phone's walls and ceiling
    if (b.x < BALL_R) { b.x = BALL_R; if (b.vx < 0) b.vx *= -0.85; }
    if (b.x > W - BALL_R) { b.x = W - BALL_R; if (b.vx > 0) b.vx *= -0.85; }
    if (b.y < BALL_R) { b.y = BALL_R; if (b.vy < 0) b.vy *= -0.85; }
    if (b.y > H - 82) {
      // every dropped ball costs a life; only that ball starts over
      if (++gameMisses >= 3) {
        gameNewHi = gameScore > pet.gameHi;
        pet.playResult(gameScore);
        sfxPlay(gameNewHi && gameScore > 0 ? SFX_MEDAL : SFX_LEVEL);
        gameOverUntil = millis() + 4000;
        return;
      }
      balls[i] = newBall();
    }
  }
  // the pet runs under the ball that is closest to falling
  const low = balls.reduce((a, b) => (b.y > a.y ? b : a));
  let chase = (low.x - gamePetX) * 0.12;
  if (chase > 7) chase = 7;
  if (chase < -7) chase = -7;
  gamePetX += chase * k;
}

function drawGameScene() {
  const hh = sceneHour();
  const night = hh < 6 || hh >= 20;
  const [top, bot] = skyColors(hh, night);
  const hor = H - 90;
  for (let y = 0; y < hor; y += 8) gfx.fillRect(0, y, W, 8, lerp565(top, bot, y, hor));
  if (night) for (const [sx, sy] of STARS) gfx.fillRect(sx, sy + 40, 4, 4, UI_WHITE);
  const bio = pet.isEgg() ? 0 : DEX[pet.speciesId].biome;
  let soil = BIOME_SOIL[bio < 6 ? bio : 0];
  if (night) soil = lerp565(soil, C565(0x16, 0x1c, 0x30), 9, 16);
  gfx.fillRect(0, hor, W, H - hor, soil);
}

function renderGame() {
  const night = sceneHour() < 6 || sceneHour() >= 20;
  const ink = night ? UI_INK_NIGHT : UI_INK;
  const oy = Math.round((H - 466) / 2); // centre the firmware's result screen

  if (gameOverUntil) {
    drawGameScene();
    if (!timeLeft(gameOverUntil)) { gameOpen = false; return; }
    const buf = fmt(T(S.SCORE_FMT), gameScore);
    gfx.setTextColor(ink);
    setSize(4);
    setCur(centerX(buf, 4), oy + 160);
    printT(buf);
    setSize(2);
    if (gameNewHi && gameScore > 0) {
      gfx.setTextColor(UI_BAR_WARN);
      setCur(centerX(T(S.NEW_RECORD), 2), oy + 214);
      printT(T(S.NEW_RECORD));
    } else {
      const rec = fmt(T(S.RECORD_FMT), pet.gameHi);
      gfx.setTextColor(ink);
      setCur(centerX(rec, 2), oy + 214);
      printT(rec);
    }
    const msg = gameScore >= 10 ? T(S.GREAT_JOY) : T(S.PLUS_JOY);
    gfx.setTextColor(ink);
    setCur(centerX(msg, 2), oy + 250);
    printT(msg);
    return;
  }

  drawGameScene();
  stepGame();
  if (!gameOpen || gameOverUntil) return;

  const buf = String(gameScore);
  gfx.setTextColor(ink);
  setSize(4);
  setCur(centerX(buf, 4), 24);
  printT(buf);
  const rec = fmt(T(S.REC_FMT), pet.gameHi);
  setSize(2);
  setCur(centerX(rec, 2), 70);
  printT(rec);
  for (let i = 0; i < 3; i++) {
    if (i < 3 - gameMisses) gfx.fillCircle(CX - 28 + i * 28, 100, 6, UI_BAR_BAD);
    else gfx.drawCircle(CX - 28 + i * 28, 100, 6, UI_TRACK);
  }
  if (gameScore === 0) {
    const hint = P('TAP_BALL');
    setSize(2);
    setCur(centerX(hint, 2), 128);
    printT(hint);
  }

  // a new ball joined: "+1 (ball)" for a moment
  if (extraBallAt && millis() - extraBallAt < 1500 && Math.floor((millis() - extraBallAt) / 150) % 2 === 0) {
    gfx.setTextColor(UI_BAR_WARN);
    setSize(3);
    setCur(CX - 44, 158);
    printT('+1');
    drawMap('ICON_PLAY', CX + 4, 150, 2, false);
  }

  if (pmd.loaded) {
    const low = balls.reduce((a, b) => (b.y > a.y ? b : a));
    let act = low.x > gamePetX + 4 ? PMD_WALKR : low.x < gamePetX - 4 ? PMD_WALKL : PMD_IDLE;
    if (!pmd.has(act)) act = PMD_IDLE;
    drawPmdAct(act, Math.trunc(gamePetX), H - 72, millis(), true, false, 3);
  }

  const ht = millis() - hitTime;
  if (hitTime && ht < 260) {
    const rad = 22 + Math.floor(ht / 6);
    gfx.drawCircle(hitX, hitY, rad, C565(0xff, 0xe7, 0x9f));
    gfx.drawCircle(hitX, hitY, rad - 2, C565(0xff, 0xd9, 0x8a));
  }
  for (const b of balls) drawMap('ICON_PLAY', b.x - 24, b.y - 24, 3, false);
}

// ---------- punching bag (trains strength) ----------
function startSack() {
  if (pet.isEgg() || pet.sleeping || pet.ceremony) return;
  sackOpen = true;
  sackUntil = millis() + 10000;
  sackOverUntil = 0;
  sackHits = 0;
  sackShake = 0;
  sackNewHi = false;
}

function sackTap() {
  if (!timeLeft(sackUntil)) return;
  sackHits++;
  sackShake = 16;
}

function renderSack() {
  const now = millis();
  drawGameScene();
  const night = sceneHour() < 6 || sceneHour() >= 20;
  const ink = night ? UI_INK_NIGHT : UI_INK;
  const oy = Math.round((H - 466) / 2);

  if (sackOverUntil) {
    if (!timeLeft(sackOverUntil)) { sackOpen = false; return; }
    const b = fmt(T(S.HITS_FMT), sackHits);
    gfx.setTextColor(ink);
    setSize(4);
    setCur(centerX(b, 4), oy + 150);
    printT(b);
    const g = fmt(T(S.STR_GAIN_FMT), sackGain);
    gfx.setTextColor(UI_BAR_BAD);
    setSize(3);
    setCur(centerX(g, 3), oy + 210);
    printT(g);
    setSize(2);
    if (sackNewHi && sackHits > 0) {
      gfx.setTextColor(UI_BAR_WARN);
      setCur(centerX(T(S.NEW_RECORD), 2), oy + 256);
      printT(T(S.NEW_RECORD));
    } else {
      const r = fmt(T(S.RECORD_FMT), pet.strHi);
      gfx.setTextColor(ink);
      setCur(centerX(r, 2), oy + 256);
      printT(r);
    }
    return;
  }

  if (!timeLeft(sackUntil)) {
    sackNewHi = sackHits > pet.strHi;
    sackGain = pet.trainStrength(sackHits);
    sfxPlay(sackNewHi ? SFX_MEDAL : SFX_PLAY);
    sackOverUntil = now + 3500;
    return;
  }

  sackShake *= Math.pow(0.84, frameDt / 85);
  const off = Math.trunc(sackShake * Math.sin(now * 0.05));
  const sx = CX + off, top = oy + 86;
  gfx.fillRect(CX - 3, 0, 6, top, ink);
  gfx.fillRect(sx - 4, top - 30, 8, 34, ink);
  gfx.fillRoundRect(sx - 42, top, 84, 150, 26, C565(0xb5, 0x3a, 0x3a));
  gfx.fillRoundRect(sx - 42, top, 84, 22, 18, C565(0x7e, 0x28, 0x28));
  gfx.drawRoundRect(sx - 42, top, 84, 150, 26, ink);
  gfx.fillRect(sx - 42, top + 70, 84, 4, C565(0x7e, 0x28, 0x28));

  const buf = String(sackHits);
  gfx.setTextColor(ink);
  setSize(6);
  setCur(centerX(buf, 6), oy + 268);
  printT(buf);
  setSize(2);
  setCur(centerX(T(S.HIT_FAST), 2), oy + 322);
  printT(T(S.HIT_FAST));

  const left = sackUntil - now;
  const bw = 280, fw = Math.floor((bw * left) / 10000);
  gfx.fillRoundRect(CX - bw / 2, oy + 350, bw, 16, 5, UI_TRACK);
  if (fw > 2) gfx.fillRoundRect(CX - bw / 2, oy + 350, fw, 16, 5, UI_BAR_OK);
}

// ---------- ceremonies ----------
// farewell: bow with hearts, then walks off. Runaway: flinches in the rain and leaves.
function drawCeremony() {
  if (!pmd.loaded) { drawPet(); return; }
  const now = millis();
  const t = pet.ceremonyT();
  const panic = pet.ceremony === CER_RUNAWAY;
  let x = CX;
  const y = GROUND;
  let act = PMD_IDLE;

  if (panic) {
    for (let i = 0; i < 60; i++) {
      const rx = (i * 47 + Math.floor(now / 3)) % W;
      const ry = (i * 91 + Math.floor(now / 2)) % (H + 4);
      gfx.drawLine(rx, ry, rx - 3, ry + 12, C565(0x6a, 0x84, 0xb0));
    }
    let fade = false;
    if (t < 0.3) {
      act = pmd.has(PMD_HURT) ? PMD_HURT : PMD_IDLE;
      x = CX + Math.trunc(4 * Math.sin(now * 0.04));
    } else {
      act = pmd.has(PMD_WALKL) ? PMD_WALKL : PMD_IDLE;
      x = CX - Math.trunc(((t - 0.3) / 0.7) * (CX + 120));
      fade = t > 0.6 && Math.floor(now / 160) % 2 === 0;
    }
    drawPmdAct(act, x, y, now, true, fade, 5);
    if (t < 0.55) {
      const ty = y - 150 + (Math.floor(now / 6) % 40);
      gfx.fillRect(x + 6, ty, 3, 6, C565(0x9a, 0xc4, 0xe8));
    }
    return;
  }

  const gcy = GROUND - 96;
  for (let k = 0; k < 4; k++) {
    const r = 60 + k * 34 + Math.trunc(10 * Math.sin(now * 0.02));
    gfx.drawCircle(CX, gcy, r, C565(0xff, 0xdf, 0x8a));
  }
  const span = H - 106;
  for (let i = 0; i < 16; i++) {
    const px = (i * 71 + 28) % W;
    const py = H - 56 - ((Math.floor(now / 8) + i * 70) % span);
    if (i % 4 === 0) drawMap('HEART', px - 8, py - 8, 1, false);
    else gfx.fillRect(px, py, 4, 4, i % 2 ? C565(0xff, 0xe7, 0x9f) : C565(0xff, 0x9a, 0xc0));
  }
  if (t < 0.45) act = pmd.has(PMD_POSE) ? PMD_POSE : pmd.has(PMD_NOD) ? PMD_NOD : PMD_IDLE;
  else {
    act = pmd.has(PMD_WALKR) ? PMD_WALKR : PMD_IDLE;
    x = CX + Math.trunc(((t - 0.45) / 0.55) * (CX + 140));
  }
  drawPmdAct(act, x, y, now, true, false, 5);
  if (pet.showHeart()) drawMap('HEART', x + 50, y - 190, 2, false);
}

function drawEvolveFX(now) {
  const t = pet.evolveT();
  const cx = CX, cy = GROUND - 96;
  const halo = 36 + Math.trunc(t * 150) + Math.trunc(8 * Math.sin(now * 0.02));
  for (let k = 0; k < 4; k++) {
    const r = halo - k * 7;
    if (r > 0) gfx.drawCircle(cx, cy, r, UI_WHITE);
  }
  const base = now * 0.004;
  for (let i = 0; i < 12; i++) {
    const a = base + (i * Math.PI) / 6;
    const len = 90 + Math.trunc(70 * (0.5 + 0.5 * Math.sin(now * 0.012 + i)));
    gfx.drawLine(cx, cy, cx + Math.trunc(Math.cos(a) * len), cy + Math.trunc(Math.sin(a) * len), UI_WHITE);
  }
  const period = 60 + Math.trunc(220 * (1 - t));
  const showOld = t < 0.9 && evoPmd.loaded && Math.floor(now / period) % 2 === 0;
  if (showOld) drawPmdActM(evoPmd, PMD_IDLE, cx, GROUND, 0, true, true, 5);
  else drawPmdAct(PMD_IDLE, cx, GROUND, 0, true, true, 5);
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 + t * 4;
    const d = (Math.floor(now / 14) + i * 33) % 200;
    const sx = cx + Math.trunc(Math.cos(a) * d), sy = cy + Math.trunc(Math.sin(a) * d);
    gfx.fillRect(sx - 2, sy - 2, 5, 5, i & 1 ? C565(0xff, 0xe0, 0x70) : UI_WHITE);
  }
  if (t > 0.9) gfx.fillCircle(cx, cy, Math.trunc((600 * (t - 0.9)) / 0.1), UI_WHITE);
}

function drawPet() {
  if (pmd.loaded) return drawPetPMD();
  if (pet.evolving()) return drawEvolveFX(millis());
  if (!pmd.failed) return; // still downloading
  const y = GROUND - 110;
  gfx.setTextColor(inkColor());
  setSize(6);
  setCur(CX - 18, y - 80);
  printT('?');
  setSize(2);
  const l1 = T(S.NO_SPRITES);
  setCur(centerX(l1, 2), y - 4);
  printT(l1);
  const l2 = 'Check your connection';
  setCur(centerX(l2, 2), y + 20);
  printT(l2);
}

// ---------- bath ----------
function startBath() {
  if (pet.isEgg() || pet.sleeping || pet.ceremony || bathUntil) return;
  bathUntil = millis() + 3000;
  bathPending = true;
  const cx = Math.trunc(beh.x);
  for (const b of bubbles) {
    b.x = cx - 70 + random(140);
    b.y = GROUND - random(150);
    b.r = 8 + random(16);
    b.ph = random(64);
  }
}

function drawBath() {
  const now = millis();
  if (!timeLeft(bathUntil)) {
    bathUntil = 0;
    if (bathPending) {
      bathPending = false;
      pet.clean();
      if (pmd.has(PMD_POSE)) {
        beh.mode = 2;
        beh.act = PMD_POSE;
        beh.t0 = now;
        beh.until = now + pmdActTotalMs(pmd.acts[PMD_POSE]) * 2;
      }
    }
    return;
  }
  const left = bathUntil - now;
  if (left > 800) {
    const t = now / 220;
    for (const b of bubbles) {
      const bx = b.x + Math.trunc(Math.sin(t + b.ph) * 6);
      const by = b.y - Math.trunc((3000 - left) / 90);
      gfx.fillCircle(bx, by, b.r, UI_WHITE);
      gfx.drawCircle(bx, by, b.r, 0x7e3d);
      gfx.fillCircle(bx - Math.trunc(b.r / 3), by - Math.trunc(b.r / 3), Math.trunc(b.r / 4), UI_BG_DAY);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const b = bubbles[i];
      const sx = b.x + (i % 3) * 6 - 6, sy = b.y - 18;
      const col = i % 2 ? UI_BAR_WARN : UI_WHITE;
      gfx.fillRect(sx - 6, sy - 1, 13, 3, col);
      gfx.fillRect(sx - 1, sy - 6, 3, 13, col);
    }
  }
}

// ---------- PMD pet: behaviour ----------
// Scale is a whole number: the idle pose aims for ~170 units of visible sprite
// (more on tall stages), never over maxS, and no pose may reach into the header.
function drawPmdActM(m, actId, cx, groundY, t, loop, sil, maxS) {
  const a = m.acts[actId];
  if (!a.frames) return;
  const room = groundY - 96;
  const target = Math.max(110, Math.min(220, room * 0.72));
  const idle = m.acts[PMD_IDLE];
  const visH = (x) => (x.base || x.h) - x.top; // opaque rows only
  let sBase = idle.h ? Math.floor(target / visH(idle)) : 5;
  if (sBase < 2) sBase = 2;
  if (room > 420) maxS++; // a tall stage has room for one more step
  if (sBase > maxS) sBase = maxS;
  let s = sBase;
  while (s > 2 && visH(a) * s > Math.min(250, room)) s--;
  const fi = pmdFrameAt(a, t, loop);
  const x0 = cx - Math.trunc((a.w * s) / 2), y0 = groundY - (a.base || a.h) * s;
  gfx.blit(m.frameCanvas(actId, fi, sil), x0, y0, a.w * s, a.h * s);
}
const drawPmdAct = (actId, cx, groundY, t, loop, sil, maxS) => drawPmdActM(pmd, actId, cx, groundY, t, loop, sil, maxS);

function behNext() {
  const now = millis();
  beh.t0 = now;
  const r = random(100);
  if (r < 35 && (pmd.has(PMD_WALKL) || pmd.has(PMD_WALKR))) {
    beh.mode = 1;
    beh.targetX = 130 + random(206);
    beh.until = now + 15000;
  } else if (r < 60) {
    const pick = [PMD_POSE, PMD_NOD, PMD_BREATH].filter((f) => pmd.has(f));
    if (pick.length) {
      beh.mode = 2;
      beh.act = pick[random(pick.length)];
      beh.until = now + pmdActTotalMs(pmd.acts[beh.act]);
      return;
    }
    beh.mode = 0;
    beh.until = now + 2000 + random(3000);
  } else {
    beh.mode = 0;
    beh.until = now + 2000 + random(3000);
  }
}

function drawPetPMD() {
  const now = millis();
  if (pet.evolving()) { drawEvolveFX(now); return; }
  if (evoPmd.loaded) evoPmd.unload();

  const m = pet.mood();
  let act, loop = true;
  if (m === MOOD_SLEEPING && pmd.has(PMD_SLEEP)) {
    act = PMD_SLEEP;
    beh.mode = 0;
  } else if (m === MOOD_EATING && pmd.has(PMD_EAT)) {
    act = PMD_EAT;
    beh.t0 = 0;
  } else if (m === MOOD_SAD && pmd.has(PMD_HURT)) {
    act = PMD_HURT;
  } else {
    if (now > beh.until) behNext();
    if (beh.mode === 1) {
      const d = beh.targetX - beh.x;
      if (Math.abs(d) < 4) {
        behNext();
        act = PMD_IDLE;
      } else {
        // 3 px per 100 ms frame on the board
        const step = Math.min(Math.abs(d), (3 * frameDt) / 100);
        beh.x += d > 0 ? step : -step;
        act = d > 0 ? PMD_WALKR : PMD_WALKL;
      }
    } else {
      act = beh.mode === 2 ? beh.act : PMD_IDLE;
      loop = false;
    }
    if (!pmd.has(act)) act = PMD_IDLE;
  }
  drawPmdAct(act, Math.trunc(beh.x), GROUND, now - beh.t0, loop || act === PMD_IDLE, false, 5);
  if (pet.showHeart()) drawMap('HEART', Math.trunc(beh.x) + 50, GROUND - 190, 2, false);
}

function drawPoops() {
  for (let i = 0; i < pet.poops; i++) drawMap('POOP', 36 + i * 46, GROUND - 52, 2, false);
}

function eggMsg() {
  switch (pet.eggCracks()) {
    case 0: return T(S.EGG_TOUCH);
    case 1: return T(S.EGG_MOVES);
    default: return T(S.EGG_ALMOST);
  }
}

function statusMsg() {
  if (pet.evolving()) return T(S.EVOLVING);
  if (bathUntil) return 'Splish splash!';
  if (pet.sleeping) return 'Zzz...';
  if (pet.eating()) return T(S.EATING);
  if (pet.showHeart()) return T(S.LIKES);
  if (pet.fullness < 25) return T(S.HUNGRY);
  if (pet.hygiene < 25) return T(S.NEEDS_BATH);
  if (pet.energy < 25) return T(S.EXHAUSTED);
  if (pet.joy < 25) return T(S.SAD);
  if (pet.weight > 60) return T(S.CHUBBY);
  if (pet.shiny && pet.ageMinutes < 15) return T(S.IS_SHINY);
  return T(S.HAPPY);
}

// ---------- app lifecycle: backgrounding counts as "powered off" ----------
function onHide() {
  pet.lastSeenEpoch = epochNow();
  pet.save();
  scheduleReminders();
}
function onShow() {
  // time away: merciful offline progression (floors, no slip-ups), like the board's RTC catch-up
  if (pet.syncClock(epochNow()) > 0) pet.lastTick = millis();
  pushCancel();
  gfx.resize();
}

// push reminders while the app is away: the first need that runs low, then a
// "misses you" a few hours later (not while it sleeps: its needs have floors)
const NEED_MSG = { food: S.HUNGRY, hygiene: S.NEEDS_BATH, energy: S.EXHAUSTED, joy: S.SAD };
function scheduleReminders() {
  if (!pushEnabled()) return;
  const events = [];
  const now = Date.now();
  const say = (at, id) => events.push({ at: outOfQuietHours(at), title: 'TamaPoke', body: `${petName()}: ${T(id)}` });
  const f = firstNeed(pet);
  if (f) say(now + f.minutes * 60000, NEED_MSG[f.need]);
  if (!pet.sleeping && !pet.isEgg() && !pet.ceremony && !pet.awaitingStarter()) {
    say((events.length ? events[0].at : now) + 4 * 3600000, S.SAD);
  }
  pushSchedule(events);
}
document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
window.addEventListener('pagehide', onHide);

// debug hooks for the browser console (like the firmware's serial commands)
window.tamapoke = {
  pet, sfxPlay,
  game: () => ({ open: gameOpen, over: !!gameOverUntil, balls: balls.map((b) => ({ x: b.x, y: b.y })), score: gameScore, misses: gameMisses, W, H }),
};

await document.fonts.load('12px "PressStart2P"').catch(() => {});
setup();
requestAnimationFrame(loop);
