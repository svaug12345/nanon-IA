// Service worker de L'Atelier de Nanon — v1.2.1
// Rôle : rendre l'appli installable et afficher la page même hors connexion.
// Changer CACHE à chaque nouvelle version force le téléphone à tout recharger.
const CACHE = "atelier-nanon-v1.2.1";
const FICHIERS = ["./", "index.html", "manifest.json", "icon-192.png", "icon-512.png"];

// Installation : on met les fichiers de l'appli en cache.
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

// Activation : on supprime les caches des anciennes versions.
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((cles) =>
    Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Requêtes : réseau d'abord (toujours la version à jour), cache si hors ligne.
// Les appels au relais Cloudflare (autre domaine) ne sont jamais mis en cache.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request))
  );
});
