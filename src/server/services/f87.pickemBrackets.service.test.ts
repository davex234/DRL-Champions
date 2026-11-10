/**
 * F87 · SERVICIO DE PICK'EMS 2.0 (Node) sobre `MemSupabase` + espejo mínimo de las RPC de 0071 (la autoridad real se
 * prueba en la BD: `scripts/ops/_f87-dryrun.sh`, 98 comprobaciones). Aquí: lo que decide el SERVIDOR antes de la RPC.
 *
 *   · Solo uno de los dos participantes PREDICHOS (nunca un equipo arbitrario, nunca un cruce por definir).
 *   · Revisión vieja (otra pestaña) → 409 STALE con el estado fresco, sin llamar a la RPC.
 *   · Cierre (espejo) → 409 LOCKED, sin RPC. Ámbito no publicado → 409.
 *   · Cambiar aguas arriba manda a la RPC SOLO los descendientes incompatibles.
 *   · Vista pública sin picks de nadie; clasificación con nombre + #TAG, sin UUID.
 *   · Admin: sin permiso → 401; recompensas con sobre inexistente → 400 sin RPC; publicar con el validador en rojo → 409.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MemSupabase, type Row } from "./testing/memSupabase";
import { canonicalDescriptor, deriveFormat, type FormatDescriptor } from "@/domain/pickems/format";
import { isLockedAt } from "@/domain/pickems/locks";
import { getBracketView, savePick, claimBracket, listBrackets } from "./pickemBrackets";
import { pickemsAdminHandlers, setRewards, publish, economyOf } from "@/server/admin/pickems";
import { proposedRewards } from "@/domain/pickems/bracketRewards";
import { de8, T } from "@/domain/pickems/testing/formatFixtures";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const BID = "44444444-4444-4444-8444-444444444444";

class PickemMem extends MemSupabase {
  saveArgs: Record<string, unknown>[] = [];
  rpc_app_pickem_save_pick(a: Record<string, unknown>) {
    this.saveArgs.push(a);
    const b = this.table("pickem_brackets").find((r) => r.id === a.p_bracket);
    if (!b) throw new Error("PICKEM_NOT_FOUND");
    if (b.status !== "PUBLISHED") throw new Error("PICKEM_NOT_OPEN");
    const node = this.table("pickem_bracket_matches").find((r) => r.bracket_id === a.p_bracket && r.match_id === a.p_match);
    if (!node) throw new Error("PICKEM_BAD_MATCH");
    let e = this.table("pickem_bracket_entries").find((r) => r.bracket_id === a.p_bracket && r.user_id === a.p_user);
    if (!e) { e = { bracket_id: a.p_bracket, user_id: a.p_user, revision: 0 }; this.table("pickem_bracket_entries").push(e); }
    if (a.p_expected_revision !== null && e.revision !== a.p_expected_revision) return { ok: false, code: "STALE", revision: e.revision };
    const m = this.table("matches").find((r) => r.id === a.p_match)!;
    if (isLockedAt({ bracketStatus: "PUBLISHED", lockPolicy: "MATCH", stageLockAt: null, lockAt: node.lock_at as string, lockOverrideAt: null, voided: false, realStatus: m.status as string, realStart: m.start_time as string }, Date.now())) throw new Error("PICKEM_LOCKED");
    const picks = this.table("pickem_bracket_picks");
    const cleared: string[] = [];
    for (const id of (a.p_clear as string[]) ?? []) {
      const i = picks.findIndex((r) => r.bracket_id === a.p_bracket && r.user_id === a.p_user && r.match_id === id);
      if (i >= 0) { picks.splice(i, 1); cleared.push(id); }
    }
    const i = picks.findIndex((r) => r.bracket_id === a.p_bracket && r.user_id === a.p_user && r.match_id === a.p_match);
    if (i >= 0) picks.splice(i, 1);
    if (a.p_team) picks.push({ bracket_id: a.p_bracket, user_id: a.p_user, match_id: a.p_match, team_id: a.p_team });
    e.revision = (e.revision as number) + 1;
    return { ok: true, revision: e.revision, cleared };
  }
  rpc_app_pickem_claim(a: Record<string, unknown>) {
    const b = this.table("pickem_brackets").find((r) => r.id === a.p_bracket);
    if (b?.status !== "SETTLED") throw new Error("PICKEM_NOT_SETTLED");
    return { applied: true, tier: "PARTICIPATION", reward: { packId: "estandar", packCount: 1 } };
  }
}

function seed(opts: { status?: string; past?: string[]; admin?: boolean } = {}) {
  const f = de8(opts.admin !== false);
  const d = deriveFormat({ eventId: "evt-test", stages: f.stages, matches: f.matches, adminEdges: f.adminEdges }).descriptor as FormatDescriptor;
  const db = new PickemMem();
  db.tables.pickem_brackets = [{
    id: BID, slug: "test-doble", event_id: "evt-test", title: "Prueba · Doble", status: opts.status ?? "PUBLISHED", format_kind: d.kind, stage_ids: d.stageIds,
    descriptor: d, descriptor_checksum: createHash("sha256").update(canonicalDescriptor(d)).digest("hex"), admin_edges: f.adminEdges ?? [], scoring_version: "pickem-scoring-v1",
    max_points: d.nodes.reduce((s, n) => s + n.points, 0), lock_policy: "MATCH", stage_lock_at: null, rewards: { version: 1, status: "OFF", minCompletion: 0.8, tiers: [] },
    rewards_status: "OFF", rewards_version: 1, version: 1, settlement_version: 0, published_at: new Date().toISOString(), settled_at: null, cancelled_at: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }];
  const now = Date.now();
  db.tables.matches = f.matches.map((m) => ({ ...m, start_time: opts.past?.includes(m.id) ? new Date(now - 3_600_000).toISOString() : m.start_time })) as unknown as Row[];
  db.tables.pickem_bracket_matches = d.nodes.map((n) => ({ bracket_id: BID, match_id: n.matchId, points: n.points, lock_at: (db.tables.matches.find((m) => m.id === n.matchId) as Row).start_time, lock_override_at: null, voided_at: null, void_reason: null }));
  db.tables.teams = Array.from({ length: 8 }, (_, i) => ({ id: T(i + 1), name: `Equipo ${i + 1}` }));
  db.tables.events = [{ id: "evt-test", name: "Evento de prueba", status: "upcoming", start_date: null }];
  db.tables.profiles = [
    { id: ME, username: "yo_qa", public_tag: "ABCDEFG", is_admin: false },
    { id: OTHER, username: "otro_qa", public_tag: "HJKMNPQ", is_admin: false },
    { id: ADMIN, username: "admin_qa", public_tag: "RSTUVWX", is_admin: true },
  ];
  db.tables.pickem_bracket_entries = [];
  db.tables.pickem_bracket_picks = [];
  db.tables.pickem_bracket_claims = [];
  return { db, sb: db.client, d };
}

test("pick válido de cuartos: la RPC recibe la revisión y ninguna limpieza", async () => {
  const { db, sb } = seed();
  const r = await savePick(sb, ME, "test-doble", "de-uqf1", T(1), 0);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(db.saveArgs.length, 1);
  assert.equal(db.saveArgs[0].p_expected_revision, 0);
  assert.deepEqual(db.saveArgs[0].p_clear, []);
  if (r.ok) assert.deepEqual(r.data.picks, { "de-uqf1": T(1) });
});

test("equipo que no juega ese cruce (en MI cuadro) → 400 sin RPC; cruce por definir → 400 sin RPC", async () => {
  const { db, sb } = seed();
  const a = await savePick(sb, ME, "test-doble", "de-uqf1", T(5), 0);
  assert.equal(!a.ok && a.status, 400);
  assert.equal(!a.ok && a.code, "TEAM_NOT_IN_MATCH");
  const b = await savePick(sb, ME, "test-doble", "de-usf1", T(1), 0);
  assert.equal(!b.ok && b.code, "PARTICIPANTS_UNKNOWN");
  const c = await savePick(sb, ME, "test-doble", "no-existe", T(1), 0);
  assert.equal(!c.ok && c.code, "BAD_MATCH");
  assert.equal(db.saveArgs.length, 0);
});

test("otra pestaña guardó antes: revisión vieja → 409 STALE con el estado fresco, sin RPC", async () => {
  const { db, sb } = seed();
  await savePick(sb, ME, "test-doble", "de-uqf1", T(1), 0);
  const r = await savePick(sb, ME, "test-doble", "de-uqf2", T(4), 0);
  assert.equal(!r.ok && r.status, 409);
  assert.equal(!r.ok && r.code, "STALE");
  assert.deepEqual(!r.ok && r.data, { revision: 1, picks: { "de-uqf1": T(1) } });
  assert.equal(db.saveArgs.length, 1);
});

test("cambiar cuartos manda a la RPC SOLO los descendientes incompatibles; lo independiente se queda", async () => {
  const { db, sb } = seed();
  let rev = 0;
  for (const [m, t] of [["de-uqf1", T(1)], ["de-uqf2", T(4)], ["de-usf1", T(1)], ["de-uqf3", T(2)], ["de-lr1a", T(8)]] as const) {
    const r = await savePick(sb, ME, "test-doble", m, t, rev);
    assert.ok(r.ok, `${m}: ${JSON.stringify(r)}`);
    rev = r.ok ? r.data.revision : rev;
  }
  const r = await savePick(sb, ME, "test-doble", "de-uqf1", T(8), rev);
  assert.ok(r.ok);
  assert.deepEqual(db.saveArgs.at(-1)!.p_clear, ["de-lr1a", "de-usf1"], "semifinal (T1 ya no llega) y ronda baja (T8 ya no cae)");
  if (r.ok) assert.deepEqual(r.data.picks, { "de-uqf1": T(8), "de-uqf2": T(4), "de-uqf3": T(2) });
});

test("cerrado (espejo del cierre) → 409 LOCKED sin RPC; ámbito liquidado → 409 NOT_OPEN", async () => {
  const { db, sb } = seed({ past: ["de-uqf1"] });
  const r = await savePick(sb, ME, "test-doble", "de-uqf1", T(1), 0);
  assert.equal(!r.ok && r.code, "LOCKED");
  assert.equal(db.saveArgs.length, 0);
  const s = seed({ status: "SETTLED" });
  const r2 = await savePick(s.sb, ME, "test-doble", "de-uqf2", T(4), 0);
  assert.equal(!r2.ok && r2.code, "NOT_OPEN");
});

test("vista pública: sin picks de nadie y clasificación con nombre + #TAG, sin UUID", async () => {
  const { sb } = seed();
  await savePick(sb, OTHER, "test-doble", "de-uqf1", T(1), 0);
  const v = await getBracketView(sb, "test-doble", null);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.equal(v.data.me, null);
  assert.equal(v.data.leaderboard.participants, 1);
  assert.deepEqual(Object.keys(v.data.leaderboard.rows[0]).sort(), ["correct", "points", "position", "tag", "username"]);
  assert.equal(v.data.leaderboard.rows[0].tag, "#HJKMNPQ");
  const json = JSON.stringify(v.data);
  assert.ok(!json.includes(OTHER) && !json.includes(ME), "ningún UUID de jugador en la respuesta");
  assert.ok(!/@|email/i.test(json), "sin correos");
});

test("vista con sesión: SOLO mis picks; los del otro jugador no aparecen", async () => {
  const { sb } = seed();
  await savePick(sb, OTHER, "test-doble", "de-uqf1", T(8), 0);
  await savePick(sb, ME, "test-doble", "de-uqf2", T(4), 0);
  const v = await getBracketView(sb, "test-doble", ME);
  assert.ok(v.ok);
  if (!v.ok) return;
  assert.deepEqual(v.data.me?.picks, { "de-uqf2": T(4) });
  assert.equal(v.data.me?.revision, 1);
  const json = JSON.stringify(v.data);
  assert.ok(!json.includes(OTHER), "ni el UUID del otro");
  assert.equal(v.data.rewards, null, "recompensas OFF → no se prometen");
  const list = await listBrackets(sb, ME);
  assert.ok(list.ok && list.data.brackets[0].mine?.picked === 1);
});

test("reclamar antes de liquidar → 409 NOT_SETTLED (lo decide la RPC)", async () => {
  const { sb } = seed();
  const r = await claimBracket(sb, ME, "test-doble");
  assert.equal(!r.ok && r.status, 409);
  assert.equal(!r.ok && r.code, "NOT_SETTLED");
});

test("admin: sin permiso → 401; sobre inexistente → 400 sin RPC; publicar con el validador en rojo → 409 sin RPC", async () => {
  const { db, sb } = seed({ status: "DRAFT", admin: false });
  const h = pickemsAdminHandlers({ verify: async () => null, db: () => sb, rate: undefined } as never);
  const res = await h.POST(new Request("http://x/api/admin/pickems", { method: "POST", body: JSON.stringify({ action: "publish", id: BID, version: 1 }) }));
  assert.equal(res.status, 401);
  const bad = await setRewards(sb, ADMIN, BID, 1, { minCompletion: 0.8, tiers: [{ id: "PARTICIPATION", minRatio: null, reward: { packId: "sobre-inventado" } }] }, "DRAFT", false);
  assert.equal(!bad.ok && bad.status, 400);
  db.tables.stages = de8().stages as unknown as Row[];
  const pub = await publish(sb, ADMIN, BID, 1);
  assert.equal(!pub.ok && pub.status, 409);
  assert.ok(!db.rpcCalls.some((c) => c.startsWith("app_pickem_admin")), "ninguna RPC de admin llamada");
});

test("economía del panel: con el cuadro incompleto NO se simula (nada de «valor esperado 0» engañoso); completo sí", () => {
  const { d } = seed({ admin: false });
  const inc = economyOf(d, proposedRewards("x"), 0, null, undefined, true);
  assert.equal(inc.simulation.length, 0);
  assert.ok(inc.warnings.some((w) => /cuadro completo/.test(w)));
  assert.equal(inc.worstCase1000, 20_000_000);
  const full = seed().d;
  const ok = economyOf(full, proposedRewards("x"), 0, null, undefined, false);
  assert.equal(ok.simulation.length, 3);
  assert.ok(ok.simulation.every((r) => r.ev > 0));
});
