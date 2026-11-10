/**
 * F72.8 · EL RELOJ DE LAS DECISIONES, en los servicios REALES (PvE `duels.ts`, PvP `duelsPvp.ts`) sobre MemSupabase,
 * donde cada consulta es atómica y el `await` entre leer y escribir es el hueco real de producción.
 *
 * No se esperan 30 s: se ENVEJECE el plazo guardado (`turn_deadline_at` al pasado), igual que hacía el verificador del
 * Bloque 7.4.3. Se envejece el reloj, no el veredicto: si ha vencido lo sigue decidiendo el servicio, y qué se juega, el
 * orquestador.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES } from "@/domain/cardgame";
import { MemSupabase } from "./testing/memSupabase";
import { startMatch, playTurn, getMatch, getActiveMatch } from "./duels";
import { createPvpMatch, applyPvpAction, syncPvpMatch, PVP_TURN_MS, type PvpMatchView } from "./duelsPvp";
import { TURN_DECISION_MS } from "@/lib/duel/turnClock";
import type { DuelMatchView } from "@/lib/duel/types";

const U = "aaaaaaaa-0000-4000-8000-0000000072e8";
const A = "aaaaaaaa-0000-4000-8000-00000000728a";
const B = "bbbbbbbb-0000-4000-8000-00000000728b";
let seq = 0;
const cuid = () => `eeee7280-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

function giveDeck(db: MemSupabase, user: string, offset = 0): string {
  const used = new Set<string>(); const team: string[] = [];
  for (const role of DUEL_ROLES) {
    let n = 0, skip = offset;
    for (const c of CARDS.filter((x) => x.combat && (x.role ?? getPlayer(x.playerId)?.role) === role)) {
      if (n === 2) break;
      if (used.has(c.playerId)) continue;
      if (skip-- > 0) continue;
      used.add(c.playerId); n++;
      const u = cuid();
      db.table("user_cards").push({ uid: u, user_id: user, card_id: c.id, serial: null, origin: "pack", locked: false, obtained_at: new Date(0).toISOString() });
      team.push(u);
    }
  }
  const id = randomUUID(); const at = new Date(0).toISOString();
  db.table("duel_decks").push({ id, user_id: user, name: "Equipo", card_uids: team, created_at: at, updated_at: at });
  return id;
}

const row = (db: MemSupabase, id: string) => db.table("duel_matches").find((r) => r.id === id)!;
/** Lleva el plazo guardado al pasado: la decisión en curso «ha vencido». */
const age = (db: MemSupabase, id: string, ms = 1000) => { row(db, id).turn_deadline_at = new Date(Date.now() - ms).toISOString(); };

async function pve() {
  const db = new MemSupabase();
  db.table("profiles").push({ id: U, username: "qa728", credits: 1000, xp: 0, level: 1 });
  const deck = giveDeck(db, U);
  const s = await startMatch(db.client, U, deck, "NORMAL");
  assert.ok(s.ok, s.error);
  return { db, v: s.data!.view };
}
const state = async (db: MemSupabase, id: string) => { const r = await getMatch(db.client, U, id); assert.ok(r.ok, r.error); return r.data!.view; };

/* ═══════════════════════════ PvE ═══════════════════════════ */
// DUEL GAMEPLAY UX 2.0 · contra un BOT no hay reloj de decisión: ni plazo, ni jugada automática, ni derrota por tiempo.
// Los F72.8 S1–S9 (plazo, vencimiento y jugada automática en PvE) se reescriben a ese contrato; el PvP (S10–S13) no cambia.

/** Una espera MUY superior al plazo antiguo de 30 s. */
const LONG_WAIT = TURN_DECISION_MS * 20;

test("UX2 S1 · PvE: la partida nace SIN plazo (ni en la vista ni en la fila guardada)", async () => {
  const { db, v } = await pve();
  assert.equal(v.status, "IN_PROGRESS");
  assert.equal(v.turnDeadlineAt, null);
  assert.equal(row(db, v.matchId).turn_deadline_at ?? null, null);
});

