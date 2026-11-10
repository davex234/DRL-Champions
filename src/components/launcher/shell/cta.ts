/**
 * LAUNCHER — del TONO de una acción al BOTÓN del sistema.
 *
 * El dominio del launcher decide el peso semántico de la acción principal (`GameAction.tone`:
 * instalar es primaria, actualizar es oro, reanudar es cian…). Quién es el botón lo decide el
 * sistema de diseño. Esta tabla es la costura entre las dos cosas, y existe para que ningún
 * componente vuelva a inventarse un botón con degradado propio.
 */
import type { NxButtonAccent, NxButtonVariant } from "@/components/ui/NxButton";
import type { GameAction } from "@/launcher";

export const CTA: Record<GameAction["tone"], { variant: NxButtonVariant; accent?: NxButtonAccent }> = {
  primary: { variant: "primary" },
  gold: { variant: "primary", accent: "gold" },
  cyan: { variant: "primary", accent: "cyan" },
  neutral: { variant: "secondary" },
  danger: { variant: "danger" },
};
