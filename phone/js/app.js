// Port of TamaPoke.ino (UI, gestures, minigames) for phones. Drawing code keeps
// the firmware's 466x466 coordinates so every screen matches the device.
import { DEX, FW_VERSION } from './data.js';
import {
  Pet, millis, random, timeLeft, MINUTES_PER_LEVEL, CER_FAREWELL, CER_RUNAWAY,
  MOOD_HAPPY, MOOD_SAD, MOOD_EATING, MOOD_SLEEPING, R_RARO, R_LEGENDARIO, MED_COUNT,
  SFX_TAP, SFX_EAT, SFX_PLAY, SFX_HEART, SFX_MEDAL, SFX_DENY, SFX_LEVEL,
} from './pet.js';
import {
  PmdMon, Thumbs, pmdActTotalMs, pmdFrameAt, INK_K,
  PMD_IDLE, PMD_WALKL, PMD_WALKR, PMD_SLEEP, PMD_EAT, PMD_HURT, PMD_POSE, PMD_NOD, PMD_BREATH,
} from './sprites.js';
import {
  Gfx, C565, lerp565, W, UI_BG_DAY, UI_BG_NIGHT, UI_INK, UI_INK_NIGHT, UI_TRACK,
  UI_BAR_OK, UI_BAR_WARN, UI_BAR_BAD, UI_WHITE, BLACK,
} from './gfx.js';
import { S, T, fmt, dexName, medalName, medalLabel, medalDesc, LANG_CODES, getLang, setLang, isCjk } from './i18n.js';
import { sfxPlay, audioUnlock, audioEnabled, audioSetEnabled, audioSetSleeping } from './audio.js';

const canvas = document.getElementById('screen');
const gfx = new Gfx(canvas);
gfx.cjk = isCjk();
const pet = new Pet(sfxPlay);
let pmd = new PmdMon();       // current pet, multi-action sprite
let evoPmd = new PmdMon();    // previous form during the evolution flash
const galleryPmd = new PmdMon();
const thumbs = new Thumbs();
let monFor = -2, monShinyFor = false;

const CX = 233, CY = 233, PET_GROUND = 304, HORIZON = 232;

// on-screen behaviour of the pet
const beh = { mode: 0, act: PMD_IDLE, t0: 0, until: 0, x: 233, targetX: 233 };

let galleryOpen = false, galleryPage = 0, galleryDetail = 0;
let cardOpen = false, kbOpen = false, nameBuf = '', cardPage = 0, clockOpen = false;
let bathUntil = 0, bathPending = false;
const bubbles = Array.from({ length: 14 }, () => ({ x: 0, y: 0, r: 0, ph: 0 }));
let feedMenuUntil = 0;
// ball minigame
let gameOpen = false, gameOverUntil = 0, ballX = 0, ballY = 0, ballVX = 0, ballVY = 0, gamePetX = 233;
let lastGameStep = 0, gameScore = 0, gameMisses = 0, hitX = 0, hitY = 0, hitTime = 0, gameNewHi = false;
// punching bag
let sackOpen = false, sackUntil = 0, sackOverUntil = 0, sackHits = 0, sackShake = 0, sackGain = 0, sackNewHi = false;

const buttons = [
  { cx: 140, cy: 390, icon: 'ICON_FOOD' },
  { cx: 202, cy: 404, icon: 'ICON_PLAY' },
  { cx: 264, cy: 404, icon: 'ICON_LIGHT' },
  { cx: 326, cy: 390, icon: 'ICON_CLEAN' },
];
const BTN_HALF = 26, BTN_HIT = 36;
const CRACK1 = [[15, 8], [16, 9], [15, 10]];
const CRACK2 = [[11, 13], [12, 14], [11, 15], [20, 12], [19, 13], [20, 14]];
const STARS = [[120, 140], [330, 120], [370, 210], [95, 230], [280, 90], [160, 95]];
const STARTER_DEX = [1, 4, 7];
const STARTER_ROW_Y = 110, STARTER_ROW_H = 70, STARTER_ROW_GAP = 8;
const EVO_BTN_W = 256, EVO_BTN_H = 64, EVO_BTN_X = CX - EVO_BTN_W / 2, EVO_BTN_Y = 172;
const FAR_BTN_W = 408, FAR_BTN_H = 58, FAR_BTN_X = CX - FAR_BTN_W / 2, FAR_BTN_Y = 176;

let confirmUntil = 0, choiceKind = 0, choiceUntil = 0;
// gesture in progress
let pressed = false, tX0 = 0, tY0 = 0, tXl = 0, tYl = 0, tStart = 0, holdFired = false;
let gNight = false;
let frameDt = 100; // ms since the previous frame (the firmware ran at a fixed 10 fps)

// local wall-clock time as an epoch, like the board's RTC (which holds local time)
const epochNow = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 1000);

// ---------- text helpers (same names as the firmware) ----------
const setSize = (n) => gfx.setTextSize(n);
const setCur = (x, y) => gfx.setCursor(x, y);
const printT = (s) => gfx.print(s);
const textW = (s, n) => gfx.textW(s, n);
const centerX = (s, n) => gfx.centerX(s, n);
const inkColor = () => (gNight ? UI_INK_NIGHT : UI_INK);
const drawMap = (name, x, y, s, sil) => gfx.drawMap(name, x, y, s, sil);

// ---------- setup ----------
function setup() {
  pet.begin();
  thumbs.load();
  pet.syncClock(epochNow());
  if (!pet.awaitingStarter() && !pet.isEgg()) ensureMon();
}

function ensureMon() {
  if (pet.speciesId === monFor && monShinyFor === pet.shiny) return;
  monFor = pet.speciesId;
  monShinyFor = pet.shiny;
  beh.x = beh.targetX = 233;
  beh.mode = 0;
  beh.until = 0;
  if (pet.speciesId >= 1 && pet.speciesId <= 151) pmd.load(pet.speciesId, pet.shiny);
  else pmd.unload();
}

let wasEvoReady = false, wasRunReady = false, lastClock = 0, lastFrame = 0;

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
  render();
  requestAnimationFrame(loop);
}

// ---------- touch ----------
const inPetZone = (x, y) => x > 110 && x < 356 && y > 95 && y < 310;

