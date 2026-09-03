/**
 * DUELOS — SERVICIO CON AUTORIDAD DE SERVIDOR (Fase 8, SOLO SERVIDOR).
 *
 * Es el único sitio donde se ejecuta una partida de duelos. Une tres piezas que ya existían y no
 * reimplementa ninguna:
 *
 *   · PROPIEDAD  → `user_cards` (migración 0011), leída con `service_role`.
 *   · CATÁLOGO   → `CardRegistry`, el mismo adaptador que usa la colección.
 *   · REGLAS     → `@/domain/cardgame` (Fases 3-7): validación de mazo, snapshot, orquestador de
 *                  turnos, bots y Combat Resolver. Aquí no se compara ni una estadística.
 *
 * FRONTERAS DE SEGURIDAD, que son la razón de ser de este fichero:
 *
 *   1. El mazo se resuelve SIEMPRE contra `user_cards`. Un `uid` que el usuario no posee no llega
 *      nunca a la partida, aunque el cliente lo pida.
 *   2. Las semillas se generan aquí con `crypto` y NO salen. El cliente no puede predecir al bot.
 *   3. El estado completo vive en `duel_matches`, cuya RLS no tiene ninguna política: el cliente
 *      no puede leerlo ni con su propio token. Lo que sale es `toPublicView`, redactado.
 *   4. Cada acción del jugador se valida contra el estado del SERVIDOR: de quién es el turno, qué
 *      fase es y qué cartas le quedan lo decide el orquestador, no el cuerpo de la petición.
 *
 * NO concede cartas, créditos ni recompensas. Un duelo de esta fase no mueve la economía.
 */
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import type { CombatStatKey } from "@/domain/cards/combat";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, duelDeckStatus, takeDeckSnapshot,
  makeDeckResolver, ownershipFromList, explainDeckError,
  DUEL_DECK_SIZE, DUEL_ROLES,
  type DuelDeck, type DuelDeckCard, type DuelDeckSnapshot, type DuelDeckStatus,
} from "@/domain/cardgame";
import { CURRENT_COMBAT_RULES, explainCombatReason } from "@/domain/cardgame/combat";
import { duelAward, capDuelAward, DAILY_DUEL_AWARD_CAP } from "@/domain/progression/duelRewards";
import { award } from "./rewards";
import {
  startDuelMatch, confirmTurn, availableCards, requiredDefenderStat,
  selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  type DuelMatch, type Side,
} from "@/domain/cardgame/match";
import {
  createRng, createController, advanceBots, createDuelBot,
  type BotDifficulty, type RngState,
} from "@/domain/cardgame/opponent";
import { toOwnedCard, type UserCardRow } from "./inventory";
import type {
  DuelDeckDTO, DuelDeckCardDTO, DuelMatchView, DuelTurnView, DuelReplay,
} from "@/lib/duel/types";

const registry = new CardRegistry();

/** El jugador siempre es el bando A. El bando B es el bot. */
const HUMAN: Side = "A";
const BOT: Side = "B";

/** Tope de mazos guardados por usuario. Evita que la lista crezca sin control. */
export const MAX_DECKS = 8;

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  data?: T;
}

const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });
const done = <T>(data: T): ServiceResult<T> => ({ ok: true, status: 200, data });

// ───────────────────────────── propiedad e inventario ─────────────────────────────

/** Instancias que el usuario posee REALMENTE, según la base de datos. */
async function loadOwned(sb: SupabaseClient, userId: string): Promise<OwnedCard[]> {
  const { data, error } = await sb
    .from("user_cards")
    .select("uid, card_id, serial, origin, locked, obtained_at")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return ((data as UserCardRow[]) ?? []).map(toOwnedCard);
}

/** Proyección de una carta de duelo para el cliente. Solo datos ya públicos del catálogo. */
function toCardDTO(c: DuelDeckCard): DuelDeckCardDTO {
  const player = registry.player(c.playerId);
  return {
    uid: c.uid,
    cardId: c.cardId,
    playerId: c.playerId,
    nick: c.playerName,
    team: c.team,
    country: player?.country ?? "",
    role: c.role,
    region: c.region,
    variantId: c.variantId,
    ovr: c.ovr,
    combat: c.combat,
    serial: c.serial,
  };
}

// ───────────────────────────── mazos ─────────────────────────────

