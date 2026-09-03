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
  circuitRow, eventRow, teamRow, matchRow, matchMapRow, mapPlayerStatRow,
} from "./mappers";
import {
  upsertCircuits, upsertTeams, upsertPlayers, upsertEvent, upsertStages, upsertMatches, upsertMatchMaps,
  upsertMapStats, upsertPlayerStats, recomputeStandings, recomputeTeamStats,
  recomputePlayerEventStats, setSyncState, logNotification,
} from "./writers";
import { runPickemLifecycle } from "@/server/services/pickemLifecycle";

export interface SyncResult {
  tournamentId: string;
  teams: number;
  /** Jugadores dados de alta en esta pasada (0 si la fuente no los aporta). */
  players: number;
  matches: number;
  maps: number;
  ok: boolean;
  error?: string;
  /** Qué hizo el ciclo de Pick'ems en esta pasada (Fase 10). */
  pickem?: { created: number; resolved: number; scored: boolean; usersScored: number };
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
  /*
   * Media para columnas ENTERAS. `player_stats.acs` es `int`, y promediar el ACS de varios
   * mapas da decimales: el primer sync real murió aquí con
   * «invalid input syntax for type integer: "219.5"». Las demás medias (kast, adr, hs_pct,
   * kd, rating) van a columnas `numeric` y se conservan con su decimal.
   */
  const avgInt = (xs: (number | null)[]) => {
    const v = avg(xs);
    return v == null ? null : Math.round(v);
  };
  const out: Record<string, unknown>[] = [];
  for (const [playerId, rows] of byPlayer) {
    const kills = sum(rows.map((r) => r.kills));
    const deaths = sum(rows.map((r) => r.deaths));
    out.push({
      match_id: matchId, player_id: playerId, team_id: rows[0].team_id,
      agent_id: rows[0].agent_id, kills, deaths, assists: sum(rows.map((r) => r.assists)),
      acs: avgInt(rows.map((r) => r.acs)), kast: avg(rows.map((r) => r.kast)),
      adr: avg(rows.map((r) => r.adr)), hs_pct: avg(rows.map((r) => r.hs_pct)),
      fk: sum(rows.map((r) => r.fk)), fd: sum(rows.map((r) => r.fd)),
      clutches: sum(rows.map((r) => r.clutches)), rating: avg(rows.map((r) => r.rating)),
      kd: deaths ? Math.round((kills / deaths) * 100) / 100 : kills,
      plus_minus: kills - deaths, maps_played: rows.length,
    });
  }
  return out;
}

/**
 * Opciones de una pasada. Ambas son ADITIVAS: sin ellas el comportamiento es el de siempre.
 */
export interface SyncOptions {
  /**
   * Jugadores a dar de alta antes de escribir estadísticas. `map_player_stats.player_id` tiene
   * FK contra `players(id)`; sin esto un scoreboard real no se puede escribir. La fuente mock
   * no los aporta y conserva su comportamiento anterior.
   */
  players?: Record<string, unknown>[];
  /**
   * Ejecutar el ciclo de Pick'ems (paso 7). Por defecto SÍ, como hasta ahora. Se puede apagar
   * para validar primero la persistencia de datos en una primera pasada aislada, sin abrir ni
   * corregir predicciones de golpe sobre un torneo entero ya terminado.
   */
  pickems?: boolean;
}

/** Sincroniza un torneo completo (equipos, jugadores, fases, partidos, mapas, stats). */
export async function syncTournament(
  source: CompetitiveSource,
  tournamentId: string,
  sb: SupabaseClient,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const stateId = `${source.id}:event:${tournamentId}`;
  const result: SyncResult = { tournamentId, teams: 0, players: 0, matches: 0, maps: 0, ok: false };
  try {
    await setSyncState(sb, stateId, { status: "running", error: null });

    /*
     * 0. CIRCUITO — antes que el evento, porque `events.circuit_id` lo referencia.
     *
     * `upsertCircuits` y `circuitRow` existían desde el principio y NADIE los llamaba: el
     * primer sync real falló justo aquí, con `events_circuit_id_fkey`, porque el circuito que
     * publica la fuente («vct») no estaba entre los diez sembrados. No se inventa ninguno: se
     * da de alta el que venga de la fuente, y si no viene, el evento queda sin circuito.
     */
    const circuits = await source.getCircuits();
    if (circuits.length) await upsertCircuits(sb, circuits.map(circuitRow));

    // 1. Torneo
    const tournament = await source.getTournament(tournamentId);
    if (tournament) await upsertEvent(sb, eventRow(tournament));

    // 2. Equipos
    const teams = await source.getTeams(tournamentId);
    await upsertTeams(sb, teams.map(teamRow));
    result.teams = teams.length;
    // Nombre legible por id, para las columnas legacy de `matches` que lee Pick'ems.
    const nameById = new Map(teams.map((t) => [t.id, t.name]));
    const nameOf = (id: string): string | undefined => nameById.get(id);

    /*
     * 2-bis. JUGADORES — el paso que faltaba.
     *
     * `map_player_stats.player_id` y `player_stats.player_id` tienen FK real contra
     * `players(id)`, y hasta ahora NADIE daba de alta jugadores: por eso la tabla estaba vacía
     * y ninguna sincronización con scoreboard podía completarse. Va después de los equipos
     * porque `players.team_id` los referencia.
     */
    if (opts.players?.length) {
      await upsertPlayers(sb, opts.players);
      result.players = opts.players.length;
    }

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
      matchRows.push(matchRow(m, stageId, nameOf));
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

    /*
     * 7. EL CICLO DE JUEGO (Fase 10)
     *
     * Aquí es donde el circuito real se convierte en algo que el jugador puede jugar.
     * Hasta la Fase 10, la sincronización terminaba en el paso 6: los partidos entraban,
     * los resultados entraban… y ninguna predicción se abría ni se corregía nunca. Las
     * preguntas de Pick'em solo las creaba un script de semilla y el corrector solo lo
     * llamaban tests.
     *
     * `runPickemLifecycle` abre las predicciones de los partidos que aún no han empezado,
     * fija el resultado de los que ya acabaron y reparte puntos y recompensas. Es
     * idempotente de arriba abajo, así que correr en cada sincronización es correcto.
     *
     * NUNCA lanza: si algo falla en el ciclo de juego, la sincronización de DATOS —que es
     * la razón de ser de esta función— tiene que terminar bien igualmente. Un torneo sin
     * predicciones es un problema; un torneo sin resultados es un producto roto.
     */
    if (opts.pickems !== false) {
      const loop = await runPickemLifecycle(sb, tournamentId);
      result.pickem = {
        created: loop.created,
        resolved: loop.resolved,
        scored: loop.scored,
        usersScored: loop.usersScored,
      };
      if (loop.notes.length > 0) {
        await logNotification(
          sb, "info", "pickem_lifecycle",
          `Pick'em ${tournamentId}: ${loop.notes.join(" · ")}`,
        );
      }
    }

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
