/**
 * MATCH NARRATIVE ENGINE — Héroes y villanos.
 *
 * Selecciona protagonistas a partir de los arcos: héroes (mayor impacto, clutchs,
 * dominio, "héroe en la derrota") y villanos (desaparecidos, estrellas que no
 * aparecieron, primeras muertes que costaron rondas, tilt). El "motivo" es una
 * etiqueta estructural derivada, no una frase escrita a mano por partido.
 */
import type { PlayerArc, Standout, TeamId } from "./types";

export function selectStandouts(arcs: PlayerArc[], winner: TeamId | null): {
  heroes: Standout[];
  villains: Standout[];
} {
  const heroes: Standout[] = [];
  const villains: Standout[] = [];

  const ranked = [...arcs].sort((a, b) => b.impactScore - a.impactScore);

  // — Héroes —
  for (const a of ranked.slice(0, 3)) {
    if (a.impactScore <= 0) continue;
    const onLoser = winner != null && a.team !== winner;
    const reason = heroReason(a, onLoser);
    heroes.push({ name: a.name, team: a.team, score: a.impactScore, reason, tags: a.states });
  }
  // Asegura un "héroe en la derrota" si el mejor del bando perdedor destacó mucho.
  if (winner) {
    const bestLoser = ranked.find((a) => a.team !== winner);
    if (bestLoser && bestLoser.impactScore > 0 && !heroes.some((h) => h.name === bestLoser.name)
      && bestLoser.impactScore >= (heroes[0]?.score ?? 0) * 0.7) {
      heroes.push({ name: bestLoser.name, team: bestLoser.team, score: bestLoser.impactScore, reason: "héroe en la derrota", tags: bestLoser.states });
    }
  }

  // — Villanos —
  const scored = arcs.map((a) => ({ a, v: villainScore(a, winner) }))
    .sort((x, y) => y.v - x.v);
  for (const { a, v } of scored.slice(0, 2)) {
    if (v < 14) continue;
    villains.push({ name: a.name, team: a.team, score: Math.round(v), reason: villainReason(a), tags: a.states });
  }

  return { heroes, villains };
}

function heroReason(a: PlayerArc, onLoser: boolean): string {
  if (a.aces > 0) return `${a.aces} ace${a.aces > 1 ? "s" : ""}`;
  if (a.clutchWins > 0) return `${a.clutchWins} clutch${a.clutchWins > 1 ? "s" : ""} ganado${a.clutchWins > 1 ? "s" : ""}`;
  if (onLoser) return "héroe en la derrota";
  if (a.states.includes("dominant")) return "dominó el mapa";
  if (a.multikills >= 2) return `${a.multikills} multikills`;
  if (a.roundsDecisive >= 3) return `${a.roundsDecisive} rondas decisivas`;
  return "rendimiento de alto impacto";
}

function villainScore(a: PlayerArc, winner: TeamId | null): number {
  let v = a.firstDeaths * 6 + a.tiltPeak * 0.18;
  if (a.states.includes("disappeared")) v += 22;
  if (a.states.includes("cold")) v += 8;
  // Estrella esperada que no apareció: muchas muertes, poco impacto.
  if (a.deaths > a.kills + 2) v += 10;
  v -= a.impactScore * 0.12;
  // Pesa más si su equipo perdió (le "costó" el partido).
  if (winner && a.team !== winner) v += 8;
  return v;
}

function villainReason(a: PlayerArc): string {
  if (a.states.includes("disappeared")) return "se desvaneció en el tramo final";
  if (a.states.includes("tilt")) return "entró en tilt";
  if (a.firstDeaths >= 3) return `${a.firstDeaths} primeras muertes`;
  if (a.deaths > a.kills + 2) return "negativo en duelos clave";
  if (a.states.includes("cold")) return "frío todo el partido";
  return "bajo rendimiento";
}
