/* Mesa service worker (scope /). Deliberately small and data-free:
 *  - precaches the static shell: the offline page, the manifest and the icons (none contains board data);
 *  - caches /_next/static/* (hashed JS, CSS, fonts) cache-first, so the app shell opens fast;
 *  - navigations are network-first with an 8 s limit; when the PC does not answer (network error, timeout, or a
 *    502/503/504/530 from the Cloudflare Tunnel: Mesa or the tunnel is down) the cached /offline.html ("Sin conexión con tu PC") is shown;
 *  - NEVER caches /api/*, HTML pages or anything else with board data, and never stores or replays a write:
 *    every non-GET request and every other URL goes straight to the network, untouched.
 *  - Web Push (t33): `push` shows a notification from the payload alone and fetches NOTHING (so Cloudflare Access cannot
 *    block it); `notificationclick` focuses an open Mesa window and navigates it, else opens the URL;
 *    `pushsubscriptionchange` re-subscribes and re-POSTs best effort (every page load also re-syncs, see usePush.ts).
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
      // One by one and tolerant: with an expired Access session these answer a redirect to the login, which must not
      // fail the whole install (the next visit retries). Same-origin fetches carry the CF_Authorization cookie.
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
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
    if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 530) return (await offline()) || res;
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

// ---------- Web Push (t33) ----------
// The server sends { title, url, tag } and nothing else (no ticket or salida text): the body is this fixed line.
const PUSH_BODY = "Toca para abrir Mesa.";

/** A same-origin path, never an absolute or protocol-relative URL. */
function safePath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") ? url : "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Mesa";
  const options = { body: PUSH_BODY, data: { url: safePath(data.url) } };
  if (typeof data.tag === "string" && data.tag) options.tag = data.tag.slice(0, 120);
  // A push always shows something (browsers require it); no fetch here.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (wins) => {
      const win = wins.find((c) => new URL(c.url).origin === self.location.origin);
      if (win) {
        try {
          const focused = await win.focus();
          return await (focused || win).navigate(url);
        } catch {
          /* the window went away or cannot navigate: open a new one */
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// The push service rotated the subscription: make a new one with the same key and tell Mesa, best effort. If Access
// blocks the POST, the next page load re-syncs it.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription;
        const key = old && old.options && old.options.applicationServerKey;
        const sub = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
        if (!sub) return;
        const j = sub.toJSON();
        await fetch("/api/push/subscription", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: (j.keys && j.keys.p256dh) || "", auth: (j.keys && j.keys.auth) || "" } }),
        });
      } catch {
        /* best effort */
      }
    })(),
  );
});
