/**
 * EQUIPOS — Deck Builder 2.0 + Team Management (Fase 32). SOLO SERVIDOR.
 *
 * Extiende el servicio de mazos de la Fase 8 (`duels.ts`), no lo sustituye: misma tabla `duel_decks`,
 * misma lectura de propiedad (`loadOwned`, ahora paginada), misma proyección (`toDeckDTO`) y el MISMO
 * validador (`validateDuelDeck` con `makeDeckResolver` sobre el catálogo persistido). Lo nuevo:
 *
 *   · FOTO ÚNICA  — `getDeckWorkspace`: equipos + colección resuelta + equipo activo, en tres lecturas
 *                   en paralelo (sin N+1). Es el read model del hub y del constructor.
 *   · GUARDADO ATÓMICO CON VERSIÓN — `saveComposition`: nombre + 10 referencias en UN `update`
 *                   condicionado a `updated_at` (concurrencia optimista). Idempotente: repetir el mismo
 *                   guardado con la versión vieja responde «sin cambios», no «conflicto».
 *   · CREAR / RENOMBRAR / DUPLICAR / BORRAR / ACTIVAR, cada uno validado aquí.
 *
 * FRONTERAS: el usuario sale del token (la ruta); cada consulta filtra por `user_id`; una carta que no
 * está en `user_cards` del usuario ⇒ 403 (ajena o inexistente, misma respuesta); un mazo de otro ⇒ 404
 * (no se distingue de «no existe»). Guardar un equipo INCOMPLETO se permite; uno con errores duros
 * (jugador repetido, rol de más, temporadas mezcladas) no. Activar exige equipo COMPLETO y LEGAL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import {
  createDuelDeck, explainDeckError, makeDeckResolver, ownershipFromList, validateDuelDeck,
  DUEL_DECK_SIZE, type DuelDeckError,
} from "@/domain/cardgame";
import type { OwnedCard } from "@/domain/cards/types";
import { toCardDTO } from "@/lib/duel/matchView";
import {
  checkDeckName, copyName, isIncompleteError, nextTeamName, sameUids, DUPLICATE_PLAYER_TEXT,
} from "@/domain/deckBuilder/builder";
import type { DeckBuilderCardDTO, DeckWorkspaceDTO, DuelDeckDTO } from "@/lib/duel/types";
import { loadOwned, loadOwnership, toDeckDTO, DECK_COLS, MAX_DECKS, type DeckRow } from "./duels";

export type TeamCode =
  | "NOT_FOUND" | "CONFLICT" | "CARD_NOT_OWNED" | "DECK_ILLEGAL" | "DECK_NOT_READY" | "LIMIT"
  | "ACTIVE_DECK" | "NOT_READY" | "BAD_NAME" | "DUPLICATE_UID" | "DB";

export interface TeamResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  code?: TeamCode;
  /** En éxito, la respuesta. En error, datos útiles para la interfaz (p. ej. la versión vigente). */
  data?: T;
}

export const STALE_TEXT = "Este equipo cambió en otra pestaña.";
export const ACTIVE_NOT_READY_TEXT = "Elegir equipo activo todavía no está disponible en este servidor.";
export const NOT_READY_TO_ACTIVATE_TEXT = "Solo puedes activar un equipo completo y legal.";
export const ACTIVE_DELETE_TEXT = "Es tu equipo activo. Confirma que quieres borrarlo: te quedarás sin equipo activo hasta que elijas otro.";

const fail = <T = never>(status: number, code: TeamCode, error: string, data?: T): TeamResult<T> => ({ ok: false, status, code, error, data });
const done = <T>(data: T): TeamResult<T> => ({ ok: true, status: 200, data });

/** Tabla o función que aún no existe (0050 sin aplicar). */
export const isMissingSchema = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === "42P01" || e.code === "42883" || e.code === "PGRST202" || e.code === "PGRST205" || /does not exist|could not find/i.test(e.message ?? ""));

const cat = () => serverCatalogSync();
const resolverFor = (owned: OwnedCard[]) =>
  makeDeckResolver(cat().registry, ownershipFromList(owned), (cardId, v) => cat().instance(cardId, v));

