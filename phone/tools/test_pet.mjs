// Quick headless checks of the ported game logic (mirrors a few test/test_pet.cpp cases).
globalThis.localStorage = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } };
const { Pet, CER_NONE } = await import('../js/pet.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

const p = new Pet();
p.begin();
ok(p.awaitingStarter() && p.isEgg(), 'first run waits for starter pick');
p.chooseStarter(4);
p.eggTap(); p.eggTap(); p.eggTap();
ok(p.speciesId === 4 && p.isRegistered(4), 'three taps hatch the chosen starter');
const f0 = p.fullness;
p.tick();
ok(p.fullness === f0 - 2 && p.ageMinutes === 1, 'awake tick: FOOD -2');
p.lastSeenEpoch = 86400 * 20000;
p.feedBerry(4 % 3);
ok(p.berryKnown && p.streak === 1, 'favourite berry revealed, streak starts');
p.ageMinutes = 15 * 60; p.fullness = p.joy = p.energy = p.hygiene = 90;
ok(p.canEvolveNow() && p.wantEvolveButton(), 'Lv16 and well cared: can evolve');
p.evolve();
ok(p.speciesId === 5 && p.isRegistered(5), 'Charmander -> Charmeleon');
// offline progression with floors
p.savedSeen = 1000000; p.fullness = 100; p.joy = 100; p.energy = 100; p.hygiene = 100; p.poops = 0; p.sleeping = false;
const mins = p.syncClock(1000000 + 600 * 60);
ok(mins === 600 && p.fullness === 15 && p.joy === 15 && p.poops === 2, 'offline 10h: bars floor at 15, 2 poops');
// save/load round trip
const q = new Pet(); q.begin();
ok(q.speciesId === 5 && q.streak === 1 && q.isRegistered(4), 'save/load round trip');
// ceremony -> new egg
p.release();
ok(p.ceremony !== CER_NONE, 'release starts ceremony');
p.ceremonyUntil = 1; p.update(performance.now());
ok(p.isEgg() && !p.awaitingStarter(), 'after ceremony: new egg, no starter pick');
let egg = {}; for (let i = 0; i < 2000; i++) { const d = p.pickEggSpecies(); egg[d] = 1; }
ok(Object.keys(egg).length > 20, 'egg roll spreads over many species');
// the Professor's box
{
  globalThis.localStorage.d = {};
  const b = new Pet(); b.begin(); b.chooseStarter(1); b.eggTap(); b.eggTap(); b.eggTap();
  b.ageMinutes = 600; b.nick = 'BULBY'; b.bond = 40; b.fullness = 33;
  b.release(); b.ceremonyUntil = 1; b.update(performance.now());
  ok(b.isEgg() && b.box.length === 1 && b.box[0].speciesId === 1 && b.box[0].nick === 'BULBY', 'release: Pokemon goes to the box, new egg');
  ok(!b.canSwap() && !b.swapFromBox(0), 'no swap while it is an egg');
  b.eggTarget = 7; b.eggTap(); b.eggTap(); b.eggTap();
  ok(b.speciesId === 7 && b.boxOf(1).length === 1, 'hatched the next one; box lists by species');
  ok(b.swapFromBox(0) && b.speciesId === 1 && b.nick === 'BULBY' && b.ageMinutes === 600 && b.fullness === 33 && b.bond === 40,
    'swap: comes back frozen in time');
  ok(b.box.length === 1 && b.box[0].speciesId === 7, 'swap: the other one took its place');
  const c = new Pet(); c.begin();
  ok(c.box.length === 1 && c.speciesId === 1, 'box survives save/load');
  b.neglectTicks = 999; b.startRunaway();
  ok(b.box.length === 1, 'a runaway does not go to the box');
}

// push reminders: predicted from the offline rules
const { firstNeed, outOfQuietHours } = await import('../js/push.js');
const r = new Pet(); r.begin(); r.starterPick = false; r.speciesId = 4; r.ceremony = CER_NONE;
r.fullness = 80; r.joy = r.energy = r.hygiene = 100; r.sleeping = false;
let fn = firstNeed(r);
ok(fn && fn.need === 'food' && fn.minutes === 28, 'awake: hungry in 28 min (80 - 2/min < 25)');
r.fullness = 10;
fn = firstNeed(r);
ok(fn && fn.need === 'hygiene' && fn.minutes === 76, 'a need already low is skipped (next: HYG at 100 - 1/min)');
r.sleeping = true; r.fullness = 80;
ok(firstNeed(r) === null, 'asleep: floors stay above 25, no reminder');
const late = new Date(2026, 8, 29, 23, 30).getTime();
ok(new Date(outOfQuietHours(late)).getHours() === 8 && new Date(outOfQuietHours(late)).getDate() === 30, '23:30 moves to 08:00 next day');
const noon = new Date(2026, 8, 29, 12, 0).getTime();
ok(outOfQuietHours(noon) === noon, 'daytime unchanged');
process.exit(fails ? 1 : 0);
