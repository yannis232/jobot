/* Seulement les fichiers publics du site. Les documents privés restent dans le coffre. */
const CACHE='moneyscout-static-1.1.0';
const BASE=new URL('./',self.location.href);
const ASSETS=['./','index.html','manifest.webmanifest','assets/theme.css','assets/mark.svg','assets/app.mjs','assets/core.mjs','assets/vault.mjs','assets/sources.mjs','assets/pdf.mjs','assets/leaflet.js','assets/leaflet.css','assets/lib/jspdf.umd.min.js','assets/lib/pdf.min.mjs','assets/lib/pdf.worker.min.mjs','assets/lib/Vera.ttf'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(p=>new URL(p,BASE).href)))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('moneyscout-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==BASE.origin||!u.pathname.startsWith(BASE.pathname))return;
if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(new URL('index.html',BASE).href,copy));}return response;}).catch(()=>caches.match(new URL('index.html',BASE).href)));return;}
event.respondWith(caches.match(event.request).then(saved=>saved||fetch(event.request)));
});