function toScreen(e) {
  const r = canvas.getBoundingClientRect();
  return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * W)];
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audioUnlock();
  const [x, y] = toScreen(e);
  if (sackOpen) { // every tap counts immediately (mash fast)
    if (y < 72) sackOpen = false;
    else sackTap();
    return;
  }
  pressed = true;
  canvas.setPointerCapture(e.pointerId);
  tX0 = tXl = x;
  tY0 = tYl = y;
  tStart = millis();
  holdFired = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (!pressed) return;
  [tXl, tYl] = toScreen(e);
});
function endGesture() {
  if (!pressed) return;
  pressed = false;
  const dx = tXl - tX0, dy = tYl - tY0, dt = millis() - tStart;
  if (holdFired) return;
  if (Math.abs(dx) > 80 && Math.abs(dy) < 70 && dt < 800) onSwipe(dx > 0 ? 1 : -1);
  else if (Math.abs(dy) > 80 && Math.abs(dx) < 70 && dt < 800) onSwipeV(dy > 0 ? 1 : -1);
  else if (dt < 1500 && Math.abs(dx) < 40 && Math.abs(dy) < 40) onTap(tX0, tY0);
}
canvas.addEventListener('pointerup', (e) => { if (pressed) [tXl, tYl] = toScreen(e); endGesture(); });
canvas.addEventListener('pointercancel', () => { pressed = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// holding still on the pet for 3 s -> "release?" dialog
function checkLongPress() {
  if (!pressed || holdFired || galleryOpen || cardOpen || kbOpen || clockOpen || gameOpen) return;
  if (millis() - tStart > 3000 && Math.abs(tXl - tX0) < 30 && Math.abs(tYl - tY0) < 30 &&
      inPetZone(tX0, tY0) && !pet.isEgg() && !confirmUntil && !pet.ceremony && !pet.awaitingStarter()) {
    confirmUntil = millis() + 10000;
    holdFired = true;
    if (navigator.vibrate) navigator.vibrate(30);
  }
}

function onSwipeV(dir) {
  if (pet.awaitingStarter()) return;
  if (gameOpen || galleryOpen || kbOpen || sackOpen || pet.ceremony) return;
  if (clockOpen) { clockOpen = false; return; }
  if (cardOpen) {
    if (dir < 0) cardOpen = false;
    return;
  }
  if (dir > 0) {
    if (!confirmUntil && !feedMenuUntil) clockOpen = true;
  } else if (!pet.isEgg() && !confirmUntil && !feedMenuUntil) {
    cardOpen = true;
    cardPage = 0;
  }
}

function onSwipe(dir) {
  if (pet.awaitingStarter()) return;
  if (gameOpen || kbOpen || clockOpen) return;
  if (cardOpen) {
    const p = cardPage + (dir > 0 ? -1 : 1);
    cardPage = p < 0 ? 0 : p > 3 ? 3 : p;
    return;
  }
  if (!galleryOpen) {
    if (!pet.ceremony && !confirmUntil) {
      galleryOpen = true;
      galleryPage = 0;
      galleryDetail = 0;
    }
    return;
  }
  if (galleryDetail) {
    galleryDetail = 0;
    galleryPmd.unload();
    return;
  }
  let np = galleryPage - dir;
  if (np < 0) {
    galleryOpen = false;
    galleryPmd.unload();
    return;
  }
  if (np > 9) np = 9;
  galleryPage = np;
}

function onTap(x, y) {
  if (pet.awaitingStarter()) {
    for (let i = 0; i < 3; i++) {
      const ry = STARTER_ROW_Y + i * (STARTER_ROW_H + STARTER_ROW_GAP);
      if (x >= 70 && x <= 396 && y >= ry && y <= ry + STARTER_ROW_H) {
        pet.chooseStarter(STARTER_DEX[i]);
        sfxPlay(SFX_TAP);
        break;
      }
    }
    return;
  }
  if (galleryOpen) return galleryTap(x, y);
  if (kbOpen) return keyboardTap(x, y);
  if (clockOpen) return clockTap(x, y);
  if (pet.ceremony) return;
  if (cardOpen) {
    if (cardPage === 0 && y < 84) openKeyboard();
    else if (cardPage === 1 && y >= 300 && y <= 340 && x >= 96 && x <= 370) {
      cardOpen = false;
      startSack();
    } else cardOpen = false;
    return;
  }
  if (gameOpen) return gameTap(x, y);
  if (choiceKind) {
    const b1 = x >= 93 && x <= 373 && y >= 206 && y <= 258;
    const b2 = x >= 93 && x <= 373 && y >= 268 && y <= 320;
    if (choiceKind === 1) {
      if (b1) {
        // keep the old form's sprite for the flashing silhouettes
        const old = pmd;
        pmd = evoPmd;
        evoPmd = old;
        pmd.unload();
        monFor = -2; // reload (the new form, or the same one if evolve() declines)
        pet.evolve();
      } else if (b2) pet.declineEvolve();
    } else if (choiceKind === 2) {
      if (b1) pet.startFarewell();
      else if (b2) pet.declineFarewell();
    }
    choiceKind = 0;
    return;
  }
  if (confirmUntil) {
    if (timeLeft(confirmUntil) && x >= 118 && x <= 218 && y >= 252 && y <= 304) pet.release();
    confirmUntil = 0;
    return;
  }
  if (feedMenuUntil) {
    if (timeLeft(feedMenuUntil) && y >= 288 && y <= 352 && x >= 101 && x <= 365) {
      const item = Math.floor((x - 101) / 66);
      if (item === 3) pet.feedCandy();
      else pet.feedBerry(item);
      sfxPlay(SFX_EAT);
    }
    feedMenuUntil = 0;
    return;
  }
  if (pet.isEgg()) {
    pet.eggTap();
    sfxPlay(SFX_TAP);
    return;
  }
  if (pet.wantEvolveButton() && x >= EVO_BTN_X && x <= EVO_BTN_X + EVO_BTN_W &&
      y >= EVO_BTN_Y && y <= EVO_BTN_Y + EVO_BTN_H) {
    choiceKind = 1;
    choiceUntil = millis() + 12000;
    return;
  }
  if (x >= FAR_BTN_X && x <= FAR_BTN_X + FAR_BTN_W && y >= FAR_BTN_Y && y <= FAR_BTN_Y + FAR_BTN_H) {
    if (pet.canRunawayNow()) { pet.startRunaway(); return; }
    if (pet.wantFarewellButton()) { choiceKind = 2; choiceUntil = millis() + 12000; return; }
  }
  for (let i = 0; i < 4; i++) {
    const dx = x - buttons[i].cx, dy = y - buttons[i].cy;
    if (dx * dx + dy * dy <= BTN_HIT * BTN_HIT) {
      sfxPlay(SFX_TAP);
      if (i === 0) { if (!pet.sleeping) feedMenuUntil = millis() + 6000; }
      else if (i === 1) startGame();
      else if (i === 2) pet.toggleLight();
      else startBath();
      return;
    }
  }
  if (inPetZone(x, y)) {
    pet.caress();
    if (!pet.sleeping) sfxPlay(SFX_HEART);
  }
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

function drawClouds(now, col) {
  for (let k = 0; k < 2; k++) {
    const cx = ((Math.floor(now / 50) + k * 250) % 560) - 40;
    const cy = 70 + k * 34;
    gfx.fillCircle(cx, cy, 16, col);
    gfx.fillCircle(cx + 18, cy + 3, 13, col);
    gfx.fillCircle(cx - 15, cy + 4, 12, col);
  }
}

function drawScene(biome, now, night) {
  const h = sceneHour();
  const [top, bot] = skyColors(h, night);
  for (let y = 0; y < HORIZON; y += 8) gfx.fillRect(0, y, 466, 8, lerp565(top, bot, y, HORIZON));

  if (night) {
    gfx.fillCircle(360, 78, 24, C565(0xe8, 0xee, 0xf5));
    gfx.fillCircle(370, 72, 22, lerp565(top, bot, 78, HORIZON));
    for (const [sx, sy] of STARS) gfx.fillRect(sx, sy, 4, 4, UI_WHITE);
  } else if (h < 18) {
    gfx.fillCircle(360, 84, 26, h < 8 ? C565(0xff, 0xd9, 0x8a) : C565(0xff, 0xe7, 0x9f));
    drawClouds(now, C565(0xff, 0xff, 0xff));
  } else {
    gfx.fillCircle(233, HORIZON - 6, 34, C565(0xff, 0xf1, 0xc8));
  }

  let soil = BIOME_SOIL[biome < 6 ? biome : 0];
  if (night) soil = lerp565(soil, C565(0x16, 0x1c, 0x30), 9, 16);
  if (biome === 1) {
    const sea = night ? C565(0x1c, 0x34, 0x52) : C565(0x4f, 0x96, 0xc4);
    gfx.fillRect(0, HORIZON - 26, 466, 26, sea);
    for (let i = 0; i < 3; i++) {
      const wy = HORIZON - 22 + i * 7;
      const fc = night ? C565(0x3a, 0x58, 0x78) : C565(0xbf, 0xe6, 0xf5);
      gfx.fillRect(60 + ((Math.floor(now / 60) + i * 30) % 60), wy, 26, 2, fc);
      gfx.fillRect(300 - ((Math.floor(now / 60) + i * 20) % 60), wy, 26, 2, fc);
    }
  }

  gfx.fillRect(0, HORIZON, 466, 466 - HORIZON, soil);
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
    for (let f = 0; f < 10; f++) {
      const fx = (f * 53 + Math.floor(now / 40)) % 466;
      const fy = (f * 90 + Math.floor(now / 18)) % HORIZON;
      gfx.fillRect(fx, fy, 3, 3, UI_WHITE);
    }
  } else if (biome === 0) {
    for (const gx of [80, 175, 300, 395])
      for (let b = -1; b <= 1; b++) gfx.fillRect(gx + b * 5, HORIZON + 6, 2, 8 + (b === 0 ? 4 : 0), dk);
  }
}

function plainBg() {
  gfx.fillScreen(BLACK);
  gfx.fillCircle(CX, CY, 231, UI_BG_DAY);
}

function renderStarterSelect() {
  plainBg();
  const t = T(S.CHOOSE_STARTER);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(t, 2), 68);
  printT(t);
  for (let i = 0; i < 3; i++) {
    const d = STARTER_DEX[i];
    const de = DEX[d];
    const ry = STARTER_ROW_Y + i * (STARTER_ROW_H + STARTER_ROW_GAP);
    gfx.fillRoundRect(70, ry, 326, STARTER_ROW_H, 14, lerp565(de.accent, UI_WHITE, 6, 8));
    gfx.drawRoundRect(70, ry, 326, STARTER_ROW_H, 14, de.accent);
    drawThumb(d, 76, ry - 5, 3, false);
    gfx.setTextColor(UI_INK);
    setSize(3);
    setCur(178, ry + 24);
    printT(dexName(d));
  }
}

// ---------- main render ----------
function render() {
  gfx.cjk = isCjk();
  if (pet.awaitingStarter()) return renderStarterSelect();
  if (galleryOpen) return renderGallery();
  if (gameOpen) return renderGame();
  if (sackOpen) return renderSack();
  if (kbOpen) return renderKeyboard();
  if (clockOpen) return renderClock();
  if (cardOpen) return renderCard();

  const h = sceneHour();
  gNight = pet.sleeping || h < 6 || h >= 20;
  drawScene(pet.isEgg() ? 0 : DEX[pet.speciesId].biome, millis(), gNight);

  if (pet.ceremony) {
    const d = DEX[pet.speciesId];
    const msg = pet.ceremony === CER_FAREWELL ? T(S.FAREWELL) : pet.ceremony === CER_RUNAWAY ? T(S.RUNAWAY) : T(S.GOODBYE);
    drawHeader(dexName(pet.speciesId), d.accent, msg);
    drawCeremony();
    return;
  }

  if (pet.isEgg()) {
    drawHeader(T(S.EGG_HDR), inkColor(), eggMsg());
    const s = 5, x = CX - 16 * s, y = 202 - 16 * s;
    drawMap('EGG', x, y, s, false);
    if (pet.eggCracks() >= 1) for (const c of CRACK1) gfx.fillRect(x + c[0] * s, y + c[1] * s, s, s, INK_K);
    if (pet.eggCracks() >= 2) for (const c of CRACK2) gfx.fillRect(x + c[0] * s, y + c[1] * s, s, s, INK_K);
    gfx.fillRect(0, 312, 466, 154, gNight ? UI_BG_NIGHT : UI_BG_DAY);
    if (pet.eggRarity() >= R_RARO) {
      const rar = pet.eggRarity() === R_LEGENDARIO ? T(S.EGG_LEGEND) : T(S.EGG_RARE);
      gfx.setTextColor(pet.eggRarity() === R_LEGENDARIO ? UI_BAR_WARN : 0x4c98);
      setSize(2);
      setCur(centerX(rar, 2), 316);
      printT(rar);
    }
    const reg = fmt(T(S.POKEDEX_FMT), pet.registeredCount());
    gfx.setTextColor(inkColor());
    setSize(2);
    setCur(centerX(reg, 2), 348);
    printT(reg);
  } else {
    const d = DEX[pet.speciesId];
    const base = pet.nick || dexName(pet.speciesId);
    const name = fmt(T(S.NAME_FMT), pet.shiny ? '*' : '', base, pet.level());
    drawHeader(name, gNight ? UI_INK_NIGHT : d.accent, statusMsg());
    drawStreakBadge();
    drawPet();
    drawBath();
    drawPoops();
    gfx.fillRect(0, 312, 466, 154, gNight ? UI_BG_NIGHT : UI_BG_DAY);
    drawBars();
    drawButtons();
    drawCelebration();
    if (pet.wantEvolveButton()) drawEvolveButton();
    else if (pet.canRunawayNow()) drawRunawayButton();
    else if (pet.wantFarewellButton()) drawFarewellButton();
  }

  if (pet.sleeping) {
    gfx.setTextColor(UI_INK_NIGHT);
    setSize(3);
    setCur(320, 130);
    printT('Zz');
  }

  if (feedMenuUntil) {
    if (!timeLeft(feedMenuUntil)) feedMenuUntil = 0;
    else {
      gfx.fillRoundRect(101, 288, 264, 64, 14, UI_WHITE);
      gfx.drawRoundRect(101, 288, 264, 64, 14, inkColor());
      drawMap('ICON_FOOD', 110, 296, 3, false);
      drawMap('ICON_BERRY_B', 176, 296, 3, false);
      drawMap('ICON_BERRY_G', 242, 296, 3, false);
      drawMap('ICON_CANDY', 308, 296, 3, false);
    }
  }

  if (confirmUntil) {
    if (!timeLeft(confirmUntil)) confirmUntil = 0;
    else {
      gfx.fillRoundRect(94, 168, 278, 152, 16, UI_WHITE);
      gfx.drawRoundRect(94, 168, 278, 152, 16, UI_INK);
      const q = fmt(T(S.RELEASE_FMT), dexName(pet.speciesId));
      gfx.setTextColor(UI_INK);
      setSize(2);
      setCur(centerX(q, 2), 196);
      printT(q);
      gfx.fillRoundRect(118, 252, 100, 52, 12, UI_BAR_OK);
      gfx.setTextColor(UI_WHITE);
      setCur(118 + (100 - textW(T(S.YES), 2)) / 2, 270);
      printT(T(S.YES));
      gfx.fillRoundRect(248, 252, 100, 52, 12, UI_BAR_BAD);
      setCur(248 + (100 - textW(T(S.NO), 2)) / 2, 270);
      printT(T(S.NO));
    }
  }

  if (choiceKind) {
    if (!timeLeft(choiceUntil)) choiceKind = 0;
    else drawChoiceDialog();
  }
}

// ---------- ball minigame ----------
function startGame() {
  if (pet.isEgg() || pet.sleeping || pet.ceremony) return;
  gameOpen = true;
  gameOverUntil = 0;
  gameScore = 0;
  gameMisses = 0;
  gameNewHi = false;
  hitTime = 0;
  gamePetX = 233;
  lastGameStep = millis();
  respawnBall();
}

function respawnBall() {
  ballX = 150 + random(166);
  ballY = 96;
  let sp = 1.6 + gameScore * 0.05;
  if (sp > 4) sp = 4;
  ballVX = random(2) ? sp : -sp;
  ballVY = 0;
}

function gameTap(x, y) {
  if (gameOverUntil) return;
  if (y < 72) { gameOpen = false; return; }
  const dx = ballX - x, dy = ballY - y;
  if (dx * dx + dy * dy < 74 * 74) {
    gameScore++;
    sfxPlay(SFX_PLAY);
    const lift = 6.6 + (gameScore > 16 ? 3.5 : gameScore * 0.22);
    ballVY = -lift;
    ballVX += dx * 0.12;
    if (ballVX > 6.5) ballVX = 6.5;
    if (ballVX < -6.5) ballVX = -6.5;
    hitX = ballX;
    hitY = ballY;
    hitTime = millis();
  }
}

function stepGame() {
  const now = millis();
  let k = lastGameStep ? (now - lastGameStep) / 85 : 1;
  if (k > 3) k = 3;
  lastGameStep = now;
  let grav = 0.4 + gameScore * 0.013;
  if (grav > 0.8) grav = 0.8;
  ballVY += grav * k;
  ballX += ballVX * k;
  ballY += ballVY * k;
  const dx = ballX - CX, dy = ballY - CY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 205) {
    const nx = dx / d, ny = dy / d;
    const dot = ballVX * nx + ballVY * ny;
    if (dot > 0) {
      ballVX = (ballVX - 2 * dot * nx) * 0.85;
      ballVY = (ballVY - 2 * dot * ny) * 0.85;
    }
    ballX = CX + nx * 205;
    ballY = CY + ny * 205;
  }
  if (ballY > 384) {
    if (++gameMisses >= 3) {
      gameNewHi = gameScore > pet.gameHi;
      pet.playResult(gameScore);
      sfxPlay(gameNewHi && gameScore > 0 ? SFX_MEDAL : SFX_LEVEL);
      gameOverUntil = millis() + 4000;
    } else respawnBall();
  }
  let chase = (ballX - gamePetX) * 0.12;
  if (chase > 7) chase = 7;
  if (chase < -7) chase = -7;
  gamePetX += chase * k;
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

  if (sackOverUntil) {
    if (!timeLeft(sackOverUntil)) { sackOpen = false; return; }
    const b = fmt(T(S.HITS_FMT), sackHits);
    gfx.setTextColor(ink);
    setSize(4);
    setCur(centerX(b, 4), 150);
    printT(b);
    const g = fmt(T(S.STR_GAIN_FMT), sackGain);
    gfx.setTextColor(UI_BAR_BAD);
    setSize(3);
    setCur(centerX(g, 3), 210);
    printT(g);
    setSize(2);
    if (sackNewHi && sackHits > 0) {
      gfx.setTextColor(UI_BAR_WARN);
      setCur(centerX(T(S.NEW_RECORD), 2), 256);
      printT(T(S.NEW_RECORD));
    } else {
      const r = fmt(T(S.RECORD_FMT), pet.strHi);
      gfx.setTextColor(ink);
      setCur(centerX(r, 2), 256);
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
  const sx = CX + off, top = 86;
  gfx.fillRect(CX - 3, 56, 6, top - 56, ink);
  gfx.fillRect(sx - 4, top - 30, 8, 34, ink);
  gfx.fillRoundRect(sx - 42, top, 84, 150, 26, C565(0xb5, 0x3a, 0x3a));
  gfx.fillRoundRect(sx - 42, top, 84, 22, 18, C565(0x7e, 0x28, 0x28));
  gfx.drawRoundRect(sx - 42, top, 84, 150, 26, ink);
  gfx.fillRect(sx - 42, top + 70, 84, 4, C565(0x7e, 0x28, 0x28));

  const buf = String(sackHits);
  gfx.setTextColor(ink);
  setSize(6);
  setCur(centerX(buf, 6), 268);
  printT(buf);
  setSize(2);
  setCur(centerX(T(S.HIT_FAST), 2), 322);
  printT(T(S.HIT_FAST));

  const left = sackUntil - now;
  const bw = 280, fw = Math.floor((bw * left) / 10000);
  gfx.fillRoundRect(CX - bw / 2, 350, bw, 16, 5, UI_TRACK);
  if (fw > 2) gfx.fillRoundRect(CX - bw / 2, 350, fw, 16, 5, UI_BAR_OK);
}

function drawGameScene() {
  const hh = sceneHour();
  const night = hh < 6 || hh >= 20;
  const [top, bot] = skyColors(hh, night);
  const hor = 376;
  for (let y = 0; y < hor; y += 8) gfx.fillRect(0, y, 466, 8, lerp565(top, bot, y, hor));
  if (night) for (const [sx, sy] of STARS) gfx.fillRect(sx, sy, 4, 4, UI_WHITE);
  const bio = pet.isEgg() ? 0 : DEX[pet.speciesId].biome;
  let soil = BIOME_SOIL[bio < 6 ? bio : 0];
  if (night) soil = lerp565(soil, C565(0x16, 0x1c, 0x30), 9, 16);
  gfx.fillRect(0, hor, 466, 466 - hor, soil);
}

function renderGame() {
  const night = sceneHour() < 6 || sceneHour() >= 20;
  const ink = night ? UI_INK_NIGHT : UI_INK;

  if (gameOverUntil) {
    drawGameScene();
    if (!timeLeft(gameOverUntil)) { gameOpen = false; return; }
    const buf = fmt(T(S.SCORE_FMT), gameScore);
    gfx.setTextColor(ink);
    setSize(4);
    setCur(centerX(buf, 4), 160);
    printT(buf);
    setSize(2);
    if (gameNewHi && gameScore > 0) {
      gfx.setTextColor(UI_BAR_WARN);
      setCur(centerX(T(S.NEW_RECORD), 2), 214);
      printT(T(S.NEW_RECORD));
    } else {
      const rec = fmt(T(S.RECORD_FMT), pet.gameHi);
      gfx.setTextColor(ink);
      setCur(centerX(rec, 2), 214);
      printT(rec);
    }
    const msg = gameScore >= 10 ? T(S.GREAT_JOY) : T(S.PLUS_JOY);
    gfx.setTextColor(ink);
    setCur(centerX(msg, 2), 250);
    printT(msg);
    return;
  }

  drawGameScene();
  stepGame();
  if (!gameOpen || gameOverUntil) return;

  const buf = String(gameScore);
  gfx.setTextColor(ink);
  setSize(4);
  setCur(centerX(buf, 4), 30);
  printT(buf);
  const rec = fmt(T(S.REC_FMT), pet.gameHi);
  setSize(2);
  setCur(centerX(rec, 2), 76);
  printT(rec);
  for (let i = 0; i < 3; i++) {
    if (i < 3 - gameMisses) gfx.fillCircle(180 + i * 28, 104, 6, UI_BAR_BAD);
    else gfx.drawCircle(180 + i * 28, 104, 6, UI_TRACK);
  }

  if (pmd.loaded) {
    let act = ballX > gamePetX + 4 ? PMD_WALKR : ballX < gamePetX - 4 ? PMD_WALKL : PMD_IDLE;
    if (!pmd.has(act)) act = PMD_IDLE;
    drawPmdAct(act, Math.trunc(gamePetX), 394, millis(), true, false, 3);
  }

  const ht = millis() - hitTime;
  if (hitTime && ht < 260) {
    const rad = 22 + Math.floor(ht / 6);
    gfx.drawCircle(hitX, hitY, rad, C565(0xff, 0xe7, 0x9f));
    gfx.drawCircle(hitX, hitY, rad - 2, C565(0xff, 0xd9, 0x8a));
  }
  drawMap('ICON_PLAY', ballX - 24, ballY - 24, 3, false);
}

// ---------- pet card (swipe up) ----------
function statBarX() {
  setSize(2);
  let ancho = 0;
  for (const id of [S.STAT_ATK, S.STAT_DEF, S.STAT_SPE, S.STAT_WGT, S.VIN]) ancho = Math.max(ancho, textW(T(id), 2));
  const x = 96 + ancho + 12;
  return x < 150 ? 150 : x;
}

function drawCardStat(y, label, val, maxBar, color) {
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(96, y);
  printT(label);
  setCur(330, y);
  printT(String(val));
  const bx = statBarX();
  const bw = 310 - bx;
  let fw = Math.floor((val * bw) / maxBar);
  if (fw > bw) fw = bw;
  gfx.fillRoundRect(bx, y + 2, bw, 11, 3, UI_TRACK);
  if (fw > 2) gfx.fillRoundRect(bx, y + 2, fw, 11, 3, color);
}

// ---------- settings (swipe down). The phone keeps real time, so the
// firmware's hour/minute editor becomes a read-only clock. ----------
const LANG_PILL_Y = 296, LANG_PILL_H = 30, LANG_PILL_X = 336, LANG_PILL_W = 96;

function renderClock() {
  plainBg();
  const d = new Date();
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  gfx.setTextColor(UI_INK);
  setSize(7);
  setCur(centerX(t, 7), 130);
  printT(t);

  const snd = audioEnabled();
  const sl = snd ? T(S.SND_ON) : T(S.SND_OFF);
  gfx.fillRoundRect(34, LANG_PILL_Y, 96, LANG_PILL_H, 8, snd ? UI_BAR_OK : UI_WHITE);
  gfx.drawRoundRect(34, LANG_PILL_Y, 96, LANG_PILL_H, 8, UI_INK);
  gfx.setTextColor(snd ? UI_BG_DAY : UI_INK);
  setSize(2);
  setCur(34 + (96 - textW(sl, 2)) / 2, LANG_PILL_Y + 8);
  printT(sl);

  gfx.fillRoundRect(LANG_PILL_X, LANG_PILL_Y, LANG_PILL_W, LANG_PILL_H, 8, UI_WHITE);
  gfx.drawRoundRect(LANG_PILL_X, LANG_PILL_Y, LANG_PILL_W, LANG_PILL_H, 8, UI_INK);
  const lp = `${LANG_CODES[getLang()]} >`;
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(LANG_PILL_X + (LANG_PILL_W - textW(lp, 2)) / 2, LANG_PILL_Y + 8);
  printT(lp);

  gfx.fillRoundRect(133, 340, 200, 48, 14, UI_BAR_OK);
  gfx.setTextColor(UI_BG_DAY);
  setSize(3);
  setCur(centerX('OK', 3), 352);
  printT('OK');

  gfx.setTextColor(UI_TRACK);
  setSize(2);
  setCur(centerX(T(S.CLOCK_CANCEL), 2), 410);
  printT(T(S.CLOCK_CANCEL));
  const ver = `TamaPoke v${FW_VERSION} (phone)`;
  setSize(1);
  setCur(centerX(ver, 1), 436);
  printT(ver);
}

function clockTap(x, y) {
  if (y >= LANG_PILL_Y && y <= LANG_PILL_Y + LANG_PILL_H) {
    if (x >= 34 && x < 130) {
      audioSetEnabled(!audioEnabled());
      if (audioEnabled()) sfxPlay(SFX_TAP);
      return;
    }
    if (x >= LANG_PILL_X && x < LANG_PILL_X + LANG_PILL_W) {
      setLang((getLang() + 1) % LANG_CODES.length);
      sfxPlay(SFX_TAP);
      return;
    }
  }
  if (y >= 340 && y <= 388 && x >= 133 && x <= 333) clockOpen = false;
}

function drawStreakBadge() {
  if (pet.streak < 1) return;
  const x = 26, y = 16;
  gfx.fillTriangle(x + 8, y, x + 1, y + 17, x + 15, y + 17, UI_BAR_BAD);
  gfx.fillTriangle(x + 8, y + 7, x + 4, y + 17, x + 12, y + 17, UI_BAR_WARN);
  gfx.setTextColor(inkColor());
  setSize(2);
  setCur(x + 22, y + 2);
  printT(String(pet.streak));
}

function drawCelebration() {
  let l1 = null, l2 = null;
  if (pet.showMedal()) {
    for (let i = 0; i < MED_COUNT; i++) if (pet.newMedal & (1 << i)) { l2 = medalName(i); break; }
    l1 = T(S.MEDAL_BANNER);
  } else if (pet.showMilestone()) {
    l1 = T(S.GREAT);
    l2 = fmt(T(S.STREAK_DAYS_FMT), pet.streak);
  }
  if (!l1) return;
  gfx.fillRoundRect(73, 150, 320, 96, 16, UI_BAR_WARN);
  gfx.drawRoundRect(73, 150, 320, 96, 16, UI_INK);
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(l1, 3), 176);
  printT(l1);
  setSize(2);
  setCur(centerX(l2 || '', 2), 212);
  printT(l2 || '');
}

function renderCardProfile() {
  const d = DEX[pet.speciesId];
  const nm = pet.nick || dexName(pet.speciesId);
  const head = fmt(T(S.NAME_FMT), pet.shiny ? '*' : '', nm, pet.level());
  gfx.setTextColor(d.accent);
  const hts = textW(head, 3) <= 198 ? 3 : 2;
  setSize(hts);
  setCur(centerX(head, hts), hts === 3 ? 34 : 40);
  printT(head);
  if (pet.nick) {
    const par = `(${dexName(pet.speciesId)})`;
    gfx.setTextColor(UI_TRACK);
    setSize(2);
    setCur(centerX(par, 2), 64);
    printT(par);
  }
  if (pmd.loaded) drawPmdAct(PMD_IDLE, CX, 206, millis(), true, false, 4);

  const sx = 138, sy = 224;
  gfx.fillTriangle(sx + 8, sy, sx + 1, sy + 18, sx + 15, sy + 18, UI_BAR_BAD);
  gfx.fillTriangle(sx + 8, sy + 7, sx + 4, sy + 18, sx + 12, sy + 18, UI_BAR_WARN);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(sx + 24, sy + 2);
  printT(fmt(T(S.STREAK_FMT), pet.streak, pet.bestStreak));

  drawCardStat(258, T(S.VIN), pet.bond, 100, C565(0xd4, 0x52, 0x7e));

  const berry = !pet.berryKnown ? T(S.BERRY_UNK) : pet.lovesBerry(0) ? T(S.BERRY_RED)
    : pet.lovesBerry(1) ? T(S.BERRY_BLUE) : T(S.BERRY_GREEN);
  const info = fmt(T(S.INFO_FMT), berry, Math.floor(pet.ageMinutes / 1440));
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(info, 2), 296);
  printT(info);
  gfx.setTextColor(UI_TRACK);
  setCur(centerX(T(S.RENAME_HINT), 2), 332);
  printT(T(S.RENAME_HINT));
}

