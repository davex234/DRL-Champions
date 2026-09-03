/**
 * EXPORTADOR DE DATOS PARA EL DOCUMENTO DE PRODUCTO (Duelos).
 *
 *   npx tsx scripts/duel-deck-export.ts > <destino>.json
 *
 * Vuelca a JSON los datos REALES que necesitan los mockups del PDF: dos mazos válidos de 10 cartas
 * con su jugador, equipo, país, rol, variante, OVR y trío de combate, más una partida completa
 * Humano vs Bot jugada con el motor real (orquestador + resolver + bot NORMAL).
 *
 * Es de SOLO LECTURA: no toca el catálogo, ni la aplicación, ni el dominio. Existe para que el
 * documento no invente ni un solo número.
 */
import { CARDS } from "@/data/catalog";
import { CardRegistry } from "@/collection/registry";
import { getTeam } from "@/data/teams";
import { VARIANTS } from "@/domain/cards/variants";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import { buildDecks, mirrorSnapshot } from "./lib/duel-fixtures";
import { startDuelMatch, buildCombatPlan, type DuelMatch } from "@/domain/cardgame/match";
import { createRng, createController, advanceBots, createDuelBot } from "@/domain/cardgame/opponent";
import { auditCombatResult, explainCombatReason, type DuelDeckSnapshot } from "@/domain/cardgame/combat";
import { validateDuelDeck, createDuelDeck, makeDeckResolver, ownershipFromList, duelDeckStatus, explainDeckError } from "@/domain/cardgame";

const registry = new CardRegistry();
const NOW = 1_700_000_000_000;

/** Ficha completa de una carta, con todo lo que el mockup necesita pintar. */
function cardFace(uid: string, snap: DuelDeckSnapshot) {
  const c = snap.cards.find((x) => x.uid === uid)!;
  const player = registry.player(c.playerId);
  const team = getTeam(c.team);
  const variant = VARIANTS[c.variantId];
  return {
    uid: c.uid,
    nick: c.playerName,
    team: c.team,
    teamTag: team?.tag ?? c.team.slice(0, 3).toUpperCase(),
    teamColor: team?.color ?? "#333",
    country: player?.country ?? "",
    role: c.role,
    variantId: c.variantId,
    variantLabel: variant.label,
    palette: variant.palette,
    serialized: variant.serialized,
    serial: c.serial,
    ovr: c.ovr,
    combat: c.combat,
  };
}

const decks = buildDecks();
const mine = decks.M1;
const rival = mirrorSnapshot(decks.M2, "rival");
const mirror = mirrorSnapshot(decks.M1, "espejo");

/**
 * Juega una partida completa con el motor real. Las dos partes las mueve el bot NORMAL: es la
 * referencia reproducible del jugador que decide bien la mitad de las veces.
 */
function playShowcase(a: DuelDeckSnapshot, b: DuelDeckSnapshot, seedA: number, seedB: number): DuelMatch {
  const start = startDuelMatch({ id: "showcase", snapshotA: a, snapshotB: b, firstAttacker: "A" });
  if (!start.ok) throw new Error(start.error.code);
  const res = advanceBots(
    start.match,
    createController({ side: "A", kind: "BOT", id: "you" }, { side: "B", kind: "BOT", id: "bot" }),
    { A: createDuelBot("you", "NORMAL"), B: createDuelBot("bot", "NORMAL") },
    createRng(seedA), createRng(seedB),
  );
  if (res.error) throw new Error(res.error.code);
  return res.match;
}

// Semillas elegidas para que el documento muestre los TRES desenlaces posibles con partidas
// auténticas: victoria ajustada, derrota y empate en espejo. Ninguna cifra está escrita a mano.
const m: DuelMatch = playShowcase(mine, rival, 4006, 2196);       // VICTORY 5-4
const mDefeat: DuelMatch = playShowcase(mine, rival, 20260901, 77); // DEFEAT 4-6
const mDraw: DuelMatch = playShowcase(mine, mirror, 1253, 2795);    // DRAW

