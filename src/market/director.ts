/**
 * DIRECTOR DEPORTIVO — cada club tiene una filosofía y DECIDE según ella (Career Fase 4/7).
 *
 * Deriva la postura del club (filosofía + agresividad + paciencia + sesgo de cantera) de los
 * datos del mundo (prestigio/presupuesto/fanbase), con el MISMO criterio que `@/career`
 * derivePhilosophy (mismos umbrales), sin duplicar estado. El director acepta/rechaza ventas,
 * exige ventas, declara intransferibles y pide cantera. PURO y DETERMINISTA.
 */
import type { WorldTeam } from "@/world";
import { makeRng, seedOf } from "@/world";
import type { DirectorStance, MarketPhilosophy, ListStatus, SquadNeed } from "./types";

const PHIL_LABEL: Record<MarketPhilosophy, string> = {
  develop_youth: "Cantera y proyecto",
  buy_stars: "Fichar estrellas",
  financial_control: "Control económico",
  long_project: "Proyecto a largo plazo",
  win_now: "Ganar YA",
};

/** Filosofía del club (mismos umbrales que `@/career` derivePhilosophy, derivada del mundo). */
export function philosophyOf(team: WorldTeam): MarketPhilosophy {
  const rng = makeRng(seedOf(team.id, "philo", Math.round(team.prestige)));
  const rich = team.budget > 30000;
  const prestige = team.prestige;
  if (prestige >= 75) return rich ? "win_now" : "buy_stars";
  if (prestige >= 55) return rich ? "buy_stars" : "long_project";
  if (team.budget < 12000) return "financial_control";
  return rng.chance(0.5) ? "develop_youth" : "long_project";
}

/** Postura del director deportivo ante el mercado. */
export function directorStance(team: WorldTeam): DirectorStance {
  const philosophy = philosophyOf(team);
  const aggression = philosophy === "win_now" ? 85 : philosophy === "buy_stars" ? 72 : philosophy === "financial_control" ? 25 : 45;
  const patience = philosophy === "financial_control" ? 82 : philosophy === "long_project" ? 75 : philosophy === "win_now" ? 40 : 60;
  const youthBias = philosophy === "develop_youth" ? 88 : philosophy === "long_project" ? 65 : philosophy === "buy_stars" ? 25 : 40;
  const message =
    philosophy === "win_now" ? "Queremos títulos ya: fichajes contrastados, sin miedo a gastar."
    : philosophy === "buy_stars" ? "Buscamos estrellas que llenen el estadio."
    : philosophy === "financial_control" ? "Cada crédito cuenta: vender bien antes de comprar."
    : philosophy === "develop_youth" ? "Apostamos por la cantera y la proyección."
    : "Construimos un proyecto sólido a varios años.";
  return { philosophy, aggression, patience, youthBias, message: `${PHIL_LABEL[philosophy]} — ${message}` };
}

/**
 * ¿El director acepta VENDER a un jugador a cambio de `fee`? Depende de la filosofía, del
 * estatus (transferible ⇒ sí), de si el jugador es clave y de si la oferta cubre expectativas.
 */
export function directorAcceptsSale(
  stance: DirectorStance,
  status: ListStatus,
  value: number,
  releaseClause: number,
  fee: number,
  isStarterKey: boolean,
): { accept: boolean; reason: string } {
  if (status === "protected") return { accept: false, reason: "Declarado INTRANSFERIBLE por el club." };
  if (fee >= releaseClause) return { accept: true, reason: "Se paga la cláusula: no hay nada que negociar." };
  const floor = status === "listed" || status === "loan_listed"
    ? value * 0.8
    : isStarterKey ? value * (1 + (stance.patience / 100) * 0.4) : value * 0.95;
  if (fee >= floor) return { accept: true, reason: "La oferta cubre las expectativas del club." };
  return { accept: false, reason: `El club pide al menos ${Math.round(floor)} por el jugador.` };
}

/**
 * El director revisa la plantilla y decide qué jugadores poner transferibles / exigir vender
 * (exceso, contratos que expiran, filosofía). Devuelve un mapa de estatus recomendado.
 */
export function directorReview(
  stance: DirectorStance,
  needs: SquadNeed[],
  roster: { id: string; value: number; years: number; happiness: number; age: number; potential: number }[],
): Record<string, ListStatus> {
  const out: Record<string, ListStatus> = {};
  const surplus = needs.find((n) => n.kind === "sell_surplus");
  const sorted = [...roster].sort((a, b) => a.value - b.value); // los más flojos, primero
  for (const p of roster) {
    // Intransferible: joya joven en un club de cantera, o crack en un win_now.
    if ((stance.youthBias > 70 && p.age <= 20 && p.potential >= 85) || (stance.philosophy === "win_now" && p.value > 12000)) {
      out[p.id] = "protected"; continue;
    }
    // Descontento o contrato expirando ⇒ transferible para no perderlo gratis.
    if (p.happiness < 40 || p.years <= 0) { out[p.id] = "listed"; continue; }
    out[p.id] = "normal";
  }
  // Exceso de plantilla ⇒ los más flojos a la rampa de salida.
  if (surplus) for (const p of sorted.slice(0, Math.max(1, roster.length - 6))) if (out[p.id] === "normal") out[p.id] = "listed";
  return out;
}
