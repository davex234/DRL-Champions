/**
 * SIMULADOR DEL MUNDO — `advanceWorld` ejecuta UNA temporada completa de forma autónoma
 * y determinista, componiendo todos los subsistemas. `simulateWorld(n)` avanza N
 * temporadas (el usuario puede "irse 10 temporadas" y volver a un universo distinto).
 *
 *   preseason → liga → playoffs → (evolución/edad) → mercado (contratos/jubilaciones/
 *   fichajes/coaches) → valores/rankings → narrativa/historia/noticias → nueva temporada
 */
import type { WorldState, WorldEvent } from "./types";
import type { NewsItem } from "@/intel";
import { playSeason } from "./season";
import { evolveSeason } from "./evolve";
import { updateFanbase } from "./fanbase";
import { tickContracts } from "./contracts";
import { retireVeterans } from "./retirement";
import { runTransferMarket, manageCoaches } from "./transfers";
import { recomputeRankings } from "./rankings";
import { snapshotWorld, detectWorldEvents } from "./narrative";
import { updateHistory } from "./history";
import { worldNews } from "./news";
import { makeRng, seedOf } from "./rng";

/**
 * Avanza el mundo UNA temporada. Devuelve los eventos y noticias generados.
 *
 * `opts.skipTransferMarket`: no ejecuta el mercado interno de fichajes (lo asume la capa
 * completa `src/market::runAiMarket`, que REUTILIZA `runTransferMarket` como mecanismo).
 * MERCADO ÚNICO (Consolidation F1.1): en producto, TODOS los avances de temporada pasan por
 * `runAiMarket` + `advanceWorld({skipTransferMarket:true})` (useWorldStore/useManagerStore).
 * El camino sin opts queda como mecanismo de bajo nivel para verifies/headless.
 * `opts.protectTeamId`: blinda al club del usuario si el mercado interno sí corre.
 */
export function advanceWorld(
  world: WorldState,
  opts?: { skipTransferMarket?: boolean; protectTeamId?: string },
): { events: WorldEvent[]; news: NewsItem[] } {
  const prev = snapshotWorld(world);

  // 1) Competición.
  world.phase = "league";
  const result = playSeason(world);
  world.phase = "playoffs";
  evolveSeason(world, result);        // desarrollo + edad + títulos + timeline + valores
  updateFanbase(world, result);

  // 2) Intertemporada / mercado.
  world.phase = "market";
  tickContracts(world, makeRng(seedOf(world.seed, "contracts", world.season)));
  const retired = retireVeterans(world, makeRng(seedOf(world.seed, "retire", world.season)));
  if (!opts?.skipTransferMarket) runTransferMarket(world, { protectTeamId: opts?.protectTeamId });
  manageCoaches(world);

  // 3) Rankings.
  recomputeRankings(world);

  // 4) Narrativa + historia + periódico.
  const events = detectWorldEvents(world, result, prev, retired.map((p) => p.id));
  world.events = [...events, ...world.events].slice(0, 300);
  updateHistory(world, result);
  const news = worldNews(events);
  world.news = [...news, ...world.news].slice(0, 200);

  // 5) Nueva temporada.
  world.season++;
  world.phase = "offseason";
  return { events, news };
}

/** Avanza N temporadas. Acumula eventos/noticias del periodo. */
export function simulateWorld(world: WorldState, seasons: number): { events: WorldEvent[]; news: NewsItem[] } {
  const events: WorldEvent[] = [];
  const news: NewsItem[] = [];
  for (let i = 0; i < Math.max(0, seasons); i++) {
    const r = advanceWorld(world);
    events.push(...r.events);
    news.push(...r.news);
  }
  return { events, news };
}
