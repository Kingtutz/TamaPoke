// Port of audio.cpp: Game Boy-style square-wave effects via Web Audio.
const NOTES = [
  [[880, 35]],                                                     // TAP
  [[660, 45], [0, 12], [660, 45]],                                 // EAT
  [[784, 45], [988, 60]],                                          // PLAY
  [[1047, 55], [1319, 90]],                                        // HEART
  [[523, 80], [659, 80], [784, 110], [1047, 170]],                 // HATCH
  [[523, 80], [659, 80], [784, 80], [1047, 90], [1319, 230]],      // EVOLVE
  [[784, 70], [0, 25], [784, 70], [0, 25], [1047, 200]],           // MEDAL
  [[300, 110], [200, 170]],                                        // DENY
  [[784, 150], [659, 150], [523, 280]],                            // BYE
  [[784, 70], [1047, 130]],                                        // LEVEL
];
const KEY = 'tamapoke.snd';

let ctx = null;
let on = true;
let sleeping = false;
let busyUntil = 0; // effects queue one after another, like the firmware's task
try { on = localStorage.getItem(KEY) !== '0'; } catch {}

// iOS only allows audio after a user gesture: call this from a touch handler
export function audioUnlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function sfxPlay(id) {
  if (!on || sleeping || !ctx || ctx.state !== 'running' || !NOTES[id]) return;
  let t = Math.max(ctx.currentTime + 0.01, busyUntil);
  for (const [f, ms] of NOTES[id]) {
    const d = ms / 1000;
    if (f) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.004);           // attack (64 samples @16k)
      g.gain.setValueAtTime(0.08, Math.max(t + 0.004, t + d - 0.006));
      g.gain.linearRampToValueAtTime(0, t + d);                   // release (96 samples)
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + d + 0.01);
    }
    t += d;
  }
  busyUntil = t;
}

export const audioEnabled = () => on;
export function audioSetEnabled(v) {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch {}
}
export function audioSetSleeping(v) { sleeping = v; }
