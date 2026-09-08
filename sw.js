/** ============================================================
 *  sw.js — Service Worker for Offline PWA Support
 * ============================================================ */

const CACHE_NAME = 'pdf-flow-v11';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './merge-pdf.html',
    './image-to-pdf.html',
    './signature.html',
    './split-pdf.html',
    './pdf-to-image.html',
    './organize-pdf.html',
    './watermark-pdf.html',
    './page-number-pdf.html',
    './protect-pdf.html',
    './compress-pdf.html',
    './ocr-pdf.html',
    './rotate-pdf.html',
    './unlock-pdf.html',
    './crop-pdf.html',
    './word-to-pdf.html',
    './excel-to-pdf.html',
    './edit-pdf.html',
    './style.css',
    './signature.css',
    './theme.js',
    './app.js',
    './image-to-pdf.js',
    './signature.js',
    './split-pdf.js',
    './pdf-to-image.js',
    './organize-pdf.js',
    './watermark-pdf.js',
    './page-number-pdf.js',
    './protect-pdf.js',
    './compress-pdf.js',
    './ocr-pdf.js',
    './rotate-pdf.js',
    './unlock-pdf.js',
    './crop-pdf.js',
    './word-to-pdf.js',
    './excel-to-pdf.js',
    './edit-pdf.js',
    './gdrive-config.js',
    './gdrive-picker.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((k) => {
                    if (k !== CACHE_NAME) return caches.delete(k);
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    // 1. Bypass Service Worker for non-GET requests (e.g. POST to TrueEdit) or API endpoints
    if (e.request.method !== 'GET' || e.request.url.includes('/api/')) {
        return;
    }

    // 2. Cache first, fallback to network (ignore query string for versioned assets)
    e.respondWith(
        caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
            return cachedResponse || fetch(e.request).then((networkResponse) => {
                return networkResponse;
            }).catch(() => {
                return cachedResponse;
            });
        })
    );
});