test("UX2 S2 · PvE: esperar MÁS que el plazo antiguo no mueve nada (ni auto-selección, ni auto-envío, ni derrota, ni cambio de turno)", async () => {
  const { db, v } = await pve();
  // Incluso una fila heredada con un plazo guardado y ya vencido hace mucho se ignora.
  age(db, v.matchId, LONG_WAIT);
  for (let i = 0; i < 5; i++) {
    const again = await state(db, v.matchId);
    assert.equal(again.status, "IN_PROGRESS");
    assert.equal(again.stateVersion, v.stateVersion, "ninguna transición");
    assert.equal(again.turn, v.turn, "ningún cambio de turno");
    assert.equal(again.history.length, v.history.length);
    assert.equal(again.yourUsed.length, 0, "ninguna carta jugada por ti");
    assert.deepEqual(again.timeouts ?? [], [], "ninguna jugada automática");
    assert.equal(again.turnDeadlineAt, null);
  }
  const active = await getActiveMatch(db.client, U);
  assert.equal(active.data!.view!.stateVersion, v.stateVersion, "retomar (otra sesión) tampoco resuelve nada");
});

test("UX2 S3 · PvE: tras la espera, el movimiento MANUAL funciona normalmente (también con la hora muy pasada)", async () => {
  const { db, v } = await pve();
  age(db, v.matchId, LONG_WAIT);
  const card = v.yourHand[0].uid;
  const human = await playTurn(db.client, U, v.matchId, card, v.youAreAttacker ? "gamesense" : undefined, v.stateVersion, { now: Date.now() + LONG_WAIT });
  assert.ok(human.ok, human.error);
  const after = await state(db, v.matchId);
  assert.equal(after.stateVersion, (v.stateVersion ?? 0) + 1, "una transición, la tuya");
  assert.ok(after.yourUsed.some((c) => c.uid === card), "se jugó la carta que elegiste");
  assert.deepEqual(after.timeouts ?? [], []);
  assert.equal(after.turnDeadlineAt, null, "la siguiente decisión tampoco tiene plazo");
});

test("UX2 S4 · PvE: partida ENTERA a mano, cada turno sin plazo, termina sin jugadas automáticas", async () => {
  const { db, v } = await pve();
  let cur = v;
  for (let i = 0; i < 12 && cur.status === "IN_PROGRESS"; i++) {
    assert.equal(cur.turnDeadlineAt, null);
    age(db, cur.matchId, LONG_WAIT);
    const r = await playTurn(db.client, U, cur.matchId, cur.yourHand[0].uid, cur.youAreAttacker ? "stronghold" : undefined, cur.stateVersion);
    assert.ok(r.ok, r.error);
    cur = await state(db, cur.matchId);
  }
  assert.ok(["COMPLETED", "DRAW"].includes(cur.status), cur.status);
  assert.equal(cur.history.length, 10);
  assert.deepEqual(cur.timeouts ?? [], []);
});

test("UX2 S5 · PvE: DOBLE ENVÍO con la misma versión → exactamente UNA transición; el segundo, 409", async () => {
  for (let k = 0; k < 4; k++) {
    const { db, v } = await pve();
    const card = v.yourHand[k % v.yourHand.length].uid;
    const stat = v.youAreAttacker ? "gamesense" : undefined;
    const [x, y] = await Promise.all([
      playTurn(db.client, U, v.matchId, card, stat, v.stateVersion),
      playTurn(db.client, U, v.matchId, card, stat, v.stateVersion),
    ]);
    assert.equal([x, y].filter((r) => r.ok).length, 1, "una sola jugada aplicada");
    assert.equal([x, y].find((r) => !r.ok)!.status, 409);
    const after = await state(db, v.matchId);
    assert.equal(after.stateVersion, (v.stateVersion ?? 0) + 1, "UNA transición, nunca dos");
  }
});

test("UX2 S6 · PvE: acción con la versión vieja → 409 con el estado actual; no altera nada", async () => {
  const { db, v } = await pve();
  const ok = await playTurn(db.client, U, v.matchId, v.yourHand[0].uid, v.youAreAttacker ? "stronghold" : undefined, v.stateVersion);
  assert.ok(ok.ok, ok.error);
  const moved = await state(db, v.matchId);
  const late = await playTurn(db.client, U, v.matchId, v.yourHand[1].uid, v.youAreAttacker ? "entryfrag" : undefined, v.stateVersion);
  assert.equal(late.ok, false);
  assert.equal(late.status, 409);
  const after = await state(db, v.matchId);
  assert.equal(after.stateVersion, moved.stateVersion);
  assert.deepEqual(after.history, moved.history);
});

