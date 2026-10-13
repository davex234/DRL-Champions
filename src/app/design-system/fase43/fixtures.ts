/**
 * ARNÉS QA · FASE 43 — CARD MASTERY & DECK STRATEGY · ESCENAS QA SYNTHETIC.
 *
 * Lo SINTÉTICO: ejemplares (uids, series, fechas), nombres e ids de equipo. Lo REAL: las definiciones del catálogo y
 * sus estadísticas, el validador canónico (`checkDraft`), el análisis (`@/domain/deckStrategy`) y las partidas, que se
 * juegan con el MOTOR PURO y dos bots (`qaSimulation`) y se proyectan como en el servidor. Nada se escribe.
 */
import { explainDeckError, DUEL_ROLES } from "@/domain/cardgame";
import type { RoleId } from "@/domain/cards/types";
import { checkDraft, indexPool, type BuilderCard } from "@/domain/deckBuilder/builder";
import { analyzeDeck, suggestDeck, swapAlternatives, type Axis } from "@/domain/deckStrategy";
import { builderCardOf, catalogCards, strategyContext, syntheticCollection } from "@/lib/deckStrategy/catalog";
import { qaFindMatch, qaReplay, qaSimulate, qaSnapshot, qaView } from "@/lib/duel/qaSimulation";
import type { DuelMatch } from "@/domain/cardgame/match";
import type { DuelDeckDTO, DuelMatchView, DuelReplay } from "@/lib/duel/types";
import type { BuilderInitial as Init } from "@/components/duel/DeckBuilder";

export const FASE43_SCENES = [
  "legal-balanced", "legal-stronghold", "legal-gamesense", "legal-entryfrag", "polarized", "incomplete-8", "invalid-duplicate",
  "selected-duelist", "selected-initiator", "selected-controller", "selected-sentinel", "selected-flex",
  "swap-positive", "swap-tradeoff", "swap-no-change", "no-alternatives", "many-alternatives", "unowned-comparison",
  "active-deck", "inactive-deck", "suggest-balanced", "suggest-entryfrag", "pareto-options", "context-gamesense", "large-5000",
  "two-deck-comparison", "prematch-own", "pvp-hidden-rival", "pve-permitted",
  "post-match-win", "post-match-loss", "post-match-draw", "ovr-tiebreak", "stat-tiebreak",
  "axis-stronghold", "axis-gamesense", "axis-entryfrag", "replay-summary", "keyboard", "strategy-unavailable",
] as const;
export type Fase43Scene = (typeof FASE43_SCENES)[number];

const ctx = strategyContext();
const QA_NOW = Date.UTC(2026, 8, 16, 18);
const deckUuid = (n: number) => `0000dec4-3000-4000-8000-${String(n).padStart(12, "0")}`;

/* ───────────── colección y equipos ───────────── */

// 700 ejemplares de 250 definiciones: con el catálogo diseñado (329) quedan cartas SIN poseer (escena «no poseída»).
export const COLLECTION: BuilderCard[] = syntheticCollection(700, 43, 250);
// Gemelos REALES del catálogo (Duelistas con el mismo OVR y el mismo trío): «cambio sin efecto». Se buscan en el
// catálogo, no se escriben: se prefieren jugadores distintos; el catálogo diseñado (2026-09-21) solo tiene gemelos
// del MISMO jugador (dos ediciones con las mismas cifras), que siguen siendo un cambio real sin efecto.
const TWINS = (() => {
  const groups = new Map<string, string[]>();
  for (const c of catalogCards()) {
    if (c.role !== "Duelista") continue;
    const k = `${c.ovr}|${c.combat.stronghold}|${c.combat.gamesense}|${c.combat.entryfrag}`;
    groups.set(k, [...(groups.get(k) ?? []), c.cardId]);
  }
  const pairs = [...groups.values()].filter((ids) => ids.length >= 2).map((ids) => [...ids].sort());
  const distinct = pairs.find((ids) => new Set(ids.map((id) => id.split("__")[0])).size >= 2);
  const pair = distinct ?? pairs.sort((a, b) => a[0].localeCompare(b[0]))[0];
  if (!pair) throw new Error("fase43: el catálogo no tiene gemelos Duelista");
  const [a, b] = distinct ? [pair[0], pair.find((id) => id.split("__")[0] !== pair[0].split("__")[0])!] : pair;
  return [a, b];
})();
const TWIN_A = builderCardOf(TWINS[0], 900_001);
const TWIN_B = builderCardOf(TWINS[1], 900_002);
// Otra edición del jugador de TWIN_A (mazo «Variantes QA»: el mismo jugador dos veces).
const DUP_VARIANT = builderCardOf(catalogCards().find((c) => c.playerId === TWIN_A.playerId && c.cardId !== TWIN_A.cardId && c.cardId !== TWIN_B.cardId)?.cardId ?? TWIN_B.cardId, 900_003);
COLLECTION.push(TWIN_A, TWIN_B, DUP_VARIANT);
const POOL = indexPool(COLLECTION);