/** La colección del constructor: cada ejemplar poseído que se puede jugar, ya resuelto. */
export function builderCollection(owned: OwnedCard[], counts: Readonly<Record<string, number>> | null = null): DeckBuilderCardDTO[] {
  const resolve = resolverFor(owned);
  const out: DeckBuilderCardDTO[] = [];
  for (const o of owned) {
    const r = resolve(o.uid);
    if (!r.ok) continue;
    out.push({ ...toCardDTO(r.card, cat().registry), dataVersion: r.card.dataVersion, statBoost: r.card.statBoost, obtainedAt: o.obtainedAt, ...(counts ? { copies: counts[o.cardId] ?? 1 } : {}) });
  }
  return out.sort((a, b) => b.ovr - a.ovr || a.nick.localeCompare(b.nick));
}

/** Equipo activo. Sin 0050 ⇒ `supported: false`. */
export async function readActive(sb: SupabaseClient, userId: string): Promise<{ supported: boolean; deckId: string | null }> {
  const { data, error } = await sb.from("duel_active_deck").select("deck_id").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return { supported: false, deckId: null };
    throw new Error(error.message);
  }
  return { supported: true, deckId: (data as { deck_id: string } | null)?.deck_id ?? null };
}

/** Para marcar `active` en las respuestas de escritura: si no se puede leer, no se marca (no se inventa). */
async function activeIdOrNull(sb: SupabaseClient, userId: string): Promise<string | null> {
  try { return (await readActive(sb, userId)).deckId; } catch { return null; }
}

/* ───────────────────────────── lectura ───────────────────────────── */

export async function getDeckWorkspace(sb: SupabaseClient, userId: string): Promise<TeamResult<DeckWorkspaceDTO>> {
  await serverCatalog(sb);
  const [{ owned, counts }, rows, active] = await Promise.all([
    loadOwnership(sb, userId),
    sb.from("duel_decks").select(DECK_COLS).eq("user_id", userId).order("updated_at", { ascending: false }),
    readActive(sb, userId),
  ]);
  if (rows.error) return fail(500, "DB", rows.error.message);
  const list = (rows.data as DeckRow[] | null) ?? [];
  const activeDeckId = active.deckId && list.some((r) => r.id === active.deckId) ? active.deckId : null;
  return done({
    decks: list.map((r) => toDeckDTO(r, owned, activeDeckId)),
    collection: builderCollection(owned, counts),
    activeDeckId,
    activeSupported: active.supported,
    maxDecks: MAX_DECKS,
    serverNow: Date.now(),
  });
}

/* ───────────────────────────── validación de escritura ───────────────────────────── */

const humanHard = (e: DuelDeckError): string =>
  e.code === "DUPLICATE_PLAYER" || e.code === "DUPLICATE_CARD" ? DUPLICATE_PLAYER_TEXT : explainDeckError(e);

/**
 * Propiedad + composición, con el validador canónico. `null` si se puede guardar (vacío, a medias o
 * listo); si no, el fallo. Una carta ajena y una inexistente dan la MISMA respuesta.
 */
export function checkComposition(uids: readonly string[], owned: OwnedCard[]): TeamResult<never> | null {
  if (new Set(uids).size !== uids.length) return fail(400, "DUPLICATE_UID", "El equipo repite una carta.");
  if (uids.length > DUEL_DECK_SIZE) return fail(400, "DECK_ILLEGAL", `Un equipo tiene como máximo ${DUEL_DECK_SIZE} cartas.`);
  const mine = new Set(owned.map((o) => o.uid));
  if (uids.some((u) => !mine.has(u))) return fail(403, "CARD_NOT_OWNED", "Ese equipo contiene una carta que no es tuya o que ya no está disponible.");
  const validation = validateDuelDeck(createDuelDeck({ id: "check", name: "check", cards: [...uids], now: 0 }), resolverFor(owned));
  const hard = validation.errors.filter((e) => !isIncompleteError(e));
  if (hard.length) return fail(422, "DECK_ILLEGAL", humanHard(hard[0]));
  return null;
}

async function rowOf(sb: SupabaseClient, userId: string, id: string): Promise<{ row: DeckRow | null; error: string | null }> {
  const { data, error } = await sb.from("duel_decks").select(DECK_COLS).eq("id", id).eq("user_id", userId).maybeSingle();
  return { row: (data as DeckRow | null) ?? null, error: error?.message ?? null };
}

/* ───────────────────────────── escrituras ───────────────────────────── */

