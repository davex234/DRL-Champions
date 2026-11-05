/**
 * DIRECTIVAS — los objetivos de la organización, que CAMBIAN cada temporada (Fase 6/7).
 *
 * DERIVAN del estado del club (títulos/prestigio/presupuesto/última posición) y de la temporada.
 * Deterministas, nunca aleatorias. PURO. Reutiliza el `WorldState`; no persiste estado nuevo.
 */
import type { WorldState } from "@/world";
import type { Directive } from "./types";

export function clubDirectives(world: WorldState, clubId: string, season: number): Directive[] {
  const t = world.teams[clubId];
  if (!t) return [];
  const last = t.standings[t.standings.length - 1];
  const total = Object.keys(world.teams).length;
  const out: Directive[] = [];

  if (t.titles >= 3 || last?.champion) out.push({ kind: "win_titles", text: "Revalidar el título y ampliar la dinastía", target: 1, priority: 95 });
  else if (t.prestige >= 60) out.push({ kind: "qualify", text: "Clasificar a un torneo internacional (Top 4)", target: Math.ceil(total * 0.34), priority: 78 });
  else out.push({ kind: "develop_youth", text: "Desarrollar la cantera y crecer", target: 2, priority: 65 });

  if (t.budget < 12000) out.push({ kind: "profit", text: "Cerrar la temporada en beneficios", target: 0, priority: 82 });
  if (t.prestige >= 50) out.push({ kind: "expand_brand", text: "Expandir la marca y la afición", target: Math.round(t.fanbase * 1.15), priority: 55 });
  if (t.budget > 30000) out.push({ kind: "sign_star", text: "Fichar una estrella diferencial", target: 1, priority: 68 });

  // Una directiva rota según la paridad de la temporada (varía el foco cada año).
  if (season % 2 === 0 && !out.some((d) => d.kind === "expand_brand")) out.push({ kind: "expand_brand", text: "Año de crecimiento de marca", target: 1, priority: 50 });

  return out.sort((a, b) => b.priority - a.priority).slice(0, 4);
}
