// Port of pet.h / pet.cpp (firmware game logic). Kept 1:1 with the C++ so the
// numbers in the README's game manual hold on the phone too.
import { DEX, CLASSIC_DEX } from './data.js';

export const PET_TICK_MS = 60000;
export const MINUTES_PER_LEVEL = 60;
export const EAT_ANIM_MS = 2500;
export const HEART_MS = 1500;
export const EVOLVE_ANIM_MS = 5200;
export const CEREMONY_MS = 10000;
export const FAREWELL_AGE_MIN = 3 * 24 * 60;
export const RUNAWAY_TICKS = 60;
export const DEX_EEVEE = 133;

export const CER_NONE = 0, CER_FAREWELL = 1, CER_RUNAWAY = 2, CER_RELEASE = 3;
export const MOOD_HAPPY = 0, MOOD_SAD = 1, MOOD_EATING = 2, MOOD_SLEEPING = 3;
export const R_EVO = 0, R_COMUN = 1, R_RARO = 2, R_LEGENDARIO = 3;
export const MED_LV10 = 1, MED_LV25 = 2, MED_LV50 = 4, MED_BERRY = 8,
  MED_STREAK7 = 16, MED_BOND = 32, MED_FINAL = 64, MED_FIT = 128;
export const MED_COUNT = 8;

export const SFX_TAP = 0, SFX_EAT = 1, SFX_PLAY = 2, SFX_HEART = 3, SFX_HATCH = 4,
  SFX_EVOLVE = 5, SFX_MEDAL = 6, SFX_DENY = 7, SFX_BYE = 8, SFX_LEVEL = 9;

export const millis = () => Math.floor(performance.now());
export const random = (n) => Math.floor(Math.random() * n);
// ms left until `deadline` (0 if passed or inactive)
export const timeLeft = (deadline) => {
  if (!deadline) return 0;
  const left = deadline - millis();
  return left > 0 ? left : 0;
};

const clamp100 = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);
// offline progression: bars drop with a floor (comes back hungry, not dead)
const dropTo = (v, d, fl) => (v <= fl ? v : v - fl > d ? v - d : fl);

const STORE_KEY = 'tamapoke.pet.v1';

// Persisted fields (the NVS keys of Pet::save/load)
const SAVED = ['fullness', 'joy', 'energy', 'hygiene', 'poops', 'weight',
  'geneAtk', 'geneDef', 'geneSpe', 'trAtk', 'trDef', 'trSpe', 'berryKnown', 'shiny',
  'eggShiny', 'starterPick', 'dexShinyReg', 'ageMinutes', 'speciesId', 'eggTarget',
  'eggTaps', 'careMistakes', 'sleeping', 'lastEnd', 'dexReg', 'streak', 'bestStreak',
  'lastCareDay', 'bond', 'medals', 'totalMedals', 'lastMilestone', 'gameHi', 'strHi', 'nick',
  // phone-only additions: the firmware keeps these in RAM, but a phone app gets
  // killed in the background far more often than the board reboots
  'evoDeclinedLv', 'farDeclinedAge', 'goodTicks', 'neglectTicks', 'mistakeCooldown', 'bondToday',
  'box'];

// Phone-only: the Professor's box. A released Pokemon, or one that said
// farewell, is kept there frozen in time and can be swapped back from the
// Pokedex. These are the fields that belong to the Pokemon itself; the Pokedex,
// streak and mini-game records stay with the player.
const PET_FIELDS = ['speciesId', 'shiny', 'nick', 'ageMinutes', 'fullness', 'joy', 'energy', 'hygiene',
  'poops', 'weight', 'geneAtk', 'geneDef', 'geneSpe', 'trAtk', 'trDef', 'trSpe', 'berryKnown',
  'careMistakes', 'sleeping', 'bond', 'medals', 'evoDeclinedLv', 'farDeclinedAge', 'goodTicks', 'mistakeCooldown'];

