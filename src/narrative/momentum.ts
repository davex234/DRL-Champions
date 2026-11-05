/**
 * MATCH NARRATIVE ENGINE — Momentum e inflexión.
 *
 * El momentum es una media exponencial de los resultados de ronda (con un matiz por
 * el dominio de bajas dentro de la ronda), en [-100 (control de B), +100 (control de
 * A)]. Los "shifts" marcan cuándo cambia el control; el punto de inflexión es la
 * ronda que más voltea la balanza hacia el ganador final.
 */
import type { MomentumPoint, MomentumShift, TeamId } from "./types";
import type { RoundRecord } from "./memory";

const DECAY = 0.6;
const DEADZONE = 18;

export function computeMomentum(records: RoundRecord[]): {
  series: MomentumPoint[];
  shifts: MomentumShift[];
} {
  const series: MomentumPoint[] = [];
  const shifts: MomentumShift[] = [];
  let value = 0;
  let prevControl: TeamId | null = null;

  for (const r of records) {
    const toA = r.winner === "A" ? 1 : -1;
    const raw = toA * 70 + toA * Math.min(20, r.killDiffWinner) * 1.5;
    value = DECAY * value + (1 - DECAY) * raw;
    value = Math.max(-100, Math.min(100, value));
    const control: TeamId | null = value > DEADZONE ? "A" : value < -DEADZONE ? "B" : null;
    series.push({ round: r.round, value: Math.round(value), control });

    const prev = series.length >= 2 ? series[series.length - 2].value : 0;
    const delta = value - prev;
    const gained: TeamId = delta >= 0 ? "A" : "B";
    const controlChanged = control != null && control !== prevControl;
    if ((controlChanged || Math.abs(delta) >= 40) && Math.abs(delta) >= 18) {
      shifts.push({
        round: r.round, from: prevControl, to: control ?? gained,
        magnitude: Math.round(Math.min(100, Math.abs(delta))),
        cause: dominantCause(r, control ?? gained),
      });
    }
    if (control != null) prevControl = control;
  }
  return { series, shifts };
}

/** Id del evento más importante de la ronda que beneficia al equipo `to`. */
function dominantCause(r: RoundRecord, to: TeamId): string | null {
  let best: string | null = null;
  let bestImp = -1;
  for (const e of r.events) {
    if (e.favors !== to) continue;
    if (e.type === "kill" || e.type === "round_win") continue;
    if (e.importance > bestImp) { bestImp = e.importance; best = e.id; }
  }
  return best;
}

/**
 * Punto de inflexión: la ronda R que maximiza el salto de momentum medio (después −
 * antes) hacia el GANADOR final. Devuelve la ronda o null.
 */
export function findInflection(
  series: MomentumPoint[], winner: TeamId | null,
): { round: number; magnitude: number } | null {
  if (!winner || series.length < 4) return null;
  const sign = winner === "A" ? 1 : -1;
  let best: { round: number; magnitude: number } | null = null;
  for (let i = 1; i < series.length - 1; i++) {
    const before = avg(series.slice(0, i).map((p) => p.value));
    const after = avg(series.slice(i).map((p) => p.value));
    const swing = sign * (after - before);
    if (!best || swing > best.magnitude) best = { round: series[i].round, magnitude: Math.round(swing) };
  }
  return best && best.magnitude > 12 ? best : null;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
