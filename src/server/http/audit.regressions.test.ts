/**
 * FULL GAME AUDIT (2026-10-07) · regresiones de los fallos reproducidos en la auditoría (los que no tienen ya su propio
 * test de servicio: carrera de retos → `socialAcceptRace.service.test`, descanso/estrategia del Coach →
 * `coach/audit.halftime.test`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonObject } from "./jsonBody";
import { validarPartido } from "@/server/services/coachMatches";
import { emptyStrat, updateStep, validateStrat } from "@/domain/tactics/strat";

const ROOT = process.cwd();
const code = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const req = (body: string | null) => new Request("http://t/api", { method: "POST", headers: { "content-type": "application/json" }, body });

test("AUDIT-API-1 · readJsonObject: solo objetos; `null`, número, cadena, array, vacío o roto → null (nunca lanza)", async () => {
  assert.deepEqual(await readJsonObject(req('{"action":"x"}')), { action: "x" });
  for (const b of ["null", "7", '"x"', "[]", "", "{roto", null]) assert.equal(await readJsonObject(req(b)), null, String(b));
});

test("AUDIT-API-2 · las 11 rutas que daban 500 con un cuerpo `null` leen el cuerpo con readJsonObject", () => {
  const routes = ["game/credits", "game/duel/matchmaking", "game/duel/pvp", "game/duel", "game/economy", "game/market", "game/progression",
    "game/strats", "game/coach-matches", "game/social", "pickems"];
  for (const r of routes) {
    const s = code(`src/app/api/${r}/route.ts`);
    assert.match(s, /readJsonObject/, r);
    assert.doesNotMatch(s, /body = \(?await req\.json\(\)/, `${r}: lectura cruda del cuerpo`);
  }
});

const final = { seed: 1, teamName: "a", rivalName: "b", difficulty: "normal", mapId: "ascent", mapSite: "A", startSide: "ATK", durationSeconds: 600, mvp: "x" };
test("AUDIT-COACH-6 · marcador final del Coach: solo los que el motor produce (13-0 … 13-12); 2-1, 99-0 o 14-12 → 400", () => {
  for (const [h, a] of [[13, 0], [13, 12], [7, 13], [12, 13]]) assert.equal(validarPartido({ ...final, scoreHome: h, scoreAway: a, rounds: h + a }).ok, true, `${h}-${a}`);
  for (const [h, a] of [[2, 1], [99, 0], [14, 12], [13, 13], [12, 11], [0, 13 + 1]]) assert.equal(validarPartido({ ...final, scoreHome: h, scoreAway: a, rounds: h + a }).ok, false, `${h}-${a}`);
});

test("AUDIT-COACH-7 · pizarra: dos jugadores con el MISMO agente en un paso → rechazado (como en las composiciones)", () => {
  const s = emptyStrat("s1", "ascent", "attack" as Parameters<typeof emptyStrat>[2]); // cinco jugadores, uno por rol
  const dup = updateStep(s, 0, (st) => ({ ...st, players: st.players.map((p) => ({ ...p, agentId: "jett" })) }));
  assert.ok(validateStrat(dup).issues.some((i) => i.code === "AGENT_DUPLICATE"));
  const five = ["jett", "omen", "sova", "killjoy", "skye"];
  const ok = updateStep(s, 0, (st) => ({ ...st, players: st.players.map((p, i) => ({ ...p, agentId: five[i] })) }));
  assert.ok(!validateStrat(ok).issues.some((i) => i.code === "AGENT_DUPLICATE"));
});

test("AUDIT-COACH-8 · guardar una jugada asignada a una partida con mapa fijado no puede cambiarle el mapa (409)", () => {
  const s = code("src/app/api/game/strats/route.ts");
  assert.ok(s.includes('from("coach_match_strats").select("match_id").eq("strat_id", id).eq("user_id", session.userId)'));
  assert.ok(s.includes('code: "MAP_LOCKED_BY_MATCH"') && s.includes("status: 409"));
  const m = code("src/app/api/game/match-strats/route.ts");
  assert.ok(m.includes('.order("sort_order", { ascending: false }).limit(1)') && m.includes("sort_order: siguiente"), "orden = máximo + 1");
});

test("AUDIT-COACH-9 · editar una composición: tope por mapa al MOVERLA y la principal deja de serlo (nunca 500 por el índice)", () => {
  const s = code("src/app/api/game/compositions/route.ts");
  assert.ok(s.includes("moving = (prev as { map_id: string }).map_id !== limpia.mapId;"));
  assert.ok(s.includes("update(moving ? { ...fila, primary_comp: false } : fila)"));
  assert.ok(s.includes('if (error?.code === "23505") return bad('));
});

test("AUDIT-COACH-10 · el Coach: guardas de doble clic en ronda/compra y match point de los dos con 12-12", () => {
  const h = code("src/components/sim/useCoachMatch.ts");
  assert.ok(h.includes('if (!finished || !m || gateRef.current !== "roundEnd") return;'));
  assert.ok(h.includes('if (!m || m.phase !== "BUY_PHASE" || justOpened()) return;'));
  assert.ok(h.includes('mp.includes("home") && mp.includes("away") ? "both"'));
  assert.match(code("src/components/coach/CoachTacticalPanel.tsx"), /MATCH POINT · LOS DOS/);
});

test("AUDIT-COACH-11 · sin nombres de Ascent en los doce mapas (A Main / B/Tree) en panel, pizarra, narración y scouting", () => {
  for (const f of ["src/components/coach/CoachTacticalPanel.tsx", "src/coach/broadcast.ts", "src/coach/chalkboard.ts", "src/lib/match/scouting.ts", "src/tactics/broadcast.ts", "src/tactics/opponent.ts"]) {
    assert.doesNotMatch(code(f), /"A Main"|B ?\/ ?Tree/, f);
  }
});

test("AUDIT-UI-1 · estados vacíos honestos: comparar sin jugador, colecciones vacías, Pick'em no publicado y jugada desconocida", () => {
  const cmp = code("src/app/social/comparar/page.tsx");
  assert.ok(cmp.includes("if (!id) return <EmptyState") && cmp.includes('else setError("Jugador no encontrado")'));
  const col = code("src/app/colecciones/page.tsx");
  assert.ok(col.includes("const none = !loading && defs.length === 0;") && col.includes("Todavía no hay colecciones") && col.includes("{!none && ("));
  const pk = code("src/components/pickems/predict/PredictScreen.tsx");
  assert.ok(pk.includes("b.error.status === 404) return <EmptyState"));
  const rv = code("src/app/entrenador/strats/revisar/page.tsx");
  assert.ok(rv.includes('(id ? rows.find((r) => r.id === id) ?? null : rows[0] ?? null)') && rv.includes("Esa estrategia no existe"));
});
