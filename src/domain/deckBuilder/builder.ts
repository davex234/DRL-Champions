/**
 * DECK BUILDER 2.0 (Fase 32) — AYUDANTES DE PRESENTACIÓN ALREDEDOR DEL VALIDADOR CANÓNICO. PURO.
 *
 * Aquí NO hay reglas nuevas. Todo lo que decide si un equipo es legal sale de `@/domain/cardgame`:
 *
 *   · `validateDuelDeck`  — tamaño (10), composición por rol (2 × Duelista/Controlador/Iniciador/
 *                            Centinela/Flex), carta repetida, JUGADOR repetido (variantes incluidas),
 *                            propiedad y temporada (`dataVersion`).
 *   · `duelDeckStatus`    — EMPTY / INCOMPLETE / INVALID / READY_FOR_DUEL.
 *   · `addCard` / `removeCard` / `replaceCard` — las mutaciones canónicas del mazo.
 *   · `explainDeckError`  — el texto canónico de cada error.
 *
 * Lo que añade este módulo es LECTURA de ese veredicto para la pantalla: huecos por rol, estado de
 * cada hueco, frases humanas, qué cambio es posible antes de hacerlo, medias de las estadísticas que
 * ya existen (OVR y el trío de combate), comparación, sugerencia por OVR y autocompletado con
 * búsqueda con retroceso. Una operación se permite si NO introduce un error «duro» que el validador
 * no tuviera ya (un equipo a medias es un estado legítimo; uno con dos cartas del mismo jugador, no).
 *
 * FLEX, según el código: es un ROL de jugador (`RoleId`), no un hueco comodín. Un hueco Flex solo
 * admite cartas de jugadores Flex. El serial NO interviene en nada de lo que se calcula aquí.
 *
 * El servidor vuelve a validar al guardar, al activar y al jugar: esto es la vista, no la autoridad.
 */
import {
  addCard, createDuelDeck, duelDeckStatus, explainDeckError, removeCard, replaceCard, validateDuelDeck,
  DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES,
  type DuelDeckCard, type DuelDeckError, type DuelDeckResolver, type DuelDeckStatus, type DuelDeckValidation,
} from "@/domain/cardgame";
import { compareCards } from "@/domain/cardgame/deckInsert";
import { COMBAT_STAT_META, COMBAT_STAT_ORDER, type CombatStatKey, type CombatStats } from "@/domain/cards/combat";
import type { Region, RoleId, VariantId } from "@/domain/cards/types";
import { ns, td } from "@/i18n/runtime";

const t = ns("deckBuilder");

/* ───────────────────────────── carta del constructor ───────────────────────────── */

/**
 * Un EJEMPLAR poseído (instancia de `user_cards`), ya resuelto por el servidor contra la versión con
 * la que se acuñó. Es `DuelDeckCardDTO` + lo que el validador canónico necesita (`dataVersion`,
 * `statBoost`) + la fecha de obtención (orden «más reciente»).
 */
export interface BuilderCard {
  uid: string;
  cardId: string;
  playerId: string;
  nick: string;
  team: string;
  country: string;
  role: RoleId;
  region: Region;
  variantId: VariantId;
  ovr: number;
  combat: CombatStats;
  serial: number | null;
  dataVersion: string;
  statBoost: number;
  obtainedAt: number;
  /** Copias de esta carta según el servidor (ver `DeckBuilderCardDTO.copies`). Ausente = se cuentan los ejemplares. */
  copies?: number;
}

export type Pool = ReadonlyMap<string, BuilderCard>;

export const indexPool = (cards: readonly BuilderCard[]): Pool => new Map(cards.map((c) => [c.uid, c]));

export const toDuelDeckCard = (c: BuilderCard): DuelDeckCard => ({
  uid: c.uid, cardId: c.cardId, playerId: c.playerId, playerName: c.nick, team: c.team, region: c.region,
  role: c.role, variantId: c.variantId, combat: c.combat, ovr: c.ovr, statBoost: c.statBoost,
  dataVersion: c.dataVersion, serial: c.serial,
});

/** Puerto de resolución del validador canónico sobre la colección del servidor. Lo que no está, no es tuyo. */
export function poolResolver(pool: Pool): DuelDeckResolver {
  return (uid) => {
    const c = pool.get(uid);
    return c ? { ok: true, card: toDuelDeckCard(c) } : { ok: false, uid, reason: "CARD_NOT_OWNED" };
  };
}

/** Orden documentado de «mejor carta»: OVR descendente; empate → nick; empate → uid. Determinista. */
export const byOvr = (a: BuilderCard, b: BuilderCard): number =>
  b.ovr - a.ovr || a.nick.localeCompare(b.nick, "es") || a.uid.localeCompare(b.uid);

/* ───────────────────────────── veredicto del borrador ───────────────────────────── */

export interface DraftCheck {
  validation: DuelDeckValidation;
  status: DuelDeckStatus;
  ready: boolean;
  count: number;
  /** Errores que no son «falta algo»: sobra, repite, mezcla o ya no es tuya. */
  hard: DuelDeckError[];
  /** Referencias del borrador que ya no están en la colección (propiedad perdida). */
  lostUids: string[];
}

