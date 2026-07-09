/**
 * DRL TORNEOS — CardGenerationEngine.
 * ⚠️ LEGACY (Card Generator F4, 2026-07-09): pipeline admin/Supabase histórico. El cerebro
 * editorial canónico es `src/card-generator` (generateCards sobre AnalyzerResult).
 *
 * Responsabilidades: generar las especificaciones de carta (rareza por rating →
 * variante/accolade), crear las versiones especiales (MVP MYTHIC, Champion
 * CHAMPION), asignar foto y persistir el resultado + historial. Extensible:
 * nuevas fuentes solo deben rellenar `tournament_players` / `card_photos`.
 *
 * El cálculo de specs es PURO; la persistencia usa el cliente service_role.
 * El cliente aplica luego las accolades al roster local para volver las cartas
 * jugables (poseíbles / en sobres / colección).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccoladeId, Player, VariantId } from "@/domain/cards/types";
import { getPlayer, variantsForAccolade } from "@/data/catalog";
import { getVariant, baseMetalForOvr } from "@/domain/cards/variants";
import { applyStatBoost, computeOvr } from "@/domain/cards/ovr";
import { resolveTier, ruleForKind, pickPhoto } from "@/domain/tournaments/rarity";
import { computeAwards, type AwardPlayer, type AwardWinner } from "@/domain/collections/awards";
import type {
  Tournament, TournamentPlayer, RarityRule, GeneratedCardSpec, GenerationResult, CardPhoto,
} from "@/domain/tournaments/types";

/** Variante de mayor rank entre las que desbloquea una accolade. */
function topVariant(accolade: AccoladeId, player: Player): VariantId {
  const vs = variantsForAccolade(accolade, player);
  if (!vs.length) return baseMetalForOvr(computeOvr(player.stats));
  return vs.reduce((best, v) => (getVariant(v).rank > getVariant(best).rank ? v : best), vs[0]);
}

/** Construye la spec de una carta para un jugador según la regla aplicada. */
function buildSpec(
  tp: TournamentPlayer,
  rule: RarityRule,
  kind: GeneratedCardSpec["kind"],
  photo?: CardPhoto | null,
): GeneratedCardSpec | null {
  const player = getPlayer(tp.playerId);
  if (!player) return null; // solo jugadores del catálogo del juego son "jugables"
  const accolade = (rule.accolade ?? "").trim();
  const variantId: VariantId = accolade
    ? topVariant(accolade as AccoladeId, player)
    : baseMetalForOvr(computeOvr(player.stats));
  const variant = getVariant(variantId);
  const ovr = computeOvr(applyStatBoost(player.stats, variant.statBoost));
  return {
    playerId: tp.playerId, teamId: tp.teamId, nick: tp.nick ?? player.nick, kind,
    tier: rule.tier, accolade, variantId, cardId: `${tp.playerId}__${variantId}`,
    ovr, rating: tp.rating, photoId: photo?.id,
  };
}

interface GenInput {
  tournament: Tournament;
  players: TournamentPlayer[];
  rules: RarityRule[];
  /** Fotos aprobadas por jugador (opcional). */
  photosByPlayer?: Record<string, CardPhoto[]>;
}

function photoFor(playerId: string, input: GenInput): CardPhoto | null {
  return pickPhoto(input.photosByPlayer?.[playerId] ?? []);
}

/** TournamentPlayer[] → AwardPlayer[] (métricas para los premios del Collection Engine). */
function awardPlayersFrom(players: TournamentPlayer[]): AwardPlayer[] {
  return players.map((p) => ({
    playerId: p.playerId, nick: p.nick, teamId: p.teamId, rating: p.rating,
    acs: p.acs, kills: p.kills, assists: p.assists, hsPct: p.hsPct, clutch: p.clutch, isRookie: p.isRookie,
  }));
}

/** Construye la spec de una carta premio (Top ACS / Rookie / Clutch…). */
function buildAwardSpec(w: AwardWinner, input: GenInput): GeneratedCardSpec | null {
  const player = getPlayer(w.playerId);
  if (!player) return null;
  const variant = getVariant(w.variantId);
  const ovr = computeOvr(applyStatBoost(player.stats, variant.statBoost));
  const tp = input.players.find((p) => p.playerId === w.playerId);
  return {
    playerId: w.playerId, teamId: w.teamId, nick: w.nick ?? player.nick, kind: w.kind,
    tier: w.kind, accolade: w.accolade, variantId: w.variantId, cardId: w.cardId,
    ovr, rating: tp?.rating, photoId: photoFor(w.playerId, input)?.id,
  };
}

