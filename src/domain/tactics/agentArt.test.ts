/**
 * F59 · MANIFIESTO DE ARTE DE AGENTES — pruebas A–G del encargo.
 *
 * A todo agente canónico tiene entrada · B sin ids duplicados · C ningún asset apunta a un fichero
 * inexistente · D nada ambiguo se asigna en silencio · E cara/cuerpo se resuelven bien · F respaldo
 * (legado/desconocido → null) · G determinismo (plan y manifiesto no dependen del orden ni de la fecha).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TACTICAL_AGENTS } from "./roster";
import { AGENT_ART_MANIFEST } from "./agentArtManifest";
import {
  AGENT_ART_KINDS, AGENT_ART_SOURCE_DIRS, agentArtwork, agentIdFromName, getAgentArtwork, normalizeAgentKey, planAgentArt, type SourceFile,
} from "./agentArt";

const ROOT = process.cwd();
const ids = TACTICAL_AGENTS.map((a) => a.id);
const realFiles = (): SourceFile[] =>
  AGENT_ART_KINDS.flatMap((kind) => readdirSync(join(ROOT, "personajes", AGENT_ART_SOURCE_DIRS[kind])).map((file) => ({ kind, file })));

test("A · todo agente canónico del roster tiene su fila en el manifiesto (y nada más)", () => {
  assert.ok(ids.length >= 29, "el roster se lee del catálogo real");
  assert.deepEqual(Object.keys(AGENT_ART_MANIFEST).sort(), [...ids].sort());
});

test("B · ni ids ni rutas duplicadas", () => {
  assert.equal(new Set(ids).size, ids.length);
  const srcs = Object.values(AGENT_ART_MANIFEST).flatMap((m) => [m.face?.src, m.full?.src]).filter(Boolean);
  assert.equal(new Set(srcs).size, srcs.length);
});

test("C · cada asset existe en public/, su ?v= es el hash del fichero y su original sigue en personajes/", () => {
  for (const [id, m] of Object.entries(AGENT_ART_MANIFEST)) {
    for (const kind of AGENT_ART_KINDS) {
      const a = m[kind];
      if (!a) continue;
      const [path, v] = a.src.split("?v=");
      assert.equal(path, `/agents/${id}/${kind}.webp`, `${id}/${kind}: ruta canónica`);
      const file = join(ROOT, "public", path);
      assert.ok(existsSync(file), `${id}/${kind}: falta ${path}`);
      assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10), v, `${id}/${kind}: derivado desactualizado (npm run agent-art:import)`);
      const orig = join(ROOT, a.source);
      assert.ok(existsSync(orig), `${id}/${kind}: el original ${a.source} no está`);
      assert.equal(createHash("sha256").update(readFileSync(orig)).digest("hex").slice(0, 16), a.sourceSha, `${id}/${kind}: el original cambió`);
      assert.ok(a.width > 0 && a.height > 0);
      if (kind === "face") {
        assert.ok(a.width <= 256 && a.height <= 256, "cara ≤ 256 px");
        assert.ok(a.small, `${id}: falta la cara pequeña`);
        const [sp, sv] = a.small!.src.split("?v=");
        assert.equal(sp, `/agents/${id}/face-96.webp`);
        const sf = join(ROOT, "public", sp);
        assert.ok(existsSync(sf), `${id}: falta ${sp}`);
        assert.equal(createHash("sha256").update(readFileSync(sf)).digest("hex").slice(0, 10), sv);
        assert.ok(a.small!.width <= 96 && a.small!.height <= 96);
      }
    }
  }
});

test("D · dos ficheros para el mismo agente y pieza = colisión (no se elige uno); lo desconocido se informa", () => {
  const plan = planAgentArt([
    { kind: "face", file: "jett.png" },
    { kind: "face", file: "Jett.webp" },
    { kind: "face", file: "sova.webp" },
    { kind: "face", file: "notas.txt" },
    { kind: "full", file: "veil.webp" },
    { kind: "full", file: "jet.png" },
  ]);
  assert.deepEqual(plan.collisions, [{ kind: "face", agentId: "jett", files: ["jett.png", "Jett.webp"] }]);
  assert.equal(plan.assigned.face.jett, undefined, "una colisión no se asigna");
  assert.equal(plan.assigned.face.sova, "sova.webp");
  assert.deepEqual(plan.unknown.map((u) => u.file).sort(), ["jet.png", "notas.txt", "veil.webp"], "legado, casi-nombres y no-imágenes no son agentes");
  assert.ok(plan.missing.full.includes("jett"));
});

test("D · la carpeta real: sin colisiones ni ficheros sin dueño; los renombrados se declaran", () => {
  const plan = planAgentArt(realFiles());
  assert.deepEqual(plan.collisions, []);
  assert.deepEqual(plan.unknown, []);
  const renamed = Object.fromEntries(plan.renamed.map((r) => [`${r.kind}:${r.file}`, `${r.agentId}/${r.via}`]));
  assert.equal(renamed["face:Omen.webp"], "omen/case");
  assert.equal(renamed["full:geko.avif"], "gekko/alias");
});

test("E · normalización explícita: id, nombre, mayúsculas, símbolos y alias; sin parecidos", () => {
  assert.equal(normalizeAgentKey("KAY/O"), "kayo");
  for (const [raw, id] of [["jett", "jett"], ["Jett", "jett"], ["KAY/O", "kayo"], ["Kay O", "kayo"], ["kayo", "kayo"], ["Omen", "omen"], ["geko", "gekko"], ["Gekko", "gekko"], ["Kill Joy", "killjoy"]] as const) {
    assert.equal(agentIdFromName(raw), id, raw);
  }
  for (const raw of ["jet", "jettt", "Kay", "veil", "Warden", "", "TenZ"]) assert.equal(agentIdFromName(raw), null, `«${raw}» no es un agente`);
});

test("E · cara y cuerpo se resuelven por id canónico", () => {
  for (const id of ids) {
    const art = agentArtwork(id)!;
    assert.equal(art.agentId, id);
    assert.equal(getAgentArtwork(id, "face"), AGENT_ART_MANIFEST[id].face);
    assert.equal(getAgentArtwork(id, "full"), AGENT_ART_MANIFEST[id].full);
  }
  assert.match(getAgentArtwork("jett", "face")!.src, /^\/agents\/jett\/face\.webp\?v=/);
  assert.match(getAgentArtwork("gekko", "full")!.source, /personajes\/entero\/geko\.avif$/);
});

test("F · respaldo: legado, desconocido o vacío → null (el componente pinta el emblema, sin pedir nada)", () => {
  for (const id of ["veil", "warden", "notanagent", "", null, undefined]) {
    assert.equal(agentArtwork(id as string), null);
    assert.equal(getAgentArtwork(id as string, "face"), null);
    assert.equal(getAgentArtwork(id as string, "full"), null);
  }
  // El nombre visible NO es la clave: sólo el id canónico resuelve arte.
  assert.equal(agentArtwork("KAY/O"), null);
});

test("G · determinismo: el plan no depende del orden de lectura; el manifiesto va ordenado y sin fechas", () => {
  const files = realFiles();
  const a = planAgentArt(files);
  const b = planAgentArt([...files].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(AGENT_ART_MANIFEST), [...Object.keys(AGENT_ART_MANIFEST)].sort());
  const src = readFileSync(join(ROOT, "src/domain/tactics/agentArtManifest.ts"), "utf8");
  assert.ok(!/20\d\d-\d\d-\d\d|Date|generatedAt/.test(src), "sin marcas de tiempo");
});

test("una sola puerta: ninguna pantalla compone rutas de arte de agente ni lee personajes/", () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const permitidos = /agentArtManifest\.ts$|agentArt\.ts$|agentArt\.test\.ts$|agents[\\/]visuals\.ts$|lib[\\/]assets\.ts$|\.test\.tsx?$/;
  for (const f of walk(join(ROOT, "src")).filter((p) => /\.(ts|tsx)$/.test(p) && !permitidos.test(p))) {
    const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/personajes\//.test(code), `${f} lee personajes/ directamente`);
    for (const id of ids) assert.ok(!code.includes(`/agents/${id}/`), `${f} compone la ruta de ${id} a mano`);
  }
});