// ── Mazo INVÁLIDO de ejemplo: se quitan dos cartas de un rol y se duplica otro.
// Los errores los produce la validación REAL del dominio; no se inventa ninguno.
const best = new Map<string, (typeof CARDS)[number]>();
for (const c of CARDS) {
  const b = best.get(c.playerId);
  if (!b || c.ovr > b.ovr) best.set(c.playerId, c);
}
const byRole = new Map<RoleId, (typeof CARDS)[number][]>();
for (const c of best.values()) {
  const p = registry.player(c.playerId);
  if (p) byRole.set(p.role, [...(byRole.get(p.role) ?? []), c]);
}
for (const [, arr] of byRole) arr.sort((x, y) => y.ovr - x.ovr || x.id.localeCompare(y.id));
const duelistas = byRole.get("Duelista") ?? [];
const badPicks = [
  ...duelistas.slice(0, 4),                                  // 4 duelistas: sobran 2
  ...(byRole.get("Controlador") ?? []).slice(0, 2),
  ...(byRole.get("Iniciador") ?? []).slice(0, 2),
  ...(byRole.get("Centinela") ?? []).slice(0, 2),             // 0 Flex: faltan 2
];
const badOwned: OwnedCard[] = badPicks.map((c, i) => ({ uid: `bad-u${i}`, cardId: c.id, obtainedAt: NOW }));
const badDeck = createDuelDeck({ id: "bad", name: "Mazo incompleto", cards: badOwned.map((o) => o.uid), now: NOW });
const badValidation = validateDuelDeck(badDeck, makeDeckResolver(registry, ownershipFromList(badOwned)));

const out = {
  generatedFor: "NEXUS VALORANT CARDS — Duel Gameplay · Product Preview",
  deckMine: {
    name: "Mazo 1",
    sumOvr: mine.cards.reduce((s, c) => s + c.ovr, 0),
    dataVersion: mine.dataVersion,
    cards: mine.cards.map((c) => cardFace(c.uid, mine)),
  },
  deckRival: {
    name: "Rival",
    sumOvr: rival.cards.reduce((s, c) => s + c.ovr, 0),
    cards: rival.cards.map((c) => cardFace(c.uid, rival)),
  },
  invalidDeck: {
    status: duelDeckStatus(badDeck, badValidation),
    roleCounts: badValidation.roleCounts,
    errors: badValidation.errors.map((e) => ({ code: e.code, role: e.role, expected: e.expected, actual: e.actual, text: explainDeckError(e) })),
  },
  match: describe(m),
  matchDefeat: describe(mDefeat),
  matchDraw: describe(mDraw),
};

/** Proyección del partido para los mockups: marcador, motivo, audit trail y los 10 turnos. */
function describe(x: DuelMatch) {
  const r = x.result!;
  return {
    id: x.id,
    orchestratorVersion: x.orchestratorVersion,
    combatRulesVersion: x.combatRulesVersion,
    status: x.status,
    scoreA: r.scoreA,
    scoreB: r.scoreB,
    winner: r.winner,
    isDraw: r.isDraw,
    tiedEncounters: r.tiedEncounters,
    decidedBy: r.combat.decidedBy,
    reason: explainCombatReason(r.combat),
    audit: auditCombatResult(r.combat),
    sumOvrA: r.combat.tiebreak?.sumOvrA ?? null,
    sumOvrB: r.combat.tiebreak?.sumOvrB ?? null,
    statTotalA: r.combat.statTotalA,
    statTotalB: r.combat.statTotalB,
    plan: buildCombatPlan(x).encounters.length,
    turns: x.turns.map((t) => ({
      number: t.number,
      attacker: t.attacker,
      outcome: t.outcome,
      scoreAfterA: t.scoreAfterA,
      scoreAfterB: t.scoreAfterB,
      attackerStat: t.attackerStat,
      defenderStat: t.defenderStat,
      a: { uid: t.encounter.a.uid, nick: t.encounter.a.playerName, stat: t.encounter.a.stat, value: t.encounter.a.value, role: t.encounter.a.role, team: t.encounter.a.team },
      b: { uid: t.encounter.b.uid, nick: t.encounter.b.playerName, stat: t.encounter.b.stat, value: t.encounter.b.value, role: t.encounter.b.role, team: t.encounter.b.team },
      reason: t.encounter.reason,
    })),
  };
}

console.log(JSON.stringify(out, null, 2));
