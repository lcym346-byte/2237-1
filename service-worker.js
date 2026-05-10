const CACHE_NAME = 'pos-v20260606-debug-cache';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './service-worker.js',
  './styles/base.css',
  './styles/layout.css',
  './styles/pos.css',
  './styles/orders.css',
  './styles/reports.css',
  './styles/import.css',
  './styles/products.css',
  './styles/settings.css',
  './js/app.js',
  './js/core/store.js',
  './js/core/storage.js',
  './js/core/utils.js',
  './js/pages/pos-page.js',
  './js/pages/orders-page.js',
  './js/pages/reports-page.js',
  './js/pages/products-page.js',
  './js/pages/settings-page.js',
  './js/modules/cart-service.js',
  './js/modules/order-service.js',
  './js/modules/report-session.js',
  './js/modules/drag-sort.js',
  './js/modules/product-category-manager.js',
  './js/modules/product-module-manager.js',
  './js/modules/print-service.js',
  './js/modules/print-bridge.js',
  './js/modules/realtime-order-service.js',
  './js/modules/google-backup-service.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Firebase CDN 和外部 API 不做快取
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  // 127.0.0.1 APK 端不做快取（避免攔截到 ping/print）
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;

  event.respondWith(
    fetch(event.request).then((response) => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => {
      return caches.match(event.request).then(cached => cached || caches.match('./index.html'));
    })
  );
});