/** «Falta algo» (incompleto) frente a «algo está mal» (duro). Misma frontera que `duelDeckStatus`. */
export function isIncompleteError(e: DuelDeckError): boolean {
  return (e.code === "DECK_SIZE" && (e.actual ?? 0) < DUEL_DECK_SIZE)
    || (e.code === "ROLE_COUNT" && (e.actual ?? 0) < (e.expected ?? 0));
}

const draftDeck = (uids: readonly string[]) => createDuelDeck({ id: "draft", name: "draft", cards: [...uids], now: 0 });

/** Ejecuta EL validador canónico sobre el borrador. */
export function checkDraft(uids: readonly string[], pool: Pool): DraftCheck {
  const deck = draftDeck(uids);
  const validation = validateDuelDeck(deck, poolResolver(pool));
  return {
    validation,
    status: duelDeckStatus(deck, validation),
    ready: validation.valid,
    count: uids.length,
    hard: validation.errors.filter((e) => !isIncompleteError(e)),
    lostUids: uids.filter((u) => !pool.has(u)),
  };
}

/* ───────────────────────────── lenguaje humano ───────────────────────────── */

export const ROLE_PLURAL: Record<RoleId, string> = {
  Duelista: "Duelistas", Controlador: "Controladores", Iniciador: "Iniciadores", Centinela: "Centinelas", Flex: "Flex",
};
export const roleCount = (n: number, role: RoleId): string => `${n} ${n === 1 ? role : ROLE_PLURAL[role]}`;

export const DUPLICATE_PLAYER_TEXT = "Ya tienes otra carta de este jugador en el equipo.";
export const LOST_CARD_TEXT = "Esta carta ya no está disponible.";
export const AUTOCOMPLETE_FAIL_TEXT = "No tienes suficientes cartas compatibles para completar este equipo.";
export const SUGGEST_REASON = "Mejor OVR disponible para este hueco.";
export const READY_TEXT = "EQUIPO LISTO";

export type IssueKind = "missing" | "excess" | "conflict" | "lost";

export interface Issue {
  kind: IssueKind;
  code: DuelDeckError["code"];
  message: string;
  /** Cartas del borrador a las que afecta (para marcar su hueco). */
  uids: string[];
  role?: RoleId;
}

/** «6 / 10 CARTAS». */
export const countLabel = (count: number): string => t("{count} / {DUEL_DECK_SIZE} CARTAS", { count, DUEL_DECK_SIZE });

/** «Faltan: 1 Controlador · 1 Centinela · 2 Flex», o null si no falta ningún rol. */
export function missingText(v: DuelDeckValidation): string | null {
  const roles = DUEL_ROLES.filter((r) => v.missingByRole[r] > 0);
  return roles.length ? t("Faltan: {roles}", { roles: roles.map((r) => roleCount(v.missingByRole[r], r)).join(" · ") }) : null;
}

const dupPlayersFor = (v: DuelDeckValidation, playerId: string): boolean =>
  v.errors.some((e) => e.code === "DUPLICATE_PLAYER" && e.playerId === playerId);

/**
 * Qué falta, qué sobra y qué choca, en frases. Cada error canónico se traduce una vez; los que
 * describen lo mismo (dos copias de una carta ⇒ también jugador repetido) se funden.
 */