/** Reconstruye el mazo de dominio a partir de una fila y valida contra la propiedad real. */
function validateAgainstOwnership(
  deck: DuelDeck, owned: OwnedCard[],
): { validation: ReturnType<typeof validateDuelDeck>; status: DuelDeckStatus } {
  const validation = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  return { validation, status: duelDeckStatus(deck, validation) };
}

interface DeckRow { id: string; name: string; card_uids: string[]; created_at: string; updated_at: string }

function toDeckDTO(row: DeckRow, owned: OwnedCard[]): DuelDeckDTO {
  const deck = createDuelDeck({
    id: row.id, name: row.name, cards: row.card_uids ?? [],
    now: new Date(row.created_at).getTime(),
  });
  const { validation, status } = validateAgainstOwnership(deck, owned);
  const roleCounts = validation.roleCounts;
  return {
    id: row.id,
    name: row.name,
    cardUids: row.card_uids ?? [],
    cards: validation.resolved.map(toCardDTO),
    valid: validation.valid,
    status,
    roleCounts,
    missingByRole: validation.missingByRole,
    // Los errores viajan ya explicados: la interfaz nunca traduce códigos de dominio.
    errors: validation.errors.map((e) => ({ code: e.code, message: explainDeckError(e) })),
    sumOvr: validation.resolved.reduce((s, c) => s + c.ovr, 0),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

/** Todos los mazos del usuario, ya validados contra su inventario de ahora mismo. */
export async function listDecks(sb: SupabaseClient, userId: string): Promise<ServiceResult<{ decks: DuelDeckDTO[] }>> {
  const [owned, res] = await Promise.all([
    loadOwned(sb, userId),
    sb.from("duel_decks").select("id, name, card_uids, created_at, updated_at")
      .eq("user_id", userId).order("updated_at", { ascending: false }),
  ]);
  if (res.error) return fail(500, res.error.message);
  return done({ decks: ((res.data as DeckRow[]) ?? []).map((r) => toDeckDTO(r, owned)) });
}

/** Cartas del usuario que pueden entrar en un mazo de duelo, listas para el constructor. */
export async function listCollection(sb: SupabaseClient, userId: string): Promise<ServiceResult<{ cards: DuelDeckCardDTO[] }>> {
  const owned = await loadOwned(sb, userId);
  const resolve = makeDeckResolver(registry, ownershipFromList(owned));
  const cards: DuelDeckCardDTO[] = [];
  for (const o of owned) {
    const r = resolve(o.uid);
    if (r.ok) cards.push(toCardDTO(r.card));
  }
  cards.sort((a, b) => b.ovr - a.ovr || a.nick.localeCompare(b.nick));
  return done({ cards });
}

const NAME_RE = /^[\p{L}\p{N} ._'#&-]{1,40}$/u;

/**
 * Crea o actualiza un mazo.
 *
 * Valida en servidor: nombre, tamaño, y que CADA instancia sea del usuario. Un mazo incompleto se
 * puede guardar —el jugador puede dejarlo a medias— pero uno con cartas ajenas no.
 */
export async function saveDeck(
  sb: SupabaseClient, userId: string,
  input: { id?: string; name: string; cardUids: string[] },
): Promise<ServiceResult<{ deck: DuelDeckDTO }>> {
  const name = input.name.trim();
  if (!NAME_RE.test(name)) return fail(400, "Nombre de mazo no válido");

  const uids = [...new Set(input.cardUids)];
  if (uids.length !== input.cardUids.length) return fail(400, "El mazo repite una carta");
  if (uids.length > DUEL_DECK_SIZE) return fail(400, `Un mazo tiene como máximo ${DUEL_DECK_SIZE} cartas`);

  // FRONTERA: la propiedad la decide la base de datos, no el cuerpo de la petición.
  const owned = await loadOwned(sb, userId);
  const ownedUids = new Set(owned.map((o) => o.uid));
  const alien = uids.find((u) => !ownedUids.has(u));
  if (alien) return fail(403, "Ese mazo contiene una carta que no es tuya");

  if (input.id) {
    const { data, error } = await sb.from("duel_decks")
      .update({ name, card_uids: uids })
      .eq("id", input.id).eq("user_id", userId)
      .select("id, name, card_uids, created_at, updated_at").maybeSingle();
    if (error) return fail(500, error.message);
    if (!data) return fail(404, "Mazo no encontrado");
    return done({ deck: toDeckDTO(data as DeckRow, owned) });
  }

  const { count } = await sb.from("duel_decks")
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) >= MAX_DECKS) return fail(409, `Has alcanzado el máximo de ${MAX_DECKS} mazos`);

  const { data, error } = await sb.from("duel_decks")
    .insert({ user_id: userId, name, card_uids: uids })
    .select("id, name, card_uids, created_at, updated_at").maybeSingle();
  if (error) return fail(500, error.message);
  return done({ deck: toDeckDTO(data as DeckRow, owned) });
}

export async function deleteDeck(sb: SupabaseClient, userId: string, id: string): Promise<ServiceResult<{ id: string }>> {
  const { error } = await sb.from("duel_decks").delete().eq("id", id).eq("user_id", userId);
  if (error) return fail(500, error.message);
  return done({ id });
}

// ───────────────────────────── mazo del rival ─────────────────────────────

/**
 * OPD-09 — MAZO DEL RIVAL. DECISIÓN DE PRODUCTO, no viene del documento de diseño.
 *
 * Ni el PDF ni las Fases 1-7 definen de dónde sale el mazo del oponente en un duelo contra la
 * máquina. Se elige lo que NO altera ninguna regla y da una partida justa: un mazo legal construido
 * de forma determinista con las cartas del catálogo cuyo OVR está más cerca del mazo del jugador.
 *
 * No modifica cartas, ni estadísticas, ni reglas: solo elige QUÉ diez cartas trae el rival. Si el
 * producto decide otra cosa (mazos por dificultad, mazos de temporada, espejo), se cambia aquí sin
 * tocar el motor.
 */
function buildOpponentDeck(targetSumOvr: number, seed: number): DuelDeckSnapshot {
  // Mejor carta de cada JUGADOR, agrupada por rol. Es el mismo criterio determinista que usan los
  // tests y el laboratorio de balance de la Fase 7, y garantiza que no se repita jugador.
  const byRole = new Map<RoleId, { cardId: string; ovr: number }[]>();
  for (const role of DUEL_ROLES) {
    const bestPerPlayer = new Map<string, { cardId: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = bestPerPlayer.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) bestPerPlayer.set(c.playerId, { cardId: c.id, ovr: c.ovr });
    }
    const arr = [...bestPerPlayer.values()].sort((a, b) => b.ovr - a.ovr || a.cardId.localeCompare(b.cardId));
    byRole.set(role, arr);
  }

  // Se busca el bloque de dos cartas por rol cuya suma total quede más cerca del mazo del jugador.
  const perRoleTarget = targetSumOvr / DUEL_ROLES.length / 2;
  const picks: { cardId: string; ovr: number }[] = [];
  for (const role of DUEL_ROLES) {
    const arr = byRole.get(role) ?? [];
    if (arr.length < 2) throw new Error(`El catálogo no tiene 2 cartas de ${role} para el rival`);
    let bestStart = 0;
    let bestDist = Infinity;
    for (let i = 0; i + 1 < arr.length; i++) {
      const dist = Math.abs((arr[i].ovr + arr[i + 1].ovr) / 2 - perRoleTarget);
      if (dist < bestDist) { bestDist = dist; bestStart = i; }
    }
    picks.push(arr[bestStart], arr[bestStart + 1]);
  }

  // Instancias sintéticas del rival: existen solo dentro de esta partida y nunca se conceden.
  const owned: OwnedCard[] = picks.map((p, i) => ({
    uid: `bot-${seed}-${i}`, cardId: p.cardId, obtainedAt: 0,
  }));
  const deck = createDuelDeck({ id: `bot-${seed}`, name: "Rival", cards: owned.map((o) => o.uid), now: 0 });
  const validation = validateDuelDeck(deck, makeDeckResolver(registry, ownershipFromList(owned)));
  if (!validation.valid) {
    throw new Error(`Mazo de rival ilegal: ${validation.errors.map((e) => e.code).join(", ")}`);
  }
  return takeDeckSnapshot(deck, validation, 0)!;
}

