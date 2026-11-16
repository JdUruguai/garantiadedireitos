/* Service worker do Genograma: guarda os arquivos do aplicativo para ele abrir sem internet.
   Só responde pelos arquivos listados abaixo; o restante do site passa direto pela rede. */
var CACHE = 'genograma-v1';
var ARQUIVOS = [
  'genograma.html',
  'genograma.webmanifest',
  'icones/genograma-180.png',
  'icones/genograma-192.png',
  'icones/genograma-512.png',
  'icones/genograma-512-maskable.png'
];
var URLS = ARQUIVOS.map(function (a) { return new URL(a, self.registration.scope).href; });

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(URLS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('genograma-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Rede primeiro (para receber atualizações); sem rede, usa a cópia guardada. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = e.request.url.split('#')[0].split('?')[0];
  if (URLS.indexOf(url) < 0) return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      if (r && r.ok) { var copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(url, copia); }); }
      return r;
    }).catch(function () { return caches.match(url); })
  );
});
