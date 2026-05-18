const CACHE = 'xantex-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/dashboard.html',
  '/trade.html',
  '/markets.html',
  '/account-types.html',
  '/history.html',
  '/notifications.html',
  '/settings.html',
  '/supabase.js',
  '/notif-popup.js',
  '/notification.js',
  '/images/logo.png',
  '/images/favicon.png',
  '/images/icon-192.png',
  '/images/icon-512.png',
];

// Install: pre-cache core assets
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {})
  );
});

// Activate: clear old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
//  - Supabase / external APIs → network only (never cache)
//  - Static assets (images, JS, fonts) → cache first, then network
//  - HTML pages → network first, fall back to cache
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache Supabase, Resend, or third-party API calls
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('resend.com') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('fonts.g') ||
    e.request.method !== 'GET'
  ) {
    return;
  }

  // Static assets → cache first
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|mp4)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // HTML + JS → network first, fall back to cache
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
