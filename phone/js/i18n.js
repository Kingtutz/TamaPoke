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

// Phone-only labels (tabs, buttons) that the firmware never needed.
// Order follows LANG_CODES: ES EN FR DE IT PT JA KO.
const PHONE = {
  HOME: ['Inicio', 'Home', 'Accueil', 'Start', 'Home', 'Início', 'ホーム', '홈'],
  DEX: ['Pokédex', 'Pokédex', 'Pokédex', 'Pokédex', 'Pokédex', 'Pokédex', 'ずかん', '도감'],
  STATS: ['Ficha', 'Stats', 'Fiche', 'Profil', 'Scheda', 'Ficha', 'ステータス', '상태'],
  SETTINGS: ['Ajustes', 'Settings', 'Réglages', 'Optionen', 'Opzioni', 'Ajustes', 'せってい', '설정'],
  FEED: ['Comer', 'Feed', 'Manger', 'Füttern', 'Cibo', 'Comer', 'ごはん', '밥'],
  PLAY: ['Jugar', 'Play', 'Jouer', 'Spielen', 'Gioca', 'Jogar', 'あそぶ', '놀기'],
  LIGHT: ['Luz', 'Light', 'Lumière', 'Licht', 'Luce', 'Luz', 'でんき', '불'],
  BATH: ['Baño', 'Bath', 'Bain', 'Baden', 'Bagno', 'Banho', 'おふろ', '목욕'],
  CANDY: ['Caramelo', 'Candy', 'Bonbon', 'Bonbon', 'Caramella', 'Doce', 'キャンディ', '사탕'],
  SOUND: ['Sonido', 'Sound', 'Son', 'Ton', 'Suono', 'Som', 'サウンド', '소리'],
  LANGUAGE: ['Idioma', 'Language', 'Langue', 'Sprache', 'Lingua', 'Idioma', 'げんご', '언어'],
  ON: ['Sí', 'On', 'Oui', 'An', 'Sì', 'Sim', 'オン', '켜기'],
  OFF: ['No', 'Off', 'Non', 'Aus', 'No', 'Não', 'オフ', '끄기'],
  RENAME: ['Renombrar', 'Rename', 'Renommer', 'Umbenennen', 'Rinomina', 'Renomear', 'なまえをかえる', '이름 변경'],
  CANCEL: ['Cancelar', 'Cancel', 'Annuler', 'Abbrechen', 'Annulla', 'Cancelar', 'キャンセル', '취소'],
  RELEASE: ['Soltar', 'Release', 'Relâcher', 'Freilassen', 'Libera', 'Soltar', 'にがす', '놓아주기'],
  TAP_BALL: ['Toca la pelota!', 'Tap the ball!', 'Touche la balle !', 'Tipp den Ball!', 'Tocca la palla!', 'Toque na bola!', 'ボールをタップ!', '공을 탭!'],
  WAKE_FIRST: ['Despiértalo primero (Luz)', 'Wake it up first (Light)', "Réveille-le d'abord (Lumière)", 'Erst aufwecken (Licht)', 'Prima sveglialo (Luce)', 'Acorde-o primeiro (Luz)', 'まず おこしてね(でんき)', '먼저 깨워 주세요 (불)'],
  NOT_SEEN: ['Sin registrar', 'Not seen yet', 'Pas encore vu', 'Noch nicht gesehen', 'Non ancora visto', 'Ainda não visto', 'みつけていない', '아직 못 봤어요'],
};
export const P = (key) => PHONE[key][lang];
export const LANG_NAMES = ['Español', 'English', 'Français', 'Deutsch', 'Italiano', 'Português', '日本語', '한국어'];
