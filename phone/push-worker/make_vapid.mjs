// Makes a VAPID key pair for the push worker. The public key goes in
// wrangler.toml (VAPID_PUBLIC); the private one is a secret and is never
// committed:  node make_vapid.mjs  then  npx wrangler secret put VAPID_PRIVATE_JWK
import { b64u } from './src/webpush.js';

const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', k.privateKey);
console.log('VAPID_PUBLIC      =', b64u(await crypto.subtle.exportKey('raw', k.publicKey)));
console.log('VAPID_PRIVATE_JWK =', JSON.stringify({ kty, crv, x, y, d }));