// ───────────────────────────── proyección pública ─────────────────────────────

/** Turno ya jugado, tal y como puede verlo el jugador: todo esto ocurrió a la vista. */
function toTurnView(m: DuelMatch, i: number): DuelTurnView {
  const t = m.turns[i];
  const mine = t.encounter.a;
  const theirs = t.encounter.b;
  return {
    number: t.number,
    attacker: t.attacker,
    outcome: t.outcome,
    scoreAfterYou: t.scoreAfterA,
    scoreAfterRival: t.scoreAfterB,
    you: { uid: mine.uid, nick: mine.playerName, team: mine.team, role: mine.role, stat: mine.stat, value: mine.value },
    rival: { uid: theirs.uid, nick: theirs.playerName, team: theirs.team, role: theirs.role, stat: theirs.stat, value: theirs.value },
    reason: t.encounter.reason,
  };
}

/**
 * Proyección REDACTADA de la partida.
 *
 * Lo que entra: marcador, turno, fase, mis cartas, las cartas del rival YA JUGADAS, el historial y,
 * si el rival ataca, la carta y estadística que acaba de declarar —que son públicas por definición—.
 *
 * Lo que NUNCA entra: las cartas no jugadas del rival, su snapshot, el estado del generador y las
 * semillas. Sin esto, el cliente podría calcular la partida entera antes de jugarla.
 */
