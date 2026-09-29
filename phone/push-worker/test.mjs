// Checks the Web Push crypto against the receiving side of RFC 8291: a message
// encrypted for a fresh "browser" key pair must decrypt back, and the VAPID JWT
// must verify with the public key. Usage: node phone/push-worker/test.mjs
import { encrypt, vapidAuth, b64u, unb64u } from './src/webpush.js';

const te = new TextEncoder();
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hmac = async (k, d) => new Uint8Array(await crypto.subtle.sign('HMAC',
  await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));

// the browser's side: its key pair and auth secret
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));

const msg = JSON.stringify({ title: 'TamaPoke', body: 'Charlie: It\'s hungry! åäö ポケモン' });
const body = await encrypt(b64u(uaPub), b64u(auth), msg);

// decrypt as the browser would
const salt = body.slice(0, 16);
const rs = new DataView(body.buffer).getUint32(16);
const idlen = body[20];
const asPub = body.slice(21, 21 + idlen);
const ct = body.slice(21 + idlen);
ok(rs === 4096 && idlen === 65, 'aes128gcm header');
const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
const ikm = await hmac(await hmac(auth, shared), concat(te.encode('WebPush: info\0'), uaPub, asPub, [1]));
const prk = await hmac(salt, ikm);
const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce },
  await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
ok(plain[plain.length - 1] === 2, 'last-record delimiter');
ok(new TextDecoder().decode(plain.slice(0, -1)) === msg, 'payload decrypts back');

// VAPID
const v = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vPub = b64u(await crypto.subtle.exportKey('raw', v.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', v.privateKey);
const hdr = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc', vPub, jwk, 'https://example.test/');
const [, t, k] = hdr.match(/^vapid t=([^,]+), k=(.+)$/);
ok(k === vPub, 'VAPID k= is the public key');
const [h, c, s] = t.split('.');
const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
ok(claims.aud === 'https://fcm.googleapis.com' && claims.exp > Date.now() / 1000, 'VAPID claims');
const pub = await crypto.subtle.importKey('raw', unb64u(vPub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(s), te.encode(`${h}.${c}`)), 'VAPID signature verifies');

process.exit(fails ? 1 : 0);