function renderCardStats() {
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(T(S.BATTLE), 3), 48);
  printT(T(S.BATTLE));
  drawCardStat(118, T(S.STAT_ATK), pet.atkStat(), 260, UI_BAR_BAD);
  drawCardStat(160, T(S.STAT_DEF), pet.defStat(), 260, 0x4c98);
  drawCardStat(202, T(S.STAT_SPE), pet.speStat(), 260, UI_BAR_WARN);
  drawCardStat(244, T(S.STAT_WGT), pet.weight, 100, 0xb3c8);
  gfx.fillRoundRect(96, 300, 274, 40, 12, UI_BAR_BAD);
  gfx.setTextColor(UI_BG_DAY);
  setSize(2);
  setCur(centerX(T(S.TRAIN_STR), 2), 311);
  printT(T(S.TRAIN_STR));
}

function renderCardMedals() {
  let got = 0;
  for (let i = 0; i < MED_COUNT; i++) if (pet.hasMedal(1 << i)) got++;
  const head = fmt(T(S.MEDALS_FMT), got, MED_COUNT);
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(head, 3), 48);
  printT(head);
  for (let i = 0; i < MED_COUNT; i++) {
    const x = 28 + (i % 2) * 206, y = 104 + Math.floor(i / 2) * 54;
    const g = pet.hasMedal(1 << i);
    gfx.fillRoundRect(x, y, 196, 44, 10, g ? UI_BAR_OK : UI_TRACK);
    if (g) {
      gfx.fillCircle(x + 22, y + 22, 11, UI_BG_DAY);
      gfx.setTextColor(UI_BAR_OK);
      setSize(2);
      setCur(x + 16, y + 13);
      printT('v');
    }
    gfx.setTextColor(g ? UI_BG_DAY : 0x8410);
    setSize(2);
    setCur(x + 44, y + 14);
    printT(medalDesc(i));
  }
}