export function deckDto(n: number, name: string, uids: string[], pool = POOL, o: { active?: boolean } = {}): DuelDeckDTO {
  const check = checkDraft(uids, pool);
  return {
    id: deckUuid(n), name, cardUids: uids, cards: check.validation.resolved.map((c) => pool.get(c.uid)!),
    valid: check.ready, status: check.status, roleCounts: check.validation.roleCounts, missingByRole: check.validation.missingByRole,
    errors: check.validation.errors.map((e) => ({ code: e.code, message: explainDeckError(e) })),
    sumOvr: check.validation.resolved.reduce((s, c) => s + c.ovr, 0), updatedAt: QA_NOW - n * 3_600_000,
    version: new Date(QA_NOW - n * 3_600_000).toISOString().replace("Z", "000+00:00"), active: !!o.active,
  };
}

const sug = (o: "BALANCED" | Axis) => suggestDeck(POOL, o, ctx).uids;
const BAL = sug("BALANCED"); const SH = sug("stronghold"); const GS = sug("gamesense"); const EF = sug("entryfrag");

/** Polarizado: por rol, el jugador de mayor y el de menor OVR de la colección. */
const POLAR = (() => {
  const out: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, BuilderCard>();
    for (const c of COLLECTION) if (c.role === role) { const b = best.get(c.playerId); if (!b || c.ovr > b.ovr) best.set(c.playerId, c); }
    const list = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.uid.localeCompare(b.uid));
    out.push(list[0].uid, list[list.length - 1].uid);
  }
  return out;
})();

/** Equipo con el gemelo A de Duelista y el resto del equilibrado. */
const TWIN_DECK = (() => {
  const nonDuel = BAL.filter((u) => POOL.get(u)!.role !== "Duelista");
  const otherDuel = [...POOL.values()].filter((c) => c.role === "Duelista" && c.playerId !== TWIN_A.playerId && c.playerId !== TWIN_B.playerId).sort((a, b) => b.ovr - a.ovr || a.uid.localeCompare(b.uid))[0];
  return [...nonDuel, otherDuel.uid, TWIN_A.uid];
})();

export const DECKS = {
  bal: deckDto(1, "Equilibrio QA", BAL, POOL, { active: true }),
  sh: deckDto(2, "Muro QA", SH),
  gs: deckDto(3, "Lectura QA", GS),
  ef: deckDto(4, "Entrada QA", EF),
  polar: deckDto(5, "Extremos QA", POLAR),
  eight: deckDto(6, "A medias QA", BAL.slice(0, 8)),
  dup: deckDto(7, "Variantes QA", [...BAL.filter((u) => POOL.get(u)!.role !== "Duelista"), TWIN_A.uid, DUP_VARIANT.uid]),
  twin: deckDto(8, "Gemelos QA", TWIN_DECK),
};

const slotOf = (_uids: string[], role: RoleId) => `${role}-1`;
const findAlt = (uids: string[], pred: (fit: string[], noChange: boolean) => boolean) => {
  for (const u of uids) {
    for (const a of swapAlternatives(uids, u, POOL, ctx)) if (pred(a.impact.fit, a.impact.noChange)) return { slotUid: u, candidateUid: a.card.uid };
  }
  return null;
};
const POSITIVE = findAlt(BAL, (fit) => fit[0].startsWith("Sube") && !fit[0].includes("reduce"));
const TRADEOFF = findAlt(BAL, (fit) => fit[0].includes("pero reduce"));

/* ───────────── colecciones especiales ───────────── */

/** Sin alternativas: de Centinela solo los dos del equipo. */
const SCARCE = COLLECTION.filter((c) => c.role !== "Centinela" || BAL.includes(c.uid));
export const LARGE = syntheticCollection(5000, 5043, catalogCards().length);
const LARGE_POOL = indexPool(LARGE);
const LARGE_DECK = suggestDeck(LARGE_POOL, "gamesense", ctx).uids;
const UNOWNED = catalogCards().find((d) => d.role === "Controlador" && !COLLECTION.some((c) => c.cardId === d.cardId))!.cardId;