/** Guardado atómico del constructor, condicionado a la versión. */
export async function saveComposition(
  sb: SupabaseClient, userId: string,
  input: { id: string; name: string; cardUids: string[]; expectedVersion: string },
): Promise<TeamResult<{ deck: DuelDeckDTO; unchanged: boolean }>> {
  const nm = checkDeckName(input.name);
  if (!nm.ok) return fail(400, "BAD_NAME", nm.reason);
  await serverCatalog(sb);
  const [owned, activeId] = await Promise.all([loadOwned(sb, userId, input.cardUids), activeIdOrNull(sb, userId)]);
  const bad = checkComposition(input.cardUids, owned);
  if (bad) return bad;

  const upd = await sb.from("duel_decks")
    .update({ name: nm.name, card_uids: input.cardUids })
    .eq("id", input.id).eq("user_id", userId).eq("updated_at", input.expectedVersion)
    .select(DECK_COLS).maybeSingle();
  if (upd.error) return fail(500, "DB", upd.error.message);
  if (upd.data) return done({ deck: toDeckDTO(upd.data as DeckRow, owned, activeId), unchanged: false });

  // No se actualizó: o no es tuyo / no existe, o la versión ya no es la que leíste.
  const cur = await rowOf(sb, userId, input.id);
  if (cur.error) return fail(500, "DB", cur.error);
  if (!cur.row) return fail(404, "NOT_FOUND", "Equipo no encontrado");
  const deck = toDeckDTO(cur.row, owned, activeId);
  // Idempotencia: el mismo guardado repetido (doble clic, reintento) no es un conflicto.
  if (cur.row.name === nm.name && sameUids(cur.row.card_uids ?? [], input.cardUids)) return done({ deck, unchanged: true });
  return fail(409, "CONFLICT", STALE_TEXT, { deck, unchanged: false });
}

export async function createTeam(
  sb: SupabaseClient, userId: string, input: { name: string | null; cardUids: string[] },
): Promise<TeamResult<{ deck: DuelDeckDTO }>> {
  await serverCatalog(sb);
  const [owned, rows] = await Promise.all([
    loadOwned(sb, userId, input.cardUids),
    sb.from("duel_decks").select("id, name").eq("user_id", userId),
  ]);
  if (rows.error) return fail(500, "DB", rows.error.message);
  const names = ((rows.data as { name: string }[] | null) ?? []).map((r) => r.name);
  if (names.length >= MAX_DECKS) return fail(409, "LIMIT", `Has alcanzado el máximo de ${MAX_DECKS} equipos.`);
  const nm = checkDeckName(input.name ?? nextTeamName(names));
  if (!nm.ok) return fail(400, "BAD_NAME", nm.reason);
  const bad = checkComposition(input.cardUids, owned);
  if (bad) return bad;
  const ins = await sb.from("duel_decks").insert({ user_id: userId, name: nm.name, card_uids: input.cardUids }).select(DECK_COLS).maybeSingle();
  if (ins.error || !ins.data) return fail(500, "DB", ins.error?.message ?? "insert vacío");
  return done({ deck: toDeckDTO(ins.data as DeckRow, owned, null) });
}

export async function renameTeam(
  sb: SupabaseClient, userId: string, input: { id: string; name: string; expectedVersion: string },
): Promise<TeamResult<{ deck: DuelDeckDTO; unchanged: boolean }>> {
  const nm = checkDeckName(input.name);
  if (!nm.ok) return fail(400, "BAD_NAME", nm.reason);
  await serverCatalog(sb);
  const [owned, activeId] = await Promise.all([loadOwned(sb, userId), activeIdOrNull(sb, userId)]);
  const upd = await sb.from("duel_decks")
    .update({ name: nm.name })
    .eq("id", input.id).eq("user_id", userId).eq("updated_at", input.expectedVersion)
    .select(DECK_COLS).maybeSingle();
  if (upd.error) return fail(500, "DB", upd.error.message);
  if (upd.data) return done({ deck: toDeckDTO(upd.data as DeckRow, owned, activeId), unchanged: false });
  const cur = await rowOf(sb, userId, input.id);
  if (cur.error) return fail(500, "DB", cur.error);
  if (!cur.row) return fail(404, "NOT_FOUND", "Equipo no encontrado");
  const deck = toDeckDTO(cur.row, owned, activeId);
  if (cur.row.name === nm.name) return done({ deck, unchanged: true });
  return fail(409, "CONFLICT", STALE_TEXT, { deck, unchanged: false });
}

