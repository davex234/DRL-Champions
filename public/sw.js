/* Service Worker de NEXUS — soporte offline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE FICHERO SE REESCRIBIÓ (auditoría de estabilidad)
 *
 * La versión anterior decía en su comentario «estáticos: stale-while-revalidate»,
 * pero el código NO filtraba nada: aplicaba caché a TODO GET del mismo origen que
 * no fuera una navegación. Medido en un build real, eso eran 107 cargas RSC y 32
 * chunks guardados por sesión.
 *
 * Las cargas RSC (`?_rsc=`) son el flujo Flight que el router pide en cada
 * navegación de cliente. Se devolvían con `cached || network`, es decir: si había
 * entrada, se servía sin comprobar nada. Un cliente de una compilación recibiendo
 * el flujo Flight de OTRA no cuadra —los identificadores de módulo no tienen nada
 * que ver— y React acaba en `resolveModelChunk` llamando a `enqueueModel` sobre
 * algo que no es un controlador de stream:
 *
 *     chunk.reason.enqueueModel is not a function
 *
 * Y como el nombre de la caché era una constante fija, el `activate` nunca borraba
 * nada: la caché envenenada sobrevivía a todos los despliegues.
 *
 * Peor aún: un service worker se instala por ORIGEN, no por modo. Basta con haber
 * abierto una vez una compilación de producción en `localhost:3001` para que
 * siguiera controlando las sesiones de desarrollo en ese mismo puerto, sirviendo
 * artefactos de producción a un cliente de desarrollo.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ESTRATEGIA ACTUAL — lista blanca, no lista negra.
 *
 *   · Navegaciones (HTML): network-first, con respaldo en caché para el modo avión.
 *   · Estáticos con hash de contenido (`/_next/static/…`): cache-first. Son
 *     inmutables por definición: si el contenido cambia, cambia la URL.
 *   · Iconos, imágenes y fuentes de `public/`: stale-while-revalidate.
 *   · TODO LO DEMÁS: se deja pasar sin tocar. Nada de RSC, nada de `/api/`.
 *
 * La regla de oro: si no se puede demostrar que un recurso es inmutable o que
 * servirlo viejo es inofensivo, NO se cachea.
 */

/*
 * El nombre lleva versión y hay que SUBIRLO en cualquier cambio de estrategia.
 * Al subirlo, el `activate` borra las cachés anteriores, y esa es la vía por la
 * que se limpia sola la caché envenenada que dejó la versión v1.
 */
const CACHE = "nexus-v2";

/** El armazón mínimo para que la aplicación abra sin conexión. */
const PRECACHE = ["/", "/manifest.webmanifest"];

/** Estáticos de Next: llevan hash en la URL, así que son inmutables. */
const isImmutableAsset = (url) => url.pathname.startsWith("/_next/static/");

/** Recursos propios de `public/`: pueden cambiar sin cambiar de nombre. */
const isPublicAsset = (url) =>
  /^\/(icons|branding|players|teams|img|images|fonts)\//.test(url.pathname) ||
  /\.(png|jpg|jpeg|webp|avif|svg|ico|woff2?|ttf)$/i.test(url.pathname);

/**
 * ¿Es una carga RSC? Es la petición que hace el router en cada navegación de
 * cliente. NUNCA se cachea: es específica de una compilación y de un estado del
 * árbol de rutas, y servir una vieja rompe el protocolo Flight.
 */
const isRscRequest = (url, req) =>
  url.searchParams.has("_rsc") ||
  req.headers.get("RSC") === "1" ||
  req.headers.get("Next-Router-Prefetch") === "1" ||
  req.headers.get("Next-Router-State-Tree") !== null;

/** Datos del usuario. Ni obsoletos ni compartidos entre cuentas del mismo navegador. */
const isApiRequest = (url) => url.pathname.startsWith("/api/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Permite a la página pedir la retirada del service worker y el borrado de sus
 * cachés. Lo usa `RegisterSW` en desarrollo: un service worker instalado desde una
 * compilación de producción seguiría controlando el mismo origen en `next dev`, y
 * ahí sus artefactos no valen para nada.
 */
self.addEventListener("message", (event) => {
  if (event.data !== "nexus:purge") return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Terceros (fuentes, banderas…): no se tocan.
  if (url.origin !== self.location.origin) return;

  // Las dos exclusiones que motivaron esta reescritura.
  if (isRscRequest(url, req) || isApiRequest(url)) return;

  // Navegaciones: siempre red primero; la caché es solo el paracaídas sin conexión.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  // Estáticos con hash: cache-first. Son inmutables, no hace falta revalidar.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Recursos de `public/`: stale-while-revalidate, que aquí sí es apropiado.
  if (isPublicAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Cualquier otra cosa: la red, sin intermediarios.
});
