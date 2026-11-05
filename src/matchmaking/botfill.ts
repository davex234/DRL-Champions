/**
 * BOT FILL + BACKFILL — completa lados vacíos y sustituye a los que se caen (Online Fase 2/7).
 *
 * Un bot es un `PlayerProfile` determinista; su quinteto se genera al construir el partido
 * reutilizando `buildRivalRoster` (jugadores REALES del catálogo). PURO y DETERMINISTA.
 */
import { makeRng, seedFrom } from "@/sim/rng";
import type { Region } from "@/domain/cards/types";
import type { PlayerProfile } from "./types";
import { defaultProfile } from "./profile";

export function botProfile(seedBase: number, i: number, region: Region, targetMmr: number): PlayerProfile {
  const rng = makeRng(seedFrom(`bot:${seedBase}:${i}`));
  return defaultProfile(`bot-${seedBase}-${i}`, `Bot ${i + 1}`, {
    region, mmr: Math.max(400, Math.round(targetMmr + rng.int(-40, 40))), skill: 45 + rng.int(0, 20), coachRating: 0, roster: null,
  });
}

/** Rellena un lado hasta `target` coaches con bots (bot fill). Devuelve perfiles + nº de bots. */
export function fillSide(humans: PlayerProfile[], target: number, seedBase: number, region: Region, targetMmr: number): { profiles: PlayerProfile[]; bots: number } {
  const profiles = [...humans];
  let bots = 0;
  while (profiles.length < target) { profiles.push(botProfile(seedBase, profiles.length, region, targetMmr)); bots++; }
  return { profiles: profiles.slice(0, target), bots };
}

/** Es un perfil-bot (para no exigirle ready check). */
export function isBot(id: string): boolean { return id.startsWith("bot-"); }
