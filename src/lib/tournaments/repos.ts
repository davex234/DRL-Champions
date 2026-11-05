"use client";

/** Lectura (anon, RLS pública) del sistema de torneos. Devuelve tipos de dominio. */
import { getSupabase } from "@/lib/supabase/client";
import type {
  TournamentRow, TournamentTeamRow, TournamentPlayerRow, CardGenerationRuleRow,
  CardGenerationRow, PlayerCardRow, SpecialCardRow, CardPhotoRow,
} from "@/lib/supabase/tournaments.types";
import type {
  Tournament, TournamentTeam, TournamentPlayer, RarityRule, CardPhoto,
} from "@/domain/tournaments/types";

const num = (n: number | null): number | undefined => (n == null ? undefined : Number(n));

function toTournament(r: TournamentRow): Tournament {
  return {
    id: r.id, name: r.name, region: r.region ?? undefined, tier: r.tier ?? undefined,
    status: r.status as Tournament["status"], eventId: r.event_id ?? undefined,
    winnerTeamId: r.winner_team_id ?? undefined, startDate: r.start_date ?? undefined,
    endDate: r.end_date ?? undefined, finishedAt: r.finished_at ?? undefined,
  };
}

export async function listTournaments(limit = 100): Promise<Tournament[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("tournaments").select("*").order("created_at", { ascending: false }).limit(limit);
  return ((data as TournamentRow[]) ?? []).map(toTournament);
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from("tournaments").select("*").eq("id", id).maybeSingle();
  return data ? toTournament(data as TournamentRow) : null;
}

export async function listTournamentTeams(tournamentId: string): Promise<TournamentTeam[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("tournament_teams").select("*").eq("tournament_id", tournamentId);
  return ((data as TournamentTeamRow[]) ?? []).map((r) => ({
    tournamentId: r.tournament_id, teamId: r.team_id, teamName: r.team_name ?? undefined,
    placement: num(r.placement), status: r.status as TournamentTeam["status"],
  }));
}

export async function listTournamentPlayers(tournamentId: string): Promise<TournamentPlayer[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("tournament_players").select("*").eq("tournament_id", tournamentId);
  return ((data as TournamentPlayerRow[]) ?? []).map((r) => ({
    tournamentId: r.tournament_id, teamId: r.team_id ?? undefined, playerId: r.player_id,
    nick: r.nick ?? undefined, rating: num(r.rating), acs: num(r.acs), kd: num(r.kd),
    kast: num(r.kast), maps: num(r.maps), isMvp: r.is_mvp, stats: r.stats,
  }));
}

export async function listRarityRules(): Promise<RarityRule[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("card_generation_rules").select("*").order("priority", { ascending: false });
  return ((data as CardGenerationRuleRow[]) ?? []).map((r) => ({
    id: r.id, kind: r.kind as RarityRule["kind"], tier: r.tier, label: r.label,
    minRating: num(r.min_rating), accolade: r.accolade ?? undefined, color: r.color ?? undefined,
    priority: r.priority, active: r.active,
  }));
}

export async function listPlayerCards(tournamentId: string): Promise<PlayerCardRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("player_cards").select("*").eq("tournament_id", tournamentId);
  return (data as PlayerCardRow[]) ?? [];
}

export async function listSpecialCards(tournamentId: string): Promise<SpecialCardRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("special_cards").select("*").eq("tournament_id", tournamentId);
  return (data as SpecialCardRow[]) ?? [];
}

export async function listGenerations(tournamentId: string): Promise<CardGenerationRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("card_generations").select("*")
    .eq("tournament_id", tournamentId).order("created_at", { ascending: false });
  return (data as CardGenerationRow[]) ?? [];
}

export async function listCardPhotos(playerId: string): Promise<CardPhoto[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data } = await sb.from("card_photos").select("*").eq("player_id", playerId);
  return ((data as CardPhotoRow[]) ?? []).map((r) => ({
    id: r.id, playerId: r.player_id, url: r.url, source: r.source as CardPhoto["source"],
    quality: num(r.quality), approvalStatus: r.approval_status as CardPhoto["approvalStatus"], priority: r.priority,
  }));
}
