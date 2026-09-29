// Port of i18n.cpp: T(S.X) returns the string in the active language.
import { STR_IDS, STRINGS, MED_NAME, MED_LBL, MED_DSC, DEX, DEX_NAMES } from './data.js';

export const LANG_CODES = ['ES', 'EN', 'FR', 'DE', 'IT', 'PT', 'JA', 'KO'];
const LANG_DEFAULT = 1; // English
const KEY = 'tamapoke.lang';

export const S = Object.fromEntries(STR_IDS.map((id, i) => [id.slice(2), i]));

let lang = LANG_DEFAULT;
try {
  const v = Number(localStorage.getItem(KEY));
  if (localStorage.getItem(KEY) !== null && v >= 0 && v < LANG_CODES.length) lang = v;
} catch {}

export const getLang = () => lang;
export const isCjk = () => lang === 6 || lang === 7;
export function setLang(l) {
  if (l < 0 || l >= LANG_CODES.length) return;
  lang = l;
  try { localStorage.setItem(KEY, String(l)); } catch {}
}

export const T = (id) => STRINGS[lang][id];
export const medalName = (i) => MED_NAME[lang][i];
export const medalLabel = (i) => MED_LBL[lang][i];
export const medalDesc = (i) => MED_DSC[lang][i];

export function dexName(dex) {
  if (dex < 1 || dex > 151) return DEX[0].name;
  const code = LANG_CODES[lang];
  const n = DEX_NAMES[code] ? DEX_NAMES[code][dex] : null;
  return n || DEX[dex].name;
}

// just enough printf for the firmware's format strings (%s %u %d %lu %02d %03d)
export function fmt(f, ...args) {
  let i = 0;
  return f.replace(/%(0?\d+)?l?([sud%])/g, (m, pad, conv) => {
    if (conv === '%') return '%';
    let v = String(args[i++]);
    if (pad) v = v.padStart(parseInt(pad, 10), pad[0] === '0' ? '0' : ' ');
    return v;
  });
}
