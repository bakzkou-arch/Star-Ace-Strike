const version = "26.2.37.01";
const prefix = "sky-strike-offline-";
const cacheName = prefix + version;
const gameFiles = ["./","./offline-install.js","./app.webmanifest","./skystrike-icon-192.png","./skystrike-icon-512.png","./assets/aerial_grass_rock-Diffuse.jpg","./assets/aerial_grass_rock-nor_gl.jpg","./assets/aerial_grass_rock-Rough.jpg","./assets/aerial_ground_rock-Diffuse.jpg","./assets/aerial_ground_rock-nor_gl.jpg","./assets/aerial_ground_rock-Rough.jpg","./assets/blue_metal_plate-nor_gl.jpg","./assets/blue_metal_plate-Rough.jpg"];
const scope = new URL(self.registration.scope);
const urlFor = path => new URL(path, scope).href;
const cachedURLs = new Set(gameFiles.map(urlFor));
let saving;

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

async function saveGame() {
  const cache = await caches.open(cacheName);
  await cache.addAll([...cachedURLs].map(url => new Request(url, { cache: "reload" })));
  for (const name of await caches.keys()) {
    if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
  }
}

self.addEventListener("message", event => {
  if (event.data?.type !== "save-game" || !event.ports[0]) return;
  const port = event.ports[0];
  if (event.data.version !== version) {
    port.postMessage({ ok: false, update: true });
    return;
  }
  saving ??= saveGame().finally(() => { saving = undefined; });
  event.waitUntil(saving.then(() => port.postMessage({ ok: true }),
    () => port.postMessage({ ok: false })));
});

async function findSaved(url) {
  const current = await caches.match(url, { cacheName });
  if (current) return current;
  for (const name of (await caches.keys()).reverse()) {
    if (!name.startsWith(prefix) || name === cacheName) continue;
    const previous = await caches.match(url, { cacheName: name });
    if (previous) return previous;
  }
}

async function savedRange(request, response) {
  const bytes = await response.arrayBuffer();
  const length = bytes.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(request.headers.get("Range"));
  const start = match?.[1] ? Number(match[1]) : Math.max(0, length - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  if (!match || (!match[1] && !match[2]) || start > end || start >= length) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + length } });
  }
  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding");
  headers.set("Content-Range", `bytes ${start}-${end}/${length}`);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.origin) return;
  if (request.mode === "navigate" && url.pathname === scope.pathname) {
    event.respondWith(fetch(request).catch(async () => (await findSaved(scope.href)) ?? Response.error()));
  } else if (cachedURLs.has(url.href)) {
    event.respondWith((async () => {
      const saved = await findSaved(url.href);
      if (!saved) return fetch(request);
      return request.headers.has("Range") ? savedRange(request, saved) : saved;
    })());
  }
});
