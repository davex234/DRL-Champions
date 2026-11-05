/**
 * MANAGER CAREER ENGINE · Fase 3 — patrocinadores.
 *
 * Los patrocinadores aparecen según resultados, prestigio, fanbase, región, historial y
 * títulos. Generan ingresos por temporada y pueden EXIGIR objetivos. Determinista. Puro.
 */
import type { ClubView, Sponsor, SponsorTier, SponsorPersonality, ManagerCareer, ClubManagement } from "./types";
import type { Rng } from "./rng";

const TIER_BASE: Record<SponsorTier, number> = { local: 1500, regional: 4000, global: 12000, title: 30000 };

/** Personalidad de un patrocinador: qué le importa y cuánto paga. Fase 5. */
export const SPONSOR_PERSONALITY_LABEL: Record<SponsorPersonality, string> = {
  moneybags: "Inversor (paga más, no exige)",
  results: "Exige resultados deportivos",
  visibility: "Busca visibilidad (fanbase)",
  youth: "Apuesta por la cantera",
  content: "Quiere contenido y streaming",
  titles: "Solo grandes: exige títulos",
};
const PERSONALITY_PAY: Record<SponsorPersonality, number> = { moneybags: 1.3, titles: 1.2, results: 1.05, visibility: 1.0, content: 1.0, youth: 0.95 };
const TIER_PERSONALITIES: Record<SponsorTier, SponsorPersonality[]> = {
  local: ["moneybags", "visibility", "youth", "content"],
  regional: ["moneybags", "visibility", "results", "content"],
  global: ["results", "visibility", "content", "titles"],
  title: ["titles", "results", "moneybags"],
};
const TIER_NAME: Record<SponsorTier, string[]> = {
  local: ["NovaTech", "PixelByte", "GridFoods", "UrbanGear"],
  regional: ["Volt Energy", "ApexWear", "CoreNet", "Zephyr"],
  global: ["Hyperion", "OmniCorp", "Stratos", "Lumen"],
  title: ["TITAN", "Vanguard Global", "EONS", "Imperium"],
};

/** Ingreso anual de un patrocinador (escala con fanbase/prestigio). */
export function sponsorIncome(sponsors: Sponsor[]): number {
  return sponsors.reduce((a, s) => a + s.income, 0);
}

/** ¿A qué nivel de patrocinio puede aspirar el club? */
function maxTier(club: ClubView, career: ManagerCareer): SponsorTier {
  const score = club.prestige * 0.5 + Math.min(40, club.fanbase / 50) + club.titles * 4 + career.stats.titles * 2;
  if (score >= 90) return "title";
  if (score >= 60) return "global";
  if (score >= 35) return "regional";
  return "local";
}

const ORDER: SponsorTier[] = ["local", "regional", "global", "title"];

/** Patrocinadores disponibles para el club (deterministas). Mejores resultados ⇒ mejores. */
export function availableSponsors(club: ClubView, career: ManagerCareer, season: number, rng: Rng): Sponsor[] {
  const top = ORDER.indexOf(maxTier(club, career));
  const out: Sponsor[] = [];
  for (let t = Math.max(0, top - 1); t <= top; t++) {
    const tier = ORDER[t];
    const names = TIER_NAME[tier];
    const name = names[rng.int(0, names.length - 1)];
    const persos = TIER_PERSONALITIES[tier];
    const personality = persos[rng.int(0, persos.length - 1)];
    const income = Math.round(TIER_BASE[tier] * (0.8 + club.prestige / 200 + Math.min(0.6, club.fanbase / 2000)) * (1 + rng.next() * 0.2) * PERSONALITY_PAY[personality]);
    // La exigencia depende de la PERSONALIDAD, no solo del nivel.
    const objectivePosition = personality === "titles" ? 1 : personality === "results" ? Math.ceil(club.totalTeams * 0.34) : tier === "title" ? 1 : 0;
    out.push({
      id: `sponsor:${tier}:${season}:${name}`.replace(/\s+/g, "_"),
      name, tier, income, objectivePosition, years: 1 + rng.int(0, 2), signedSeason: season,
      personality, satisfaction: 60,
    });
  }
  return out;
}

/** Firma un patrocinador (uno por nivel; reemplaza el del mismo nivel). */
export function signSponsor(sponsors: Sponsor[], s: Sponsor): Sponsor[] {
  return [...sponsors.filter((x) => x.tier !== s.tier), s];
}

/**
 * Satisfacción del patrocinador (0..100) según SU personalidad: los de resultados/títulos miran
 * la posición; los de visibilidad, la fanbase; los de cantera, la academia; los de contenido, el
 * alcance mediático; los inversores casi siempre contentos. Fase 5. Determinista.
 */
export function sponsorSatisfaction(
  s: Sponsor,
  ctx: { position: number; totalTeams: number; champion: boolean; fanbase: number; academyCount: number; contentReach: number },
): number {
  const p = s.personality ?? "moneybags";
  const topFrac = 1 - (ctx.position - 1) / Math.max(1, ctx.totalTeams - 1); // 1 = campeón
  switch (p) {
    case "moneybags": return 80;
    case "titles": return ctx.champion ? 100 : ctx.position <= 2 ? 55 : 20;
    case "results": return Math.round(topFrac * 100);
    case "visibility": return Math.round(Math.min(100, ctx.fanbase / 20));
    case "youth": return Math.round(Math.min(100, 40 + ctx.academyCount * 12));
    case "content": return Math.round(Math.min(100, 30 + ctx.contentReach * 70));
  }
}