function renderCardProgress() {
  const d = DEX[pet.speciesId];
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(T(S.PROGRESS), 3), 44);
  printT(T(S.PROGRESS));
  const lv = fmt(T(S.LVL_FMT), pet.level());
  setSize(5);
  setCur(centerX(lv, 5), 86);
  printT(lv);

  const into = pet.ageMinutes % MINUTES_PER_LEVEL;
  const bx = 93, bw = 280, by = 158, bh = 22;
  gfx.fillRoundRect(bx, by, bw, bh, 6, UI_TRACK);
  const fw = Math.floor(((bw - 4) * into) / MINUTES_PER_LEVEL);
  if (fw > 0) gfx.fillRoundRect(bx + 2, by + 2, fw, bh - 4, 5, UI_BAR_OK);
  const nx = fmt(T(S.NEXT_LVL_FMT), MINUTES_PER_LEVEL - into, pet.level() + 1);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(nx, 2), by + 32);
  printT(nx);

  gfx.setTextColor(UI_TRACK);
  setCur(centerX(T(S.EVO_LABEL), 2), 230);
  printT(T(S.EVO_LABEL));
  let evo, evoCol = UI_INK;
  if (d.evolvesTo === 0) evo = T(S.FINAL_FORM);
  else {
    const needed = d.evolveLevel + pet.careMistakes;
    if (pet.level() >= needed) {
      if (pet.lowestStat() >= 40) { evo = T(S.EVO_READY); evoCol = UI_BAR_OK; }
      else { evo = T(S.EVO_BLOCKED); evoCol = UI_BAR_BAD; }
    } else evo = fmt(T(S.EVO_IN_FMT), needed - pet.level());
  }
  gfx.setTextColor(evoCol);
  setCur(centerX(evo, 2), 256);
  printT(evo);
  const ms = fmt(T(S.MISTAKES_FMT), pet.careMistakes);
  gfx.setTextColor(pet.careMistakes > 0 ? UI_BAR_BAD : UI_INK);
  setCur(centerX(ms, 2), 312);
  printT(ms);
}

