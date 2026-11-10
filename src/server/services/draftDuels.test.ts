/**
 * DRAFT GAUNTLET · COMBATE CANÓNICO (Fase 39) — el combate del draft ES la partida de siempre: mismo orquestador,
 * mismas reglas y bots, misma proyección redactada; sin recompensa en la vista y sin propiedad inventada.
 * Se juegan partidas completas con el motor REAL (bots en los dos bandos) sobre plantillas y rivales del draft.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "@/collection/registry";
import { advanceBots, createController, createDuelBot, createRng } from "@/domain/cardgame/opponent";
import { confirmTurn, startDuelMatch, type DuelMatch } from "@/domain/cardgame/match";
import { CURRENT_COMBAT_RULES } from "@/domain/cardgame/combat";
import { buildDraftPool, eligibleDataVersion, rivalDeckFor, simulateDraft } from "@/domain/draft/generate";
import { RIVAL_NAMES } from "@/domain/draft/rules";
import { draftCardUid, draftDeckCheck, draftRivalSnapshot, toDraftView, toPublicView } from "./duels";

const REG = new CardRegistry();
const INPUT = { cards: REG.cards, player: (id: string) => REG.player(id), droppable: () => true };
const POOL = buildDraftPool(INPUT, eligibleDataVersion(INPUT)!);
const RUN = "12345678-9abc-4def-8123-456789abcdef";

function play(seed: number, stage = 1): DuelMatch {
  const picks = simulateDraft(POOL, seed).picks;
  const mine = draftDeckCheck(RUN, picks, 1).snapshot!;
  const rival = draftRivalSnapshot(rivalDeckFor(POOL, seed, stage), RIVAL_NAMES[stage - 1], `t-${seed}`);
  const s = startDuelMatch({ id: RUN, snapshotA: mine, snapshotB: rival, firstAttacker: seed % 2 ? "A" : "B", rules: CURRENT_COMBAT_RULES });
  assert.ok(s.ok);
  let m = s.match;
  const ctrl = createController({ side: "A", kind: "BOT", id: "a" }, { side: "B", kind: "BOT", id: "b" });
  const bots = { A: createDuelBot("a", "NORMAL"), B: createDuelBot("b", "HARD") };
  let ra = createRng(seed + 1); let rb = createRng(seed + 2);
  for (let i = 0; i < 200 && m.status === "IN_PROGRESS"; i++) {
    const r = advanceBots(m, ctrl, bots, ra, rb);
    assert.equal(r.error, undefined);
    ra = r.rngA; rb = r.rngB; m = r.match;
    if (m.phase === "READY_TO_CONFIRM") { const c = confirmTurn(m); assert.ok(c.ok); m = c.match; }
  }
  return m;
}

test("G01 · un combate del draft se juega entero con el motor canónico: 10 turnos y resultado", () => {
  const m = play(3);
  assert.notEqual(m.status, "IN_PROGRESS");
  assert.ok(m.result);
  assert.equal(m.turns.length, 10);
});

test("G02 · DUEL UX 2.0 · ninguna proyección INVENTA recompensa: draft y PvE salen sin cifra; la pone el recibo del libro", () => {
  const m = play(5);
  const draft = toDraftView(m, "HARD");
  const pve = toPublicView(m, "HARD");
  assert.ok(draft.result && pve.result);
  assert.equal(draft.result!.award, null);
  assert.equal(pve.result!.award, null, "la tabla ya no se enseña como si fuera lo concedido (el tope diario puede dejarla en 0)");
  const src = readFileSync(join(process.cwd(), "src/server/services/duels.ts"), "utf8");
  assert.match(src, /async function withReceipt\(/);
  assert.match(src, /\.eq\("ref", `duel:\$\{row\.id\}`\)/, "el recibo sale del asiento de ESTA partida");
  assert.match(src, /if \(row\.mode === DRAFT_GAUNTLET_MODE\) return \{ \.\.\.v, result: \{ \.\.\.v\.result, award: null, rewards: \{ matchId: row\.id, grants: \[\], capped: false \} \} \};/, "el draft no paga por combate");
});

test("G03 · la vista del draft nombra al rival NEXUS de la etapa", () => {
  assert.equal(toDraftView(play(6, 4), "HARD").rivalLabel, RIVAL_NAMES[3]);
});

test("G04 · la vista del draft sigue redactada: nunca las cartas no jugadas del rival", () => {
  const picks = simulateDraft(POOL, 8).picks;
  const rivalIds = rivalDeckFor(POOL, 8, 2);
  const s = startDuelMatch({ id: RUN, snapshotA: draftDeckCheck(RUN, picks).snapshot!, snapshotB: draftRivalSnapshot(rivalIds, "NEXUS Contender", "t8"), firstAttacker: "A", rules: CURRENT_COMBAT_RULES });
  assert.ok(s.ok);
  const v = toDraftView(s.match, "NORMAL");
  assert.equal(v.rivalRemaining, 10);
  const json = JSON.stringify(v);
  for (const id of rivalIds) assert.ok(!json.includes(`"cardId":"${id}"`) || picks.includes(id), id);
});

test("G05 · resultado coherente del motor: empate ⇔ sin ganador; ganador solo A o B; marcadores no negativos", () => {
  for (const seed of [11, 12, 13, 14, 15]) {
    const r = play(seed).result!;
    assert.equal(r.isDraw, r.winner === null);
    assert.ok(r.winner === null || r.winner === "A" || r.winner === "B");
    assert.ok(r.scoreA >= 0 && r.scoreB >= 0);
  }
});

test("G06 · uids del adaptador: 10 distintos, estables y con forma de UUID", () => {
  const uids = Array.from({ length: 10 }, (_, i) => draftCardUid(RUN, i));
  assert.equal(new Set(uids).size, 10);
  assert.deepEqual(uids, Array.from({ length: 10 }, (_, i) => draftCardUid(RUN, i)));
  for (const u of uids) assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("G07 · un rival ilegal no entra en la partida (misma validación canónica)", () => {
  const deck = rivalDeckFor(POOL, 9, 1);
  assert.throws(() => draftRivalSnapshot(deck.slice(0, 9), "x", "bad"));
  assert.throws(() => draftRivalSnapshot([...deck.slice(0, 9), deck[0]], "x", "dup"));
});

test("G08 · la plantilla del draft entra con las stats de combate del catálogo, sin modificadores", () => {
  const picks = simulateDraft(POOL, 14).picks;
  const snap = draftDeckCheck(RUN, picks).snapshot!;
  for (const c of snap.cards) assert.deepEqual(c.combat, REG.card(c.cardId)!.combat);
});