export function toPublicView(m: DuelMatch, difficulty: BotDifficulty): DuelMatchView {
  const mySnap = m.snapshotA;
  const rivalSnap = m.snapshotB;
  const usedRival = new Set(m.usedB);
  const usedMine = new Set(m.usedA);

  const attacker = m.attacker;
  const iAmAttacker = attacker === HUMAN;
  const draft = m.draft;

  // Carta declarada por el rival cuando ataca él: ya está sobre la mesa, es pública.
  const rivalDeclared =
    !iAmAttacker && draft.attackerCardUid
      ? rivalSnap.cards.find((c) => c.uid === draft.attackerCardUid)
      : undefined;

  const result = m.result;

  return {
    matchId: m.id,
    difficulty,
    status: m.status,
    phase: m.phase,
    turn: m.currentTurn,
    totalTurns: 10,
    attacker,
    youAreAttacker: iAmAttacker,
    /*
     * Durante la partida el marcador es el recuento turno a turno del orquestador. Al TERMINAR pasa
     * a ser el del Combat Resolver, que puede diferir en un punto: el desempate por suma de medias
     * del documento de diseño otorga un punto adicional. El resolver es la autoridad, así que la
     * cabecera no puede seguir enseñando el recuento intermedio cuando ya hay resultado.
     */
    scoreYou: result ? result.scoreA : m.scoreA,
    scoreRival: result ? result.scoreB : m.scoreB,
    ties: m.ties,
    yourHand: mySnap.cards.filter((c) => !usedMine.has(c.uid)).map(toCardDTO),
    yourUsed: mySnap.cards.filter((c) => usedMine.has(c.uid)).map(toCardDTO),
    // Del rival solo lo jugado. Lo que le queda es un número, no una lista.
    rivalUsed: rivalSnap.cards.filter((c) => usedRival.has(c.uid)).map(toCardDTO),
    rivalRemaining: rivalSnap.cards.length - usedRival.size,
    yourDeckName: mySnap.deckName,
    yourSumOvr: mySnap.cards.reduce((s, c) => s + c.ovr, 0),
    rivalSumOvr: rivalSnap.cards.reduce((s, c) => s + c.ovr, 0),
    // Declaración en curso.
    pendingRival: rivalDeclared && draft.attackerStat
      ? { card: toCardDTO(rivalDeclared), stat: draft.attackerStat, value: rivalDeclared.combat[draft.attackerStat] }
      : null,
    requiredStat: requiredDefenderStat(m),
    yourDraftCardUid: iAmAttacker ? draft.attackerCardUid : draft.defenderCardUid,
    yourDraftStat: iAmAttacker ? draft.attackerStat : draft.defenderStat,
    history: m.turns.map((_, i) => toTurnView(m, i)),
    lastTurn: m.turns.length > 0 ? toTurnView(m, m.turns.length - 1) : null,
    result: result
      ? {
          winner: result.winner === null ? null : result.winner === HUMAN ? "YOU" : "RIVAL",
          isDraw: result.isDraw,
          scoreYou: result.scoreA,
          scoreRival: result.scoreB,
          tiedEncounters: result.tiedEncounters,
          decidedBy: result.combat.decidedBy,
          reason: explainCombatReason(result.combat),
          sumOvrYou: result.combat.tiebreak?.sumOvrA ?? null,
          sumOvrRival: result.combat.tiebreak?.sumOvrB ?? null,
          statTotalYou: result.combat.statTotalA,
          statTotalRival: result.combat.statTotalB,
          rulesVersion: result.combat.resolverVersion,
          /*
           * Lo que la partida ha dado. Se RECALCULA aquí en vez de leerse de una tabla
           * porque es determinista a partir del resultado y la dificultad: guardarlo
           * sería una segunda copia del mismo dato, con su riesgo de discrepar.
           *
           * Ojo: esto es lo que la partida CONCEDE, y el pago real lo hace
           * `awardMatchOutcome` una sola vez por partida. Que se pueda mostrar sin haber
           * cobrado todavía es correcto: el pago ocurre en el mismo `playTurn` que
           * produce el resultado.
           */
          award: (() => {
            const a = duelAward(
              {
                winner: result.winner === null ? null : result.winner === HUMAN ? "YOU" : "RIVAL",
                isDraw: result.isDraw,
              },
              difficulty,
            );
            return { points: a.points, credits: a.reward.credits ?? 0, xp: a.reward.xp ?? 0 };
          })(),
        }
      : null,
  };
}

