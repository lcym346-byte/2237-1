const CACHE_NAME = 'pos-v2111-cache';
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
  './js/pages/import-page.js',
  './js/pages/products-page.js',
  './js/pages/settings-page.js',
  './js/modules/cart-service.js',
  './js/modules/order-service.js',
  './js/modules/report-session.js',
  './js/modules/drag-sort.js',
  './js/modules/product-category-manager.js',
  './js/modules/product-module-manager.js',
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
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});