/**
 * LIVE INTEL — HABILIDADES DERIVADAS DE DATOS.
 *
 * Las habilidades de la carta NO son números fijos: emergen de las estadísticas reales
 * (muchos clutch → Clutch, consistente → Consistencia, agresivo → Entrada…). Mismo
 * espíritu que `deriveIdentity` del sim, pero sobre las 6 stats de carta y desacoplado.
 */
import type { PlayerStats } from "@/domain/cards/types";
import { ns } from "@/i18n/runtime";

const t = ns("intel");

export interface Ability { key: string; label: string; value: number }

/** Deriva las habilidades destacadas (top 3) a partir de las 6 stats de la carta. */
export function deriveAbilities(s: PlayerStats): Ability[] {
  const all: Ability[] = [
    { key: "clutch", label: t("Clutch"), value: s.clu },
    { key: "consistency", label: t("Consistencia"), value: s.com },
    { key: "entry", label: t("Entrada"), value: s.dmg },
    { key: "impact", label: t("Impacto"), value: s.scr },
    { key: "aim", label: t("Puntería"), value: s.hs },
    { key: "support", label: t("Apoyo"), value: s.ast },
  ];
  return all.sort((a, b) => b.value - a.value).filter((a) => a.value >= 60).slice(0, 3);
}

/** Etiquetas legibles de las habilidades destacadas (para carta/noticia). */
export const abilityLabels = (s: PlayerStats): string[] => deriveAbilities(s).map((a) => a.label);
