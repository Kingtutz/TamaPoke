// Push reminders. When the app goes to the background it predicts when the pet
// will need you, with the same offline rules Pet.syncClock applies on return,
// and hands those times to the push server (../push-worker/), which sends them
// even while the app is closed. Coming back cancels whatever is still pending.

// the deployed push-worker; empty = notifications hidden in Settings
export const PUSH_URL = '';

const KEY = 'tamapoke.push';
const HUNGRY = 25; // statusMsg()'s threshold for every need
const QUIET_FROM = 22, QUIET_TO = 8; // no buzzing at night: moved to 08:00

let subJson = null;   // subscription, kept ready for the synchronous pagehide path
let lastSent = '';

const stored = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const store = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch {} };

export const pushAvailable = () => !!PUSH_URL && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone Safari only offers web push to apps added to the Home Screen
export const pushNeedsInstall = () => !!PUSH_URL && /iPhone|iPad|iPod/.test(navigator.userAgent) && !('PushManager' in window);
export const pushBlocked = () => 'Notification' in window && Notification.permission === 'denied';
export const pushEnabled = () => pushAvailable() && stored() && Notification.permission === 'granted' && !!subJson;

export async function pushInit() {
  if (!pushAvailable() || !stored()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  subJson = sub ? sub.toJSON() : null;
}

export async function pushEnable() {
  if (!pushAvailable()) return false;
  if (await Notification.requestPermission() !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await (await fetch(`${PUSH_URL}/vapid`)).json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
  }
  subJson = sub.toJSON();
  store(true);
  return true;
}

export async function pushDisable() {
  store(false);
  pushCancel();
  subJson = null;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {}
}

// events: [{at: ms epoch, title, body}]
export function pushSchedule(events) {
  if (!pushEnabled()) return;
  const body = JSON.stringify({ sub: subJson, events });
  if (body === lastSent) return; // visibilitychange and pagehide both fire
  lastSent = body;
  post('/schedule', body);
}

export function pushCancel() {
  if (!subJson) return;
  lastSent = '';
  post('/cancel', JSON.stringify({ sub: subJson }));
}

// text/plain keeps it a "simple" request (no CORS preflight), which keepalive
// needs to survive the page being put away
function post(path, body) {
  fetch(PUSH_URL + path, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body }).catch(() => {});
}

function fromB64u(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

const dropTo = (v, d, fl) => (v <= fl ? v : v - fl > d ? v - d : fl);

// Minutes from now until the first need drops below the "hungry" line, replaying
// Pet.syncClock's offline minute loop. Needs already low don't count (you just
// saw them). null = nothing within the horizon (e.g. asleep: the floors are 30+).
export function firstNeed(pet, horizon = 24 * 60) {
  if (pet.isEgg() || pet.ceremony || pet.awaitingStarter()) return null;
  const v = { food: pet.fullness, hygiene: pet.hygiene, energy: pet.energy, joy: pet.joy };
  const watch = Object.keys(v).filter((k) => v[k] >= HUNGRY);
  let age = pet.ageMinutes;
  for (let m = 1; m <= horizon; m++) {
    age++;
    if (pet.sleeping) {
      v.energy = Math.min(100, v.energy + 6);
      if (age % 2 === 0) { v.food = dropTo(v.food, 1, 30); v.joy = dropTo(v.joy, 1, 35); }
      if (age % 3 === 0) v.hygiene = dropTo(v.hygiene, 1, 45);
    } else {
      v.food = dropTo(v.food, 2, 15);
      v.energy = dropTo(v.energy, 1, 15);
      v.hygiene = dropTo(v.hygiene, 1, 15);
      v.joy = dropTo(v.joy, 1, 15);
    }
    const need = watch.find((k) => v[k] < HUNGRY);
    if (need) return { minutes: m, need };
  }
  return null;
}

// pushes a time out of the quiet hours to the next 08:00
export function outOfQuietHours(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  if (h >= QUIET_FROM || h < QUIET_TO) {
    if (h >= QUIET_FROM) d.setDate(d.getDate() + 1);
    d.setHours(QUIET_TO, 0, 0, 0);
  }
  return d.getTime();
}
