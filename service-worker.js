const CACHE_NAME = 'pos-v20260621-mobile-order-hotfix';
const ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './online-order.html',
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
  './styles/dashboard.css',
  './styles/online-order.css',
  './js/app.js',
  './js/core/store.js',
  './js/core/storage.js',
  './js/core/utils.js',
  './js/core/store-config.js',
  './js/pages/pos-page.js',
  './js/pages/orders-page.js',
  './js/pages/reports-page.js',
  './js/pages/products-page.js',
  './js/pages/settings-page.js',
  './js/pages/online-order-page.js',
  './js/pages/dashboard-page.js',
  './js/print-service-dashboard.js',
  './js/history-loader.js',
  './js/modules/cart-service.js',
  './js/modules/order-service.js',
  './js/modules/report-session.js',
  './js/modules/drag-sort.js',
  './js/modules/product-category-manager.js',
  './js/modules/product-module-manager.js',
  './js/modules/print-service.js',
  './js/modules/print-bridge.js',
  './js/modules/realtime-order-service.js',
  './js/modules/promotion-service.js',
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
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;

  const isFreshAsset = event.request.mode === 'navigate' ||
    ['document', 'style', 'script'].includes(event.request.destination) ||
    /\.(html|css|js)$/i.test(url.pathname);

  const requestForNetwork = isFreshAsset
    ? new Request(event.request, { cache: 'no-store' })
    : event.request;

  event.respondWith(
    fetch(requestForNetwork).then((response) => {
      // HTML/CSS/JS 優先保持最新，避免手機舊 Service Worker / HTTP cache 一直吃舊版。
      // 其他同源 GET 才動態快取，保留離線能力。
      if (!isFreshAsset && response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone).catch(() => {});
        });
      }
      return response;
    }).catch(() => {
      return caches.match(event.request).then(cached => cached || caches.match('./index.html'));
    })
  );
});
