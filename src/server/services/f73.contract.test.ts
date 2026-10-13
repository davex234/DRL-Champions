/**
 * F73 · CONTRATOS DE SEGURIDAD Y AUTORIDAD — migración 0059, rutas y enganches.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const SQL = read("supabase/migrations/0059_crafting_missions.sql");
const body = (fn: string) => SQL.slice(SQL.indexOf(`create or replace function public.${fn}(`), SQL.indexOf("end; $$;", SQL.indexOf(`create or replace function public.${fn}(`)));

test("F73 SEC1 · 0059: ninguna RPC nueva invocable desde el navegador; solo service_role", () => {
  for (const sig of ["app_craft_pack(uuid, text, text)", "app_craft_card(uuid, text, uuid[], jsonb, text, text)", "app_mission_apply(uuid, text, text, jsonb, jsonb)"]) {
    assert.ok(SQL.includes(`revoke all on function public.${sig} from public, anon, authenticated;`), sig);
    assert.ok(SQL.includes(`grant execute on function public.${sig} to service_role;`), sig);
  }
  assert.ok(/revoke all on public\.craft_recipes, public\.content_card_projects, public\.content_missions from anon, authenticated;/.test(SQL));
  assert.ok(/revoke all on public\.user_mission_progress, public\.mission_events, public\.user_project_claims from anon, authenticated;/.test(SQL));
  assert.ok(SQL.includes("for select using (auth.uid() = user_id)"), "cada jugador lee solo lo suyo");
  assert.ok(SQL.includes("do $$") && SQL.includes("0059: una RPC de crafteo/misiones es invocable desde el navegador"), "guardia final");
  assert.ok(!/^\s*(begin|commit)\s*;/im.test(SQL), "no abre ni cierra transacción: la envuelve quien la aplica (dry-run con ROLLBACK)");
});

test("F73 SEC2 · 0059 atómica: bloqueos antes de contar, idempotencia por ref, nunca negativo, última copia protegida", () => {
  const pack = body("app_craft_pack"), card = body("app_craft_card"), apply = body("app_mission_apply");
  assert.ok(pack.includes("from public.economy_ops where ref = p_ref") && pack.includes("'repeated', true"));
  assert.ok(/from public\.user_packs where user_id = p_user and pack_id = r\.input_pack_id for update/.test(pack), "fila de sobres bloqueada (la misma que bloquea la apertura)");
  assert.ok(pack.includes("INSUFFICIENT_PACKS") && pack.includes("r.status <> 'ACTIVE'"));
  assert.ok(card.includes("from public.economy_ops where ref = p_ref"));
  assert.ok(/perform 1 from public\.user_cards where user_id = p_user and card_id = any\(v_cards\) for update/.test(card), "todas las copias de esas cartas bloqueadas");
  assert.ok(card.includes("locked = false") && card.includes("IN_DECK") && card.includes("LAST_COPY") && card.includes("DUPLICATE_INPUT"));
  assert.ok(card.includes("'craft'"), "origen de la carta: craft (ya permitido desde 0011)");
  assert.ok(apply.includes("on conflict (user_id, event_key) do nothing") && apply.includes("'repeated', true"), "un evento por usuario, una vez");
  assert.ok(apply.includes("completed_at is null"), "una misión completada no cambia");
});

test("F73 SEC3 · 0059 no toca la economía existente: ni precios, ni desguace, ni tablas anteriores", () => {
  assert.ok(!/alter table public\.(profiles|user_packs|user_cards|economy_ops|credit_transactions)/i.test(SQL));
  assert.ok(!/app_salvage_cards|app_buy_pack|app_apply_pack_open|app_grant_reward|_ledger_apply/.test(code(SQL.replace(/--.*$/gm, ""))), "no redefine ni llama RPC económicas anteriores");
  const migs = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
  // 0060 (desguace atómico) redefine app_salvage_cards por AUTORIZACIÓN expresa (2026-09-30); 0059 sigue sin tocarla (arriba).
  // F79 · 0061 (Forja 2.0) es la última del repositorio; APLICADA en producción desde F79.1 (2026-10-02).
  assert.equal(migs[migs.length - 1], "0075_team_collections.sql"); // COLECCIONES POR EQUIPO · 0075 (primeras compleciones e insignias regionales; aditiva: sin ella el servidor solo deja de guardarlas) es la última; antes F87.2 · 0073 (launch guard de Pick'ems: elegibilidad y puerta de tiempo) es la última; antes F87.1 · 0072, F87 · 0071 (Pick'ems 2.0: cuadros de predicción, cierre por partido, liquidación y reclamos; aditiva) es la última; antes F86.2 · 0070 (feedback de la Closed Alpha + embudo derivado) es la última; antes F86 · 0069 (torneos de jugadores) es la última del repositorio (cabeza = 0069; 0068 tag público de cuenta; 0067 gestión de admins, F85 añadió 0066, F84 añadió 0065, F83 0064, ops/release). F82 añadió 0062 y F89 0063.
  assert.ok(SQL.includes("NO APLICADA (requiere autorización explícita)"));
});

test("F73 SEC4 · rutas: el cliente no manda userId, cantidades, carta de salida ni progreso", () => {
  const craft = read("src/app/api/game/crafting/route.ts"), missions = read("src/app/api/game/missions/route.ts");
  // ICON (2026-10-09) · `expectedQty`: los sobres que el jugador VIO; solo puede BLOQUEAR (409) si la receta cambió.
  assert.ok(craft.includes('new Set(["action", "recipeId", "uids", "ref", "expectedQty"])'));
  assert.ok(missions.includes('new Set(["action", "missionId", "projectId"])'));
  assert.ok(!/userId|progress|cardId|qty|output/.test(code(craft).replace(/session\.userId/g, "").replace(/recipeId|craftCard|craftPack/g, "")), "sin campos de autoridad en crafteo");
  assert.ok(!/"(addProgress|progress|complete|event)"/.test(missions), "no existe acción para sumar progreso desde el cliente");
  for (const r of [craft, missions]) assert.ok(r.includes("getSession(req)") && r.includes('"No autenticado"'), "el usuario sale del token");
});

test("F73 SEC5 · enganches en los puntos de verdad del servidor; el servicio de sobres no sabe de misiones", () => {
  const duels = code(read("src/server/services/duels.ts")), pvp = code(read("src/server/services/duelsPvp.ts"));
  assert.ok(duels.includes("await settleMissionsForMatch(sb, row.id, m, [{ userId: row.user_id, side: HUMAN }]"), "PvE (rápida, campaña y draft) tras la escritura ganadora");
  assert.ok((pvp.match(/await settlePvpMissions\(sb, rec(After|Full)\);/g) ?? []).length === 3, "PvP: acción, vencimiento y red de seguridad del sondeo");
  assert.ok(!/mission/i.test(code(read("src/server/services/packs.ts"))));
  assert.ok(code(read("src/app/api/game/packs/route.ts")).includes('kind: "OPEN_PACK", key: packOpRef(session.userId, "open", ref)'));
});
