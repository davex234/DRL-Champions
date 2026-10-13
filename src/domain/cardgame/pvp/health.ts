/**
 * F66 · SALUD DEL MULTIJUGADOR (pura). La usa `/admin/system` y el QA de F66 para comprobar invariantes sin datos
 * personales: solo ids técnicos, estados y fechas.
 *
 *   · Partidas vivas COLGADAS: PvP en curso cuyo plazo de turno venció hace más de `graceMs` (el barrido oportunista
 *     debería haberlas cerrado al primer sondeo o alta en cola) o, sin plazo, sin movimiento en `idleMs`.
 *   · Asignación DOBLE: un mismo usuario en dos partidas PvP vivas a la vez (imposible por `_duel_pvp_has_active_match`).
 *   · Autopartida: una fila con el mismo usuario en los dos bandos (imposible por `duel_matches_mode_shape`).
 *   · Cola HUÉRFANA: entrada MATCHED cuya partida no existe, o PAIRING con arrendamiento vencido hace más de `graceMs`.
 */
export interface LiveMatchRow { id: string; user_id: string; player_b_id: string | null; turn_deadline_at: string | null; updated_at: string | null }
export interface QueueRow { id: string; user_id: string; state: string; match_id: string | null; pairing_expires_at: string | null }

export interface MultiplayerHealth {
  level: "HEALTHY" | "WARNING";
  liveMatches: number;
  stale: string[];
  doubleAssigned: number;
  selfMatches: string[];
  orphanQueue: string[];
  stuckPairing: string[];
  detail: string;
}

export function multiplayerHealth(
  live: readonly LiveMatchRow[], queue: readonly QueueRow[], existingMatchIds: ReadonlySet<string>, now: number,
  opts: { graceMs?: number; idleMs?: number } = {},
): MultiplayerHealth {
  const grace = opts.graceMs ?? 5 * 60_000;
  const idle = opts.idleMs ?? 24 * 3600_000;
  const t = (s: string | null) => (s ? Date.parse(s) : NaN);
  const stale = live.filter((m) => (m.turn_deadline_at ? t(m.turn_deadline_at) + grace < now : t(m.updated_at) + idle < now)).map((m) => m.id);
  const count = new Map<string, number>();
  for (const m of live) for (const u of [m.user_id, m.player_b_id]) if (u) count.set(u, (count.get(u) ?? 0) + 1);
  const doubleAssigned = [...count.values()].filter((n) => n > 1).length;
  const selfMatches = live.filter((m) => m.player_b_id !== null && m.player_b_id === m.user_id).map((m) => m.id);
  const orphanQueue = queue.filter((q) => q.state === "MATCHED" && (!q.match_id || !existingMatchIds.has(q.match_id))).map((q) => q.id);
  const stuckPairing = queue.filter((q) => q.state === "PAIRING" && t(q.pairing_expires_at) + grace < now).map((q) => q.id);
  const problems = stale.length + doubleAssigned + selfMatches.length + orphanQueue.length + stuckPairing.length;
  const parts = [
    `${live.length} PvP en curso`,
    stale.length ? `${stale.length} colgada(s)` : null,
    doubleAssigned ? `${doubleAssigned} jugador(es) en dos partidas` : null,
    selfMatches.length ? `${selfMatches.length} autopartida(s)` : null,
    orphanQueue.length ? `${orphanQueue.length} entrada(s) de cola sin partida` : null,
    stuckPairing.length ? `${stuckPairing.length} emparejamiento(s) atascado(s)` : null,
  ].filter(Boolean);
  return { level: problems ? "WARNING" : "HEALTHY", liveMatches: live.length, stale, doubleAssigned, selfMatches, orphanQueue, stuckPairing, detail: parts.join(" · ") };
}
