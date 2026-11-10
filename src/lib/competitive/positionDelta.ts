/**
 * RESULTADO ÚNICO · CAMBIO DE PUESTO EN EL TOP de una partida clasificatoria, guardado en la SESIÓN del navegador.
 *
 * El servidor no guarda historial de posiciones: el cambio solo existe como la diferencia entre dos fotos de la escalera
 * que toma la página PvP (`useLadderPositionDelta`: antes de la partida y tras la liquidación). Antes se enseñaba en el
 * resultado; ahora la página lo deja aquí, asociado a la CUENTA y a la partida, y el centro Competitivo lo enseña una vez.
 *
 * Mismo alcance que antes: mismo navegador y misma sesión (`sessionStorage`). Sin las dos fotos (recarga a mitad de
 * partida, fuera del Top, duelo privado) NO se guarda nada: nunca se inventa un cambio.
 *
 * AISLAMIENTO: la clave lleva la cuenta (`drl:ladder-delta:<usuario>:<partida>`). Dos cuentas que se enfrentaron
 * comparten partida; si la segunda entra en la misma pestaña, NUNCA lee el puesto de la primera. Sin cuenta no hay nada.
 */

export interface PositionDelta {
  /** Puestos ganados (>0), perdidos (<0) o mantenidos (0). */
  positions: number;
  /** Puesto tras la partida. */
  position: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = (userId: string, matchId: string) => `drl:ladder-delta:${userId}:${matchId}`;
const ids = (userId: string | null | undefined, matchId: string): userId is string => !!userId && UUID.test(userId) && UUID.test(matchId);

/** Un cambio es válido solo si las dos cifras son enteros y el puesto es real (≥ 1). */
export function validPositionDelta(x: unknown): x is PositionDelta {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  return Number.isInteger(d.positions) && Number.isInteger(d.position) && (d.position as number) >= 1;
}

/** Lo que la página PvP sabe tras la segunda foto → el cambio a guardar, o `null` si falta un dato. */
export function positionDeltaFrom(ladder: { positions: number | null; after: { position: number | null } } | null | undefined): PositionDelta | null {
  if (!ladder || ladder.positions === null || ladder.after.position === null) return null;
  const d = { positions: ladder.positions, position: ladder.after.position };
  return validPositionDelta(d) ? d : null;
}

export function savePositionDelta(userId: string | null | undefined, matchId: string, d: PositionDelta | null): void {
  if (!d || !ids(userId, matchId) || !validPositionDelta(d)) return;
  try { window.sessionStorage.setItem(KEY(userId, matchId), JSON.stringify({ positions: d.positions, position: d.position })); } catch { /* sin almacenamiento: no hay cambio que enseñar */ }
}

export function readPositionDelta(userId: string | null | undefined, matchId: string): PositionDelta | null {
  if (!ids(userId, matchId)) return null;
  try {
    const raw = window.sessionStorage.getItem(KEY(userId, matchId));
    const d = raw ? (JSON.parse(raw) as unknown) : null;
    return validPositionDelta(d) ? { positions: d.positions, position: d.position } : null;
  } catch { return null; }
}
