/**
 * VALOR DE MERCADO — el valor de un jugador CAMBIA constantemente (Career Fase 4/7).
 *
 * REUTILIZA `playerValue` del Living World como base (rating·edad·potencial·forma·mental·
 * títulos·mvps) y le añade lo que un mercado de fichajes real considera: contrato restante
 * (poder de negociación del vendedor) y popularidad/marca (fanbase·prestigio del club). NO
 * reimplementa el valor: lo compone. PURO y DETERMINISTA.
 */
import type { WorldPlayer, WorldTeam } from "@/world";
import { playerValue } from "@/world";
import { progress, ageBand } from "@/development";
import type { MarketValue } from "./types";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Valor de mercado enriquecido. `team` (opcional) aporta la marca (popularidad) — un crack en
 * un club enorme vale más por caché. El contrato restante modula el precio (cláusula alta si
 * quedan años; barato si expira).
 */
export function marketValue(p: WorldPlayer, team?: WorldTeam | null): MarketValue {
  const base = playerValue(p);
  const rating = progress(p.dev);
  const band = ageBand(p.dev.age, p.innate);

  // Edad/potencial: refuerzan lo que ya pondera playerValue, con una capa de "proyección".
  const ageMult = band === "joven" ? 1.08 : band === "prime" ? 1.0 : band === "veterano" ? 0.9 : 0.7;
  const potentialMult = 1 + clamp(p.innate.potential - rating, 0, 40) / 200; // margen de mejora

  // Forma reciente (0..100, 50 neutral).
  const formMult = 0.9 + clamp(p.dev.condition.form, 0, 100) / 500;

  // Contrato: años restantes dan poder al vendedor (más caro); expira ⇒ chollo.
  const years = p.contract?.years ?? 0;
  const contractMult = years <= 0 ? 0.55 : years === 1 ? 0.8 : years === 2 ? 1.0 : 1.18;

  // Popularidad/marca: fanbase y prestigio del club actual (o neutro si agente libre).
  const fanbase = team?.fanbase ?? 0;
  const prestige = team?.prestige ?? 40;
  const popularityMult = 1 + clamp(fanbase / 4000 + (prestige - 50) / 250, -0.1, 0.35);

  const value = Math.max(40, Math.round(base * ageMult * potentialMult * formMult * popularityMult));
  const releaseClause = p.contract?.releaseClause && p.contract.releaseClause > 0
    ? Math.round(p.contract.releaseClause)
    : Math.round(value * (band === "joven" ? 2.6 : 2.0));
  const wageDemand = wageFor(value, p.innate.ambition, band);

  return { base, ageMult, potentialMult, formMult, contractMult, popularityMult, value, releaseClause, wageDemand };
}

/** Salario que exige un jugador dado su valor, ambición y banda de edad. */
export function wageFor(value: number, ambition: number, band: string): number {
  const ambPull = 0.10 + (ambition / 100) * 0.08;    // ambiciosos piden más
  const bandMult = band === "prime" ? 1.1 : band === "veterano" ? 1.0 : band === "joven" ? 0.85 : 0.7;
  return Math.max(200, Math.round(value * ambPull * bandMult));
}

/** Precio mínimo al que un vendedor razonable soltaría al jugador (según su estatus). */
export function askingFee(mv: MarketValue, years: number, listed: boolean): number {
  if (listed) return Math.round(mv.value * 0.85);         // en la rampa de salida ⇒ rebaja
  if (years <= 0) return Math.round(mv.value * 0.9);      // contrato acabado ⇒ negociable
  return Math.min(mv.releaseClause, Math.round(mv.value * 1.35)); // pieza clave ⇒ caro
}