function renderCard() {
  plainBg();
  [renderCardProfile, renderCardStats, renderCardMedals, renderCardProgress][cardPage]();
  for (let i = 0; i < 4; i++) {
    if (i === cardPage) gfx.fillCircle(194 + i * 26, 374, 5, UI_INK);
    else gfx.drawCircle(194 + i * 26, 374, 4, UI_INK);
  }
  gfx.setTextColor(UI_TRACK);
  setSize(2);
  setCur(centerX(T(S.BACK), 2), 398);
  printT(T(S.BACK));
}

// ---------- rename keyboard ----------
const KB_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const KB_COLS = 6, KB_X = 40, KB_Y = 150, KB_W = 64, KB_H = 52;

function openKeyboard() {
  kbOpen = true;
  nameBuf = pet.nick.slice(0, 11);
}

function renderKeyboard() {
  plainBg();
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(T(S.NAME), 2), 56);
  printT(T(S.NAME));
  gfx.fillRoundRect(83, 84, 300, 40, 8, UI_WHITE);
  gfx.drawRoundRect(83, 84, 300, 40, 8, UI_INK);
  setSize(3);
  setCur(95, 94);
  printT(nameBuf || '_');
  for (let i = 0; i < 30; i++) {
    const x = KB_X + (i % KB_COLS) * KB_W, y = KB_Y + Math.floor(i / KB_COLS) * KB_H;
    const special = i >= 28;
    gfx.fillRoundRect(x, y, KB_W - 6, KB_H - 6, 6, special ? UI_BAR_WARN : UI_WHITE);
    gfx.drawRoundRect(x, y, KB_W - 6, KB_H - 6, 6, UI_INK);
    gfx.setTextColor(UI_INK);
    setSize(2);
    const lab = i < 28 ? KB_KEYS[i] : i === 28 ? '<-' : 'OK';
    setCur(x + (KB_W - 6 - textW(lab, 2)) / 2, y + KB_H / 2 - 10);
    printT(lab);
  }
}

