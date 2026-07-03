/**
 * DASHBOARD DE LEGACY — compone TODO el ecosistema en un DTO plano (Career Fase 6/7).
 *
 * Solo LEE del `WorldState` y de los motores puros (clubLegacy/brand/directives/rivalries/
 * hallOfFame/economy/competitions/media/social). La UI solo pinta. PURO. Determinista.
 */
import type { WorldState } from "@/world";
import type { LegacyDashboard } from "./types";
import { clubLegacy } from "./clubLegacy";
import { hallOfFame } from "./hallOfFame";
import { brandOf } from "./brand";
import { clubDirectives } from "./directives";
import { rivalriesOf } from "./rivalries";
import { globalEconomy } from "./economy";
import { deriveCompetitions } from "./competitions";
import { mediaDigest } from "./media";
import { socialTrends } from "./social";

export function legacyDashboard(world: WorldState, clubId: string): LegacyDashboard {
  const legacy = clubLegacy(world, clubId);
  const brand = brandOf(world, clubId);
  const rankPos = world.rankings.teams.findIndex((r) => r.id === clubId);
  const worldValue = Math.round(brand.commercialValue + legacy.trophies * 2000 + (world.teams[clubId]?.prestige ?? 0) * 500);
  return {
    clubLegacy: legacy,
    brand,
    directives: clubDirectives(world, clubId, world.season),
    rivalries: rivalriesOf(world, clubId),
    worldRankPos: rankPos >= 0 ? rankPos + 1 : world.rankings.teams.length,
    worldRankTotal: Object.keys(world.teams).length,
    hallOfFame: hallOfFame(world),
    economy: globalEconomy(world),
    competitions: deriveCompetitions(world),
    media: mediaDigest(world),
    social: socialTrends(world),
    worldValue,
  };
}
