// Web Push with nothing but WebCrypto: VAPID (RFC 8292) and aes128gcm payload
// encryption (RFC 8291). Runs on Cloudflare Workers and on Node 20+.

const te = new TextEncoder();

export function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// aes128gcm body for one push message (a single record)
export async function encrypt(p256dh, authSecret, payload) {
  const uaPub = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));

  const ikm = await hmac(await hmac(auth, shared), concat(te.encode('WebPush: info\0'), uaPub, asPub, [1]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key,
    concat(te.encode(payload), [2]))); // 0x02: last (and only) record, no padding

  const header = new Uint8Array(16 + 4 + 1 + asPub.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPub.length;
  header.set(asPub, 21);
  return concat(header, ct);
}

// "Authorization" header value for a push service endpoint
export async function vapidAuth(endpoint, publicKey, privateJwk, subject) {
  const enc = (o) => b64u(te.encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })}`;
  const { kty, crv, x, y, d } = privateJwk;
  const key = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${publicKey}`;
}

// POST one encrypted message; returns the push service's Response
export async function sendPush(sub, payload, vapid) {
  const body = await encrypt(sub.keys.p256dh, sub.keys.auth, payload);
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuth(sub.endpoint, vapid.publicKey, vapid.privateJwk, vapid.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'normal',
    },
    body,
  });
}
