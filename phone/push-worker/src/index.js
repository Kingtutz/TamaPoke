// TamaPoke push server (Cloudflare Worker + KV + a cron trigger).
// When the phone app goes to the background it posts its push subscription and
// up to four timed reminders; when it comes back it cancels them. Every five
// minutes the cron sends the reminders that are due. Nothing else is stored,
// and each entry expires on its own after 20 days.
import { sendPush } from './webpush.js';

const ALLOWED_ORIGINS = ['https://kingtutz.github.io', 'http://localhost:8080'];
// only real browser push services: the worker must not POST to arbitrary URLs
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/,
  /^(web\.push|[\w-]+\.push)\.apple\.com$/, /^[\w-]+\.notify\.windows\.com$/];
const MAX_EVENTS = 4;
const MAX_AHEAD_MS = 15 * 24 * 3600 * 1000;
const TTL_S = 20 * 24 * 3600;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/vapid') return json({ key: env.VAPID_PUBLIC });
    if (req.method !== 'POST' || (pathname !== '/schedule' && pathname !== '/cancel')) return json({ error: 'not found' }, 404);

    let body;
    try { body = JSON.parse(await req.text()); } catch { return json({ error: 'bad json' }, 400); }
    const sub = cleanSub(body && body.sub);
    if (!sub) return json({ error: 'bad subscription' }, 400);
    const key = await keyFor(sub.endpoint);

    const now = Date.now();
    const events = pathname === '/schedule' && Array.isArray(body.events)
      ? body.events.map(cleanEvent).filter((e) => e && e.at > now && e.at < now + MAX_AHEAD_MS)
        .sort((a, b) => a.at - b.at).slice(0, MAX_EVENTS)
      : [];
    if (!events.length) await env.SUBS.delete(key);
    else await save(env, key, { sub, events });
    return json({ ok: true, scheduled: events.length });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },
};

async function sendDue(env) {
  const now = Date.now();
  const vapid = { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT };
  let cursor;
  do {
    const page = await env.SUBS.list({ cursor });
    for (const k of page.keys) {
      if (!k.metadata || k.metadata.next > now) continue; // metadata saves a read per entry
      const rec = await env.SUBS.get(k.name, 'json');
      if (!rec) continue;
      const due = rec.events.filter((e) => e.at <= now);
      const rest = rec.events.filter((e) => e.at > now);
      const last = due[due.length - 1]; // several overdue: only the newest is worth showing
      let gone = false;
      if (last) {
        try {
          const res = await sendPush(rec.sub, JSON.stringify({ title: last.title, body: last.body }), vapid);
          gone = res.status === 404 || res.status === 410; // subscription no longer exists
          if (!res.ok && !gone) console.log('push failed', res.status, await res.text());
        } catch (err) {
          console.log('push error', String(err));
        }
      }
      if (gone || !rest.length) await env.SUBS.delete(k.name);
      else await save(env, k.name, { sub: rec.sub, events: rest });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

function save(env, key, rec) {
  return env.SUBS.put(key, JSON.stringify(rec), { metadata: { next: rec.events[0].at }, expirationTtl: TTL_S });
}

async function keyFor(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

function cleanSub(s) {
  if (!s || !str(s.endpoint, 1024) || !s.keys || !str(s.keys.p256dh, 200) || !str(s.keys.auth, 100)) return null;
  let u;
  try { u = new URL(s.endpoint); } catch { return null; }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return null;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

function cleanEvent(e) {
  if (!e || !Number.isFinite(e.at) || !str(e.title, 60) || !str(e.body, 160)) return null;
  return { at: Math.floor(e.at), title: e.title, body: e.body };
}
