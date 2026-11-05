/**
 * F59.1 · /admin/system NO da verde por tener 0056 en el código: mira `public.agents` de verdad.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { agentCatalogHealth, type AgentRow } from "./agentCatalog";
import { AGENTS } from "@/data/esports/agents";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { systemHandlers } from "@/server/admin/handlers";
import type { AdminDeps } from "@/server/admin/http";

const canon = (): AgentRow[] => AGENTS.map((a) => ({ id: a.id, name: a.name, role: a.role }));
/** El estado de producción ANTES de 0056 (precheck F59.1): 28, sin Miks, Veto duelist. */
const prodBefore = (): AgentRow[] => canon().filter((a) => a.id !== "miks").map((a) => (a.id === "veto" ? { ...a, role: "duelist" } : a));

test("estado real tras 0056 → HEALTHY y marcador aplicado", () => {
  const h = agentCatalogHealth(canon(), AGENTS);
  assert.equal(h.level, "HEALTHY");
  assert.equal(h.applied0056, true);
  assert.match(h.detail, /29 agentes en BD = 29 canónicos/);
});

test("producción ANTES de 0056 (28, sin Miks, Veto duelist) → CRITICAL, sin falso verde", () => {
  const h = agentCatalogHealth(prodBefore(), AGENTS);
  assert.equal(h.level, "CRITICAL");
  assert.equal(h.applied0056, false);
  assert.deepEqual(h.missing, ["miks"]);
  assert.deepEqual(h.roleMismatch, [{ id: "veto", db: "duelist", expected: "sentinel" }]);
});

test("Miks con rol equivocado, duplicado o agente sobrante → CRITICAL; lectura fallida → WARNING", () => {
  assert.equal(agentCatalogHealth(canon().map((a) => (a.id === "miks" ? { ...a, role: "duelist" } : a)), AGENTS).level, "CRITICAL");
  assert.equal(agentCatalogHealth([...canon(), { id: "miks", name: "Miks", role: "controller" }], AGENTS).applied0056, false);
  assert.deepEqual(agentCatalogHealth([...canon(), { id: "ghost", role: "duelist" }], AGENTS).extra, ["ghost"]);
  assert.equal(agentCatalogHealth(null, AGENTS).level, "WARNING");
});

async function system(rows: AgentRow[]) {
  const db = new MemSupabase();
  const ADMIN = "00000000-0000-4000-8000-00000000a001";
  db.seedUser(ADMIN, 0);
  for (const p of db.table("profiles")) p.is_admin = true;
  db.table("agents").push(...rows.map((r) => ({ ...r })));
  const deps: AdminDeps = { verify: async () => ({ userId: ADMIN }), db: () => db.client };
  const res = await systemHandlers(deps).GET(new Request("http://t/api/admin/system", { headers: { authorization: "Bearer x" } }));
  return (await res.json()) as { checks: { id: string; level: string; detail: string }[]; schema: Record<string, boolean> | null };
}

test("/api/admin/system · antes de aplicar: «Migraciones» CRITICAL (falta 0056) aunque el código diga 0056", async () => {
  const v = await system(prodBefore());
  const mig = v.checks.find((c) => c.id === "schema")!;
  assert.equal(v.schema?.["0056_agents_miks_veto"], false);
  assert.equal(mig.level, "CRITICAL");
  assert.match(mig.detail, /0056_agents_miks_veto/);
  assert.equal(v.checks.find((c) => c.id === "esports-agents")!.level, "CRITICAL");
});

test("/api/admin/system · aplicada: «Migraciones» y «Agentes de esports» en verde", async () => {
  const v = await system(canon());
  assert.equal(v.schema?.["0056_agents_miks_veto"], true);
  assert.equal(v.checks.find((c) => c.id === "schema")!.level, "HEALTHY");
  assert.equal(v.checks.find((c) => c.id === "esports-agents")!.level, "HEALTHY");
});
