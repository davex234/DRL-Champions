/**
 * F58 · USUARIOS — búsqueda, ficha 360, ajuste de créditos y concesiones (SOLO SERVIDOR, tras `verifyAdmin`).
 *
 * Qué NO sale nunca de aquí: hashes, tokens, refresh tokens, metadatos de GoTrue ni ninguna columna que no se nombre.
 * Todas las lecturas nombran sus columnas (nada de `select *` sobre tablas de usuario) y cuentan con `head: true`
 * (sin traer filas) cuando solo hace falta el número.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, rpcFailure, type AdminResult } from "./http";
import { entityActivity, writeAudit, type AuditRow } from "./audit";
import { listSanctions, type SanctionView } from "./moderation";
import { adminCreditRef, signedDelta, type CreditAdjustInput } from "@/domain/admin/credits";
import { cleanReason, isUuid } from "@/domain/admin/sanctions";
import { award } from "@/server/services/rewards";
import { getPack } from "@/data/packs";
import { getCard } from "@/data/catalog";
import { isPurchasable, packLifecycle } from "@/domain/packs/lifecycle";
import { looksLikeTagQuery, normalizeTag } from "@/domain/account/tag";

export interface UserRow {
  id: string; username: string; email: string | null; createdAt: string | null; lastSignInAt: string | null;
  lastSeenAt: string | null; isAdmin: boolean; credits: number; level: number;
  /** 0068 · tag público de la cuenta (contexto humano; la identidad técnica sigue siendo `id`). */
  tag: string | null;
}

/** 0068 · tags públicos de un lote de cuentas (una lectura; sin 0068, ninguno). */
async function tagsOf(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!ids.length) return m;
  const { data, error } = await sb.from("profiles").select("id, public_tag").in("id", ids);
  if (error) return m;
  for (const r of (data ?? []) as { id: string; public_tag: string | null }[]) { const t = normalizeTag(r.public_tag); if (t) m.set(r.id, t); }
  return m;
}

const QUERY = /^[\p{L}\p{N}_.@+\- ]{0,80}$/u;

export async function searchUsers(sb: SupabaseClient, q: string, page = 1, pageSize = 25): Promise<AdminResult<{ rows: UserRow[]; total: number; page: number; pageSize: number }>> {
  let t = (q ?? "").trim();
  const size = Math.min(Math.max(Math.trunc(pageSize), 1), 100);
  const p = Math.max(1, Math.trunc(page));
  // 0068 · «#TAG» identifica UNA cuenta exacta: se resuelve aquí y se busca por su id (la RPC ya admite id exacto).
  if (looksLikeTagQuery(t)) {
    const tag = normalizeTag(t);
    if (!tag) return fail(400, "Tag inválido: 7 caracteres, por ejemplo #7K4M92X");
    const { data: hit, error: tagErr } = await sb.from("profiles").select("id").eq("public_tag", tag).maybeSingle();
    if (tagErr) return fail(500, "No se pudo buscar");
    if (!hit) return ok({ rows: [], total: 0, page: 1, pageSize: size });
    t = (hit as { id: string }).id;
  }
  if (!QUERY.test(t)) return fail(400, "Búsqueda inválida");
  const { data, error } = await sb.rpc("app_admin_search_users", { p_q: t || null, p_limit: size, p_offset: (p - 1) * size });
  if (error) return rpcFailure(error.message);
  const raw = (data ?? []) as { id: string; username: string; email: string | null; created_at: string | null; last_sign_in_at: string | null; last_seen_at: string | null; is_admin: boolean; credits: number; level: number; total: number }[];
  const tags = await tagsOf(sb, raw.map((r) => r.id));
  return ok({
    rows: raw.map((r) => ({ id: r.id, username: r.username, email: r.email, createdAt: r.created_at, lastSignInAt: r.last_sign_in_at, lastSeenAt: r.last_seen_at, isAdmin: !!r.is_admin, credits: Number(r.credits ?? 0), level: Number(r.level ?? 1), tag: tags.get(r.id) ?? null })),
    total: Number(raw[0]?.total ?? 0), page: p, pageSize: size,
  });
}