/* ───────────── partidas (motor real, bots) ───────────── */

const mirror = (pred: (m: DuelMatch) => boolean): DuelMatch | null => {
  const a = qaSnapshot(0, "qa-you", "QA · Equipo principal"); const b = qaSnapshot(0, "qa-mirror", "QA · Espejo");
  for (let s = 1; s < 3000; s++) { const m = qaSimulate(a, b, 10, s % 2 ? "A" : "B", s); if (pred(m)) return m; }
  return null;
};
const decided = (k: string) => (m: DuelMatch) => m.result?.combat.decidedBy === k;
const byAxis = (axis: Axis): DuelMatch => {
  let best: { m: DuelMatch; n: number } | null = null;
  for (let s = 1; s <= 500; s++) {
    const m = qaFindMatch(() => true, s, s)!;
    const n = m.turns.filter((t) => (t.attacker === "A" ? t.attackerStat : t.defenderStat) === axis).length;
    if (!best || n > best.n) best = { m, n };
  }
  return best!.m;
};

export const MATCHES = {
  win: qaFindMatch((m) => m.result?.winner === "A" && m.result.combat.decidedBy === "SCORE")!,
  loss: qaFindMatch((m) => m.result?.winner === "B" && m.result.combat.decidedBy === "SCORE")!,
  ovr: qaFindMatch(decided("OVR_TIEBREAK"), 1, 3000)!,
  stat: mirror(decided("STAT_MARGIN"))!,
  draw: mirror((m) => m.result?.combat.status === "DRAW")!,
};

/* ───────────── escenas ───────────── */

export interface BuilderScene { kind: "builder"; note: string; deck: DuelDeckDTO | null; collection: BuilderCard[]; initial?: Init }
export interface CompareScene { kind: "compare"; note: string; decks: DuelDeckDTO[] }
export interface PrematchScene { kind: "prematch"; note: string; decks: DuelDeckDTO[]; deckId: string; difficulty: "EASY" | "NORMAL" | "HARD"; rival: "BOT" | "RANKED" }
export interface ResultSceneT { kind: "result"; note: string; view: DuelMatchView; deckId: string | null }
export interface AxisScene { kind: "axis"; note: string; view: DuelMatchView }
export interface ReplayScene { kind: "replay"; note: string; replay: DuelReplay }
export type Scene = BuilderScene | CompareScene | PrematchScene | ResultSceneT | AxisScene | ReplayScene;

const b = (note: string, deck: DuelDeckDTO | null, initial: BuilderScene["initial"] = {}, collection = COLLECTION): BuilderScene => ({ kind: "builder", note, deck, collection, initial });