function keyboardTap(x, y) {
  if (x < KB_X || y < KB_Y) return;
  const col = Math.floor((x - KB_X) / KB_W), row = Math.floor((y - KB_Y) / KB_H);
  if (col >= KB_COLS || row >= 5) return;
  const i = row * KB_COLS + col;
  if (i >= 30) return;
  if (i === 28) nameBuf = nameBuf.slice(0, -1);
  else if (i === 29) { pet.rename(nameBuf); kbOpen = false; }
  else if (nameBuf.length < 11) nameBuf += KB_KEYS[i];
}

// ---------- Pokedex gallery (swipe sideways) ----------
const GAL_X = 73, GAL_Y = 84, GAL_CELL = 80;

function drawThumb(dex, x, y, s, sil) {
  const t = thumbs.get(dex, sil);
  if (!t) return false;
  const ox = x + Math.trunc((GAL_CELL - t.w * s) / 2);
  const oy = y + Math.trunc((GAL_CELL - t.h * s) / 2);
  gfx.blit(t.canvas, ox, oy, t.w * s, t.h * s);
  return true;
}

function renderGallery() {
  plainBg();
  if (galleryDetail) {
    const d = DEX[galleryDetail];
    const reg = pet.isRegistered(galleryDetail);
    const head = `N.${String(galleryDetail).padStart(3, '0')} ${pet.isShinyRegistered(galleryDetail) ? '*' : ''}${reg ? dexName(galleryDetail) : '???'}`;
    gfx.setTextColor(reg ? d.accent : UI_INK);
    const gts = textW(head, 3) <= 234 ? 3 : 2;
    setSize(gts);
    setCur(centerX(head, gts), gts === 3 ? 56 : 60);
    printT(head);
    if (galleryPmd.loaded) drawPmdActM(galleryPmd, PMD_IDLE, CX, 300, reg ? millis() : 0, true, !reg, 6);
    else drawThumb(galleryDetail, CX - GAL_CELL, 135, 4, !reg);
    gfx.setTextColor(UI_INK);
    setSize(2);
    setCur(centerX(T(S.DETAIL_BACK), 2), 408);
    printT(T(S.DETAIL_BACK));
    return;
  }
  const head = fmt(T(S.POKEDEX_FMT), pet.registeredCount());
  gfx.setTextColor(UI_INK);
  setSize(3);
  setCur(centerX(head, 3), 36);
  printT(head);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const dex = galleryPage * 16 + r * 4 + c + 1;
      if (dex > 151) break;
      const x = GAL_X + c * GAL_CELL, y = GAL_Y + r * GAL_CELL;
      if (drawThumb(dex, x, y, 2, !pet.isRegistered(dex))) {
        if (pet.isShinyRegistered(dex)) {
          gfx.setTextColor(UI_BAR_WARN);
          setSize(2);
          setCur(x + 62, y + 4);
          printT('*');
        }
      } else {
        gfx.setTextColor(UI_TRACK);
        setSize(2);
        setCur(x + 24, y + 32);
        printT(String(dex));
      }
    }
  }
  for (let i = 0; i < 10; i++) {
    if (i === galleryPage) gfx.fillCircle(170 + i * 14, 436, 4, UI_INK);
    else gfx.drawCircle(170 + i * 14, 436, 3, UI_INK);
  }
}

