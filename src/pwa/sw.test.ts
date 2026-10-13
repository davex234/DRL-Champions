/**
 * SERVICE WORKER — invariantes de caché (regresión de la auditoría de estabilidad).
 *
 * EL FALLO QUE ESTO IMPIDE QUE VUELVA
 *
 * `public/sw.js` decía «estáticos: stale-while-revalidate» pero no filtraba nada: cacheaba
 * TODO GET del mismo origen que no fuera una navegación. Medido en un build real: 107
 * cargas RSC guardadas por sesión, servidas con `cached || network`.
 *
 * Una carga RSC es el flujo Flight de UNA compilación concreta. Servirle a un cliente la
 * de otra rompe el protocolo con `chunk.reason.enqueueModel is not a function`.
 *
 * Estos tests leen el service worker REAL y comprueban sus invariantes. Son de código
 * fuente a propósito: el fichero se sirve tal cual desde `public/`, no pasa por el
 * empaquetador, así que no hay forma de importarlo ni de simularlo con fidelidad. La
 * comprobación de comportamiento en un navegador de verdad está en `npm run sw:verify`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SW = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

/** El cuerpo del `fetch` sin los comentarios: lo que de verdad se ejecuta. */
const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("el service worker excluye explícitamente las cargas RSC", () => {
  assert.match(code, /_rsc/, "no hay ninguna comprobación de `_rsc`");
  assert.match(
    code,
    /isRscRequest\s*\(/,
    "la exclusión de RSC debería estar en una función con nombre, para que se lea",
  );
  // Y la exclusión tiene que ejecutarse ANTES de cualquier `respondWith`.
  const guard = code.indexOf("isRscRequest(url, req)");
  const firstRespond = code.indexOf("event.respondWith");
  assert.ok(guard > 0, "la guarda de RSC no se llama en el manejador de `fetch`");
  assert.ok(
    guard < firstRespond,
    "la guarda de RSC se evalúa DESPUÉS de responder: llega tarde",
  );
});

test("el service worker excluye las respuestas de /api/", () => {
  assert.match(code, /isApiRequest\s*\(/, "no hay comprobación de `/api/`");
  const guard = code.indexOf("isApiRequest(url)");
  const firstRespond = code.indexOf("event.respondWith");
  assert.ok(guard > 0 && guard < firstRespond, "la guarda de `/api/` no protege nada");
});

test("las cabeceras del router de Next también identifican una carga RSC", () => {
  /*
   * `?_rsc=` no está en todas: un prefetch puede llegar solo con cabeceras. Si únicamente
   * se mira la query, una parte del tráfico Flight se cachearía igual.
   */
  for (const header of ["RSC", "Next-Router-Prefetch", "Next-Router-State-Tree"]) {
    assert.match(code, new RegExp(header), `no se comprueba la cabecera ${header}`);
  }
});

test("solo se cachea lo que es inmutable o inofensivo", () => {
  // Estáticos con hash de contenido: la URL cambia si cambia el contenido.
  assert.match(code, /_next\/static/, "no se distingue el estático con hash de Next");
  assert.match(code, /isImmutableAsset\s*\(/);
  assert.match(code, /isPublicAsset\s*\(/);
});

test("el manejador termina dejando pasar lo no reconocido", () => {
  /*
   * La regla de oro invertida: la versión rota tenía un `respondWith` final que capturaba
   * TODO lo que no fuera una navegación. Aquí cada estrategia sale con `return` y lo que
   * no encaja en ninguna se va a la red sin tocarse.
   */
  const responds = code.match(/event\.respondWith/g) ?? [];
  assert.equal(responds.length, 3, `se esperaban 3 estrategias y hay ${responds.length}`);
  const tail = code.slice(code.lastIndexOf("event.respondWith"));
  assert.ok(
    /return;\s*\n\s*\}\s*\n[^}]*\}\s*\)\s*;?\s*$/.test(tail) || tail.trim().endsWith("});"),
    "el manejador debería acabar sin una rama que lo capture todo",
  );
});

