const version = "26.2.42.00";
const prefix = "sky-strike-offline-";
const cacheName = prefix + version;
const gameFiles = ["./","./offline-install.js","./app.webmanifest","./skystrike-icon-192.png","./skystrike-icon-512.png","./assets/runtime/game-3f5387b619de.js","./assets/compact/title.webp","./assets/compact/loading.webp","./assets/free-audio/briefing.mp3","./assets/free-audio/hangar.mp3","./assets/free-audio/combat.mp3","./assets/free-audio/combat-2.mp3","./assets/free-audio/boss.mp3","./assets/free-audio/launch.mp3","./assets/free-audio/special-launch.mp3","./assets/free-audio/weapon-switch.mp3","./assets/free-audio/gun.mp3","./assets/free-audio/explosion.mp3","./assets/free-audio/interface.mp3","./assets/free-audio/booster.mp3","./assets/compact/aerial_grass_rock-Diffuse.webp","./assets/compact/aerial_grass_rock-nor_gl.jpg","./assets/compact/aerial_grass_rock-Rough.webp","./assets/compact/aerial_ground_rock-Diffuse.webp","./assets/compact/aerial_ground_rock-nor_gl.jpg","./assets/compact/aerial_ground_rock-Rough.webp","./assets/compact/blue_metal_plate-nor_gl.jpg","./assets/compact/blue_metal_plate-Rough.webp"];
const scope = new URL(self.registration.scope);
const urlFor = path => new URL(path, scope).href;
const indexPath = new URL("index.html", scope).pathname;
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
  const bytes = await response.blob();
  const length = bytes.size;
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

async function loadAsset(request) {
  const source = new URL(request.url);
  // Open pages from the previous release can still request the old JPEG paths.
  if (/\/(?:aerial_(?:grass|ground)_rock-(?:Diffuse|Rough)|blue_metal_plate-Rough)\.jpg$/.test(source.pathname)
      && source.pathname.startsWith(scope.pathname + "assets/compact/")) {
    source.pathname = source.pathname.replace(/\.jpg$/, ".webp");
  }
  const current = await caches.match(source.href, { cacheName });
  if (current) return current;
  try {
    const response = await fetch(source.href === request.url ? request : source.href);
    if (response.ok) return response;
    return (await findSaved(request.url)) ?? response;
  } catch {
    return (await findSaved(source.href)) ?? (await findSaved(request.url)) ?? Response.error();
  }
}

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.origin) return;
  if (request.mode === "navigate" && (url.pathname === scope.pathname || url.pathname === indexPath)) {
    event.respondWith(fetch(request).catch(async () => (await findSaved(scope.href)) ?? Response.error()));
  } else if (cachedURLs.has(url.href) || url.pathname.startsWith(scope.pathname + "assets/")) {
    event.respondWith((async () => {
      const saved = await loadAsset(request);
      if (saved.status !== 200) return saved;
      return request.headers.has("Range") ? savedRange(request, saved) : saved;
    })());
  }
});