// ───────────────────────────── partida ─────────────────────────────

interface MatchRow {
  id: string; user_id: string; deck_id: string | null; difficulty: string;
  status: string; state: DuelMatch; rng: { a: RngState; b: RngState }; rules_version: string;
}

const DIFFICULTIES = new Set<BotDifficulty>(["EASY", "NORMAL", "HARD"]);

/** Lee la fila de partida del usuario. Solo `service_role` puede llegar aquí. */
async function loadMatch(sb: SupabaseClient, userId: string, matchId: string): Promise<MatchRow | null> {
  const { data, error } = await sb.from("duel_matches")
    .select("id, user_id, deck_id, difficulty, status, state, rng, rules_version")
    .eq("id", matchId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MatchRow) ?? null;
}

async function persist(sb: SupabaseClient, row: MatchRow, m: DuelMatch, rng: { a: RngState; b: RngState }) {
  const { error } = await sb.from("duel_matches")
    .update({
      status: m.status,
      state: m as unknown as object,
      rng,
      /*
       * `winner` es una copia DESNORMALIZADA de lo que ya dice `state` (migración 0016):
       * existe para que las misiones de temporada puedan contar victorias con un índice
       * en vez de traer y abrir un jsonb por partida. No decide nada —quién gana lo
       * sigue diciendo el Combat Resolver— y por eso se escribe desde el resultado que
       * él produce, nunca al revés.
       */
      winner: m.result?.winner ?? null,
    })
    .eq("id", row.id).eq("user_id", row.user_id);
  if (error) throw new Error(error.message);
}

/**
 * Hace avanzar al bot hasta que le toque decidir a la persona (o la partida acabe).
 *
 * El bot lo mueve `advanceBots`, del motor: aquí no se decide ni una jugada. `confirmTurn` también
 * es del orquestador. Esta función solo transporta el estado del generador.
 */
function runBot(m: DuelMatch, difficulty: BotDifficulty, rng: { a: RngState; b: RngState }) {
  const ctrl = createController(
    { side: HUMAN, kind: "HUMAN", id: "you" },
    { side: BOT, kind: "BOT", id: "bot" },
  );
  const res = advanceBots(m, ctrl, { [BOT]: createDuelBot("bot", difficulty) }, rng.a, rng.b);
  return { match: res.match, rng: { a: res.rngA, b: res.rngB }, error: res.error };
}

/** Confirma el turno si los dos bandos ya han declarado. Nunca lo hace la interfaz. */
function confirmIfReady(m: DuelMatch): DuelMatch {
  if (m.phase !== "READY_TO_CONFIRM") return m;
  const c = confirmTurn(m);
  return c.ok ? c.match : m;
}

