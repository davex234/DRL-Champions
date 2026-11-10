/**
 * FASE 63 · ONBOARDING 5.0 — LADO SERVIDOR.
 *
 * Lee los hechos REALES de la primera sesión (los mismos que el recorrido de la Fase 40), los acuses del jugador
 * (`app_metadata.nx_onboarding`, ver `domain/onboarding`) y construye la vista con el dominio puro. Tres escrituras, y
 * ninguna concede nada:
 *
 *   · acuses (start / skip / resume / finish) → `auth.users.app_metadata` con service_role (el cliente no puede escribir
 *     `app_metadata`: GoTrue solo lo acepta desde la API de administración). `finish` exige una partida TERMINADA en
 *     `duel_matches`, leída aquí, no un dato del cliente.
 *   · `first-team` → crea el primer equipo con las cartas POSEÍDAS (`autocomplete` del constructor + validador canónico
 *     en `createTeam`) y lo activa si no hay activo. Idempotente: con un equipo legal ya guardado lo devuelve; dos
 *     pestañas a la vez calculan el MISMO equipo y la segunda copia se borra.
 *
 * El starter NO pasa por aquí: lo concede `handle_new_user` (0011) una vez por cuenta, al crearla.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog } from "@/server/catalog";
import { deckReadiness, firstPackOf, type JourneyFacts } from "@/domain/journey";
import {
  buildOnboarding, decideFlags, parseOnboardingFlags, onboardingMetadata, FIRST_TEAM_NAME, ONBOARDING_METADATA_KEY,
  type OnboardingCommand, type OnboardingFlags, type OnboardingView, type StarterSnapshot,
} from "@/domain/onboarding";
import { autocomplete, indexPool, sameUids, type BuilderCard } from "@/domain/deckBuilder/builder";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { loadOwned, toDeckDTO, DECK_COLS, type DeckRow } from "./duels";
import { builderCollection, createTeam, readActive, setActiveTeam } from "./deckTeams";
import { readinessResolver } from "./starter";
import { countPlayedMatches } from "./matchCounts";

/* ───────────────────────────── acuses: almacén ───────────────────────────── */

/** Dónde viven los acuses. En producción, `app_metadata` de GoTrue; en tests, memoria. */
export interface OnboardingFlagStore {
  read(userId: string): Promise<OnboardingFlags>;
  write(userId: string, flags: OnboardingFlags): Promise<void>;
}

/**
 * `app_metadata` vía la API de administración. Lee el objeto entero y reescribe SOLO la clave `nx_onboarding`
 * (GoTrue fusiona las claves de primer nivel; `provider`/`providers` no se tocan).
 */
export function authFlagStore(sb: SupabaseClient): OnboardingFlagStore {
  return {
    async read(userId) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error || !data.user) throw new Error(error?.message ?? "usuario no encontrado");
      return parseOnboardingFlags(data.user.app_metadata);
    },
    async write(userId, flags) {
      const { data, error } = await sb.auth.admin.getUserById(userId);
      if (error || !data.user) throw new Error(error?.message ?? "usuario no encontrado");
      const next = { ...(data.user.app_metadata ?? {}), ...onboardingMetadata(flags) };
      const res = await sb.auth.admin.updateUserById(userId, { app_metadata: next });
      if (res.error) throw new Error(res.error.message);
    },
  };
}

/** Almacén en memoria (tests y arnés): mismo contrato, misma serialización ISO. */
export function memoryFlagStore(seed: Record<string, Record<string, unknown>> = {}): OnboardingFlagStore & { raw: Record<string, Record<string, unknown>> } {
  const raw = seed;
  return {
    raw,
    async read(userId) { return parseOnboardingFlags(raw[userId] ?? {}); },
    async write(userId, flags) { raw[userId] = { ...(raw[userId] ?? {}), ...onboardingMetadata(flags) }; },
  };
}

export { ONBOARDING_METADATA_KEY };

/* ───────────────────────────── hechos ───────────────────────────── */

const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

/**
 * Hechos de la primera sesión, en lecturas acotadas y en paralelo (ninguna escribe). Partidas terminadas = el mismo
 * criterio que la métrica `duels_played` de la progresión (estados finales, sin Draft Gauntlet).
 */
