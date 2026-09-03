/**
 * VLR IMPORT ENGINE — orquesta el flujo ÚNICO del conector:
 *
 *   URL → parseVlrUrl → fetch(evento, stats, partidos) → parsers puros →
 *   [opcional] fetch de cada página de partido (mapas + stats por mapa) → toRawSnapshot.
 *
 * La red vive SOLO en el `VlrFetcher` (inyectable); con un fetcher de fixtures el motor es 100%
 * determinista y offline. NO genera cartas, NO calcula OVR, NO publica: entrega el `RawSnapshot`
 * oficial que consume `importSnapshot` (`@/importer`) tal cual.
 */
import { importSnapshot, createIdentityResolver, makeClock, type ImportResult, type ImportCtx, type IdentityRegistry, type RawSnapshot } from "@/importer";
import type { ImportProvider, ProviderHealth } from "@/importer";
import { parseVlrUrl, eventUrls, matchUrl, createHttpFetcher, VLR_BASE } from "./client";
import { parseEventInfo, parseEventTeams } from "./teams";
import { parseEventStats } from "./stats";
import { parseEventMatches } from "./matches";
import { parseMatchPage } from "./maps";
import { toRawSnapshot } from "./normalize";
import { findAll } from "./parser";
import type { VlrImportOptions, VlrImportOutput, VlrFetcher, VlrEventRef } from "./types";

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/**
 * Importa un torneo de VLR desde su URL → `RawSnapshot` oficial + metadatos + avisos.
 * Lanza `Error` si la URL no es de un torneo de VLR o si las páginas del evento no llegan;
 * los fallos por-partido NO abortan (se degradan a warning y ese partido queda sin mapas).
 */
export async function importVlrTournament(url: string, opts: VlrImportOptions = {}): Promise<VlrImportOutput> {
  const ref = parseVlrUrl(url);
  if (!ref) throw new Error(`URL de VLR no válida (se espera .../event/{id}/... ): ${url}`);

  const fetcher = opts.fetcher ?? createHttpFetcher();
  const delay = opts.politeDelayMs ?? (opts.fetcher ? 0 : 300);
  const includeDetails = opts.includeMatchDetails ?? true;
  const maxMatchPages = opts.maxMatchPages ?? 512;
  const warnings: string[] = [];

  const urls = eventUrls(ref);
  const [eventHtml, statsHtml, matchesHtml] = [await fetcher(urls.overview), await fetcher(urls.stats), await fetcher(urls.matches)];
  let pagesFetched = 3;

  const info = parseEventInfo(eventHtml);
  if (!info.name) throw new Error(`la página de VLR no parece un torneo (sin título de evento): ${urls.overview}`);
  const teams = parseEventTeams(eventHtml);
  const statsRows = parseEventStats(statsHtml);
  const matches = parseEventMatches(matchesHtml);

  let matchDetailsFetched = 0;
  if (includeDetails) {
    for (const m of matches.slice(0, maxMatchPages)) {
      try {
        if (matchDetailsFetched > 0) await sleep(delay);
        const html = await fetcher(matchUrl(m.urlPath));
        pagesFetched++; matchDetailsFetched++;
        const detail = parseMatchPage(html, m);
        m.utcTs = detail.utcTs;
        m.bestOf = detail.bestOf;
        m.maps = detail.maps;
        m.teamRefs = detail.teamRefs;
      } catch (e) {
        warnings.push(`partido ${m.vlrId}: página de detalle no disponible (${e instanceof Error ? e.message : String(e)}); mapas omitidos`);
      }
    }
    if (matches.length > maxMatchPages) warnings.push(`solo se descargaron ${maxMatchPages}/${matches.length} páginas de partido (maxMatchPages)`);
  }

  const snapshot = toRawSnapshot(ref, info, teams, statsRows, matches);

  /*
   * Mapas SIN scoreboard es el fallo silencioso de este conector: el pipeline entero termina en
   * verde —torneo, equipos, partidos y marcadores están— y aguas abajo TODAS las métricas por
   * jugador salen a cero, así que no hay líderes, ni premios, ni cartas de rendimiento. Ocurrió
   * de verdad: vlr.gg cambió el scoreboard de <table> a <div> y nada lo dijo. Se avisa aquí, que
   * es el único punto que sabe a la vez cuántos mapas se leyeron y cuántas filas salieron.
   */
  const mapsParsed = snapshot.maps?.length ?? 0;
  const mapStatRows = snapshot.mapStats?.length ?? 0;
  if (mapsParsed > 0 && mapStatRows === 0) {
    warnings.push(
      `${mapsParsed} mapas leídos y NINGUNA fila de scoreboard: el markup de la página de partido ` +
      `probablemente ha cambiado. Sin estas filas, todas las estadísticas por jugador serán cero.`,
    );
  }

  return {
    ref,
    snapshot,
    warnings,
    meta: {
      sourceUrl: url,
      eventId: ref.eventId,
      slug: ref.slug,
      pagesFetched,
      matchesListed: matches.length,
      matchDetailsFetched,
      mapsParsed,
      mapStatRows,
    },
  };
}

/**
 * Conveniencia Fase-1: pasa el snapshot del conector por el Importer OFICIAL (parse → normalize →
 * validate) con contexto inyectado. `now` es el instante lógico (determinista, nunca Date.now aquí).
 */
export function vlrSnapshotToModel(snapshot: RawSnapshot, now: number, registry?: IdentityRegistry): ImportResult {
  const ctx: ImportCtx = { clock: makeClock(now), identity: createIdentityResolver(registry) };
  return importSnapshot(snapshot, ctx);
}

/** Ids de eventos enlazados en una página de listado de VLR (/events). Puro. */
export function parseEventLinks(html: string): string[] {
  return [...new Set(findAll(/href="\/event\/(\d+)\/[a-z0-9-]*"/gi, html).map((m) => m[1]))];
}

/**
 * `ImportProvider` oficial (contrato de `@/importer/provider`) con id "vlr" — el primer provider
 * REAL del Data Import Engine. `fetchTournament` acepta el id numérico o una URL completa.
 */
export function createVlrProvider(opts: VlrImportOptions = {}): ImportProvider {
  const fetcher: VlrFetcher = opts.fetcher ?? createHttpFetcher();
  return {
    id: "vlr",
    priority: () => 10,
    supports: (game: string) => game.toLowerCase() === "valorant",
    health: async (): Promise<ProviderHealth> => {
      const t0 = Date.now();
      try {
        await fetcher(`${VLR_BASE}/events`);
        return { ok: true, latencyMs: Date.now() - t0 };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },
    discover: async (): Promise<string[]> => parseEventLinks(await fetcher(`${VLR_BASE}/events`)),
    fetchTournament: async (tournamentId: string): Promise<RawSnapshot> => {
      const url = /^\d+$/.test(tournamentId) ? `${VLR_BASE}/event/${tournamentId}` : tournamentId;
      const out = await importVlrTournament(url, { ...opts, fetcher });
      return out.snapshot;
    },
  };
}

export type { VlrEventRef };