export interface User360 {
  identity: { id: string; username: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; lastSeenAt: string | null; confirmedAt: string | null; provider: string | null; isAdmin: boolean; tag: string | null };
  progress: { level: number; xp: number; points: number; credits: number };
  collection: { cards: number; distinct: number; favorites: number };
  packs: { unopened: { packId: string; name: string; qty: number }[]; opened: number };
  decks: { decks: number; hasActive: boolean };
  competitive: { rating: number; games: number; wins: number; losses: number; draws: number } | null;
  season: { passes: { seasonId: string; xp: number; level: number | null }[] };
  modes: { campaignNodes: number; draftRuns: number; coachMatches: number };
  ledger: { at: string; delta: number; reason: string; balanceAfter: number; ref: string | null }[];
  sanctions: SanctionView[];
  activity: AuditRow[];
}

const count = async (sb: SupabaseClient, table: string, col: string, id: string): Promise<number> => {
  const { count: n } = await sb.from(table).select(col, { count: "exact", head: true }).eq(col, id);
  return n ?? 0;
};

export async function user360(sb: SupabaseClient, userId: string): Promise<AdminResult<User360>> {
  if (!isUuid(userId)) return fail(400, "Usuario inválido");
  const { data: prof, error } = await sb.from("profiles").select("id, username, level, xp, points, credits, is_admin, last_seen_at, public_tag").eq("id", userId).maybeSingle();
  if (error) return fail(500, "No se pudo leer el perfil");
  if (!prof) return fail(404, "Usuario no encontrado");
  const p = prof as { id: string; username: string; level: number; xp: number; points: number; credits: number; is_admin: boolean; last_seen_at: string | null; public_tag?: string | null };

  const [ident, cards, favs, packsRes, game, decks, active, rating, passes, camp, drafts, coach, ledger, sanctions, activity] = await Promise.all([
    sb.rpc("app_admin_user_identity", { p_user: userId }),
    count(sb, "user_cards", "user_id", userId),
    count(sb, "user_card_favorites", "user_id", userId),
    sb.from("user_packs").select("pack_id, qty").eq("user_id", userId).gt("qty", 0),
    sb.from("user_game").select("packs_opened").eq("user_id", userId).maybeSingle(),
    count(sb, "duel_decks", "user_id", userId),
    count(sb, "duel_active_deck", "user_id", userId),
    sb.from("duel_pvp_ratings").select("rating, games_played, wins, losses, draws").eq("user_id", userId).maybeSingle(),
    sb.from("user_pass").select("season_id, state").eq("user_id", userId).limit(10),
    count(sb, "campaign_progress", "user_id", userId),
    count(sb, "draft_runs", "user_id", userId),
    count(sb, "coach_matches", "user_id", userId),
    sb.from("credit_transactions").select("created_at, delta, reason, balance_after, ref").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    listSanctions(sb, { userId, pageSize: 20 }),
    entityActivity(sb, "user", userId, 20),
  ]);
  const distinctRes = await sb.from("user_cards").select("card_id").eq("user_id", userId).limit(5000);
  const i = (ident.data ?? {}) as { email?: string; createdAt?: string; lastSignInAt?: string; confirmedAt?: string; provider?: string };
  const r = rating.data as { rating: number; games_played: number; wins: number; losses: number; draws: number } | null;

  return ok({
    identity: { id: p.id, username: p.username, email: i.email ?? null, createdAt: i.createdAt ?? null, lastSignInAt: i.lastSignInAt ?? null, lastSeenAt: p.last_seen_at, confirmedAt: i.confirmedAt ?? null, provider: i.provider ?? null, isAdmin: !!p.is_admin, tag: normalizeTag(p.public_tag ?? null) },
    progress: { level: Number(p.level ?? 1), xp: Number(p.xp ?? 0), points: Number(p.points ?? 0), credits: Number(p.credits ?? 0) },
    collection: { cards, distinct: new Set(((distinctRes.data ?? []) as { card_id: string }[]).map((x) => x.card_id)).size, favorites: favs },
    packs: {
      unopened: ((packsRes.data ?? []) as { pack_id: string; qty: number }[]).map((x) => ({ packId: x.pack_id, name: getPack(x.pack_id)?.name ?? x.pack_id, qty: x.qty })),
      opened: Number((game.data as { packs_opened?: number } | null)?.packs_opened ?? 0),
    },
    decks: { decks, hasActive: active > 0 },
    competitive: r ? { rating: r.rating, games: r.games_played, wins: r.wins, losses: r.losses, draws: r.draws } : null,
    season: { passes: ((passes.data ?? []) as { season_id: string; state: { xp?: number; level?: number } | null }[]).map((x) => ({ seasonId: x.season_id, xp: Number(x.state?.xp ?? 0), level: typeof x.state?.level === "number" ? x.state.level : null })) },
    modes: { campaignNodes: camp, draftRuns: drafts, coachMatches: coach },
    ledger: ((ledger.data ?? []) as { created_at: string; delta: number; reason: string; balance_after: number; ref: string | null }[]).map((x) => ({ at: x.created_at, delta: Number(x.delta), reason: x.reason, balanceAfter: Number(x.balance_after), ref: x.ref })),
    sanctions: sanctions.ok ? sanctions.data.rows : [],
    activity,
  });
}