function galleryTap(x, y) {
  if (galleryDetail) {
    galleryDetail = 0;
    galleryPmd.unload();
    return;
  }
  if (y < 72) {
    galleryOpen = false;
    galleryPmd.unload();
    return;
  }
  if (x < GAL_X || y < GAL_Y) return;
  const c = Math.floor((x - GAL_X) / GAL_CELL), r = Math.floor((y - GAL_Y) / GAL_CELL);
  if (c > 3 || r > 3) return;
  const dex = galleryPage * 16 + r * 4 + c + 1;
  if (dex > 151) return;
  galleryDetail = dex;
  galleryPmd.load(dex, pet.isShinyRegistered(dex));
}

function drawHeader(name, nameColor, msg) {
  gfx.setTextColor(nameColor);
  setSize(3);
  setCur(centerX(name, 3), 52);
  printT(name);
  gfx.setTextColor(inkColor());
  setSize(2);
  setCur(centerX(msg, 2), 90);
  printT(msg);
}

// farewell: bow with hearts, then walks off. Runaway: flinches in the rain and leaves.
function drawCeremony() {
  if (!pmd.loaded) { drawPet(); return; }
  const now = millis();
  const t = pet.ceremonyT();
  const panic = pet.ceremony === CER_RUNAWAY;
  let x = CX;
  const y = PET_GROUND;
  let act = PMD_IDLE;

  if (panic) {
    for (let i = 0; i < 46; i++) {
      const rx = (i * 47 + Math.floor(now / 3)) % 466;
      const ry = (i * 91 + Math.floor(now / 2)) % 470;
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

  const gcy = PET_GROUND - 96;
  for (let k = 0; k < 4; k++) {
    const r = 60 + k * 34 + Math.trunc(10 * Math.sin(now * 0.02));
    gfx.drawCircle(CX, gcy, r, C565(0xff, 0xdf, 0x8a));
  }
  for (let i = 0; i < 16; i++) {
    const px = (i * 71 + 28) % 466;
    const py = 410 - ((Math.floor(now / 8) + i * 70) % 360);
    if (py < 30) continue;
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

function drawChoiceDialog() {
  let q, o1, o2, c1, c2, t1, t2;
  if (choiceKind === 1) {
    q = T(S.EVO_Q); o1 = T(S.EVO_TAP); o2 = T(S.EVO_KEEP);
    c1 = UI_BAR_BAD; t1 = UI_WHITE; c2 = UI_TRACK; t2 = UI_INK;
  } else {
    q = T(S.FAR_Q); o1 = T(S.FAR_GO); o2 = T(S.FAR_STAY);
    c1 = UI_BAR_WARN; t1 = UI_INK; c2 = UI_BAR_OK; t2 = UI_WHITE;
  }
  gfx.fillRoundRect(73, 156, 320, 188, 16, UI_WHITE);
  gfx.drawRoundRect(73, 156, 320, 188, 16, UI_INK);
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(q, 2), 176);
  printT(q);
  gfx.fillRoundRect(93, 206, 280, 52, 12, c1);
  gfx.setTextColor(t1);
  setCur(centerX(o1, 2), 224);
  printT(o1);
  gfx.fillRoundRect(93, 268, 280, 52, 12, c2);
  gfx.setTextColor(t2);
  setCur(centerX(o2, 2), 286);
  printT(o2);
}

function drawEvolveButton() {
  const p = Math.trunc(5 * Math.sin(millis() * 0.006));
  const x = EVO_BTN_X - p, y = EVO_BTN_Y - p, w = EVO_BTN_W + 2 * p, h = EVO_BTN_H + 2 * p;
  gfx.fillRoundRect(x, y, w, h, 18, UI_BAR_BAD);
  gfx.drawRoundRect(x, y, w, h, 18, UI_WHITE);
  gfx.drawRoundRect(x + 2, y + 2, w - 4, h - 4, 16, UI_WHITE);
  gfx.setTextColor(UI_WHITE);
  setSize(3);
  const t = T(S.EVO_TAP);
  setCur(centerX(t, 3), y + h / 2 - 11);
  printT(t);
}

function drawFarewellButton() {
  const p = Math.trunc(4 * Math.sin(millis() * 0.005));
  const x = FAR_BTN_X - p, y = FAR_BTN_Y - p, w = FAR_BTN_W + 2 * p, h = FAR_BTN_H + 2 * p;
  gfx.fillRoundRect(x, y, w, h, 16, UI_BAR_WARN);
  gfx.drawRoundRect(x, y, w, h, 16, UI_INK);
  const buf = fmt(T(S.FAREWELL_BTN), pet.nick || dexName(pet.speciesId));
  gfx.setTextColor(UI_INK);
  setSize(2);
  setCur(centerX(buf, 2), y + h / 2 - 8);
  printT(buf);
}

function drawRunawayButton() {
  const p = Math.trunc(3 * Math.sin(millis() * 0.003));
  const x = FAR_BTN_X - p, y = FAR_BTN_Y - p, w = FAR_BTN_W + 2 * p, h = FAR_BTN_H + 2 * p;
  gfx.fillRoundRect(x, y, w, h, 16, C565(0x3a, 0x44, 0x5a));
  gfx.drawRoundRect(x, y, w, h, 16, C565(0x70, 0x80, 0x98));
  const buf = fmt(T(S.RUNAWAY_BTN), pet.nick || dexName(pet.speciesId));
  gfx.setTextColor(C565(0xc8, 0xd2, 0xe0));
  setSize(2);
  setCur(centerX(buf, 2), y + h / 2 - 8);
  printT(buf);
}

function drawEvolveFX(now) {
  const t = pet.evolveT();
  const cx = CX, cy = PET_GROUND - 96;
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
  if (showOld) drawPmdActM(evoPmd, PMD_IDLE, cx, PET_GROUND, 0, true, true, 5);
  else drawPmdAct(PMD_IDLE, cx, PET_GROUND, 0, true, true, 5);
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 + t * 4;
    const d = (Math.floor(now / 14) + i * 33) % 200;
    const sx = cx + Math.trunc(Math.cos(a) * d), sy = cy + Math.trunc(Math.sin(a) * d);
    gfx.fillRect(sx - 2, sy - 2, 5, 5, i & 1 ? C565(0xff, 0xe0, 0x70) : UI_WHITE);
  }
  if (t > 0.9) gfx.fillCircle(cx, cy, Math.trunc((300 * (t - 0.9)) / 0.1), UI_WHITE);
}

function drawPet() {
  if (pmd.loaded) return drawPetPMD();
  if (pet.evolving()) return drawEvolveFX(millis());
  if (!pmd.failed) return; // still downloading
  gfx.setTextColor(inkColor());
  setSize(6);
  setCur(CX - 18, 202 - 80);
  printT('?');
  setSize(2);
  const l1 = T(S.NO_SPRITES);
  setCur(centerX(l1, 2), 202 - 4);
  printT(l1);
  const l2 = 'Check your connection';
  setCur(centerX(l2, 2), 202 + 20);
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
    b.y = PET_GROUND - random(150);
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
function drawPmdActM(m, actId, cx, groundY, t, loop, sil, maxS) {
  const a = m.acts[actId];
  if (!a.frames) return;
  const idleH = m.acts[PMD_IDLE].h;
  let sBase = idleH ? Math.floor(170 / idleH) : 5;
  if (sBase < 2) sBase = 2;
  if (sBase > maxS) sBase = maxS;
  let s = sBase;
  while (s > 2 && a.h * s > 250) s--;
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
    beh.targetX = 150 + random(176);
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
  drawPmdAct(act, Math.trunc(beh.x), PET_GROUND, now - beh.t0, loop || act === PMD_IDLE, false, 5);
  if (pet.showHeart()) drawMap('HEART', Math.trunc(beh.x) + 50, PET_GROUND - 190, 2, false);
}

function drawPoops() {
  for (let i = 0; i < pet.poops; i++) drawMap('POOP', 36 + i * 46, 244, 2, false);
}

function drawBars() {
  drawBar(78, 318, T(S.BAR_FOOD), pet.fullness);
  drawBar(244, 318, T(S.BAR_JOY), pet.joy);
  drawBar(78, 346, T(S.BAR_ENE), pet.energy);
  drawBar(244, 346, T(S.BAR_HYG), pet.hygiene);
}

function barLabelGap() {
  let ancho = 0;
  for (const id of [S.BAR_FOOD, S.BAR_JOY, S.BAR_ENE, S.BAR_HYG]) ancho = Math.max(ancho, textW(T(id), 2));
  return ancho <= 48 ? 48 : ancho + 8;
}

function drawBar(x, y, label, val) {
  gfx.setTextColor(inkColor());
  setSize(2);
  setCur(x, y);
  printT(label);
  const gap = barLabelGap();
  let bw = 232 - (78 + gap);
  if (bw > 100) bw = 100;
  const bx = x + gap, bh = 15;
  const fill = val >= 50 ? UI_BAR_OK : val >= 25 ? UI_BAR_WARN : UI_BAR_BAD;
  gfx.fillRoundRect(bx, y, bw, bh, 4, UI_TRACK);
  const fw = Math.floor(((bw - 4) * val) / 100);
  if (fw > 0) gfx.fillRoundRect(bx + 2, y + 2, fw, bh - 4, 3, fill);
}

function drawButtons() {
  for (let i = 0; i < 4; i++) {
    const off = pet.sleeping && i !== 2;
    const bx = buttons[i].cx - BTN_HALF, by = buttons[i].cy - BTN_HALF;
    if (!pet.sleeping) gfx.fillRoundRect(bx, by, 2 * BTN_HALF, 2 * BTN_HALF, 14, UI_WHITE);
    gfx.drawRoundRect(bx, by, 2 * BTN_HALF, 2 * BTN_HALF, 14, inkColor());
    if (!off) drawMap(buttons[i].icon, buttons[i].cx - 16, buttons[i].cy - 16, 2, false);
  }
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
}
function onShow() {
  // time away: merciful offline progression (floors, no slip-ups), like the board's RTC catch-up
  if (pet.syncClock(epochNow()) > 0) pet.lastTick = millis();
  gfx.resize();
}
document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
window.addEventListener('pagehide', onHide);
window.addEventListener('resize', () => gfx.resize());

// debug hooks for the browser console (like the firmware's serial commands)
window.tamapoke = { pet, sfxPlay };

await document.fonts.load('12px "PressStart2P"').catch(() => {});
setup();
requestAnimationFrame(loop);
