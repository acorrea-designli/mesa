/* Mesa service worker (scope /). Deliberately small and data-free:
 *  - precaches the static shell: the offline page, the manifest and the icons (none contains board data);
 *  - caches /_next/static/* (hashed JS, CSS, fonts) cache-first, so the app shell opens fast;
 *  - navigations are network-first with an 8 s limit; when the PC does not answer (network error, timeout, or a
 *    502/503/504 from `tailscale serve`) the cached /offline.html ("Sin conexión con tu PC") is shown;
 *  - NEVER caches /api/*, HTML pages or anything else with board data, and never stores or replays a write:
 *    every non-GET request and every other URL goes straight to the network, untouched.
 * Bump VERSION to drop old caches. */
const VERSION = "mesa-sw-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const NAV_TIMEOUT_MS = 8000;
const PRECACHE = ["/offline.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mesa-sw-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isStatic = (url) => url.pathname.startsWith("/_next/static/");

async function staticFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function navigate(request) {
  const offline = () => caches.open(SHELL).then((c) => c.match("/offline.html"));
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NAV_TIMEOUT_MS);
    const res = await fetch(request, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.status === 502 || res.status === 503 || res.status === 504) return (await offline()) || res;
    return res; // never stored
  } catch {
    return (await offline()) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live data: always the network
  if (isStatic(url)) return void event.respondWith(staticFirst(request));
  if (PRECACHE.includes(url.pathname) && request.mode !== "navigate") {
    return void event.respondWith(caches.open(SHELL).then((c) => c.match(request.url)).then((hit) => hit || fetch(request)));
  }
  if (request.mode === "navigate") return void event.respondWith(navigate(request));
});

// The page tells us which hashed assets the shell loaded, so they are there when the PC is not.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "cache-assets" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(ASSETS).then((cache) =>
      Promise.all(
        data.urls
          .filter((u) => typeof u === "string" && u.startsWith("/_next/static/"))
          .map((u) => cache.match(u).then((hit) => hit || fetch(u).then((res) => (res.ok ? cache.put(u, res) : undefined)).catch(() => undefined))),
      ),
    ),
  );
});