export const SCENES: Record<Fase43Scene, Scene> = {
  "legal-balanced": b(`equipo legal ${analyzeDeck(DECKS.bal.cards as BuilderCard[], ctx).orientation?.label}`, DECKS.bal),
  "legal-stronghold": b(`plantilla que prioriza Stronghold: ${analyzeDeck(DECKS.sh.cards as BuilderCard[], ctx).orientation?.label}`, DECKS.sh),
  "legal-gamesense": b(`plantilla que prioriza Gamesense: ${analyzeDeck(DECKS.gs.cards as BuilderCard[], ctx).orientation?.label}`, DECKS.gs),
  "legal-entryfrag": b(`plantilla que prioriza Entryfrag: ${analyzeDeck(DECKS.ef.cards as BuilderCard[], ctx).orientation?.label}`, DECKS.ef),
  polarized: b(`mejor y peor jugador de cada rol: forma ${analyzeDeck(DECKS.polar.cards as BuilderCard[], ctx).shape}`, DECKS.polar),
  "incomplete-8": b("8/10: medias parciales, sin orientación", DECKS.eight),
  "invalid-duplicate": b("dos variantes del mismo jugador: el validador canónico lo bloquea", DECKS.dup),
  "selected-duelist": b("carta seleccionada · Duelista", DECKS.bal, { slotSheet: slotOf(BAL, "Duelista") }),
  "selected-initiator": b("carta seleccionada · Iniciador", DECKS.bal, { slotSheet: slotOf(BAL, "Iniciador") }),
  "selected-controller": b("carta seleccionada · Controlador", DECKS.bal, { slotSheet: slotOf(BAL, "Controlador") }),
  "selected-sentinel": b("carta seleccionada · Centinela", DECKS.bal, { slotSheet: slotOf(BAL, "Centinela") }),
  "selected-flex": b("carta seleccionada · Flex", DECKS.bal, { slotSheet: slotOf(BAL, "Flex") }),
  "swap-positive": b("vista previa: solo sube", DECKS.bal, { compare: POSITIVE }),
  "swap-tradeoff": b("vista previa: sube un eje y reduce otro", DECKS.bal, { compare: TRADEOFF }),
  "swap-no-change": b("vista previa: gemelos reales del catálogo (mismas cifras)", DECKS.twin, { compare: { slotUid: TWIN_A.uid, candidateUid: TWIN_B.uid } }),
  "no-alternatives": b("Centinela sin alternativas en la colección", DECKS.bal, { slotSheet: "Centinela-1" }, SCARCE),
  "many-alternatives": b("Duelista con muchas alternativas (orden Δ OVR)", DECKS.bal, { slotSheet: "Duelista-2" }),
  "unowned-comparison": b("carta que no tienes: comparación solo informativa", DECKS.bal, { explore: UNOWNED }),
  "active-deck": b("equipo activo", DECKS.bal),
  "inactive-deck": b("equipo no activo", DECKS.gs),
  "suggest-balanced": b("plantilla por objetivo: Equilibrado", DECKS.eight, { suggestObjective: "BALANCED" }),
  "suggest-entryfrag": b("plantilla por objetivo: Priorizar Entryfrag", DECKS.bal, { suggestObjective: "entryfrag" }),
  "pareto-options": b("opciones no dominadas", DECKS.bal, { pareto: true }),
  "context-gamesense": b("contexto desde una partida: Gamesense (no es una orden)", DECKS.bal, { focusAxis: "gamesense", slotSheet: "Controlador-1" }),
  "large-5000": b(`colección de 5.000 ejemplares sobre ${catalogCards().length} definiciones`, deckDto(9, "Gran colección QA", LARGE_DECK, LARGE_POOL), { slotSheet: "Iniciador-1" }, LARGE),
  "two-deck-comparison": { kind: "compare", note: "dos equipos propios, sin ganador", decks: [DECKS.gs, DECKS.ef, DECKS.bal] },
  "prematch-own": { kind: "prematch", note: "pre-partida: perfil del propio equipo", decks: [DECKS.bal, DECKS.ef], deckId: DECKS.bal.id, difficulty: "NORMAL", rival: "BOT" },
  "pvp-hidden-rival": { kind: "prematch", note: "PvP: rival oculto, solo tu equipo", decks: [DECKS.ef], deckId: DECKS.ef.id, difficulty: "NORMAL", rival: "RANKED" },
  "pve-permitted": { kind: "prematch", note: "PvE Difícil: el mazo del bot se crea al empezar; nada del rival", decks: [DECKS.gs], deckId: DECKS.gs.id, difficulty: "HARD", rival: "BOT" },
  "post-match-win": { kind: "result", note: "victoria (motor real, bots)", view: qaView(MATCHES.win), deckId: DECKS.bal.id },
  "post-match-loss": { kind: "result", note: "derrota (motor real, bots)", view: qaView(MATCHES.loss), deckId: DECKS.bal.id },
  "post-match-draw": { kind: "result", note: "empate total (espejo, motor real)", view: qaView(MATCHES.draw), deckId: DECKS.bal.id },
  "ovr-tiebreak": { kind: "result", note: "desempate por suma de OVR (+1 punto)", view: qaView(MATCHES.ovr), deckId: DECKS.bal.id },
  "stat-tiebreak": { kind: "result", note: "desempate por estadística total (sin punto)", view: qaView(MATCHES.stat), deckId: DECKS.bal.id },
  "axis-stronghold": { kind: "axis", note: "partida con más turnos de Stronghold", view: qaView(byAxis("stronghold")) },
  "axis-gamesense": { kind: "axis", note: "partida con más turnos de Gamesense", view: qaView(byAxis("gamesense")) },
  "axis-entryfrag": { kind: "axis", note: "partida con más turnos de Entryfrag", view: qaView(byAxis("entryfrag")) },
  "replay-summary": { kind: "replay", note: "repetición: lectura desde los turnos guardados", replay: { ...qaReplay(MATCHES.win), deckId: DECKS.bal.id } },
  keyboard: b("teclado: foco visible en huecos y alternativas", DECKS.bal),
  "strategy-unavailable": { kind: "replay", note: "repetición sin turnos: la lectura no se inventa", replay: { ...qaReplay(MATCHES.win), turns: [], deckId: null } },
};
