/**
 * MUNDO × NARRATIVA — los 16 hitos del universo (sin frases de UI).
 *
 * Compara el estado del mundo ANTES y DESPUÉS de la temporada (snapshot) + el resultado +
 * los retirados para detectar: dinastías, colapsos, bombazos, jubilaciones, wonderkids,
 * leyendas, rivalidades, generaciones doradas, estrellas emergentes, últimos bailes, ceses/
 * contrataciones de coach, fichajes récord, temporadas/splits perfectos y remontadas. PURO.
 */
import type { WorldState, WorldEvent, WorldEventType } from "./types";
import type { SeasonResult } from "./season";
import { progress, ageBand } from "@/development";
import { ns } from "@/i18n/runtime";

const tr = ns("world");

export interface WorldSnapshot {
  coachByTeam: Record<string, string | null>;
  posByTeam: Record<string, number>;
  values: Record<string, number>;
  titles: Record<string, number>;
  recordFee: number;
  champion: string | null;
}

export function snapshotWorld(world: WorldState): WorldSnapshot {
  const posByTeam: Record<string, number> = {};
  for (const t of Object.values(world.teams)) {
    const last = t.standings[t.standings.length - 1];
    posByTeam[t.id] = last?.pos ?? 99;
  }
  const values: Record<string, number> = {};
  const titles: Record<string, number> = {};
  for (const p of Object.values(world.players)) { values[p.id] = p.value; titles[p.id] = p.titles; }
  const champs = world.history.champions;
  return {
    coachByTeam: Object.fromEntries(Object.values(world.teams).map((t) => [t.id, t.coachId])),
    posByTeam, values, titles,
    recordFee: world.history.records["transfer"]?.value ?? 0,
    champion: champs.length ? champs[champs.length - 1].teamId : null,
  };
}

const m = (n: number) => Math.min(100, Math.max(1, Math.round(n)));

export function detectWorldEvents(world: WorldState, result: SeasonResult, prev: WorldSnapshot, retiredIds: string[]): WorldEvent[] {
  const out: WorldEvent[] = [];
  const season = world.season;
  const total = Object.keys(world.teams).length;
  const push = (type: WorldEventType, subject: string, magnitude: number, detail: string) => out.push({ type, season, subject, magnitude: m(magnitude), detail });
  const champ = world.teams[result.championId];
  const seasonTransfers = world.transfers.filter((t) => t.season === season);

  // — Dinastía / remontada / temporada perfecta —
  if (champ) {
    let streak = 0;
    for (let i = world.history.champions.length - 1; i >= 0; i--) { if (world.history.champions[i].teamId === champ.id) streak++; else break; }
    if (streak >= 3) push("historic_dynasty", champ.name, 80 + streak * 4, tr("{streak} títulos seguidos", { streak }));
    const champStanding = result.standings.find((s) => s.teamId === champ.id);
    if (champStanding && champStanding.losses <= 1) push("perfect_season", champ.name, 88, tr("liga con {losses} derrotas", { losses: champStanding.losses }));
    const prevPos = prev.posByTeam[champ.id] ?? 99;
    if (prevPos > total * 0.7) push("historic_comeback", champ.name, 85, tr("del puesto {prevPos} al título", { prevPos }));
  }
  // League winner dominante (perfect split) aunque no gane playoffs.
  const leagueWinner = result.standings[0];
  if (leagueWinner && leagueWinner.losses <= 1 && leagueWinner.teamId !== result.championId) {
    push("perfect_split", world.teams[leagueWinner.teamId]?.name ?? leagueWinner.teamId, 80, `liga dominada (${leagueWinner.wins}-${leagueWinner.losses})`);
  }

  // — Colapsos —
  for (const s of result.standings) {
    const prevPos = prev.posByTeam[s.teamId];
    if (prevPos != null && prevPos <= 3 && s.pos >= Math.ceil(total * 0.7)) push("great_collapse", world.teams[s.teamId]?.name ?? s.teamId, 70 + (s.pos - prevPos), tr("del {prevPos} al {pos}", { prevPos, pos: s.pos }));
  }

  // — Fichajes —
  let maxFee = prev.recordFee; let bombSubject = "";
  for (const t of seasonTransfers) {
    if (t.kind === "transfer" && t.fee >= 22000) push("transfer_bomb", t.nick, m(60 + t.fee / 1500), `${t.nick} → ${world.teams[t.to ?? ""]?.name ?? "?"} (${t.fee})`);
    if (t.fee > maxFee) { maxFee = t.fee; bombSubject = `${t.nick} (${t.fee})`; }
  }
  if (maxFee > prev.recordFee && bombSubject) push("record_transfer", bombSubject, 90, tr("fichaje récord histórico"));

  // — Jubilaciones —
  for (const id of retiredIds) {
    const p = world.players[id];
    if (!p) continue;
    if (p.titles >= 1 || (prev.values[id] ?? 0) > 1500) push("retirement", p.nick, 60 + p.titles * 6, tr("cuelga el ratón → {staffRole}", { staffRole: p.staffRole }));
    if (p.titles >= 4) push("legend_created", p.nick, 92, tr("leyenda con {titles} títulos", { titles: p.titles }));
  }

  // — Jugadores —
  for (const p of Object.values(world.players)) {
    if (p.status !== "active") continue;
    const band = ageBand(p.dev.age, p.innate);
    const prevTitles = prev.titles[p.id] ?? 0;
    if (prevTitles < 5 && p.titles >= 5) push("legend_created", p.nick, 95, tr("leyenda viva ({titles} títulos)", { titles: p.titles }));
    const prevVal = prev.values[p.id] ?? p.value;
    if (band === "joven" && p.value > prevVal * 1.4 && p.value > 1200) push("the_next_star", p.nick, 70, `irrumpe (${prevVal}→${p.value})`);
    if (p.origin === "academy" && p.dev.seasonsPlayed <= 1 && p.innate.potential >= 90) push("academy_wonderkid", p.nick, 75, `wonderkid (pot ${p.innate.potential})`);
    if ((band === "veterano" || band === "declive") && p.dev.age >= 30 && p.value > 1800) push("the_last_dance", p.nick, 65, tr("último baile a los {age}", { age: p.dev.age }));
  }

  // — Generación dorada —
  for (const t of Object.values(world.teams)) {
    const youngStars = t.roster.map((id) => world.players[id]).filter((p) => p && p.status === "active" && ageBand(p.dev.age, p.innate) === "joven" && p.innate.potential >= 85);
    if (youngStars.length >= 3) push("golden_generation", t.name, 78, tr("{length} jóvenes con techo alto", { length: youngStars.length }));
  }

  // — Rivalidades —
  for (const t of Object.values(world.teams)) {
    for (const [rid, intensity] of Object.entries(t.rivalries)) {
      if (intensity >= 56 && t.id < rid) push("historic_rivalry", `${t.name} vs ${world.teams[rid]?.name ?? rid}`, intensity, tr("clásico del circuito"));
    }
  }

  // — Coaches —
  for (const t of Object.values(world.teams)) {
    const before = prev.coachByTeam[t.id];
    if (before != null && before !== t.coachId) {
      push("coach_fired", world.coaches[before]?.name ?? before, 55, tr("destituido en {name}", { name: t.name }));
      if (t.coachId) push("coach_hired", world.coaches[t.coachId]?.name ?? t.coachId, 50, tr("nuevo coach de {name}", { name: t.name }));
    }
  }

  return out;
}
