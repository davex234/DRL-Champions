/**
 * F59.1 · CATÁLOGO DE AGENTES DE ESPORTS COMPLETO — Miks y Veto (0056).
 *
 * Tres copias del mismo hecho tienen que decir lo mismo que el roster verificado del Tactical Coach:
 * la tabla `public.agents` (seed 0003 + 0056), su espejo TS y el registro de slugs de VLR. Si Riot saca
 * otro agente y sólo se añade en un sitio, esto falla en vez de dejar estadísticas con agent_id NULL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS, getAgent } from "./agents";
import { TACTICAL_AGENTS } from "@/domain/tactics/roster";
import { agentName, agentFromSrc } from "@/importer-vlr/agents";

const MIG = join(process.cwd(), "supabase", "migrations");
const seeded = (): Map<string, { name: string; role: string }> => {
  const m = new Map<string, { name: string; role: string }>();
  for (const f of readdirSync(MIG).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    const sql = readFileSync(join(MIG, f), "utf8");
    for (const block of sql.match(/insert into public\.agents \(id, name, role\) values[\s\S]*?on conflict/g) ?? []) {
      for (const [, id, name, role] of block.matchAll(/\(\s*'([a-z0-9]+)'\s*,\s*'([^']+)'\s*,\s*'([a-z]+)'\s*\)/g)) m.set(id, { name, role });
    }
  }
  return m;
};

test("Miks (controlador) y Veto (centinela) están en el catálogo de esports", () => {
  assert.deepEqual(getAgent("miks"), { id: "miks", name: "Miks", role: "controller" });
  assert.deepEqual(getAgent("veto"), { id: "veto", name: "Veto", role: "sentinel" });
});

test("espejo TS = roster verificado del entrenador (mismos ids y mismos roles)", () => {
  const esports = new Map(AGENTS.map((a) => [a.id, a.role]));
  assert.equal(esports.size, AGENTS.length, "sin ids duplicados");
  assert.deepEqual([...esports.keys()].sort(), TACTICAL_AGENTS.map((a) => a.id).sort());
  for (const a of TACTICAL_AGENTS) assert.equal(esports.get(a.id), a.role, a.id);
});

test("las migraciones siembran exactamente el espejo TS (0003 + 0056)", () => {
  const db = seeded();
  assert.deepEqual([...db.keys()].sort(), AGENTS.map((a) => a.id).sort());
  for (const a of AGENTS) assert.deepEqual(db.get(a.id), { name: a.name, role: a.role }, a.id);
});

/* ═══════════ 0056 contra el estado REAL de producción (Veto ya existía como duelist) ═══════════ */

const MIG56 = readFileSync(join(MIG, "0056_agents_catalog_miks_veto.sql"), "utf8").replace(/--.*$/gm, "");
type Row = { id: string; name: string; role: string; icon: string | null };

/** Aplica LAS SENTENCIAS DEL FICHERO (parseadas, no reescritas) a un estado de `public.agents`. */
function apply56(state: Row[]): Row[] {
  const rows = state.map((r) => ({ ...r }));
  for (const stmt of MIG56.split(";").map((x) => x.trim()).filter(Boolean)) {
    const ins = /^insert into public\.agents \(id, name, role\) values \('([a-z]+)', '([^']+)', '([a-z]+)'\)\s+on conflict \(id\) do nothing$/.exec(stmt);
    const upd = /^update public\.agents set role = '([a-z]+)'\s+where id = '([a-z]+)' and role = '([a-z]+)'$/.exec(stmt);
    if (ins) { if (!rows.some((r) => r.id === ins[1])) rows.push({ id: ins[1], name: ins[2], role: ins[3], icon: null }); }
    else if (upd) { for (const r of rows) if (r.id === upd[2] && r.role === upd[3]) r.role = upd[1]; }
    else assert.fail(`sentencia no prevista en 0056: ${stmt}`);
  }
  return rows.sort((x, y) => x.id.localeCompare(y.id));
}

const seed27 = (): Row[] => [...seeded()].filter(([id]) => id !== "miks" && id !== "veto").map(([id, v]) => ({ id, ...v, icon: null }));
const canon = (): Row[] => AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role, icon: null })).sort((x, y) => x.id.localeCompare(y.id));
const prod28 = (): Row[] => [...seed27(), { id: "veto", name: "Veto", role: "duelist", icon: null }];

test("0056 · sólo tres sentencias: dos altas idempotentes y UN update limitado a veto.role duelist→sentinel", () => {
  const stmts = MIG56.split(";").map((x) => x.trim()).filter(Boolean);
  assert.equal(stmts.length, 3);
  assert.ok(!/\b(delete|drop|alter|truncate|create)\b/i.test(MIG56), "sin borrados ni esquema");
  assert.equal(MIG56.match(/\bupdate\b/gi)?.length, 1);
  assert.match(MIG56, /update public\.agents set role = 'sentinel'\s+where id = 'veto' and role = 'duelist'/, "sólo el role, sólo veto, sólo desde duelist");
  assert.ok(!/stats/i.test(MIG56), "no toca estadísticas");
});

test("0056 · producción (28, veto duelist) → 29 canónicos, MISMO id de veto, los otros 27 intactos", () => {
  assert.equal(prod28().length, 28);
  const after = apply56(prod28());
  assert.deepEqual(after, canon());
  assert.equal(after.filter((r) => r.id === "veto").length, 1);
  for (const r of seed27()) assert.deepEqual(after.find((x) => x.id === r.id), r, `${r.id} no cambia`);
});

test("0056 · idempotente: segunda pasada, BD ya corregida o BD nueva desde el repo → mismo resultado, sin duplicados", () => {
  const once = apply56(prod28());
  assert.deepEqual(apply56(once), once, "segunda pasada = sin cambios");
  assert.deepEqual(apply56(canon()), canon(), "Miks y Veto ya correctos");
  assert.deepEqual(apply56(seed27()), canon(), "BD nueva (seed 0003 del repo)");
  for (const st of [once, apply56(once)]) for (const id of ["miks", "veto"]) assert.equal(st.filter((r) => r.id === id).length, 1);
});

test("el importador de VLR nombra a Miks y Veto (antes: capitalización por defecto)", () => {
  assert.equal(agentFromSrc("/img/vlr/game/agents/miks.png"), "Miks");
  assert.equal(agentFromSrc("/img/vlr/game/agents/veto.png"), "Veto");
  // Y el nombre de cada agente del catálogo vuelve a su id (así lo resuelve el sync contra la tabla).
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = new Map(AGENTS.flatMap((a) => [[norm(a.name), a.id], [norm(a.id), a.id]] as const));
  for (const a of AGENTS) assert.equal(byName.get(norm(agentName(a.id))), a.id, a.id);
});
