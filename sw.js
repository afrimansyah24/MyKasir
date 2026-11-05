/* ==========================================================================
   My Kasir — Service Worker (PWA)
   --------------------------------------------------------------------------
   HANYA cache shell statis (HTML/CSS/JS/gambar).
   TIDAK PERNAH cache request API (Worker / Apps Script), supaya data
   transaksi & stok selalu segar.
   ========================================================================== */

const CACHE = 'my-kasir-shell-v3';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll gagal total bila satu file 404 (mis. config.js belum di-commit),
      // jadi tiap file di-cache secara individual.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Request ke origin lain (Worker, CDN, Drive, Google Fonts) → biarkan lewat jaringan.
  if (url.origin !== self.location.origin) return;

  // 2) Request API → TIDAK di-cache (data harus real-time).
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/rpc')) return;

  // 3) Navigasi → jaringan dulu, fallback ke cache (agar aplikasi tetap
  //    terbuka saat offline, walau transaksi tetap butuh internet).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 4) Aset statis → cache-first, laluisi cache di background.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});

// Pesan dari halaman: "perbarui app" → aktifkan worker baru.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
