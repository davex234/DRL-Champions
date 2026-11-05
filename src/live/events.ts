import { ns } from "@/i18n/runtime";

const t = ns("live");

/**
 * LIVE ECOSYSTEM — EVENTOS automáticos del universo.
 *
 * Hechos detectables del flujo (torneo finalizado, campeón, MVP, debut, traspaso, ACE
 * histórico…) que producen contenido (noticias/desafíos). PUROS: el orquestador los
 * construye con datos ya resueltos (no vuelve a la fuente). Sin duplicar lógica.
 */
export type EcoEventType =
  | "tournament_finished" | "champion" | "mvp" | "debut" | "transfer" | "historic_ace" | "big_performance";

export interface EcoEvent {
  id: string;
  type: EcoEventType;
  at: number;
  season: number;
  tournamentId: string;
  tournamentName: string;
  player?: string;
  team?: string;
  detail: string;
  magnitude: number; // 0..100
}

const ev = (e: Omit<EcoEvent, "id">): EcoEvent => ({
  id: `evt:${e.type}:${e.tournamentId}:${e.player ?? e.team ?? "x"}`.replace(/\s+/g, "_").toLowerCase(),
  ...e,
});

export const tournamentFinished = (tId: string, name: string, season: number, at: number): EcoEvent =>
  ev({ type: "tournament_finished", tournamentId: tId, tournamentName: name, season, at, detail: `${name} ha finalizado`, magnitude: 60 });
export const championEvent = (tId: string, name: string, season: number, team: string, at: number): EcoEvent =>
  ev({ type: "champion", tournamentId: tId, tournamentName: name, season, team, at, detail: t("{team}, campeón de {name}", { team, name }), magnitude: 95 });
export const mvpEvent = (tId: string, name: string, season: number, player: string, at: number): EcoEvent =>
  ev({ type: "mvp", tournamentId: tId, tournamentName: name, season, player, at, detail: t("{player}, MVP de {name}", { player, name }), magnitude: 90 });
export const debutEvent = (tId: string, name: string, season: number, player: string, at: number): EcoEvent =>
  ev({ type: "debut", tournamentId: tId, tournamentName: name, season, player, at, detail: t("{player} debuta en {name}", { player, name }), magnitude: 55 });
export const transferEvent = (tId: string, name: string, season: number, player: string, team: string, at: number): EcoEvent =>
  ev({ type: "transfer", tournamentId: tId, tournamentName: name, season, player, team, at, detail: t("{player} ficha por {team}", { player, team }), magnitude: 70 });
export const historicAce = (tId: string, name: string, season: number, player: string, at: number, magnitude = 85): EcoEvent =>
  ev({ type: "historic_ace", tournamentId: tId, tournamentName: name, season, player, at, detail: t("{player} firma una actuación histórica", { player }), magnitude });
