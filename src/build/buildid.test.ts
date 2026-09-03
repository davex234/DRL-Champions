/**
 * BUILD ID — reproducible y sensible al contenido (regresión de la auditoría).
 *
 * EL FALLO QUE ESTO IMPIDE QUE VUELVA
 *
 * `generateBuildId` devolvía `drl-${version}-${build}` leyendo solo `version.json`: dos
 * compilaciones con CÓDIGO DISTINTO compartían identificador mientras no se tocara el
 * número de versión. Comprobado en su día: se cambió un fichero de `src/`, se recompiló, y
 * el id seguía siendo `drl-0.1.1-1`.
 *
 * Next manda el build id en cada petición RSC y el cliente compara: si no coincide, fuerza
 * una recarga completa. Es su red de seguridad para cuando se despliega mientras alguien
 * tiene la pestaña abierta. Con un id congelado esa red nunca se dispara.
 *
 * Las dos propiedades tienen que cumplirse A LA VEZ, y por eso van juntas aquí:
 *   · REPRODUCIBLE  — mismo código, mismo id (artefactos del Build Cloud comparables).
 *   · SENSIBLE      — código distinto, id distinto (la red de seguridad funciona).
 * Arreglar una rompiendo la otra es exactamente lo que pasó la primera vez.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Carga la configuración con caché invalidada: el id se calcula al importarla. */
async function buildId(): Promise<string | null> {
  const mod = await import(`../../next.config.mjs?cache=${Date.now()}${Math.random()}`);
  const gen = mod.default?.generateBuildId;
  assert.equal(typeof gen, "function", "next.config.mjs no expone generateBuildId");
  return gen();
}

test("el build id es reproducible: mismo código, mismo identificador", async () => {
  const a = await buildId();
  const b = await buildId();
  assert.ok(a, "no se generó ningún build id");
  assert.equal(a, b, "dos lecturas seguidas dan identificadores distintos");
});

test("el build id incluye la versión, para que siga siendo legible", async () => {
  const id = (await buildId())!;
  const v = JSON.parse(readFileSync(join(ROOT, "version.json"), "utf8"));
  assert.ok(
    id.startsWith(`drl-${v.version}-${v.build}-`),
    `«${id}» no empieza por la versión declarada`,
  );
});

test("el build id CAMBIA cuando cambia el código", async () => {
  const victim = join(ROOT, "src", "design", "tokens.ts");
  const original = readFileSync(victim, "utf8");
  const before = await buildId();

  try {
    writeFileSync(victim, `${original}\n/* marca temporal del test */\n`, "utf8");
    const after = await buildId();
    assert.notEqual(
      after,
      before,
      "cambiar una fuente NO cambió el build id: la red de seguridad de Next queda anulada",
    );
  } finally {
    writeFileSync(victim, original, "utf8");
  }

  // Y al revertir, vuelve el mismo de antes: eso es lo que hace reproducible la compilación.
  assert.equal(await buildId(), before, "revertir el cambio no devuelve el id original");
});

test("el build id también cambia si cambia el service worker", async () => {
  /*
   * `public/sw.js` no se compila, se sirve tal cual. Si no entrara en el hash, cambiar la
   * estrategia de caché no cambiaría el build id y los navegadores con la versión anterior
   * no tendrían forma de enterarse —que es justo el problema que se acaba de arreglar.
   */
  const victim = join(ROOT, "public", "sw.js");
  const original = readFileSync(victim, "utf8");
  const before = await buildId();

  try {
    writeFileSync(victim, `${original}\n/* marca temporal del test */\n`, "utf8");
    assert.notEqual(await buildId(), before, "cambiar el service worker no cambia el build id");
  } finally {
    writeFileSync(victim, original, "utf8");
  }
});
