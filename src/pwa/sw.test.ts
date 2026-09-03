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