export function describeIssues(check: DraftCheck, uids: readonly string[], pool: Pool): Issue[] {
  const v = check.validation;
  const out: Issue[] = [];
  const missing = missingText(v);
  if (missing) out.push({ kind: "missing", code: "ROLE_COUNT", message: missing, uids: [] });

  const dupPlayers = new Set<string>();
  const versionOf = v.resolved[0]?.dataVersion;
  for (const e of v.errors) {
    switch (e.code) {
      case "ROLE_COUNT": {
        const expected = e.expected ?? 0;
        const actual = e.actual ?? 0;
        if (actual <= expected || !e.role) break;
        const role = e.role;
        const inRole = uids.filter((u) => pool.get(u)?.role === role);
        out.push({ kind: "excess", code: e.code, role, message: t("Sobra {v}: solo caben {expected}.", { v: roleCount(actual - expected, role), expected }), uids: inRole.slice(expected) });
        break;
      }
      case "DECK_SIZE": {
        const actual = e.actual ?? 0;
        if (actual > DUEL_DECK_SIZE) out.push({ kind: "excess", code: e.code, message: t("Sobran {v} cartas: un equipo tiene {DUEL_DECK_SIZE}.", { v: actual - DUEL_DECK_SIZE, DUEL_DECK_SIZE }), uids: [] });
        break;
      }
      case "DUPLICATE_PLAYER": {
        if (!e.playerId || dupPlayers.has(e.playerId)) break;
        dupPlayers.add(e.playerId);
        const same = uids.filter((u) => pool.get(u)?.playerId === e.playerId);
        const nick = e.uid ? pool.get(e.uid)?.nick : undefined;
        out.push({ kind: "conflict", code: e.code, message: nick ? `${DUPLICATE_PLAYER_TEXT} (${nick})` : DUPLICATE_PLAYER_TEXT, uids: same });
        break;
      }
      case "DUPLICATE_CARD": {
        const card = e.uid ? pool.get(e.uid) : undefined;
        if (card && dupPlayersFor(v, card.playerId)) break; // ya lo cuenta el jugador repetido
        out.push({ kind: "conflict", code: e.code, message: t("No puedes usar la misma carta dos veces en el mismo equipo."), uids: e.uid ? [e.uid] : [] });
        break;
      }
      case "CARD_NOT_OWNED":
      case "CARD_NOT_FOUND":
        out.push({ kind: "lost", code: e.code, message: LOST_CARD_TEXT, uids: e.uid ? [e.uid] : [] });
        break;
      case "INCOMPATIBLE_DATA_VERSION":
        out.push({
          kind: "conflict", code: e.code, message: explainDeckError(e),
          uids: uids.filter((u) => { const c = pool.get(u); return !!c && c.dataVersion !== versionOf; }),
        });
        break;
      default:
        out.push({ kind: "conflict", code: e.code, message: explainDeckError(e), uids: e.uid ? [e.uid] : [] });
    }
  }
  const lostSeen = new Set<string>();
  const seen = new Set<string>();
  return out.filter((i) => {
    if (i.kind === "lost") {
      // Una frase por equipo, con todas las cartas perdidas.
      if (lostSeen.size) { const first = out.find((x) => x.kind === "lost")!; if (first !== i) { first.uids.push(...i.uids); return false; } }
      lostSeen.add(i.message);
      return true;
    }
    const k = `${i.kind}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ───────────────────────────── tablero ───────────────────────────── */

export type SlotState = "EMPTY" | "FILLED" | "INVALID";

export interface BoardSlot {
  key: string;
  role: RoleId;
  /** Posición dentro del rol (0, 1). */
  index: number;
  label: string;
  state: SlotState;
  uid: string | null;
  card: BuilderCard | null;
  issue: string | null;
}

/** Referencias que no caben en un hueco: cartas perdidas o de un rol que ya está lleno. */
export interface BoardExtra { uid: string; card: BuilderCard | null; issue: string }

export interface Board {
  slots: BoardSlot[];
  byRole: Record<RoleId, BoardSlot[]>;
  extras: BoardExtra[];
}

export const slotKey = (role: RoleId, index: number): string => `${role}-${index + 1}`;

/**
 * Los huecos salen de la composición canónica (`DUEL_ROLES` × `DUEL_COMPOSITION`). Cada carta cae
 * en el primer hueco libre de su rol, en el orden del borrador; mover dentro del rol es reordenar.
 */
export function buildBoard(uids: readonly string[], pool: Pool, check: DraftCheck = checkDraft(uids, pool)): Board {
  const problems = new Map<string, string>();
  for (const issue of describeIssues(check, uids, pool)) {
    if (issue.kind === "missing") continue;
    for (const u of issue.uids) if (!problems.has(u)) problems.set(u, issue.message);
  }
  const perRole = Object.fromEntries(DUEL_ROLES.map((r) => [r, [] as string[]])) as Record<RoleId, string[]>;
  const extras: BoardExtra[] = [];
  for (const u of uids) {
    const c = pool.get(u);
    if (!c) { extras.push({ uid: u, card: null, issue: LOST_CARD_TEXT }); continue; }
    perRole[c.role].push(u);
  }
  const byRole = {} as Record<RoleId, BoardSlot[]>;
  const slots: BoardSlot[] = [];
  for (const role of DUEL_ROLES) {
    const quota = DUEL_COMPOSITION[role];
    byRole[role] = [];
    for (let i = 0; i < quota; i++) {
      const uid = perRole[role][i] ?? null;
      const card = uid ? pool.get(uid) ?? null : null;
      const issue = uid ? problems.get(uid) ?? null : null;
      const slot: BoardSlot = {
        key: slotKey(role, i), role, index: i, label: `${role} ${i + 1}`,
        state: !uid ? "EMPTY" : issue ? "INVALID" : "FILLED", uid, card, issue,
      };
      byRole[role].push(slot);
      slots.push(slot);
    }
    for (const u of perRole[role].slice(quota)) {
      extras.push({ uid: u, card: pool.get(u) ?? null, issue: problems.get(u) ?? t("Sobra: solo caben {quota} de {role}.", { quota, role: td(role) }) });
    }
  }
  return { slots, byRole, extras };
}

/* ───────────────────────────── cambios posibles ───────────────────────────── */

export type EditBlock =
  | "ALREADY_IN" | "NOT_OWNED" | "DECK_FULL" | "ROLE_FULL" | "DUPLICATE_PLAYER"
  | "DATA_VERSION" | "WRONG_ROLE" | "NOT_IN_DECK" | "ILLEGAL";

export type EditResult =
  | { ok: true; uids: string[] }
  | { ok: false; code: EditBlock; reason: string; conflictUid: string | null };

const blocked = (code: EditBlock, reason: string, conflictUid: string | null = null): EditResult => ({ ok: false, code, reason, conflictUid });

const errKey = (e: DuelDeckError): string =>
  [e.code, e.role ?? "", e.playerId ?? "", e.cardId ?? "", (e.versions ?? []).join(","),
    e.code === "ROLE_COUNT" || e.code === "DECK_SIZE" ? String(e.actual ?? "") : ""].join("|");

/** Errores duros que aparecen DESPUÉS y no estaban ANTES (como multiconjunto). */
export function newHardErrors(before: DraftCheck, after: DraftCheck): DuelDeckError[] {
  const counts = new Map<string, number>();
  for (const e of before.hard) counts.set(errKey(e), (counts.get(errKey(e)) ?? 0) + 1);
  const fresh: DuelDeckError[] = [];
  for (const e of after.hard) {
    const k = errKey(e);
    const n = counts.get(k) ?? 0;
    if (n > 0) counts.set(k, n - 1);
    else fresh.push(e);
  }
  return fresh;
}

const PRIORITY: DuelDeckError["code"][] = ["DUPLICATE_PLAYER", "DUPLICATE_CARD", "ROLE_COUNT", "DECK_SIZE", "INCOMPATIBLE_DATA_VERSION"];
const priorityOf = (c: DuelDeckError["code"]): number => { const i = PRIORITY.indexOf(c); return i < 0 ? PRIORITY.length : i; };

function explainBlock(fresh: DuelDeckError[], card: BuilderCard, uids: readonly string[], pool: Pool, ignoreUid: string | null): EditResult {
  const e = [...fresh].sort((a, b) => priorityOf(a.code) - priorityOf(b.code))[0];
  switch (e.code) {
    case "DUPLICATE_PLAYER":
    case "DUPLICATE_CARD": {
      const other = uids.find((u) => u !== ignoreUid && u !== card.uid && pool.get(u)?.playerId === card.playerId) ?? null;
      return blocked("DUPLICATE_PLAYER", DUPLICATE_PLAYER_TEXT, other);
    }
    case "ROLE_COUNT":
      return blocked("ROLE_FULL", t("Los {v} huecos de {role} están ocupados. Sustituye una carta.", { v: DUEL_COMPOSITION[card.role], role: td(card.role) }));
    case "DECK_SIZE":
      return blocked("DECK_FULL", t("El equipo ya tiene {DUEL_DECK_SIZE} cartas. Sustituye una.", { DUEL_DECK_SIZE }));
    case "INCOMPATIBLE_DATA_VERSION":
      return blocked("DATA_VERSION", explainDeckError(e));
    default:
      return blocked("ILLEGAL", explainDeckError(e));
  }
}

/** Añadir una carta al borrador (a su rol). Mutación canónica `addCard`. */
export function tryAdd(uids: readonly string[], uid: string, pool: Pool, before: DraftCheck = checkDraft(uids, pool)): EditResult {
  if (uids.includes(uid)) return blocked("ALREADY_IN", t("Esta carta ya está en el equipo."), uid);
  const card = pool.get(uid);
  if (!card) return blocked("NOT_OWNED", t("Esta carta no está en tu colección."));
  if (uids.length >= DUEL_DECK_SIZE) return blocked("DECK_FULL", t("El equipo ya tiene {DUEL_DECK_SIZE} cartas. Sustituye una.", { DUEL_DECK_SIZE }));
  const next = addCard(draftDeck(uids), uid, 0).cards;
  const fresh = newHardErrors(before, checkDraft(next, pool));
  return fresh.length ? explainBlock(fresh, card, uids, pool, null) : { ok: true, uids: next };
}

/** Sustituir una carta por otra en el MISMO hueco. Mutación canónica `replaceCard` (conserva la posición). */
export function tryReplace(uids: readonly string[], oldUid: string, newUid: string, pool: Pool, before: DraftCheck = checkDraft(uids, pool)): EditResult {
  if (!uids.includes(oldUid)) return blocked("NOT_IN_DECK", t("Esa carta ya no está en el equipo."));
  if (oldUid === newUid) return { ok: true, uids: [...uids] };
  if (uids.includes(newUid)) return blocked("ALREADY_IN", t("Esta carta ya está en el equipo."), newUid);
  const card = pool.get(newUid);
  if (!card) return blocked("NOT_OWNED", t("Esta carta no está en tu colección."));
  const old = pool.get(oldUid);
  if (old && old.role !== card.role) return blocked("WRONG_ROLE", t("Este hueco es de {role}; {nick} juega de {role2}.", { role: td(old.role), nick: card.nick, role2: td(card.role) }));
  const next = replaceCard(draftDeck(uids), oldUid, newUid, 0).cards;
  const fresh = newHardErrors(before, checkDraft(next, pool));
  return fresh.length ? explainBlock(fresh, card, uids, pool, oldUid) : { ok: true, uids: next };
}

/** Colocar una carta en un hueco concreto: vacío ⇒ añadir; ocupado ⇒ sustituir. */
export function tryPlace(uids: readonly string[], slot: BoardSlot, uid: string, pool: Pool, before: DraftCheck = checkDraft(uids, pool)): EditResult {
  const card = pool.get(uid);
  if (!card) return blocked("NOT_OWNED", t("Esta carta no está en tu colección."));
  if (card.role !== slot.role) return blocked("WRONG_ROLE", t("Este hueco es de {role}; {nick} juega de {role2}.", { role: td(slot.role), nick: card.nick, role2: td(card.role) }));
  return slot.uid ? tryReplace(uids, slot.uid, uid, pool, before) : tryAdd(uids, uid, pool, before);
}

/** Quitar siempre es posible: un equipo a medias es un estado legítimo. Mutación canónica `removeCard`. */
export function tryRemove(uids: readonly string[], uid: string): EditResult {
  if (!uids.includes(uid)) return blocked("NOT_IN_DECK", t("Esa carta ya no está en el equipo."));
  return { ok: true, uids: removeCard(draftDeck(uids), uid, 0).cards };
}

/** Mover arriba/abajo DENTRO de su rol (el único movimiento que existe: el hueco lo decide el rol). */
export function moveInRole(uids: readonly string[], uid: string, dir: -1 | 1, pool: Pool): string[] {
  const card = pool.get(uid);
  if (!card) return [...uids];
  const positions = uids.map((u, i) => (pool.get(u)?.role === card.role ? i : -1)).filter((i) => i >= 0);
  const at = positions.indexOf(uids.indexOf(uid));
  const to = at + dir;
  if (at < 0 || to < 0 || to >= positions.length) return [...uids];
  const out = [...uids];
  [out[positions[at]], out[positions[to]]] = [out[positions[to]], out[positions[at]]];
  return out;
}

/* ───────────────────────────── desde la colección ───────────────────────────── */

export type CardAction =
  | { kind: "add"; slotKey: string }
  | { kind: "replace"; slotKeys: string[]; reason: string; conflictUid: string | null }
  | { kind: "in_deck"; slotKey: string | null }
  | { kind: "blocked"; reason: string };

export interface SlotFit { key: string; mode: "add" | "replace" }

/** Huecos donde esta carta PUEDE entrar ahora mismo (resaltado de compatibilidad). */
export function compatibleSlots(card: BuilderCard, uids: readonly string[], pool: Pool, board: Board, before: DraftCheck = checkDraft(uids, pool)): SlotFit[] {
  if (uids.includes(card.uid)) return [];
  return board.byRole[card.role]
    .filter((s) => tryPlace(uids, s, card.uid, pool, before).ok)
    .map((s) => ({ key: s.key, mode: s.uid ? ("replace" as const) : ("add" as const) }));
}

/**
 * Qué pasa al pulsar una carta de la colección: se AÑADE si hay hueco legal de su rol; si no, se
 * ofrecen los huecos donde puede SUSTITUIR (mismo jugador o rol lleno); si nada es posible, se
 * dice por qué. Nunca se resalta un hueco donde el validador la rechazaría.
 */
export function actionForCard(card: BuilderCard, uids: readonly string[], pool: Pool, board: Board, before: DraftCheck = checkDraft(uids, pool)): CardAction {
  if (uids.includes(card.uid)) return { kind: "in_deck", slotKey: board.slots.find((s) => s.uid === card.uid)?.key ?? null };
  const add = tryAdd(uids, card.uid, pool, before);
  if (add.ok) {
    const empty = board.byRole[card.role].find((s) => !s.uid);
    return { kind: "add", slotKey: empty?.key ?? slotKey(card.role, 0) };
  }
  const slotKeys = compatibleSlots(card, uids, pool, board, before).filter((s) => s.mode === "replace").map((s) => s.key);
  if (slotKeys.length) return { kind: "replace", slotKeys, reason: add.reason, conflictUid: add.conflictUid };
  return { kind: "blocked", reason: add.reason };
}

export interface Candidate { card: BuilderCard; ok: boolean; reason: string | null }

/** Candidatas de la colección para un hueco: legales primero, por OVR; las ilegales dicen por qué. */
export function candidatesForSlot(slot: BoardSlot, uids: readonly string[], pool: Pool): Candidate[] {
  const before = checkDraft(uids, pool);
  return [...pool.values()]
    .filter((c) => c.role === slot.role && !uids.includes(c.uid))
    .map((card) => {
      const r = slot.uid ? tryReplace(uids, slot.uid, card.uid, pool, before) : tryAdd(uids, card.uid, pool, before);
      return { card, ok: r.ok, reason: r.ok ? null : r.reason };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok) || byOvr(a.card, b.card));
}

/* ───────────────────────────── estadísticas reales ───────────────────────────── */

export interface TeamStats {
  count: number;
  complete: boolean;
  /** Medias con un decimal. `null` sin cartas. SOLO estadísticas que ya existen en la carta. */
  ovr: number | null;
  stronghold: number | null;
  gamesense: number | null;
  entryfrag: number | null;
  byRole: { role: RoleId; count: number; ovr: number | null }[];
}

export const round1 = (x: number): number => Math.round(x * 10) / 10;
const mean = (xs: number[]): number | null => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** Cartas presentes del borrador (las perdidas no suman: no se puede jugar con ellas). */
export const draftCards = (uids: readonly string[], pool: Pool): BuilderCard[] =>
  uids.map((u) => pool.get(u)).filter((c): c is BuilderCard => !!c);

export function teamStats(cards: readonly BuilderCard[]): TeamStats {
  return {
    count: cards.length,
    complete: cards.length === DUEL_DECK_SIZE,
    ovr: mean(cards.map((c) => c.ovr)),
    stronghold: mean(cards.map((c) => c.combat.stronghold)),
    gamesense: mean(cards.map((c) => c.combat.gamesense)),
    entryfrag: mean(cards.map((c) => c.combat.entryfrag)),
    byRole: DUEL_ROLES.map((role) => {
      const inRole = cards.filter((c) => c.role === role);
      return { role, count: inRole.length, ovr: mean(inRole.map((c) => c.ovr)) };
    }),
  };
}

export interface StatPoint { stat: CombatStatKey; label: string; value: number }

export interface TeamReading {
  /** Media más alta del trío. Empate ⇒ la primera en `COMBAT_STAT_ORDER`. */
  highest: StatPoint | null;
  /** Media más baja del trío. Empate ⇒ la primera en `COMBAT_STAT_ORDER`. */
  lowest: StatPoint | null;
  /** Las tres medias son idénticas: no hay «más alta» ni «más baja» que decir. */
  even: boolean;
  /** Rol con la OVR media más baja entre los que tienen cartas (si hay al menos dos distintos). */
  weakestRole: { role: RoleId; ovr: number } | null;
}

/** Comparación matemática de medias. No es una predicción ni una recomendación. */
export function readTeam(stats: TeamStats): TeamReading {
  const points: StatPoint[] = [];
  for (const stat of COMBAT_STAT_ORDER) {
    const value = stats[stat];
    if (value !== null) points.push({ stat, label: COMBAT_STAT_META[stat].full, value });
  }
  if (!points.length) return { highest: null, lowest: null, even: false, weakestRole: null };
  let highest = points[0];
  let lowest = points[0];
  for (const p of points) {
    if (p.value > highest.value) highest = p;
    if (p.value < lowest.value) lowest = p;
  }
  const even = highest.value === lowest.value;
  const roles = stats.byRole.filter((r): r is { role: RoleId; count: number; ovr: number } => r.ovr !== null);
  let weakestRole: TeamReading["weakestRole"] = null;
  if (roles.length >= 2) {
    const min = roles.reduce((m, r) => (r.ovr < m.ovr ? r : m), roles[0]);
    if (roles.some((r) => r.ovr !== min.ovr)) weakestRole = { role: min.role, ovr: min.ovr };
  }
  return { highest: even ? null : highest, lowest: even ? null : lowest, even, weakestRole };
}

/* ───────────────────────────── comparador ───────────────────────────── */

export type CompareKey = "ovr" | CombatStatKey | "rank";

export interface CompareRow { key: CompareKey; label: string; candidate: number; current: number | null; delta: number | null }
export interface ImpactRow { key: "ovr" | CombatStatKey; label: string; before: number | null; after: number | null; delta: number | null }

export interface CompareView {
  role: RoleId;
  current: BuilderCard | null;
  candidate: BuilderCard;
  legal: boolean;
  reason: string | null;
  rows: CompareRow[];
  /** Cómo cambian las MEDIAS del equipo si se aplica. Vacío si el cambio no es legal. */
  impact: ImpactRow[];
  nextUids: string[] | null;
}

const LABEL: Record<CompareKey, string> = {
  ovr: "OVR", stronghold: COMBAT_STAT_META.stronghold.full, gamesense: COMBAT_STAT_META.gamesense.full,
  entryfrag: COMBAT_STAT_META.entryfrag.full, rank: "Rareza",
};

const likeOf = (c: BuilderCard) => ({
  uid: c.uid, cardId: c.cardId, playerId: c.playerId, nick: c.nick, role: c.role, variantId: c.variantId,
  ovr: c.ovr, combat: c.combat, serial: c.serial,
});

/**
 * ACTUAL vs CANDIDATA. Las filas reutilizan `compareCards` de la Fase 25 (OVR, trío, rareza); el
 * impacto son medias antes/después calculadas con `teamStats`. Nada de probabilidad de victoria.
 */
export function compareForSlot(uids: readonly string[], pool: Pool, slotUid: string | null, candidateUid: string): CompareView | null {
  const candidate = pool.get(candidateUid);
  if (!candidate) return null;
  const current = slotUid ? pool.get(slotUid) ?? null : null;
  const rows: CompareRow[] = current
    ? compareCards(likeOf(candidate), likeOf(current)).map((r) => ({ key: r.key, label: LABEL[r.key], candidate: r.next, current: r.current, delta: r.delta }))
    : compareCards(likeOf(candidate), likeOf(candidate)).map((r) => ({ key: r.key, label: LABEL[r.key], candidate: r.next, current: null, delta: null }));
  const res = slotUid ? tryReplace(uids, slotUid, candidateUid, pool) : tryAdd(uids, candidateUid, pool);
  const before = teamStats(draftCards(uids, pool));
  const after = res.ok ? teamStats(draftCards(res.uids, pool)) : null;
  // Fase 43 · la diferencia sale de las medias EXACTAS (no de restar dos medias ya redondeadas, que podía decir «=»
  // con un cambio real de +0,09 o exagerarlo en ±0,1).
  const exactMean = (list: readonly string[], key: "ovr" | CombatStatKey): number | null => {
    const cs = draftCards(list, pool);
    return cs.length ? cs.reduce((s, c) => s + (key === "ovr" ? c.ovr : c.combat[key]), 0) / cs.length : null;
  };
  const impact: ImpactRow[] = after && res.ok
    ? (["ovr", ...COMBAT_STAT_ORDER] as ("ovr" | CombatStatKey)[]).map((key) => {
        const b = exactMean(uids, key);
        const a = exactMean(res.uids, key);
        return { key, label: LABEL[key], before: before[key], after: after[key], delta: a !== null && b !== null ? round1(a - b) : null };
      })
    : [];
  return { role: candidate.role, current, candidate, legal: res.ok, reason: res.ok ? null : res.reason, rows, impact, nextUids: res.ok ? res.uids : null };
}

/** «+4», «−2», «=»: el signo va en TEXTO, nunca solo en color. */
export const deltaText = (d: number | null): string =>
  d === null ? "—" : d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "=";

/* ───────────────────────────── sugerir carta ───────────────────────────── */

export interface Suggestion { card: BuilderCard | null; reason: string }

/**
 * REGLA DOCUMENTADA: entre las candidatas LEGALES y POSEÍDAS para el hueco, la de mayor OVR (empate:
 * nick, uid). En un hueco ocupado solo se sugiere si mejora la OVR actual. Sin IA, sin texto inventado.
 */
export function suggestForSlot(slot: BoardSlot, uids: readonly string[], pool: Pool): Suggestion {
  const legal = candidatesForSlot(slot, uids, pool).filter((c) => c.ok).map((c) => c.card).sort(byOvr);
  if (!legal.length) return { card: null, reason: t("No tienes cartas compatibles para este hueco.") };
  const best = legal[0];
  if (slot.card && best.ovr <= slot.card.ovr) return { card: null, reason: t("Ya tienes en este hueco la mejor OVR disponible.") };
  return { card: best, reason: SUGGEST_REASON };
}

/* ───────────────────────────── autocompletar ───────────────────────────── */

export interface AutoOptions {
  /** Cartas que NO se tocan. Por defecto, todas las del borrador. */
  pinned?: ReadonlySet<string>;
  /** Tope de nodos de la búsqueda (seguridad; con 10 huecos no se alcanza). */
  budget?: number;
}

export interface Shortage { role: RoleId; need: number; available: number }

export type AutoResult =
  | { ok: true; uids: string[]; added: string[]; removed: string[]; explored: number }
  | { ok: false; reason: string; shortages: Shortage[]; explored: number };

/**
 * Completa el equipo con cartas POSEÍDAS respetando las fijadas, los roles, el jugador único, la
 * carta única y la temporada. Búsqueda con retroceso (combinaciones por rol en orden de OVR, rol con
 * menos candidatas primero, una pasada por temporada si nada la fija): encuentra solución si existe
 * y, entre temporadas, se queda con la de mayor OVR total. El resultado pasa por `validateDuelDeck`.
 */
export function autocomplete(uids: readonly string[], pool: Pool, opts: AutoOptions = {}): AutoResult {
  const pinned = opts.pinned ?? new Set(uids);
  const budget = opts.budget ?? 200_000;
  const keep = [...new Set(uids.filter((u) => pinned.has(u) && pool.has(u)))];
  const keepCheck = checkDraft(keep, pool);
  if (keepCheck.hard.length) {
    const first = describeIssues(keepCheck, keep, pool).find((i) => i.kind !== "missing");
    return { ok: false, reason: t("Las cartas fijadas no pueden ir juntas: {v}", { v: td(first?.message) ?? explainDeckError(keepCheck.hard[0]) }), shortages: [], explored: 0 };
  }
  const keepCards = keep.map((u) => pool.get(u)!);
  const need = Object.fromEntries(DUEL_ROLES.map((r) => [r, DUEL_COMPOSITION[r] - keepCards.filter((c) => c.role === r).length])) as Record<RoleId, number>;
  const usedPlayers = new Set(keepCards.map((c) => c.playerId));
  const usedCards = new Set(keepCards.map((c) => c.cardId));
  const fixedVersion = keepCards[0]?.dataVersion ?? null;
  const free = [...pool.values()].filter((c) => !keep.includes(c.uid) && !usedPlayers.has(c.playerId)).sort(byOvr);
  const versions = fixedVersion !== null ? [fixedVersion] : [...new Set(free.map((c) => c.dataVersion))].sort();

  let explored = 0;
  let best: { cards: BuilderCard[]; total: number } | null = null;
  for (const version of versions) {
    const byRole = Object.fromEntries(DUEL_ROLES.map((r) => [r, free.filter((c) => c.role === r && c.dataVersion === version)])) as Record<RoleId, BuilderCard[]>;
    const order = DUEL_ROLES.filter((r) => need[r] > 0)
      .sort((a, b) => byRole[a].length - byRole[b].length || DUEL_ROLES.indexOf(a) - DUEL_ROLES.indexOf(b));
    const slots: RoleId[] = order.flatMap((r) => Array.from({ length: need[r] }, () => r));
    const chosen: BuilderCard[] = [];
    const players = new Set(usedPlayers);
    const cards = new Set(usedCards);
    const lastIdx: Partial<Record<RoleId, number>> = {};
    let exhausted = false;
    const dfs = (i: number): boolean => {
      if (i === slots.length) return true;
      const role = slots[i];
      const list = byRole[role];
      const start = i > 0 && slots[i - 1] === role ? (lastIdx[role] ?? -1) + 1 : 0;
      for (let j = start; j < list.length; j++) {
        if (++explored > budget) { exhausted = true; return false; }
        const c = list[j];
        if (players.has(c.playerId) || cards.has(c.cardId)) continue;
        const prev = lastIdx[role];
        players.add(c.playerId); cards.add(c.cardId); chosen.push(c); lastIdx[role] = j;
        if (dfs(i + 1)) return true;
        players.delete(c.playerId); cards.delete(c.cardId); chosen.pop(); lastIdx[role] = prev;
        if (exhausted) return false;
      }
      return false;
    };
    if (dfs(0)) {
      const total = chosen.reduce((s, c) => s + c.ovr, 0);
      if (!best || total > best.total) best = { cards: [...chosen], total };
    }
    if (exhausted) break;
  }

  if (!best) {
    const shortages: Shortage[] = DUEL_ROLES.filter((r) => need[r] > 0).map((role) => {
      const players = new Set(free.filter((c) => c.role === role && (fixedVersion === null || c.dataVersion === fixedVersion)).map((c) => c.playerId));
      return { role, need: need[role], available: players.size };
    }).filter((s) => s.available < s.need);
    return { ok: false, reason: AUTOCOMPLETE_FAIL_TEXT, shortages, explored };
  }
  const added = best.cards.map((c) => c.uid);
  const out = [...keep, ...added];
  // Red de seguridad: lo que sale de aquí lo firma el validador canónico, no esta búsqueda.
  if (!checkDraft(out, pool).ready) return { ok: false, reason: AUTOCOMPLETE_FAIL_TEXT, shortages: [], explored };
  return { ok: true, uids: out, added, removed: uids.filter((u) => !out.includes(u)), explored };
}

/* ───────────────────────────── nombres ───────────────────────────── */

export const DECK_NAME_MAX = 40;
/** Texto plano corto: letras, números, espacio y . _ ' # & -. Sin HTML, sin saltos, sin emojis. */
export const DECK_NAME_RE = /^[\p{L}\p{N} ._'#&-]{1,40}$/u;

export function normalizeDeckName(raw: unknown): string {
  return typeof raw === "string" ? raw.normalize("NFC").replace(/\s+/g, " ").trim() : "";
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

export function checkDeckName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, reason: t("Nombre de equipo no válido.") };
  const name = normalizeDeckName(raw);
  if (!name) return { ok: false, reason: t("Ponle un nombre al equipo.") };
  if ([...name].length > DECK_NAME_MAX) return { ok: false, reason: t("Máximo {DECK_NAME_MAX} caracteres.", { DECK_NAME_MAX }) };
  if (!DECK_NAME_RE.test(name)) return { ok: false, reason: t("Usa solo letras, números, espacios y . _ ' # & -") };
  return { ok: true, name };
}

const folded = (names: readonly string[]) => new Set(names.map((n) => normalizeDeckName(n).toLocaleLowerCase("es")));

/** «Equipo N» con el primer N libre. */
export function nextTeamName(existing: readonly string[]): string {
  const taken = folded(existing);
  for (let n = 1; ; n++) {
    const c = `Equipo ${n}`;
    if (!taken.has(c.toLocaleLowerCase("es"))) return c;
  }
}

/** «<nombre> copia», y si existe «<nombre> copia 2»… siempre dentro de los 40 caracteres. */
export function copyName(name: string, existing: readonly string[]): string {
  const taken = folded(existing);
  const base = `${normalizeDeckName(name).slice(0, DECK_NAME_MAX - 6).trim()} copia`;
  if (!taken.has(base.toLocaleLowerCase("es"))) return base;
  for (let n = 2; ; n++) {
    const c = `${base.slice(0, DECK_NAME_MAX - String(n).length - 1).trim()} ${n}`;
    if (!taken.has(c.toLocaleLowerCase("es"))) return c;
  }
}

/** Mismas referencias en el mismo orden (idempotencia del guardado). */
export const sameUids = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((u, i) => u === b[i]);