/** Genera todas las cartas al FINALIZAR un torneo (roster completo + especiales). */
export function generateForFinish(input: GenInput): GenerationResult {
  const { tournament, players, rules } = input;
  const specs: GeneratedCardSpec[] = [];

  // 1. Carta por rendimiento (rating → tier) para cada jugador.
  for (const tp of players) {
    const rule = resolveTier(tp.rating, rules);
    if (!rule) continue;
    const s = buildSpec(tp, rule, "player", photoFor(tp.playerId, input));
    if (s) specs.push(s);
  }
  let special = 0;

  // 2. MVP (MYTHIC): jugador marcado, o el de mayor rating.
  const mvpRule = ruleForKind(rules, "mvp");
  if (mvpRule) {
    const mvp = players.find((p) => p.isMvp)
      ?? [...players].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    if (mvp) {
      const s = buildSpec(mvp, mvpRule, "mvp", photoFor(mvp.playerId, input));
      if (s) { specs.push(s); special++; }
    }
  }

  // 3. Champion Edition (CHAMPION): roster del equipo ganador.
  const champRule = ruleForKind(rules, "champion");
  if (champRule && tournament.winnerTeamId) {
    for (const tp of players.filter((p) => p.teamId === tournament.winnerTeamId)) {
      const s = buildSpec(tp, champRule, "champion", photoFor(tp.playerId, input));
      if (s) { specs.push(s); special++; }
    }
  }

  // 4. Premios estadísticos del Collection Engine (Top ACS/Rating/HS%/Kills/Assist, Clutch, Rookie).
  for (const w of computeAwards(awardPlayersFrom(players))) {
    const s = buildAwardSpec(w, input);
    if (s) { specs.push(s); special++; }
  }

  return {
    tournamentId: tournament.id, trigger: "finish",
    specs, cardsGenerated: specs.length - special, specialGenerated: special,
  };
}

/** Genera cartas para el roster de un equipo ELIMINADO (sin especiales). */
export function generateForTeamElimination(input: GenInput, teamId: string): GenerationResult {
  const { tournament, players, rules } = input;
  const specs: GeneratedCardSpec[] = [];
  for (const tp of players.filter((p) => p.teamId === teamId)) {
    const rule = resolveTier(tp.rating, rules);
    if (!rule) continue;
    const s = buildSpec(tp, rule, "player", photoFor(tp.playerId, input));
    if (s) specs.push(s);
  }
  return { tournamentId: tournament.id, trigger: "team_eliminated", teamId, specs, cardsGenerated: specs.length, specialGenerated: 0 };
}

// ============================================================================
// Persistencia (service_role)
// ============================================================================

/** Persiste un resultado de generación: historial + player_cards + special_cards. */
export async function persistGeneration(
  sb: SupabaseClient, result: GenerationResult, createdBy?: string,
): Promise<{ generationId: string }> {
  const { data: gen, error: gErr } = await sb.from("card_generations").insert({
    tournament_id: result.tournamentId, trigger: result.trigger, team_id: result.teamId ?? null,
    cards_generated: result.cardsGenerated, special_generated: result.specialGenerated,
    status: "ok", created_by: createdBy ?? null,
    detail: { specs: result.specs.length },
  }).select("id").single();
  if (gErr) throw new Error(`card_generations: ${gErr.message}`);
  const generationId = (gen as { id: string }).id;

  const base = (s: GeneratedCardSpec) => ({
    tournament_id: result.tournamentId, player_id: s.playerId, team_id: s.teamId ?? null,
    rarity_tier: s.tier, accolade: s.accolade || null, variant_id: s.variantId, card_id: s.cardId,
    photo_id: s.photoId ?? null, generation_id: generationId,
  });

  const playerRows = result.specs.filter((s) => s.kind === "player")
    .map((s) => ({ ...base(s), ovr: s.ovr, rating: s.rating ?? null }));
  if (playerRows.length) {
    const { error } = await sb.from("player_cards").upsert(playerRows, { onConflict: "tournament_id,player_id,variant_id" });
    if (error) throw new Error(`player_cards: ${error.message}`);
  }

  const specialRows = result.specs.filter((s) => s.kind !== "player")
    .map((s) => ({ ...base(s), kind: s.kind }));
  if (specialRows.length) {
    // Reemplaza los kinds presentes para respetar los unique parciales (MVP/premios).
    const kinds = [...new Set(specialRows.map((r) => r.kind))];
    await sb.from("special_cards").delete().eq("tournament_id", result.tournamentId).in("kind", kinds);
    const { error } = await sb.from("special_cards").insert(specialRows);
    if (error) throw new Error(`special_cards: ${error.message}`);
  }

  return { generationId };
}

/** Slug URL-safe para la colección. */
function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "coleccion";
}

/**
 * Persiste la COLECCIÓN del torneo: upsert de `collections` + `collection_items`
 * desde todas las specs (jugadores + MVP + Champion + premios). Idempotente.
 */
export async function persistCollection(
  sb: SupabaseClient, tournament: Tournament, specs: GeneratedCardSpec[],
  reward: Record<string, unknown>,
): Promise<{ collectionId: string; slug: string }> {
  const slug = slugify(tournament.id || tournament.name);
  const distinct = new Set(specs.map((s) => s.cardId)).size;

  const { data: coll, error } = await sb.from("collections").upsert({
    tournament_id: tournament.id, slug, name: tournament.name,
    tier: tournament.tier ?? null, region: tournament.region ?? null,
    reward, total_items: distinct, updated_at: new Date().toISOString(),
  }, { onConflict: "tournament_id" }).select("id").single();
  if (error) throw new Error(`collections: ${error.message}`);
  const collectionId = (coll as { id: string }).id;

  const items = specs.map((s) => ({
    collection_id: collectionId, card_id: s.cardId, player_id: s.playerId,
    category: s.kind === "player" ? "player" : s.kind, label: s.nick ?? s.playerId,
    accolade: s.accolade || null, variant_id: s.variantId, ovr: s.ovr,
  }));
  if (items.length) {
    const { error: e2 } = await sb.from("collection_items")
      .upsert(items, { onConflict: "collection_id,card_id" });
    if (e2) throw new Error(`collection_items: ${e2.message}`);
  }
  return { collectionId, slug };
}
