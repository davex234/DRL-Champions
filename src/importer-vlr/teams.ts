/**
 * PÁGINA DEL EVENTO (/event/{id}) — cabecera del torneo + tarjetas de equipos participantes.
 *
 * Parsing PURO (string → datos). Markup real de vlr.gg:
 *   cabecera: h1.event-header-main-title · breadcrumb a[href=/vct-…] · pares label/value
 *   (Dates/Prize/Location) · flag de la sede.
 *   equipos: div.wf-card.event-team → a.event-team-name[href=/team/{id}/{slug}] +
 *   a.event-team-players-item[href=/player/{id}/{slug}] con flag de país.
 */
import { textOf, findAll, sliceBetween, num, flagCountry, parseVlrDates } from "./parser";
import type { VlrEventInfo, VlrTeam, VlrRosterPlayer } from "./types";

/** Valor del par label/value de la cabecera ("Dates" → "Aug 1–25, 2024"). */
function headerValue(html: string, label: string): { text?: string; flag?: string } {
  const re = new RegExp(
    `class="ge-text-light label">\\s*${label}\\s*</div>\\s*<div class="value"[^>]*>([\\s\\S]*?)</div>`,
    "i",
  );
  const m = re.exec(html);
  if (!m) return {};
  const flag = /class="flag ([^"]+)"/.exec(m[1])?.[1];
  return { text: textOf(m[1]) || undefined, flag };
}

/** Cabecera del torneo. `name` vacío ⇒ la página no es un evento de VLR válido. */
export function parseEventInfo(html: string): VlrEventInfo {
  const name = textOf(sliceBetween(html, 'class="event-header-main-title">', "</h1>") ?? "");
  const subtitle = textOf(sliceBetween(html, 'class="event-header-main-desc">', "</h2>") ?? "") || undefined;
  const bc = sliceBetween(html, 'class="event-header-main-bc">', "</div>") ?? "";
  const bcLink = /<a href="(\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(bc);
  const dates = headerValue(html, "Dates");
  const prize = headerValue(html, "Prize");
  const location = headerValue(html, "Location");
  const range = parseVlrDates(dates.text);
  return {
    name,
    subtitle,
    datesText: dates.text,
    startDate: range.start,
    endDate: range.end,
    prizePool: num(prize.text?.replace(/\s*(USD|EUR)\s*$/i, "")),
    location: location.text,
    country: flagCountry(location.flag),
    circuitName: bcLink ? textOf(bcLink[2]) || undefined : undefined,
    circuitSlug: bcLink?.[1],
  };
}

/** Equipos participantes con su roster (tarjetas event-team). */
export function parseEventTeams(html: string): VlrTeam[] {
  const teams: VlrTeam[] = [];
  const cardRe = /class="wf-card event-team"/g;
  const starts = findAll(cardRe, html).map((m) => m.index);
  for (let i = 0; i < starts.length; i++) {
    const block = html.slice(starts[i], starts[i + 1] ?? html.length);
    const nameM = /class="wf-module-item event-team-name" href="\/team\/(\d+)\/[a-z0-9-]*">([\s\S]*?)<\/a>/i.exec(block);
    if (!nameM) continue;
    const players: VlrRosterPlayer[] = findAll(
      /<a href="\/player\/(\d+)\/[a-z0-9-]*" class="[^"]*event-team-players-item"[^>]*>([\s\S]*?)<\/a>/gi,
      block,
    ).map((pm) => ({
      vlrId: pm[1],
      nick: textOf(pm[2]),
      country: flagCountry(/class="flag ([^"]+)"/.exec(pm[2])?.[1]),
    })).filter((p) => p.nick.length > 0);
    const note = textOf(sliceBetween(block, 'class="event-team-note wf-module-item">', "</div>") ?? "") || undefined;
    const name = textOf(nameM[2]);
    if (name) teams.push({ vlrId: nameM[1], name, players, note });
  }
  return teams;
}