export async function startMatch(
  sb: SupabaseClient, userId: string, deckId: string, difficulty: string,
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  if (!DIFFICULTIES.has(difficulty as BotDifficulty)) return fail(400, "Dificultad no válida");
  const level = difficulty as BotDifficulty;

  const owned = await loadOwned(sb, userId);
  const { data: deckRow, error } = await sb.from("duel_decks")
    .select("id, name, card_uids, created_at, updated_at")
    .eq("id", deckId).eq("user_id", userId).maybeSingle();
  if (error) return fail(500, error.message);
  if (!deckRow) return fail(404, "Mazo no encontrado");

  const row = deckRow as DeckRow;
  const deck = createDuelDeck({
    id: row.id, name: row.name, cards: row.card_uids ?? [], now: new Date(row.created_at).getTime(),
  });

  // FRONTERA: se vuelve a validar contra la propiedad REAL, no contra lo que guardó el cliente.
  const { validation } = validateAgainstOwnership(deck, owned);
  if (!validation.valid) {
    return fail(409, `Ese mazo no es legal: ${validation.errors.map(explainDeckError)[0] ?? "revisa la composición"}`);
  }

  const snapshot = takeDeckSnapshot(deck, validation, Date.now());
  if (!snapshot) return fail(500, "No se pudo preparar el mazo");

  const sumOvr = snapshot.cards.reduce((s, c) => s + c.ovr, 0);
  // Semillas de servidor. Nunca salen de aquí: son lo que hace impredecible al bot.
  const seedA = randomInt(0, 2 ** 31);
  const seedB = randomInt(0, 2 ** 31);
  const opponent = buildOpponentDeck(sumOvr, randomInt(0, 2 ** 31));
  // Quién abre el primer turno también se decide en servidor.
  const firstAttacker: Side = randomInt(0, 2) === 0 ? HUMAN : BOT;

  const started = startDuelMatch({
    id: crypto.randomUUID(),
    snapshotA: snapshot,
    snapshotB: opponent,
    firstAttacker,
    rules: CURRENT_COMBAT_RULES,
  });
  if (!started.ok) return fail(500, "La partida no puede empezar con ese mazo");

  let rng = { a: createRng(seedA), b: createRng(seedB) };
  // Si abre el bot, se le deja declarar antes de devolver el estado.
  const advanced = runBot(started.match, level, rng);
  if (advanced.error) return fail(500, "El oponente no pudo abrir el turno");
  const match = advanced.match;
  rng = advanced.rng;

  const { data: inserted, error: insErr } = await sb.from("duel_matches").insert({
    user_id: userId, deck_id: row.id, difficulty: level, status: match.status,
    state: match as unknown as object, rng, rules_version: CURRENT_COMBAT_RULES.version,
  }).select("id").maybeSingle();
  if (insErr) return fail(500, insErr.message);

  const withId: DuelMatch = { ...match, id: (inserted as { id: string }).id };
  await sb.from("duel_matches").update({ state: withId as unknown as object })
    .eq("id", withId.id).eq("user_id", userId);

  return done({ view: toPublicView(withId, level) });
}

export async function getMatch(
  sb: SupabaseClient, userId: string, matchId: string,
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  const row = await loadMatch(sb, userId, matchId);
  if (!row) return fail(404, "Partida no encontrada");
  return done({ view: toPublicView(row.state, row.difficulty as BotDifficulty) });
}

/** Partida en curso del usuario, si la hay. Permite retomar tras recargar la página. */
export async function getActiveMatch(
  sb: SupabaseClient, userId: string,
): Promise<ServiceResult<{ view: DuelMatchView | null }>> {
  const { data, error } = await sb.from("duel_matches")
    .select("id, user_id, deck_id, difficulty, status, state, rng, rules_version")
    .eq("user_id", userId).eq("status", "IN_PROGRESS")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return done({ view: null });
  const row = data as MatchRow;
  return done({ view: toPublicView(row.state, row.difficulty as BotDifficulty) });
}

/**
 * Aplica LA jugada de la persona y devuelve el estado resultante.
 *
 * Atacando: elige carta y declara estadística. Defendiendo: elige carta, y la estadística la impone
 * la tabla del documento de diseño —el cliente ni la envía—. Después se deja actuar al bot y, si el
 * turno está completo, lo cierra el orquestador.
 *
 * Toda decisión de legalidad la toma el orquestador. Si rechaza algo, se devuelve su motivo y NO se
 * persiste nada: una jugada ilegal no puede dejar la partida a medias.
 */
