/**
 * FASE 44 · XP QUE SE VE SUBIR — presentación pura.
 *
 * La barra anima desde el valor ANTERIOR REAL hasta el NUEVO REAL. Las dos cifras salen del servidor
 * (`xp` total tras la partida y `award.xp`); aquí solo se trocea el recorrido por niveles con la curva canónica
 * (`levelFromXp`). Si la partida cruza uno o varios niveles, cada nivel es un tramo y se anuncia SUBIDA DE NIVEL
 * con el nivel final real. Nada de valores intermedios inventados: los tramos son porcentajes de barra, no cifras.
 */
import { levelFromXp } from "@/domain/progression/levels";

export interface XpSegment {
  level: number;
  /** 0..1 dentro de ese nivel. */
  from: number;
  to: number;
}

export interface XpTimeline {
  before: { xp: number; level: number; progress: number };
  after: { xp: number; level: number; progress: number; xpIntoLevel: number; xpForNext: number };
  gained: number;
  segments: XpSegment[];
  levelsGained: number;
  levelUp: boolean;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/**
 * `xpAfter` = XP total real tras la partida; `gained` = XP real otorgada. Entradas imposibles (negativas, NaN,
 * ganancia mayor que el total) se recortan: la barra nunca baja ni sale de su canal.
 */
export function xpTimeline(xpAfter: number, gained: number): XpTimeline {
  const after = Math.max(0, Math.floor(Number.isFinite(xpAfter) ? xpAfter : 0));
  const g = Math.max(0, Math.min(after, Math.floor(Number.isFinite(gained) ? gained : 0)));
  const before = after - g;
  const b = levelFromXp(before);
  const a = levelFromXp(after);
  const segments: XpSegment[] = [];
  if (g === 0) {
    segments.push({ level: a.level, from: clamp01(a.progress), to: clamp01(a.progress) });
  } else if (a.level === b.level) {
    segments.push({ level: a.level, from: clamp01(b.progress), to: clamp01(a.progress) });
  } else {
    segments.push({ level: b.level, from: clamp01(b.progress), to: 1 });
    for (let lv = b.level + 1; lv < a.level; lv++) segments.push({ level: lv, from: 0, to: 1 });
    segments.push({ level: a.level, from: 0, to: clamp01(a.progress) });
  }
  return {
    before: { xp: before, level: b.level, progress: clamp01(b.progress) },
    after: { xp: after, level: a.level, progress: clamp01(a.progress), xpIntoLevel: a.xpIntoLevel, xpForNext: a.xpForNext },
    gained: g,
    segments,
    levelsGained: a.level - b.level,
    levelUp: a.level > b.level,
  };
}

/** Duración total de la animación de la barra: acotada (≤ 1,2 s) aunque se crucen muchos niveles. */
export function xpAnimationMs(t: XpTimeline, reduced: boolean): number {
  if (reduced || t.gained === 0) return 0;
  return Math.min(1200, 380 + 260 * (t.segments.length - 1));
}