export async function readOnboardingFacts(sb: SupabaseClient, userId: string): Promise<{ journey: JourneyFacts; starter: StarterSnapshot }> {
  await serverCatalog(sb);
  const [owned, rows, active, game, matches, packs, profile, resolve] = await Promise.all([
    loadOwned(sb, userId),
    sb.from("duel_decks").select(DECK_COLS).eq("user_id", userId).order("updated_at", { ascending: false }),
    readActive(sb, userId).catch(() => ({ supported: false, deckId: null as string | null })),
    sb.from("user_game").select("packs_opened").eq("user_id", userId).maybeSingle(),
    countPlayedMatches(sb, userId),
    sb.from("user_packs").select("pack_id, qty").eq("user_id", userId).gt("qty", 0).limit(200),
    sb.from("profiles").select("credits").eq("id", userId).maybeSingle(),
    readinessResolver(sb),
  ]);
  const deckRows = (must(rows as { data: DeckRow[] | null; error: { message: string } | null }) ?? []);
  if (matches.error) throw new Error(matches.error.message);
  const ownedPacks = ((must(packs as { data: { pack_id: string; qty: number }[] | null; error: { message: string } | null }) ?? []))
    .map((r) => ({ packId: r.pack_id, qty: Number(r.qty) || 0 })).filter((r) => r.qty > 0)
    .sort((a, b) => (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0));
  const decks = deckRows.map((r) => toDeckDTO(r, owned, active.deckId));
  const valid = decks.filter((d) => d.valid);
  const ready = valid.find((d) => d.id === active.deckId) ?? valid[0] ?? null;
  const invalid = decks.find((d) => !d.valid) ?? null;
  const journey: JourneyFacts = {
    ownedCards: owned.length,
    packsOpened: Number((game.data as { packs_opened: number } | null)?.packs_opened ?? 0),
    matchesCompleted: matches.count ?? 0,
    unopenedPacks: ownedPacks.reduce((s, p) => s + p.qty, 0),
    firstPackId: firstPackOf(ownedPacks),
    decks: { total: decks.length, valid: valid.length, firstInvalid: invalid ? { id: invalid.id, name: invalid.name, size: invalid.cards.length } : null },
    readyDeck: ready ? { id: ready.id, name: ready.name, cardIds: ready.cards.map((c) => c.cardId), active: ready.id === active.deckId } : null,
    readiness: deckReadiness(owned.map((o) => o.cardId), resolve),
  };
  const credits = (profile.data as { credits: number | string } | null)?.credits;
  return { journey, starter: { credits: credits == null ? null : Number(credits), packs: ownedPacks } };
}

export async function readOnboarding(sb: SupabaseClient, userId: string, flags: OnboardingFlags): Promise<OnboardingView> {
  const { journey, starter } = await readOnboardingFacts(sb, userId);
  return buildOnboarding({ journey, flags, starter });
}

/* ───────────────────────────── primer equipo ───────────────────────────── */

export interface FirstTeamResult {
  ok: boolean;
  status: number;
  code?: "NOT_READY" | "LIMIT" | "DB";
  error?: string;
  deck?: DuelDeckDTO;
  created?: boolean;
  activated?: boolean;
  shortages?: { role: string; need: number; available: number }[];
}

/**
 * «Crear mi primer equipo». Solo con cartas POSEÍDAS (la colección del constructor, resuelta por el servidor) y el
 * `autocomplete` del constructor, que respeta roles, jugador único y temporada; lo que sale lo firma `createTeam` con el
 * validador canónico. No inventa cartas ni reglas: si no llega, responde 409 con los roles que faltan.
 */
