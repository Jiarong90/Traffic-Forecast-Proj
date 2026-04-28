const CACHE_NAME = "fast-v15";

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        "/",
        "/index.html",
        "/css/base.css",
        "/css/layout.css",
        "/css/components.css",
        "/css/pages-dashboard.css",
        "/css/pages-map.css",
        "/css/pages-route.css",
        "/css/pages-weather.css",
        "/css/pages-alerts.css",
        "/css/modals.css",
        "/ml-traffic-model.js",
        "/js/app.js",
        "/js/auth.js",
        "/js/pages/dashboard.js",
        "/js/pages/routePlanner.js",
        "/js/pages/weather.js",
        "/js/features/reroute.js",
        "/js/features/journey.js",
        "/js/features/incidentImpact.js",
        "/js/features/mobileMenu.js",
        "/js/features/chatbot.js"
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const sameOrigin = new URL(event.request.url).origin === self.location.origin;
        if (sameOrigin && response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
