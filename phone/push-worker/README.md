# TamaPoke push server

A small Cloudflare Worker that sends the phone app's reminders ("Charlie: It's
hungry!") while the app is closed. GitHub Pages can only serve files, so the
timing has to live somewhere else. The free Workers plan is enough.

How it works:

1. When the app goes to the background it works out when the pet will need you
   (the same offline rules `Pet.syncClock` applies) and posts up to four
   reminders plus its push subscription to `/schedule`.
2. Opening the app again posts `/cancel`.
3. A cron trigger runs every 5 minutes and sends the reminders that are due,
   encrypted per RFC 8291 and signed with VAPID (`src/webpush.js`, WebCrypto
   only, no dependencies).

Only the push subscription and the pending reminders are stored in KV. Each
entry expires after 20 days. The worker only accepts endpoints on the real
browser push services (Google, Mozilla, Apple, Microsoft).

## Deploy

From this folder (`phone/push-worker/`):

```bash
npx wrangler login                          # opens the browser, once
npx wrangler kv namespace create SUBS       # put the id in wrangler.toml
node make_vapid.mjs                         # VAPID_PUBLIC -> wrangler.toml
npx wrangler secret put VAPID_PRIVATE_JWK   # paste the JSON line from make_vapid
npx wrangler deploy                         # prints https://tamapoke-push.<you>.workers.dev
```

Then put that URL in `PUSH_URL` in `phone/js/push.js`. If the app is hosted
somewhere other than `kingtutz.github.io`, add its origin to `ALLOWED_ORIGINS`
in `src/index.js`.

On an iPhone, notifications only work when the app has been added to the Home
Screen (iOS 16.4 or later). Then turn them on under Settings → Notifications in
the app.

## Test

```bash
node test.mjs    # encrypt -> decrypt round trip and VAPID signature check
```