export async function playTurn(
  sb: SupabaseClient, userId: string, matchId: string, cardUid: string, stat?: string,
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  const row = await loadMatch(sb, userId, matchId);
  if (!row) return fail(404, "Partida no encontrada");
  if (row.state.status !== "IN_PROGRESS") return fail(409, "La partida ya ha terminado");

  const level = row.difficulty as BotDifficulty;
  let m = row.state;
  let rng = row.rng;

  const iAmAttacker = m.attacker === HUMAN;

  if (iAmAttacker) {
    if (m.phase !== "ATTACKER_CARD") return fail(409, "Ahora no te toca declarar");
    const s = typeof stat === "string" ? stat : "";
    if (!["stronghold", "gamesense", "entryfrag"].includes(s)) return fail(400, "Estadística no válida");

    const a = selectAttackerCard(m, cardUid);
    if (!a.ok) return fail(409, humanize(a.error.code));
    const b = selectAttackerStat(a.match, s as CombatStatKey);
    if (!b.ok) return fail(409, humanize(b.error.code));
    m = b.match;
  } else {
    if (m.phase !== "DEFENDER_CARD") return fail(409, "Ahora no te toca responder");
    const d = selectDefenderCard(m, cardUid);
    if (!d.ok) return fail(409, humanize(d.error.code));
    // La estadística del defensor la impone la tabla: el cliente no la elige ni la envía.
    const forced = requiredDefenderStat(d.match);
    if (!forced) return fail(500, "No se pudo determinar la respuesta obligada");
    const s = selectDefenderStat(d.match, forced);
    if (!s.ok) return fail(409, humanize(s.error.code));
    m = s.match;
  }

  // Le toca al bot: responder si el jugador atacó, o nada si el jugador acaba de responder.
  const afterBot = runBot(m, level, rng);
  if (afterBot.error) return fail(500, "El oponente no pudo responder");
  m = confirmIfReady(afterBot.match);
  rng = afterBot.rng;

  // Y si el siguiente turno lo abre el bot, se le deja declarar antes de devolver el estado.
  const next = runBot(m, level, rng);
  if (!next.error) { m = next.match; rng = next.rng; }

  await persist(sb, row, m, rng);

  /*
   * ═══ EL CIERRE DEL CICLO (Fase 10) ═══
   *
   * Si la partida ha terminado en esta jugada, se paga. Antes de la Fase 10 aquí no
   * había nada: un duelo acababa y el jugador no se llevaba ni un crédito, ni XP, ni un
   * punto de rango. El modo propio del juego no tocaba la progresión.
   *
   * Va DESPUÉS de persistir a propósito. Si se pagara antes y la persistencia fallara, el
   * jugador cobraría por una partida que el servidor no recuerda haber terminado; al
   * revés, un fallo al pagar deja la partida bien guardada y el pago es reintentable —su
   * clave de idempotencia es la propia partida—.
   *
   * Y no rompe la jugada: si el pago falla, la respuesta sigue siendo el estado correcto
   * del duelo. Una recompensa perdida se puede reclamar; una partida corrompida, no.
   */
  await awardMatchOutcome(sb, row.user_id, row.id, m, level).catch((e: unknown) => {
    console.error(`[duelos] no se pudo pagar la partida ${row.id}: ${(e as Error).message}`);
  });

  return done({ view: toPublicView(m, level) });
}

/**
 * Paga lo que ha dado una partida TERMINADA.
 *
 * Tres cosas que no se negocian:
 *
 *   1. **Solo partidas terminadas de verdad.** `IN_PROGRESS` y `WAITING` no pagan. Y
 *      abandonar no paga nada, porque `abandonMatch` BORRA la fila: no hay partida que
 *      cobrar. Eso cierra la vía de «empiezo, veo que voy perdiendo y abandono».
 *   2. **Una partida, un pago.** La clave de idempotencia es `duel:<matchId>`, así que
 *      reintentar, recargar o una condición de carrera entre dos peticiones no pagan dos
 *      veces. Lo garantiza el índice único del libro mayor, no este código.
 *   3. **La recompensa no la decide esta función.** La decide la tabla del dominio
 *      (`domain/progression/duelRewards`), que es pura y está probada. Aquí solo se
 *      transporta.
 */