export async function ensureFirstTeam(sb: SupabaseClient, userId: string): Promise<FirstTeamResult> {
  await serverCatalog(sb);
  const [owned, rows, active] = await Promise.all([
    loadOwned(sb, userId),
    sb.from("duel_decks").select(DECK_COLS).eq("user_id", userId).order("created_at", { ascending: true }),
    readActive(sb, userId).catch(() => ({ supported: false, deckId: null as string | null })),
  ]);
  if (rows.error) return { ok: false, status: 500, code: "DB", error: rows.error.message };
  const decks = ((rows.data as DeckRow[] | null) ?? []).map((r) => toDeckDTO(r, owned, active.deckId));

  // 1 · ¿ya tiene un equipo legal? No se crea otro: se devuelve (y se activa si no hay activo).
  const valid = decks.filter((d) => d.valid);
  if (valid.length > 0) {
    const pick = valid.find((d) => d.id === active.deckId) ?? valid[0];
    const activated = await activateIfNone(sb, userId, pick, active);
    return { ok: true, status: 200, deck: { ...pick, active: pick.active || activated }, created: false, activated };
  }

  // 2 · el mejor equipo legal con sus cartas (determinista: dos pestañas calculan el mismo).
  const pool = indexPool(builderCollection(owned) as BuilderCard[]);
  const auto = autocomplete([], pool);
  if (!auto.ok) {
    return { ok: false, status: 409, code: "NOT_READY", error: "Todavía no tienes cartas para un equipo completo.", shortages: auto.shortages };
  }

  const created = await createTeam(sb, userId, { name: FIRST_TEAM_NAME, cardUids: auto.uids });
  if (!created.ok || !created.data) {
    return { ok: false, status: created.status, code: created.code === "LIMIT" ? "LIMIT" : "DB", error: created.error ?? "No se pudo crear el equipo" };
  }

  // 3 · carrera entre pestañas: se queda la copia MÁS ANTIGUA con esas mismas cartas; el resto se borra.
  const keep = await dedupeFirstTeam(sb, userId, auto.uids);
  const deck = keep && keep.id !== created.data.deck.id
    ? toDeckDTO(keep, owned, null)
    : created.data.deck;
  const current = await readActive(sb, userId).catch(() => ({ supported: false, deckId: null as string | null }));
  const activated = await activateIfNone(sb, userId, deck, current);
  return { ok: true, status: 200, deck: { ...deck, active: deck.id === current.deckId || activated }, created: !keep || keep.id === created.data.deck.id, activated };
}

async function dedupeFirstTeam(sb: SupabaseClient, userId: string, uids: readonly string[]): Promise<DeckRow | null> {
  const res = await sb.from("duel_decks").select(DECK_COLS).eq("user_id", userId).eq("name", FIRST_TEAM_NAME).order("created_at", { ascending: true });
  if (res.error) return null;
  const same = ((res.data as DeckRow[] | null) ?? [])
    .filter((r) => sameUids(r.card_uids ?? [], uids))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  const [first, ...rest] = same;
  for (const r of rest) await sb.from("duel_decks").delete().eq("id", r.id).eq("user_id", userId);
  return first ?? null;
}

async function activateIfNone(
  sb: SupabaseClient, userId: string, deck: DuelDeckDTO, active: { supported: boolean; deckId: string | null },
): Promise<boolean> {
  if (!active.supported || active.deckId !== null || !deck.valid) return false;
  const r = await setActiveTeam(sb, userId, { id: deck.id, expectedVersion: null });
  return r.ok;
}

/* ───────────────────────────── órdenes ───────────────────────────── */

export interface CommandResult {
  ok: boolean;
  status: number;
  code?: string;
  error?: string;
  onboarding?: OnboardingView;
  team?: FirstTeamResult;
  changed?: boolean;
}

/**
 * Ejecuta una orden del jugador sobre SU cuenta (el `userId` sale del token en la ruta). Relee los hechos del servidor
 * antes de decidir; nunca confía en nada del cliente salvo el nombre de la orden.
 */
export async function runOnboardingCommand(
  sb: SupabaseClient, userId: string, command: OnboardingCommand, store: OnboardingFlagStore, now = Date.now(),
): Promise<CommandResult> {
  if (command === "first-team") {
    const team = await ensureFirstTeam(sb, userId);
    const flags = await store.read(userId);
    const view = await readOnboarding(sb, userId, flags);
    return team.ok ? { ok: true, status: 200, team, onboarding: view } : { ok: false, status: team.status, code: team.code, error: team.error, team, onboarding: view };
  }
  const [facts, flags] = await Promise.all([readOnboardingFacts(sb, userId), store.read(userId)]);
  const d = decideFlags(command, facts.journey, flags, now);
  if (!d.ok) return { ok: false, status: d.status, code: d.code, error: d.error, onboarding: buildOnboarding({ ...facts, flags }) };
  if (d.changed) await store.write(userId, d.flags);
  return { ok: true, status: 200, changed: d.changed, onboarding: buildOnboarding({ ...facts, flags: d.flags }) };
}