test("el nombre de la caché lleva versión, para que `activate` limpie la anterior", () => {
  const name = code.match(/const CACHE = "([^"]+)"/)?.[1];
  assert.ok(name, "no se encuentra el nombre de la caché");
  assert.match(name!, /-v\d+$/, `«${name}» no lleva versión al final`);
  assert.notEqual(
    name,
    "drl-champions-v1",
    "sigue el nombre de la caché envenenada: `activate` no la borraría",
  );
  // Y `activate` tiene que borrar todo lo que no sea la actual.
  assert.match(code, /caches\.delete\(k\)/, "`activate` no borra las cachés antiguas");
});

/*
 * F70.1 · REGRESIÓN REAL (prueba manual de la RC). Con el servidor caído, la v2 respondía a
 * cualquier navegación con `caches.match(req) || caches.match("/")`: rutas como /logros o
 * /perfil pintaban la PORTADA cacheada (el hub JUGAR/INVENTARIO/TIENDA) con estado 200 y el
 * nivel/saldo congelados de la última cuenta, mientras cada `/api` daba «Failed to fetch».
 * Los gates no lo vieron porque siempre corrían con el servidor vivo.
 */
test("F70.1 · una navegación fallida NUNCA sirve el HTML de otra ruta", () => {
  assert.ok(!/caches\.match\(\s*["']\/["']\s*\)/.test(code), "vuelve el respaldo a la portada «/»");
  const nav = code.slice(code.indexOf('req.mode === "navigate"'), code.indexOf("isImmutableAsset(url)", code.indexOf('req.mode === "navigate"')));
  assert.ok(nav.length > 0, "no se encuentra la rama de navegaciones");
  assert.ok(!/caches\.match\(\s*req\s*\)/.test(nav), "la navegación vuelve a servir HTML cacheado de la propia ruta (sesión congelada)");
  assert.ok(!/\.put\(/.test(nav), "las navegaciones vuelven a guardarse en caché (HTML personal)");
  assert.match(nav, /OFFLINE_URL/, "sin conexión debe mostrarse la página offline explícita");
});

test("F70.1 · el precache es solo la página offline y el manifiesto (nada de HTML personal)", () => {
  const pre = code.match(/const PRECACHE = \[([^\]]*)\]/)?.[1] ?? "";
  assert.ok(!/["']\/["']/.test(pre), "«/» vuelve a estar precacheada");
  assert.match(code, /const OFFLINE_URL = "\/offline\.html"/);
  const html = readFileSync(join(process.cwd(), "public", "offline.html"), "utf8");
  assert.match(html, /data-offline="1"/);
  assert.ok(!/<script/i.test(html), "la página offline no debe llevar script (CSP y datos)");
  assert.ok(!/JUGAR|INVENTARIO|DRL Credit/i.test(html), "la página offline no debe parecerse al hub");
});

test("F70.1 · la caché sube de versión para purgar la v2 envenenada con HTML personal", () => {
  const name = code.match(/const CACHE = "([^"]+)"/)?.[1] ?? "";
  const v = Number(name.match(/-v(\d+)$/)?.[1] ?? 0);
  assert.ok(v >= 3, `«${name}»: la v2 guardaba HTML personal y debe purgarse`);
});

test("el worker acepta la orden de purga que usa el modo desarrollo", () => {
  assert.match(code, /nexus:purge/, "no hay canal para retirar el worker desde la página");
  assert.match(code, /registration\.unregister\(\)/, "la purga no se desregistra");
});

test("RegisterSW RETIRA el worker en desarrollo, no se limita a no registrarlo", () => {
  /*
   * Un service worker instalado desde una compilación de producción sigue controlando el
   * mismo origen en `next dev`. La versión anterior hacía `return` en desarrollo, que lo
   * deja exactamente donde estaba.
   */
  const src = readFileSync(join(process.cwd(), "src/components/pwa/RegisterSW.tsx"), "utf8");
  assert.match(src, /getRegistrations\(\)/, "no busca registros previos");
  assert.match(src, /\.unregister\(\)/, "no desregistra en desarrollo");
  assert.match(src, /nexus:purge/, "no le pide al worker que vacíe sus cachés");
});
