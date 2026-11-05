/**
 * PÁGINA DE PARTIDOS DEL EVENTO (/event/matches/{id}/?series_id=all) — lista completa de partidos.
 *
 * Parsing PURO. Markup real: labels de día (wf-label mod-large) seguidos de tarjetas con anchors
 * a.match-item cuyo href es "/{matchId}/{slug}". Dentro: hora local, dos bloques
 * match-item-vs-team (ganador = mod-winner), marcador por equipo, estado (ml-status) y
 * serie/fase (match-item-event-series / match-item-event).
 */
import { textOf, findAll, num, sliceBetween } from "./parser";
import type { VlrMatch } from "./types";

interface TeamSide { name: string; score?: number; winner: boolean }

function parseSide(block: string): TeamSide | undefined {
  const name = textOf(sliceBetween(block, 'class="text-of">', "</div>") ?? "");
  if (!name) return undefined;
  const score = num(textOf(/class="match-item-vs-team-score[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] ?? ""));
  return { name, score, winner: /match-item-vs-team mod-winner/.test(block) };
}

/** Partidos listados (sin mapas todavía: eso lo aporta la página de detalle, ver maps.ts). */
export function parseEventMatches(html: string): VlrMatch[] {
  const out: VlrMatch[] = [];
  const days = findAll(/class="wf-label mod-large">([\s\S]*?)<\/div>/gi, html)
    .map((m) => ({ index: m.index, text: textOf(m[1]) }));
  const anchors = findAll(
    /<a href="(\/(\d+)\/[a-z0-9-]+)" class="[^"]*match-item[^"]*">([\s\S]*?)<\/a>/gi,
    html,
  );
  for (const a of anchors) {
    const [, urlPath, vlrId, inner] = a;
    // Dos bloques de equipo dentro de match-item-vs; el primero es el lado A del listado.
    // (el (?: [^"]*)? evita capturar match-item-vs-team-name / -score, que siguen con "-")
    const sideBlocks = findAll(/class="match-item-vs-team(?: [^"]*)?"/g, inner).map((m) => m.index);
    if (sideBlocks.length < 2) continue;
    const vsEnd = inner.indexOf("match-item-eta");
    const sideA = parseSide(inner.slice(sideBlocks[0], sideBlocks[1]));
    const sideB = parseSide(inner.slice(sideBlocks[1], vsEnd > 0 ? vsEnd : undefined));
    if (!sideA || !sideB) continue;
    const day = [...days].reverse().find((d) => d.index < a.index)?.text;
    const series = textOf(/class="match-item-event-series[^"]*">([\s\S]*?)<\/div>/i.exec(inner)?.[1] ?? "") || undefined;
    const eventBlock = /class="match-item-event[^"]*">[\s\S]*?<\/div>([\s\S]*?)<\/div>/i.exec(inner);
    out.push({
      vlrId,
      urlPath,
      teamA: sideA.name,
      teamB: sideB.name,
      scoreA: sideA.score,
      scoreB: sideB.score,
      winner: sideA.winner ? sideA.name : sideB.winner ? sideB.name : undefined,
      statusText: textOf(/class="ml-status">([\s\S]*?)<\/div>/i.exec(inner)?.[1] ?? "") || undefined,
      series,
      stage: eventBlock ? textOf(eventBlock[1]) || undefined : undefined,
      dayText: day,
      timeText: textOf(/class="match-item-time">([\s\S]*?)<\/div>/i.exec(inner)?.[1] ?? "") || undefined,
      maps: [],
    });
  }
  return out;
}