export class Pet {
  constructor(sfx = () => {}) {
    this.sfx = sfx;
    this.fullness = 80; this.joy = 80; this.energy = 80; this.hygiene = 100;
    this.poops = 0; this.weight = 0;
    this.geneAtk = 100; this.geneDef = 100; this.geneSpe = 100;
    this.trAtk = 0; this.trDef = 0; this.trSpe = 0;
    this.berryKnown = false; this.shiny = false;
    this.ageMinutes = 0;
    this.speciesId = -1; this.prevSpeciesId = -1;
    this.careMistakes = 0; this.sleeping = false;
    this.lastSeenEpoch = 0;
    this.ceremony = CER_NONE; this.lastEnd = CER_NONE;
    this.dexReg = new Array(19).fill(0);
    this.dexShinyReg = new Array(19).fill(0);
    this.streak = 0; this.bestStreak = 0; this.lastCareDay = 0;
    this.bond = 0; this.nick = '';
    this.medals = 0; this.totalMedals = 0; this.newMedal = 0; this.lastMilestone = 0;
    this.gameHi = 0; this.strHi = 0;
    // private in the C++
    this.lastTick = 0; this.eatUntil = 0; this.heartUntil = 0; this.evolveUntil = 0;
    this.eggTarget = 1; this.eggShiny = false; this.eggTaps = 0;
    this.mistakeCooldown = 0; this.ticksSinceSave = 0; this.pendingSave = false;
    this.evoDeclinedLv = 0; this.farDeclinedAge = 0; this.starterPick = false;
    this.neglectTicks = 0; this.goodTicks = 0; this.ceremonyUntil = 0;
    this.bondToday = 0; this.medalUntil = 0; this.milestoneUntil = 0;
    this.savedSeen = 0;
    this.box = [];
  }

