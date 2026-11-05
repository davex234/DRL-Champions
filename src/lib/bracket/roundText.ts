/**
 * NOMBRE DE UNA RONDA DE CUADRO, TRADUCIDO AL PINTARLO.
 *
 * El nombre de la ronda llega como DATO en español canónico: lo compone el servidor (`domain/cups/bracket.roundName`,
 * `domain/pickems/format.elimRoundLabel`) y en los Pick'ems queda guardado en el descriptor del cuadro. `td` no sirve
 * para «Final»: es un texto con dos sentidos («partido terminado» en Pick'ems y Eventos, «la final» aquí) y el índice
 * plano de `td` devuelve el del primer módulo que lo tenga. Este módulo («bracket») solo tiene el sentido de RONDA.
 *
 * También recompone las etiquetas de doble eliminación («Final alta», «Semifinales · baja») y «Ronda 2», que el
 * servidor monta por concatenación y no están en ningún catálogo. En español devuelve el dato tal cual.
 */
import { ns, td } from "@/i18n/runtime";

const t = ns("bracket");

export function roundText(label: string): string;
export function roundText(label: string | null | undefined): string | null | undefined;
export function roundText(label: string | null | undefined): string | null | undefined {
  if (!label) return label;
  if (label === "Final") return t("Final");
  if (label === "Final alta") return t("Final alta");
  if (label === "Final baja") return t("Final baja");
  if (label.endsWith(" · alta")) return t("{round} · alta", { round: roundText(label.slice(0, -7)) });
  if (label.endsWith(" · baja")) return t("{round} · baja", { round: roundText(label.slice(0, -7)) });
  const numbered = /^Ronda (\d+)$/.exec(label);
  if (numbered) return t("Ronda {n}", { n: numbered[1] });
  return td(label);
}