/** Ajuste de créditos: una operación explícita, con saldo esperado e idempotente por gesto (ver `domain/admin/credits`). */
export async function adjustCredits(sb: SupabaseClient, actor: string, i: CreditAdjustInput): Promise<AdminResult<{ repeated: boolean; balanceBefore?: number; balanceAfter: number; delta: number }>> {
  const { data, error } = await sb.rpc("app_admin_adjust_credits", {
    p_user: i.userId, p_delta: signedDelta(i), p_reason: i.reason, p_actor: actor, p_ref: adminCreditRef(i.ref), p_expected_balance: i.expectedBalance,
  });
  if (error) return rpcFailure(error.message);
  return ok(data as { repeated: boolean; balanceBefore?: number; balanceAfter: number; delta: number });
}

/*
 * ────────────────────────── CONCESIONES (sobres y cartas) ──────────────────────────
 *
 * Por el mecanismo CANÓNICO del servidor: `award()` → `app_grant_reward` (idempotente por `(user_id, ref)` en el libro
 * mayor; las cartas se insertan con origen `reward`). Nada de INSERT improvisado en inventario. La auditoría se escribe
 * después con `app_admin_audit`; si fallara, la concesión ya hecha queda en el libro mayor con su `ref` (`admin:grant:…`).
 */
export const GRANT_PACK_MAX = 10;
export interface GrantInput { userId: string; kind: "pack" | "card"; packId?: string; count?: number; cardId?: string; reason: string; ref: string }

export function parseGrant(body: Record<string, unknown>): { ok: true; value: GrantInput } | { ok: false; error: string } {
  if (!isUuid(body.userId)) return { ok: false, error: "Usuario inválido" };
  const reason = cleanReason(body.reason);
  if (!reason) return { ok: false, error: "El motivo es obligatorio (8–500 caracteres)" };
  if (typeof body.ref !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.ref)) return { ok: false, error: "Falta la clave de la operación" };
  if (body.kind === "pack") {
    const pack = typeof body.packId === "string" ? getPack(body.packId) : undefined;
    if (!pack || packLifecycle(pack) === "DRAFT") return { ok: false, error: "Sobre inválido" };
    const n = Number(body.count ?? 1);
    if (!Number.isInteger(n) || n < 1 || n > GRANT_PACK_MAX) return { ok: false, error: `Cantidad inválida (1–${GRANT_PACK_MAX})` };
    return { ok: true, value: { userId: body.userId, kind: "pack", packId: pack.id, count: n, reason, ref: body.ref } };
  }
  if (body.kind === "card") {
    const card = typeof body.cardId === "string" ? getCard(body.cardId) : undefined;
    if (!card) return { ok: false, error: "Carta inválida" };
    return { ok: true, value: { userId: body.userId, kind: "card", cardId: card.id, reason, ref: body.ref } };
  }
  return { ok: false, error: "Tipo de concesión inválido" };
}

export async function grant(sb: SupabaseClient, actor: string, g: GrantInput): Promise<AdminResult<{ applied: boolean; cardUids: string[] }>> {
  const { data: exists } = await sb.from("profiles").select("id").eq("id", g.userId).maybeSingle();
  if (!exists) return fail(404, "Usuario no encontrado");
  const ref = `admin:grant:${g.ref}`;
  const reward = g.kind === "pack" ? { packId: g.packId, packCount: g.count } : { cardId: g.cardId };
  let out;
  try {
    out = await award(sb, { userId: g.userId, ref, reason: `admin_grant: ${g.reason}`, reward });
  } catch (e) {
    console.error(`[admin] grant: ${e instanceof Error ? e.message : String(e)}`);
    return fail(500, "No se pudo conceder");
  }
  if (out.applied) {
    const detail = { ref, reason: g.reason, before: null, after: reward, purchasable: g.packId ? isPurchasable(getPack(g.packId)!) : null };
    await writeAudit(sb, actor, g.kind === "pack" ? "user_grant_pack" : "user_grant_card", "user", g.userId, detail);
  }
  return ok({ applied: out.applied, cardUids: out.cardUids ?? [] });
}
