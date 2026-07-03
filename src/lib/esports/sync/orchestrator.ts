/**
 * DRL ESPORTS SYNC — orquestador de sincronización competitiva.
 *
 * Coordina el flujo completo para un torneo:
 *   fuente (VLR/mock) → normalización (mappers) → upsert (writers) →
 *   recálculo de clasificaciones y estadísticas (RPC).
 *
 * Es código de SERVIDOR: usa el cliente service_role. Idempotente: re-ejecutar
 * actualiza en sitio sin duplicar (todo va por UPSERT y RPC que recomputan).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { type CompetitiveSource, normalizeStatus, type RawMatch } from "./source";
import { mockSource } from "./mock";
import {
  eventRow, teamRow, matchRow, matchMapRow, mapPlayerStatRow,
} from "./mappers";
import {
  upsertTeams, upsertEvent, upsertStages, upsertMatches, upsertMatchMaps,
  upsertMapStats, upsertPlayerStats, recomputeStandings, recomputeTeamStats,
  recomputePlayerEventStats, setSyncState, logNotification,
} from "./writers";

export interface SyncResult {
  tournamentId: string;
  teams: number;
  matches: number;
  maps: number;
  ok: boolean;
  error?: string;
}

/** Resuelve el ganador de un mapa a partir de marcadores y equipos del partido. */
function resolveMapWinner(scoreA: number | null, scoreB: number | null, teamAId: string, teamBId: string): string | null {
  if (scoreA == null || scoreB == null || scoreA === scoreB) return null;
  return scoreA > scoreB ? teamAId : teamBId;
}

/** Agrega el scoreboard por mapas en una fila por (partido, jugador). */
function aggregatePlayerStats(matchId: string, mapRows: ReturnType<typeof mapPlayerStatRow>[]) {
  const byPlayer = new Map<string, ReturnType<typeof mapPlayerStatRow>[]>();
  for (const r of mapRows) {
    const list = byPlayer.get(r.player_id) ?? [];
    list.push(r);
    byPlayer.set(r.player_id, list);
  }
  const avg = (xs: (number | null)[]) => {
    const vals = xs.filter((v): v is number => v != null);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
  };
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const out: Record<string, unknown>[] = [];
  for (const [playerId, rows] of byPlayer) {
    const kills = sum(rows.map((r) => r.kills));
    const deaths = sum(rows.map((r) => r.deaths));
    out.push({
      match_id: matchId, player_id: playerId, team_id: rows[0].team_id,
      agent_id: rows[0].agent_id, kills, deaths, assists: sum(rows.map((r) => r.assists)),
      acs: avg(rows.map((r) => r.acs)), kast: avg(rows.map((r) => r.kast)),
      adr: avg(rows.map((r) => r.adr)), hs_pct: avg(rows.map((r) => r.hs_pct)),
      fk: sum(rows.map((r) => r.fk)), fd: sum(rows.map((r) => r.fd)),
      clutches: sum(rows.map((r) => r.clutches)), rating: avg(rows.map((r) => r.rating)),
      kd: deaths ? Math.round((kills / deaths) * 100) / 100 : kills,
      plus_minus: kills - deaths, maps_played: rows.length,
    });
  }
  return out;
}

/** Sincroniza un torneo completo (equipos, fases, partidos, mapas, stats). */
export async function syncTournament(
  source: CompetitiveSource,
  tournamentId: string,
  sb: SupabaseClient,
): Promise<SyncResult> {
  const stateId = `${source.id}:event:${tournamentId}`;
  const result: SyncResult = { tournamentId, teams: 0, matches: 0, maps: 0, ok: false };
  try {
    await setSyncState(sb, stateId, { status: "running", error: null });

    // 1. Torneo
    const tournament = await source.getTournament(tournamentId);
    if (tournament) await upsertEvent(sb, eventRow(tournament));

    // 2. Equipos
    const teams = await source.getTeams(tournamentId);
    await upsertTeams(sb, teams.map(teamRow));
    result.teams = teams.length;

    // 3. Fases
    const stagesRaw = await source.getStages(tournamentId);
    const stageMap = await upsertStages(
      sb, tournamentId,
      stagesRaw.map((s, i) => ({
        event_id: tournamentId, slug: s.slug, name: s.name,
        kind: s.kind ?? "playoff", order_idx: s.orderIdx ?? i,
      })),
    );

    // 4. Partidos (con detalle de mapas para los finalizados)
    const matches = await source.getMatches(tournamentId);
    const teamIds = new Set<string>();
    const matchRows: Record<string, unknown>[] = [];
    const finished: RawMatch[] = [];
    for (const m of matches) {
      const stageId = m.stageSlug ? stageMap[m.stageSlug] ?? null : null;
      matchRows.push(matchRow(m, stageId));
      teamIds.add(m.teamAId); teamIds.add(m.teamBId);
      if (normalizeStatus(m.status) === "finished") finished.push(m);
    }
    await upsertMatches(sb, matchRows);
    result.matches = matches.length;

    // 5. Detalle por mapa + scoreboard de los partidos finalizados
    for (const summary of finished) {
      const detail = (summary.maps?.length ? summary : await source.getMatchDetail(summary.id)) ?? summary;
      const maps = detail.maps ?? [];
      if (!maps.length) continue;

      const mmRows = maps.map((mp) => {
        const row = matchMapRow(detail.id, mp) as Record<string, unknown>;
        row.winner_team_id = resolveMapWinner(mp.scoreA ?? null, mp.scoreB ?? null, detail.teamAId, detail.teamBId);
        return row;
      });
      const orderToId = await upsertMatchMaps(sb, mmRows);
      result.maps += maps.length;

      const statRows = [];
      for (const mp of maps) {
        const matchMapId = orderToId[mp.mapOrder];
        if (!matchMapId) continue;
        for (const p of mp.players ?? []) statRows.push(mapPlayerStatRow(matchMapId, detail.id, p));
      }
      if (statRows.length) {
        await upsertMapStats(sb, statRows);
        await upsertPlayerStats(sb, aggregatePlayerStats(detail.id, statRows));
      }
    }

    // 6. Recálculos (clasificaciones + agregados)
    await recomputeStandings(sb, tournamentId);
    for (const teamId of teamIds) await recomputeTeamStats(sb, teamId, tournamentId);
    await recomputePlayerEventStats(sb, tournamentId);

    await setSyncState(sb, stateId, { status: "ok", last_synced_at: new Date().toISOString(), error: null });
    result.ok = true;
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result.error = msg;
    await setSyncState(sb, stateId, { status: "error", error: msg });
    await logNotification(sb, "error", "sync_error", `Sync torneo ${tournamentId}: ${msg}`);
    return result;
  }
}

/**
 * Sincronización completa: recorre los circuitos y sus torneos.
 * `source` por defecto: VLR si está configurado, si no la fuente mock.
 */
export async function runCompetitiveSync(opts: { source?: CompetitiveSource } = {}): Promise<SyncResult[]> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase admin no configurado (SUPABASE_SERVICE_ROLE_KEY)");
  const source = opts.source ?? mockSource;

  const tournaments = await source.getTournaments();
  const results: SyncResult[] = [];
  for (const t of tournaments) results.push(await syncTournament(source, t.id, sb));
  return results;
}