test("UX2 S7 · PvE: MULTI-PESTAÑA — dos pestañas y un sondeo, con un plazo heredado vencido: las tres ven lo mismo y nada se mueve", async () => {
  const { db, v } = await pve();
  age(db, v.matchId, LONG_WAIT);
  const [t1, t2, t3] = await Promise.all([getMatch(db.client, U, v.matchId), getActiveMatch(db.client, U), getMatch(db.client, U, v.matchId)]);
  const views = [t1.data!.view, t2.data!.view!, t3.data!.view];
  assert.ok(views.every((x) => x.stateVersion === v.stateVersion), JSON.stringify(views.map((x) => x.stateVersion)));
  assert.ok(views.every((x) => x.turnDeadlineAt === null));
});

/* ═══════════════════════════ PvP ═══════════════════════════ */

async function pvp(mode: "PVP" | "PVP_PRIVATE" = "PVP") {
  const db = new MemSupabase();
  const da = giveDeck(db, A, 0), dbk = giveDeck(db, B, 3);
  const c = await createPvpMatch(db.client, { playerId: A, deckId: da }, { playerId: B, deckId: dbk }, { mode });
  assert.ok(c.ok, c.error);
  // Los valores por defecto de Postgres (MemSupabase no los rellena): una partida viva tiene el cierre a NULL.
  Object.assign(row(db, c.data!.view.matchId), { closed_reason: null, closed_by: null, closed_at: null });
  return { db, matchId: c.data!.view.matchId };
}
type Snap = PvpMatchView & { expectedSide: "A" | "B" | null; isYourTurn: boolean };
async function snapOf(db: MemSupabase, player: string, matchId: string): Promise<Snap> {
  const s = await syncPvpMatch(db.client, player, matchId);
  assert.ok(s.ok, s.error);
  return (s.data as unknown as { snapshot: Snap }).snapshot;
}
const publicState = (s: Snap) => JSON.stringify({ v: s.stateVersion, t: s.match.currentTurn, p: s.match.phase, a: s.match.usedA, b: s.match.usedB, sc: [s.match.scoreA, s.match.scoreB], to: (s.match as unknown as { timeouts?: unknown }).timeouts ?? [] });

test("F72.8 S10 · PvP: 30 s por DECISIÓN, el mismo plazo para A y B; el que no decide no lo mueve sondeando", async () => {
  assert.equal(PVP_TURN_MS, TURN_DECISION_MS);
  const { db, matchId } = await pvp();
  const a0 = await snapOf(db, A, matchId), b0 = await snapOf(db, B, matchId);
  assert.equal(a0.turnDeadlineAt, b0.turnDeadlineAt, "ambos ven el mismo plazo");
  const idle = a0.expectedSide === "A" ? B : A;
  for (let i = 0; i < 6; i++) assert.equal((await snapOf(db, idle, matchId)).turnDeadlineAt, a0.turnDeadlineAt, "sondear no lo reinicia");
  // Tras decidir el atacante, empieza la decisión del defensor con SU plazo (antes: un plazo para todo el turno).
  const who = a0.expectedSide === "A" ? A : B;
  const me = await snapOf(db, who, matchId);
  const mine = me.yourSide === "A" ? me.match.snapshotA : me.match.snapshotB;
  const r = await applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: me.stateVersion, playerId: who, cardUid: mine.cards[0].uid, stat: "stronghold" });
  assert.ok(r.ok, r.error);
  const after = await snapOf(db, idle, matchId);
  assert.ok(after.turnDeadlineAt! > a0.turnDeadlineAt!, "plazo nuevo para la defensa");
});

test("F72.8 S11 · PvP: A no decide, B espera; al vencer el servidor juega por A y A y B reciben EXACTAMENTE el mismo estado", async () => {
  for (const mode of ["PVP", "PVP_PRIVATE"] as const) {
    const { db, matchId } = await pvp(mode);
    const s0 = await snapOf(db, A, matchId);
    const sleeper = s0.expectedSide === "A" ? A : B, waiter = sleeper === A ? B : A;
    age(db, matchId);
    const byWaiter = await snapOf(db, waiter, matchId); // el sondeo del que espera es el que lo resuelve
    const bySleeper = await snapOf(db, sleeper, matchId);
    assert.equal(byWaiter.stateVersion, s0.stateVersion + 1, `${mode}: una transición`);
    assert.equal(publicState(byWaiter), publicState(bySleeper), `${mode}: mismo estado para los dos`);
    assert.equal(byWaiter.lifecycle, "IN_TURN", `${mode}: la partida SIGUE (antes se cerraba como EXPIRED)`);
    assert.equal(bySleeper.isYourTurn, false, "ahora decide el otro");
    assert.equal(((byWaiter.match as unknown as { timeouts: unknown[] }).timeouts).length, 1);
  }
});

