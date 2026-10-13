/**
 * FUENTES DE XP DE CUENTA (Fase 22.1) — declaradas, no inventadas.
 *
 * La XP de CUENTA (el nivel del perfil, `profiles.xp` + `levels.ts`) ya se concede hoy por
 * acciones REALES y desde el SERVIDOR: abrir un sobre (`app_apply_pack_open` suma
 * `xpForCardRank` por carta) y jugar duelos (`duelRewards`, XP de cuenta; también pickems y el
 * bucle de juego). Este módulo NO concede XP: solo LEE esos valores del propio código para poder
 * enseñarlos en `/progresion`. Si alguien cambia una recompensa, este resumen cambia con ella.
 */
import { xpForCardRank } from "./levels";
import { duelPayoutTable } from "./duelRewards";
import { ALL_VARIANTS } from "@/domain/cards/variants";

export interface XpSource {
  id: string;
  label: string;
  /** Descripción de la acción REAL que la concede. */
  hint: string;
  /** Texto ya formateado del rango de XP. */
  amount: string;
  icon: string;
}

/** XP por carta según su rareza (mínimo = común, máximo = la mejor variante). Del propio `xpForCardRank`. */
export function packXpRange(): { min: number; max: number } {
  const ranks = ALL_VARIANTS.map((v) => v.rank);
  const xps = ranks.map((r) => xpForCardRank(r));
  return { min: Math.min(...xps), max: Math.max(...xps) };
}

/** XP de cuenta por ganar un duelo, por dificultad. Del propio `duelPayoutTable`. */
export function duelWinXp(): { easy: number; normal: number; hard: number } {
  const t = duelPayoutTable().win;
  return { easy: t.EASY.xp, normal: t.NORMAL.xp, hard: t.HARD.xp };
}

/**
 * Las fuentes de XP de cuenta, para mostrarlas en `/progresion`. Valores DERIVADOS del código
 * (no escritos a mano), así que no pueden mentir. El orden es de más frecuente a menos.
 */
export function xpSources(): XpSource[] {
  const pack = packXpRange();
  const duel = duelWinXp();
  return [
    {
      id: "pack",
      label: "Abrir sobres",
      hint: "Cada carta suma XP de cuenta según su rareza. Cuanto mejor la carta, más XP.",
      amount: `+${pack.min}–${pack.max} XP de cuenta por carta`,
      icon: "📦",
    },
    {
      id: "duel-win",
      label: "Ganar duelos",
      hint: "Ganar da más XP de cuenta en dificultades más altas.",
      amount: `+${duel.easy} · ${duel.normal} · ${duel.hard} XP de cuenta`,
      icon: "⚔️",
    },
    {
      id: "duel-play",
      label: "Jugar duelos",
      hint: "Empatar o perder también da algo de XP de cuenta por haber jugado.",
      amount: `+${duelPayoutTable().loss.EASY.xp}–${duelPayoutTable().draw.HARD.xp} XP de cuenta`,
      icon: "🎮",
    },
    {
      id: "objectives",
      label: "Reclamar objetivos",
      /* FASE 62 · son OTRA XP: la de temporada (el pase). No suben el nivel de cuenta. */
      hint: "Cada objetivo reclamado suma XP de temporada (el pase) y su recompensa. Los niveles de temporada abren recompensas del carril.",
      amount: "XP de temporada",
      icon: "🏅",
    },
  ];
}