async function awardMatchOutcome(
  sb: SupabaseClient, userId: string, matchId: string, m: DuelMatch, difficulty: BotDifficulty,
): Promise<void> {
  const result = m.result;
  if (!result || m.status === "IN_PROGRESS" || m.status === "WAITING") return;

  const base = duelAward(
    {
      winner: result.winner === null ? null : result.winner === HUMAN ? "YOU" : "RIVAL",
      isDraw: result.isDraw,
    },
    difficulty,
  );

  /*
   * EL TOPE DIARIO. Un duelo contra un bot se puede repetir sin límite, así que conectarlo
   * a la economía sin tope sería abrir una granja de créditos y de rango. Se cuentan las
   * partidas YA PAGADAS hoy —los asientos del libro mayor cuyo motivo empieza por
   * `duel_`— y a partir del cupo la partida se sigue jugando y guardando, pero deja de
   * pagar.
   *
   * Se cuenta lo pagado y no lo jugado a propósito: abandonar no consume cupo, y un fallo
   * de red que impida un pago no le quita a nadie su parte.
   */
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await sb
    .from("credit_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .like("reason", "duel\_%")
    .gte("created_at", since.toISOString());

  const a = capDuelAward(base, count ?? 0);

  await award(sb, {
    userId,
    ref: `duel:${matchId}`,
    // El motivo distingue una partida topada: en el libro mayor se ve por qué no pagó.
    reason: a.capped ? `duel_capped_${a.outcome}` : `duel_${a.outcome}`,
    reward: a.reward,
    points: a.points,
  });
}

/** Cupo diario de partidas que pagan, expuesto para la interfaz y las pruebas. */
export { DAILY_DUEL_AWARD_CAP };

/** Traduce un rechazo del orquestador a algo que el jugador entienda. */
function humanize(code: string): string {
  switch (code) {
    case "CARD_ALREADY_USED": return "Esa carta ya la has usado en un turno anterior";
    case "CARD_NOT_IN_SNAPSHOT": return "Esa carta no está en tu mazo de esta partida";
    case "WRONG_PHASE": return "Ahora no toca esa acción";
    case "ILLEGAL_STAT_MATCHUP": return "Esa estadística no puede enfrentarse a la declarada";
    case "MATCH_ALREADY_COMPLETE": return "La partida ya ha terminado";
    default: return "Jugada no permitida";
  }
}

/**
 * Repetición de una partida TERMINADA.
 *
 * Solo se sirve cuando la partida ha acabado: mientras está en curso, el historial completo del
 * rival seguiría siendo información viva. Al terminar, ya no esconde nada.
 */
export async function getReplay(
  sb: SupabaseClient, userId: string, matchId: string,
): Promise<ServiceResult<DuelReplay>> {
  const row = await loadMatch(sb, userId, matchId);
  if (!row) return fail(404, "Partida no encontrada");
  const m = row.state;
  if (m.status === "IN_PROGRESS" || m.status === "WAITING") {
    return fail(409, "La repetición solo está disponible al terminar la partida");
  }
  const view = toPublicView(m, row.difficulty as BotDifficulty);
  return done({
    matchId: m.id,
    difficulty: row.difficulty as BotDifficulty,
    rulesVersion: row.rules_version,
    yourDeckName: m.snapshotA.deckName,
    turns: view.history,
    result: view.result,
    yourCards: m.snapshotA.cards.map(toCardDTO),
    rivalCards: m.snapshotB.cards.map(toCardDTO),
  });
}

/** Partidas terminadas del usuario, para la lista de repeticiones. */
export async function listReplays(
  sb: SupabaseClient, userId: string,
): Promise<ServiceResult<{ matches: { matchId: string; difficulty: string; status: string; scoreYou: number; scoreRival: number; deckName: string; playedAt: number }[] }>> {
  const { data, error } = await sb.from("duel_matches")
    .select("id, difficulty, status, state, updated_at")
    .eq("user_id", userId).neq("status", "IN_PROGRESS")
    .order("updated_at", { ascending: false }).limit(20);
  if (error) return fail(500, error.message);
  const matches = ((data as { id: string; difficulty: string; status: string; state: DuelMatch; updated_at: string }[]) ?? [])
    .filter((r) => r.state?.result)
    .map((r) => ({
      matchId: r.id,
      difficulty: r.difficulty,
      status: r.status,
      scoreYou: r.state.result!.scoreA,
      scoreRival: r.state.result!.scoreB,
      deckName: r.state.snapshotA.deckName,
      playedAt: new Date(r.updated_at).getTime(),
    }));
  return done({ matches });
}

/** Abandona la partida en curso. No hay penalización: el abandono no está definido (Fase 7). */
export async function abandonMatch(
  sb: SupabaseClient, userId: string, matchId: string,
): Promise<ServiceResult<{ id: string }>> {
  const { error } = await sb.from("duel_matches").delete().eq("id", matchId).eq("user_id", userId);
  if (error) return fail(500, error.message);
  return done({ id: matchId });
}

/** Nombres de rol, para que la interfaz no los invente. */
export const DUEL_ROLE_LIST = DUEL_ROLES;
/** Cartas exactas de un mazo, para que la interfaz no lo asuma. */
export const DUEL_SIZE = DUEL_DECK_SIZE;
/** Cartas disponibles ahora mismo, expuesto para los tests del servicio. */
export { availableCards };