test("F72.8 S12 · PvP: cinco sondeos a la vez al vencer + la acción tardía del dormido → UNA transición; la tardía es 409", async () => {
  const { db, matchId } = await pvp();
  const s0 = await snapOf(db, A, matchId);
  const sleeper = s0.expectedSide === "A" ? A : B, waiter = sleeper === A ? B : A;
  const mine = (await snapOf(db, sleeper, matchId));
  const hand = (mine.yourSide === "A" ? mine.match.snapshotA : mine.match.snapshotB).cards;
  age(db, matchId);
  const rs = await Promise.all([
    ...Array.from({ length: 5 }, () => syncPvpMatch(db.client, waiter, matchId)),
    applyPvpAction(db.client, matchId, { actionId: randomUUID(), expectedVersion: s0.stateVersion, playerId: sleeper, cardUid: hand[1].uid, stat: "entryfrag" }),
  ]);
  const late = rs[5];
  assert.equal(late.ok, false, "una acción de una decisión vencida nunca se acepta");
  assert.equal(late.status, 409);
  const end = await snapOf(db, waiter, matchId);
  assert.equal(end.stateVersion, s0.stateVersion + 1, "una sola transición");
  assert.equal(((end.match as unknown as { timeouts: unknown[] }).timeouts).length, 1);
});

test("F72.8 S13 · PvP: partida ENTERA por vencimientos de los dos: termina y se liquida por la puerta normal", async () => {
  const { db, matchId } = await pvp();
  let s = await snapOf(db, A, matchId);
  for (let i = 0; i < 25 && s.lifecycle === "IN_TURN"; i++) { age(db, matchId); s = await snapOf(db, B, matchId); }
  assert.equal(s.lifecycle, "FINISHED");
  assert.equal(s.match.turns.length, 10);
  assert.equal(((s.match as unknown as { timeouts: unknown[] }).timeouts).length, 20);
});

/* ═══════════════════════════ todos los modos ═══════════════════════════ */

test("F72.8 S14 · un solo sistema: los tres PvE (rápida, campaña, draft) nacen en `launchPve` y los dos PvP en `createPvpMatch`", () => {
  const src = (f: string) => readFileSync(join(process.cwd(), "src", "server", "services", f), "utf8");
  const duels = src("duels.ts"), pvpSrc = src("duelsPvp.ts");
  // PvE: un único INSERT de partida, con el plazo; campaña y draft pasan por launchPve.
  assert.equal((duels.match(/from\("duel_matches"\)\.insert\(/g) ?? []).length, 1);
  assert.ok(/turn_deadline_at: deadline === null \? null/.test(duels));
  for (const f of ["startMatch", "startCampaignMatch", "startDraftMatch"]) assert.ok(new RegExp(`export async function ${f}\\(`).test(duels), f);
  assert.ok(/export async function startMatch\([\s\S]*?return createPveMatch\(/.test(duels), "rápida → createPveMatch");
  assert.ok(/export async function startCampaignMatch\([\s\S]*?return createPveMatch\(/.test(duels), "campaña → createPveMatch");
  assert.ok(/async function createPveMatch\([\s\S]*?return launchPve\(/.test(duels), "createPveMatch → launchPve");
  assert.ok(/export async function startDraftMatch\([\s\S]*?return launchPve\(/.test(duels), "draft → launchPve");
  // PvP: ranked y privado comparten createPvpMatch/applyPvpAction/expireTurnIfDue.
  assert.ok(pvpSrc.includes('mode: opts.mode ?? "PVP"'));
  assert.ok(pvpSrc.includes("autoDecision(rec.match)"), "el PvP conserva su jugada automática");
  // DUEL GAMEPLAY UX 2.0 · el PvE no tiene reloj: ni jugada automática ni plazo distinto de «ninguno».
  assert.ok(!duels.includes("autoDecision("), "contra un bot nadie juega por ti");
  const pvePage = readFileSync(join(process.cwd(), "src", "app", "duelos", "jugar", "page.tsx"), "utf8");
  assert.ok(!/TurnTimer|useDecisionClock|TimeoutNotice/.test(pvePage), "la arena PvE no pinta ni sondea ningún reloj");
  assert.ok(!/decisionDeadline\(false/.test(duels) && !duels.includes("deadlineFor("), "el PvE solo pide el plazo de «contra bot» (null)");
  assert.ok(!pvpSrc.includes('rpc("duel_pvp_expire_turn"'), "vencer ya no cierra la partida");
});