/** Duplica la COMPOSICIÓN (referencias), nunca las cartas. Revalida la propiedad de todas. */
export async function duplicateTeam(sb: SupabaseClient, userId: string, id: string): Promise<TeamResult<{ deck: DuelDeckDTO }>> {
  await serverCatalog(sb);
  const [owned, rows] = await Promise.all([
    loadOwned(sb, userId),
    sb.from("duel_decks").select(DECK_COLS).eq("user_id", userId),
  ]);
  if (rows.error) return fail(500, "DB", rows.error.message);
  const list = (rows.data as DeckRow[] | null) ?? [];
  const src = list.find((r) => r.id === id);
  if (!src) return fail(404, "NOT_FOUND", "Equipo no encontrado");
  if (list.length >= MAX_DECKS) return fail(409, "LIMIT", `Has alcanzado el máximo de ${MAX_DECKS} equipos.`);
  const bad = checkComposition(src.card_uids ?? [], owned);
  if (bad) {
    return bad.code === "CARD_NOT_OWNED"
      ? fail(409, "CARD_NOT_OWNED", "Este equipo tiene cartas que ya no están disponibles. Quítalas antes de duplicarlo.")
      : bad;
  }
  const name = copyName(src.name, list.map((r) => r.name));
  const ins = await sb.from("duel_decks").insert({ user_id: userId, name, card_uids: src.card_uids ?? [] }).select(DECK_COLS).maybeSingle();
  if (ins.error || !ins.data) return fail(500, "DB", ins.error?.message ?? "insert vacío");
  return done({ deck: toDeckDTO(ins.data as DeckRow, owned, null) });
}

/** Borrar. El equipo ACTIVO exige `confirmActive` (comportamiento explícito, sin elegir otro por el usuario). */
export async function deleteTeam(
  sb: SupabaseClient, userId: string, input: { id: string; expectedVersion: string | null; confirmActive: boolean },
): Promise<TeamResult<{ id: string; wasActive: boolean }>> {
  const cur = await rowOf(sb, userId, input.id);
  if (cur.error) return fail(500, "DB", cur.error);
  if (!cur.row) return fail(404, "NOT_FOUND", "Equipo no encontrado");
  const activeId = await activeIdOrNull(sb, userId);
  const wasActive = activeId === input.id;
  if (wasActive && !input.confirmActive) return fail(409, "ACTIVE_DECK", ACTIVE_DELETE_TEXT);
  if (input.expectedVersion && cur.row.updated_at !== input.expectedVersion) return fail(409, "CONFLICT", STALE_TEXT);
  let q = sb.from("duel_decks").delete().eq("id", input.id).eq("user_id", userId);
  if (input.expectedVersion) q = q.eq("updated_at", input.expectedVersion);
  const del = await q.select("id");
  if (del.error) return fail(500, "DB", del.error.message);
  if (!((del.data as { id: string }[] | null) ?? []).length) return fail(409, "CONFLICT", STALE_TEXT);
  return done({ id: input.id, wasActive });
}

/** Marcar activo: del usuario, completo y legal (validador canónico), y sin cambios desde que se validó. */
export async function setActiveTeam(
  sb: SupabaseClient, userId: string, input: { id: string; expectedVersion: string | null },
): Promise<TeamResult<{ activeDeckId: string; deck: DuelDeckDTO }>> {
  await serverCatalog(sb);
  const [owned, cur] = await Promise.all([loadOwned(sb, userId), rowOf(sb, userId, input.id)]);
  if (cur.error) return fail(500, "DB", cur.error);
  if (!cur.row) return fail(404, "NOT_FOUND", "Equipo no encontrado");
  const deck = toDeckDTO(cur.row, owned, null);
  if (input.expectedVersion && cur.row.updated_at !== input.expectedVersion) return fail(409, "CONFLICT", STALE_TEXT);
  if (!deck.valid) return fail(409, "DECK_NOT_READY", NOT_READY_TO_ACTIVATE_TEXT);
  const rpc = await sb.rpc("duel_deck_activate", { p_user: userId, p_deck: input.id, p_expected_updated_at: cur.row.updated_at });
  if (rpc.error) {
    if (isMissingSchema(rpc.error)) return fail(503, "NOT_READY", ACTIVE_NOT_READY_TEXT);
    return fail(500, "DB", rpc.error.message);
  }
  if (rpc.data === "NOT_FOUND") return fail(404, "NOT_FOUND", "Equipo no encontrado");
  if (rpc.data === "CONFLICT") return fail(409, "CONFLICT", STALE_TEXT);
  return done({ activeDeckId: input.id, deck: { ...deck, active: true } });
}
