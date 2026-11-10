/**
 * F73 · ADMIN — recetas, misiones y proyectos: no se guarda nada inválido; versión optimista; auditoría append-only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "@/data/catalog";
import { packCardClass } from "@/domain/packs/packClass";
import { MemSupabase } from "@/server/services/testing/memSupabase";
import { resetF73Cache } from "@/server/services/f73Config";
import { listF73, saveMission, saveProject, saveRecipe } from "./crafting";

const ADMIN = "adadadad-0000-4000-8000-0000000073ad";
function db() {
  resetF73Cache();
  const d = new MemSupabase();
  d.table("profiles").push({ id: ADMIN, username: "admin", credits: 0, is_admin: true });
  return d;
}
const err = (r: { ok: boolean } & ({ error?: string })) => (r.ok ? "" : (r as { error: string }).error);

test("F73 ADM1 · receta: no se ACTIVA por debajo del suelo seguro, ni circular, ni con sobre inexistente; DISABLED sí se guarda como propuesta", async () => {
  const d = db();
  const mk = (id: string, patch: Record<string, unknown>) => saveRecipe(d.client, ADMIN, { id, expectedVersion: 0, patch: { kind: "PACK", name: "Receta QA", ...patch } });
  assert.match(err(await mk("r1", { inputPackId: "estandar", outputPackId: "premium", inputQty: 2, status: "ACTIVE" })), /suelo seguro: mínimo 4/); // Pack Opening 3.0: con el valor nuevo de Bronce y Plata el suelo de Bronce→Plata es 4
  assert.match(err(await mk("r2", { inputPackId: "estandar", outputPackId: "estandar", inputQty: 5, status: "ACTIVE" })), /mismo sobre/);
  assert.match(err(await mk("r3", { inputPackId: "estandar", outputPackId: "no-existe", inputQty: 5, status: "ACTIVE" })), /no existe/);
  const ok = await mk("r4", { inputPackId: "estandar", outputPackId: "premium", inputQty: 4, status: "ACTIVE" });
  assert.ok(ok.ok, err(ok));
  const draft = await mk("r5", { inputPackId: "estandar", outputPackId: "premium", inputQty: 2, status: "DISABLED" });
  assert.ok(draft.ok, "una propuesta desactivada por debajo del suelo se puede guardar (no se puede activar)");
  assert.equal(d.table("content_audit_log").filter((a) => a.entity_type === "craft_recipe").length, 2);
});

test("F73 ADM2 · receta: versión optimista (dos admins a la vez) y el tipo no cambia", async () => {
  const d = db();
  await saveRecipe(d.client, ADMIN, { id: "rq", expectedVersion: 0, patch: { kind: "PACK", name: "Receta QA", inputPackId: "estandar", outputPackId: "premium", inputQty: 4, status: "DISABLED" } });
  assert.ok((await saveRecipe(d.client, ADMIN, { id: "rq", expectedVersion: 1, patch: { inputQty: 5 } })).ok);
  assert.match(err(await saveRecipe(d.client, ADMIN, { id: "rq", expectedVersion: 1, patch: { inputQty: 6 } })), /STALE_CONTENT/);
  assert.match(err(await saveRecipe(d.client, ADMIN, { id: "rq", expectedVersion: 2, patch: { kind: "CARD" } })), /tipo/);
});

test("F73 ADM3 · misión: condición, carta/jugador reales, recompensa real y acotada, dependencias activas y sin ciclos", async () => {
  const d = db();
  const save = (id: string, patch: Record<string, unknown>, v = 0) => saveMission(d.client, ADMIN, { id, expectedVersion: v, patch: { name: "Misión QA", target: 3, status: "ACTIVE", ...patch } });
  assert.match(err(await save("m0", { condition: { type: "NOPE" } })), /Condición/);
  assert.match(err(await save("m1", { condition: { type: "USE_CARD", cardId: "inventada__base" } })), /carta no existe/);
  assert.match(err(await save("m2", { condition: { type: "MATCH_WIN" }, reward: { packId: "no-existe", packCount: 1 } })), /sobre de recompensa/);
  assert.match(err(await save("m3", { condition: { type: "MATCH_WIN" }, reward: { credits: 50_000 } })), /credits/);
  assert.ok((await save("ma", { condition: { type: "MATCH_WIN" } })).ok);
  assert.ok((await save("mb", { condition: { type: "MATCH_PLAY" }, dependsOn: ["ma"] })).ok);
  assert.match(err(await save("ma", { dependsOn: ["mb"] }, 1)), /circular/i);
  assert.match(err(await save("mc", { condition: { type: "MATCH_PLAY" }, dependsOn: ["fantasma"] })), /Dependencia inválida/);
  assert.match(err(await save("ma", { status: "RETIRED" }, 1)), /dependen/, "no se retira una misión de la que dependen otras activas");
});

test("F73 ADM4 · proyecto: carta REAL; activo solo con misiones activas; listado con suelos", async () => {
  const d = db();
  const card = CARDS.find((c) => packCardClass(c) === "prime")!.id;
  assert.match(err(await saveProject(d.client, ADMIN, { id: "pj", expectedVersion: 0, patch: { name: "Proyecto QA", targetCardId: "inventada", status: "DRAFT" } })), /carta objetivo/);
  assert.match(err(await saveProject(d.client, ADMIN, { id: "pj", expectedVersion: 0, patch: { name: "Proyecto QA", targetCardId: card, status: "ACTIVE" } })), /misión activa/);
  assert.ok((await saveProject(d.client, ADMIN, { id: "pj", expectedVersion: 0, patch: { name: "Proyecto QA", targetCardId: card, status: "DRAFT" } })).ok);
  assert.ok((await saveMission(d.client, ADMIN, { id: "pm", expectedVersion: 0, patch: { name: "Misión QA", target: 1, status: "ACTIVE", condition: { type: "OPEN_PACK" }, projectId: "pj" } })).ok);
  assert.ok((await saveProject(d.client, ADMIN, { id: "pj", expectedVersion: 1, patch: { status: "ACTIVE" } })).ok);
  const l = await listF73(d.client);
  assert.ok(l.ok);
  assert.equal(d.table("content_audit_log").filter((a) => /^f73_/.test(String(a.action))).length, 3, "crear proyecto, crear misión, activar proyecto");
});
