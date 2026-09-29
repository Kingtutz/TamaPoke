// Offline support: the app shell is precached; each sprite file (~135 KB) is
// cached the first time it is shown, so the pets you've met work offline.
const SHELL = 'tamapoke-shell-v3';
const SPRITES = 'tamapoke-sprites-v1';
const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'fonts/PressStart2P-Regular.ttf',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/audio.js', 'js/data.js', 'js/gfx.js', 'js/i18n.js', 'js/pet.js', 'js/sprites.js',
  '../tools/sdcard/mons/thumbs.bin',
];

// GitHub Pages lets browsers keep files for 10 minutes, so both the precache and
// the network-first fetch skip the HTTP cache: otherwise a fresh index.html can
// end up running next to a stale app.js.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(SHELL_FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== SPRITES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/tools/sdcard/mons/') && !url.pathname.endsWith('thumbs.bin')) {
    // sprites never change: cache first
    e.respondWith(caches.open(SPRITES).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // app shell: network first (so updates arrive), cache when offline
  e.respondWith(
    // by URL: a navigation Request can't be re-issued with new options
    fetch(e.request.url, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