  begin() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch {}
    if (!raw) this.newEgg();
    else this.load(JSON.parse(raw));
    this.lastTick = millis();
  }

  newEgg() {
    this.ceremony = CER_NONE;
    this.neglectTicks = 0;
    this.weight = 0;
    this.speciesId = -1;
    this.prevSpeciesId = -1;
    this.eggTarget = this.pickEggSpecies();
    this.starterPick = this.registeredCount() === 0;
    let shinyBase = (this.lastEnd === CER_FAREWELL ? 24 : 48) - this.careBonus();
    if (shinyBase < 8) shinyBase = 8;
    this.eggShiny = random(shinyBase) === 0;
    this.eggTaps = 0;
    this.fullness = 80; this.joy = 80; this.energy = 80; this.hygiene = 100;
    this.poops = 0;
    this.ageMinutes = 0;
    this.careMistakes = 0;
    this.mistakeCooldown = 0;
    this.sleeping = false;
    this.evoDeclinedLv = 0;
    this.farDeclinedAge = 0;
    this.save();
  }

  setClock(nowEpoch) {
    this.lastSeenEpoch = nowEpoch;
    if (nowEpoch) this.save();
  }

  // applies the time that passed while the app was closed
  syncClock(nowEpoch) {
    const seen = this.savedSeen;
    this.lastSeenEpoch = nowEpoch;
    if (nowEpoch === 0) return 0;
    let mins = seen && nowEpoch > seen ? Math.floor((nowEpoch - seen) / 60) : 0;
    if (mins < 2 || this.ceremony !== CER_NONE || this.starterPick) {
      this.save();
      return 0;
    }
    if (mins > 14 * 24 * 60) mins = 14 * 24 * 60;
    for (let i = 0; i < mins; i++) {
      this.ageMinutes++;
      if (this.isEgg()) {
        if (this.ageMinutes >= 3) this.hatch();
        continue;
      }
      if (this.sleeping) {
        this.energy = clamp100(this.energy + 6);
        if (this.ageMinutes % 2 === 0) {
          this.fullness = dropTo(this.fullness, 1, 30);
          this.joy = dropTo(this.joy, 1, 35);
        }
        if (this.ageMinutes % 3 === 0) this.hygiene = dropTo(this.hygiene, 1, 45);
        continue;
      }
      this.fullness = dropTo(this.fullness, 2, 15);
      this.energy = dropTo(this.energy, 1, 15);
      this.hygiene = dropTo(this.hygiene, 1, 15);
      this.joy = dropTo(this.joy, 1, 15);
    }
    if (!this.isEgg() && !this.sleeping) {
      const p = this.poops + Math.floor(mins / 240);
      this.poops = p > 3 ? 3 : p;
    }
    this.save();
    return mins;
  }

  update(nowMs) {
    if (this.ceremony !== CER_NONE && !timeLeft(this.ceremonyUntil)) {
      this.newEgg();
      return;
    }
    while (nowMs - this.lastTick >= PET_TICK_MS) {
      this.lastTick += PET_TICK_MS;
      this.tick();
    }
  }

  tick() {
    if (this.ceremony !== CER_NONE) return;
    if (this.starterPick) return;
    this.ageMinutes++;

    if (this.isEgg()) {
      if (this.ageMinutes >= 3) this.hatch();
      return;
    }

    if (this.sleeping) {
      this.energy = clamp100(this.energy + 6);
      if (this.weight > 0 && this.ageMinutes % 3 === 0) this.weight--;
      if (this.ageMinutes % 2 === 0) {
        this.fullness = dropTo(this.fullness, 1, 30);
        this.joy = dropTo(this.joy, 1, 35);
      }
      if (this.ageMinutes % 3 === 0) this.hygiene = dropTo(this.hygiene, 1, 45);
      this.checkMedals();
      if (++this.ticksSinceSave >= 5) this.pendingSave = true;
      return;
    }

    if (this.ageMinutes % MINUTES_PER_LEVEL === 0) this.sfx(SFX_LEVEL);

    this.fullness = clamp100(this.fullness - 2);
    this.energy = clamp100(this.energy - 1);
    if (this.fullness > 40 && this.poops < 3 && random(100) < 15) this.poops++;

    this.hygiene = clamp100(this.hygiene - 1 - 4 * this.poops);
    if (this.weight > 50) this.energy = clamp100(this.energy - 1);
    if (this.weight > 0 && this.ageMinutes % 3 === 0) this.weight--;

    if (this.lowestStat() >= 40) {
      if (++this.goodTicks >= 720) {
        this.goodTicks = 0;
        if (this.trDef < 100) this.trDef++;
      }
    } else {
      this.goodTicks = 0;
    }

    let dJoy = -1;
    if (this.fullness < 30) dJoy -= 2;
    if (this.hygiene < 30) dJoy -= 2;
    this.joy = clamp100(this.joy + dJoy);

    if (this.mistakeCooldown > 0) this.mistakeCooldown--;
    if (this.lowestStat() <= 10 && this.mistakeCooldown === 0) {
      this.careMistakes++;
      this.mistakeCooldown = 60;
      if (this.bond > 1) this.bond--;
    }

    this.checkMedals();

    if (this.fullness === 0 && this.joy === 0 && this.energy === 0 && this.hygiene === 0) {
      if (this.neglectTicks < RUNAWAY_TICKS) this.neglectTicks++;
    } else {
      this.neglectTicks = 0;
    }

    if (++this.ticksSinceSave >= 5) this.pendingSave = true;
  }

  flushSave() { if (this.pendingSave) this.save(); }
  savePending() { return this.pendingSave; }

  isRegistered(dex) {
    return dex >= 1 && dex <= 151 && (this.dexReg[(dex - 1) >> 3] & (1 << ((dex - 1) & 7))) !== 0;
  }
  isShinyRegistered(dex) {
    return dex >= 1 && dex <= 151 && (this.dexShinyReg[(dex - 1) >> 3] & (1 << ((dex - 1) & 7))) !== 0;
  }

  lineHasUnregistered(base) {
    let cur = base;
    for (let guard = 0; cur >= 1 && cur <= 151 && guard < 6; guard++) {
      if (!this.isRegistered(cur)) return true;
      if (cur === DEX_EEVEE) {
        for (let b = 134; b <= 136; b++) if (!this.isRegistered(b)) return true;
        return false;
      }
      cur = DEX[cur].evolvesTo;
    }
    return false;
  }

  eggRarity() {
    return this.eggTarget >= 1 && this.eggTarget <= 151 ? DEX[this.eggTarget].rarity : R_COMUN;
  }

  pickEggSpecies() {
    if (this.registeredCount() === 0) return CLASSIC_DEX[random(CLASSIC_DEX.length)];
    let tier = R_COMUN;
    if (this.lastEnd !== CER_RUNAWAY) {
      const blessed = this.lastEnd === CER_FAREWELL;
      const rare = (blessed ? 45 : 27) + this.careBonus();
      const leg = this.registeredCount() >= 25 ? (blessed ? 10 : 3) + Math.floor(this.careBonus() / 3) : 0;
      const r = random(100);
      if (r < leg) tier = R_LEGENDARIO;
      else if (r < leg + rare) tier = R_RARO;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let t = tier; t >= R_COMUN; t--) {
        const cand = [];
        for (let d = 1; d <= 151 && cand.length < 80; d++) {
          if (DEX[d].rarity !== t) continue;
          if (pass === 0 && !this.lineHasUnregistered(d)) continue;
          cand.push(d);
        }
        if (cand.length) return cand[random(cand.length)];
      }
    }
    return CLASSIC_DEX[random(CLASSIC_DEX.length)];
  }

  registerSpecies(dex) {
    if (dex < 1 || dex > 151) return;
    this.dexReg[(dex - 1) >> 3] |= 1 << ((dex - 1) & 7);
    if (this.shiny) this.dexShinyReg[(dex - 1) >> 3] |= 1 << ((dex - 1) & 7);
  }

  careBonus() {
    const s = this.streak > 30 ? 30 : this.streak;
    return Math.floor(s / 3) + Math.floor(this.bond / 25);
  }

  today() { return this.lastSeenEpoch ? Math.floor(this.lastSeenEpoch / 86400) : 0; }

  registerCare() {
    if (this.isEgg() || this.ceremony !== CER_NONE) return;
    const d = this.today();
    if (d === 0 || d === this.lastCareDay) return;
    if (this.lastCareDay === 0 || d === this.lastCareDay + 1) {
      this.streak++;
    } else {
      this.streak = 1;
      this.lastMilestone = 0;
    }
    this.lastCareDay = d;
    this.bondToday = 0;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    this.bond = clamp100(this.bond + 4);
    const s = this.streak;
    const ms = s >= 100 ? 100 : s >= 30 ? 30 : s >= 7 ? 7 : s >= 3 ? 3 : 0;
    if (ms > this.lastMilestone) {
      this.lastMilestone = ms;
      this.milestoneUntil = millis() + 4500;
    }
    this.checkMedals();
    this.save();
  }

  addBond(amt) {
    if (this.bondToday >= 20) return;
    this.bond = clamp100(this.bond + amt);
    this.bondToday += amt;
  }

  checkMedals() {
    if (this.isEgg()) return;
    const before = this.medals;
    const lv = this.level();
    if (lv >= 10) this.medals |= MED_LV10;
    if (lv >= 25) this.medals |= MED_LV25;
    if (lv >= 50) this.medals |= MED_LV50;
    if (this.berryKnown) this.medals |= MED_BERRY;
    if (this.streak >= 7) this.medals |= MED_STREAK7;
    if (this.bond >= 100) this.medals |= MED_BOND;
    if (DEX[this.speciesId].evolvesTo === 0) this.medals |= MED_FINAL;
    if (this.weight === 0 && lv >= 5 && this.careMistakes === 0) this.medals |= MED_FIT;
    const gained = this.medals & ~before;
    if (gained) {
      for (let m = gained; m; m &= m - 1) this.totalMedals++;
      this.newMedal = gained;
      this.medalUntil = millis() + 4000;
      if (!this.sleeping) this.sfx(SFX_MEDAL);
      this.save();
    }
  }

  rename(name) {
    this.nick = name.slice(0, 11);
    this.save();
  }

  calcStat(base, gene, tr) { return Math.floor((base * gene) / 100) + this.level() + tr; }
  atkStat() { return this.isEgg() ? 0 : this.calcStat(DEX[this.speciesId].bAtk, this.geneAtk, this.trAtk); }
  defStat() { return this.isEgg() ? 0 : this.calcStat(DEX[this.speciesId].bDef, this.geneDef, this.trDef); }
  speStat() { return this.isEgg() ? 0 : this.calcStat(DEX[this.speciesId].bSpe, this.geneSpe, this.trSpe); }

  registeredCount() {
    let n = 0;
    for (let i = 1; i <= 151; i++) if (this.isRegistered(i)) n++;
    return n;
  }

  canFarewellNow() {
    return !this.isEgg() && !this.sleeping && this.ceremony === CER_NONE &&
      DEX[this.speciesId].evolvesTo === 0 && this.ageMinutes >= FAREWELL_AGE_MIN;
  }
  canRunawayNow() {
    return !this.isEgg() && !this.sleeping && this.ceremony === CER_NONE && this.neglectTicks >= RUNAWAY_TICKS;
  }

  startCeremony(kind, hearts) {
    if (this.isEgg() || this.ceremony !== CER_NONE) return;
    if (kind !== CER_RUNAWAY) this.box.push(this.snapshot()); // a runaway is gone for good
    this.lastEnd = kind;
    this.ceremony = kind;
    this.ceremonyUntil = millis() + CEREMONY_MS;
    if (hearts) this.heartUntil = this.ceremonyUntil;
    this.sfx(SFX_BYE);
    this.save();
  }
  startFarewell() { this.startCeremony(CER_FAREWELL, true); }
  startRunaway() { this.startCeremony(CER_RUNAWAY, false); }
  release() { this.startCeremony(CER_RELEASE, true); }

  hatch() {
    this.speciesId = this.eggTarget;
    this.shiny = this.eggShiny;
    this.geneAtk = 90 + random(21);
    this.geneDef = 90 + random(21);
    this.geneSpe = 90 + random(21);
    this.trAtk = this.trDef = this.trSpe = 0;
    this.berryKnown = false;
    this.bond = 0;
    this.bondToday = 0;
    this.medals = 0;
    this.newMedal = 0;
    this.nick = '';
    this.registerSpecies(this.speciesId);
    this.checkMedals();
    this.sfx(SFX_HATCH);
    this.save();
  }

  canEvolveNow() {
    if (this.isEgg() || this.sleeping || this.ceremony !== CER_NONE) return false;
    const d = DEX[this.speciesId];
    if (d.evolvesTo === 0) return false;
    return this.level() >= d.evolveLevel + this.careMistakes && this.lowestStat() >= 40;
  }

  evolve() {
    if (!this.canEvolveNow()) return;
    const d = DEX[this.speciesId];
    this.prevSpeciesId = this.speciesId;
    let next = d.evolvesTo;
    if (this.speciesId === DEX_EEVEE) {
      const opts = [];
      for (let b = 134; b <= 136; b++) if (!this.isRegistered(b)) opts.push(b);
      next = opts.length ? opts[random(opts.length)] : 134 + random(3);
    }
    this.speciesId = next;
    this.registerSpecies(this.speciesId);
    this.sfx(SFX_EVOLVE);
    this.evolveUntil = millis() + EVOLVE_ANIM_MS;
    this.save();
  }

  lovesBerry(color) { return !this.isEgg() && this.speciesId % 3 === color; }

  feedBerry(color) {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    if (this.lovesBerry(color)) {
      this.fullness = clamp100(this.fullness + 35);
      this.joy = clamp100(this.joy + 10);
      this.heartUntil = millis() + HEART_MS;
      this.berryKnown = true;
      this.addBond(2);
    } else {
      this.fullness = clamp100(this.fullness + 25);
    }
    this.eatUntil = millis() + EAT_ANIM_MS;
    this.registerCare();
    this.save();
  }

  feedCandy() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    this.fullness = clamp100(this.fullness + 10);
    this.joy = clamp100(this.joy + 12);
    this.weight = clamp100(this.weight + 12);
    this.eatUntil = millis() + EAT_ANIM_MS;
    this.registerCare();
    this.save();
  }

  playResult(score) {
    if (this.ceremony !== CER_NONE || this.isEgg()) return;
    const v = this.trSpe + Math.floor(score / 5);
    this.trSpe = v > 100 ? 100 : v;
    this.joy = clamp100(this.joy + 5 + (score > 15 ? 30 : score * 2));
    this.energy = dropTo(this.energy, 10 + Math.floor(score / 2), 5);
    this.fullness = dropTo(this.fullness, 5, 5);
    const burn = this.weight - score * 2;
    this.weight = burn > 0 ? burn : 0;
    if (score >= 5) this.heartUntil = millis() + HEART_MS;
    if (score > this.gameHi) this.gameHi = score;
    this.addBond(2);
    this.registerCare();
    this.save();
  }

  trainStrength(hits) {
    if (this.ceremony !== CER_NONE || this.isEgg()) return 0;
    let gain = Math.floor(hits / 4);
    if (gain > 18) gain = 18;
    const antes = this.trAtk;
    const v = this.trAtk + gain;
    this.trAtk = v > 100 ? 100 : v;
    gain = this.trAtk - antes;
    this.energy = dropTo(this.energy, 12, 5);
    this.fullness = dropTo(this.fullness, 5, 5);
    const burn = this.weight - Math.floor(hits / 3);
    this.weight = burn > 0 ? burn : 0;
    this.joy = clamp100(this.joy + 6);
    if (hits >= 20) this.heartUntil = millis() + HEART_MS;
    if (hits > this.strHi) this.strHi = hits;
    this.addBond(2);
    this.registerCare();
    this.save();
    return gain;
  }

  toggleLight() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg()) return;
    this.sleeping = !this.sleeping;
    this.save();
  }

  clean() {
    if (this.ceremony !== CER_NONE) return;
    this.poops = 0;
    this.hygiene = 100;
    this.addBond(1);
    this.registerCare();
    this.save();
  }

  caress() {
    if (this.ceremony !== CER_NONE) return;
    if (this.isEgg() || this.sleeping) return;
    this.joy = clamp100(this.joy + 5);
    this.heartUntil = millis() + HEART_MS;
    this.addBond(1);
    this.registerCare();
  }

  eggTap() {
    if (!this.isEgg()) return;
    if (++this.eggTaps >= 3) this.hatch();
    else this.save();
  }

  mood() {
    if (this.sleeping) return MOOD_SLEEPING;
    if (this.eating()) return MOOD_EATING;
    if (this.lowestStat() < 25) return MOOD_SAD;
    return MOOD_HAPPY;
  }

  isEgg() { return this.speciesId < 0; }
  eggCracks() { return this.eggTaps; }
  eating() { return timeLeft(this.eatUntil) > 0; }
  showHeart() { return timeLeft(this.heartUntil) > 0; }
  evolving() { return timeLeft(this.evolveUntil) > 0; }
  evolveT() { return 1 - timeLeft(this.evolveUntil) / EVOLVE_ANIM_MS; }
  wantEvolveButton() { return this.canEvolveNow() && this.level() > this.evoDeclinedLv; }
  wantFarewellButton() { return this.canFarewellNow() && this.ageMinutes >= this.farDeclinedAge; }
  declineEvolve() { this.evoDeclinedLv = this.level(); this.save(); }
  declineFarewell() { this.farDeclinedAge = this.ageMinutes + 1440; this.save(); }
  awaitingStarter() { return this.starterPick; }
  chooseStarter(dex) { this.eggTarget = dex; this.starterPick = false; this.save(); }
  level() {
    const lv = 1 + Math.floor(this.ageMinutes / MINUTES_PER_LEVEL);
    return lv > 999 ? 999 : lv;
  }
  lowestStat() { return Math.min(this.fullness, this.joy, this.energy, this.hygiene); }
  ceremonyT() {
    if (this.ceremony === CER_NONE) return 0;
    return 1 - timeLeft(this.ceremonyUntil) / CEREMONY_MS;
  }
  hasMedal(m) { return (this.medals & m) !== 0; }
  showMedal() { return timeLeft(this.medalUntil) > 0; }
  showMilestone() { return timeLeft(this.milestoneUntil) > 0; }

  save() {
    this.ticksSinceSave = 0;
    this.pendingSave = false;
    const o = {};
    for (const k of SAVED) o[k] = this[k];
    if (this.lastSeenEpoch) this.savedSeen = this.lastSeenEpoch;
    o.seen = this.savedSeen;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch {}
  }

  load(o) {
    for (const k of SAVED) if (o[k] !== undefined) this[k] = o[k];
    this.savedSeen = o.seen || 0;
    if (this.speciesId >= 1) this.registerSpecies(this.speciesId);
  }

  snapshot() {
    const o = {};
    for (const k of PET_FIELDS) o[k] = this[k];
    return o;
  }

  // the box entries of one species, with their index in the box
  boxOf(dex) {
    return this.box.map((p, index) => ({ ...p, index })).filter((p) => p.speciesId === dex);
  }

  canSwap() {
    return !this.isEgg() && !this.starterPick && this.ceremony === CER_NONE && !this.evolving();
  }

  // the current Pokemon goes to the Professor and box[i] comes back as it left
  swapFromBox(i) {
    const back = this.box[i];
    if (!back || !this.canSwap()) return false;
    this.box[i] = this.snapshot();
    for (const k of PET_FIELDS) if (back[k] !== undefined) this[k] = back[k];
    this.neglectTicks = 0;
    this.prevSpeciesId = -1;
    this.eatUntil = this.heartUntil = this.evolveUntil = this.medalUntil = 0;
    this.newMedal = 0;
    // one that came back after its farewell waits a day before asking again
    this.farDeclinedAge = Math.max(this.farDeclinedAge, this.ageMinutes + 1440);
    this.registerSpecies(this.speciesId);
    this.save();
    return true;
  }

  factoryReset() {
    try { localStorage.removeItem(STORE_KEY); } catch {}
  }
}
