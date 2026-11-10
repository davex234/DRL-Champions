"use client";

/**
 * RESULTADO ÚNICO · LO QUE LA ÚLTIMA CLASIFICATORIA LE HIZO A TU RANGO Y A TU PUESTO, en el centro Competitivo.
 *
 * El resultado del duelo ya no lo enseña. Aquí, UNA VEZ por cuenta y partida:
 *   · la CEREMONIA de rango (`RankChange`: colocación, rango obtenido, ascenso, descenso o misma división), con el
 *     movimiento que el servidor deriva del ASIENTO de la última partida (`snap.lastRanked`; aquí no se calcula nada);
 *   · el CAMBIO DE PUESTO («Subes 5 puestos en el Top (#9)») que la página PvP dejó en la sesión del navegador a partir de
 *     sus dos fotos de la escalera, para ESTA cuenta. Sin ese dato no se pinta ningún cambio.
 *
 * «Ya visto»: el de la ceremonia, por cuenta (`drl:rank-ceremony:<usuario>:<partida>`). Se decide en el navegador tras
 * montar (en servidor y tests no hay `window`: no se pinta nada) y se marca al enseñarlo, también con movimiento reducido.
 * Sin cuenta conocida no se enseña nada. Una partida demasiado antigua no se celebra en otro dispositivo.
 */
import { useEffect, useState } from "react";
import type { RankMovement } from "@/domain/ranked/standing";
import { readPositionDelta, type PositionDelta } from "@/lib/competitive/positionDelta";
import { RankChange, markRankCeremonySeen, rankCeremonySeen } from "./RankChange";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("competitive");

/** Una ceremonia más vieja que esto ya no está «pendiente» (p. ej. al entrar por primera vez desde otro dispositivo). */
export const LAST_RANKED_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export interface LastRanked { matchId: string; at: number; movement: RankMovement }

/** Pura: ¿se enseña? Solo si existe, no está vista, no es vieja y el movimiento tiene algo que contar. */
export function shouldShowLastRanked(last: LastRanked | null | undefined, now: number, seen: (matchId: string) => boolean): boolean {
  if (!last || last.movement.kind === "UNSEASONED") return false;
  if (!Number.isFinite(last.at) || now - last.at > LAST_RANKED_MAX_AGE_MS || now - last.at < -60_000) return false;
  return !seen(last.matchId);
}

export function LastRankedResult({ last, serverNow, userKey, className }: {
  last: LastRanked | null | undefined;
  serverNow: number;
  /** Cuenta de la sesión: la marca «ya vista» y el cambio de puesto son SUYOS. Sin cuenta, nada. */
  userKey: string | null | undefined;
  className?: string;
}) {
  useLocale();
  const [shown, setShown] = useState<{ userKey: string; matchId: string; delta: PositionDelta | null } | null>(null);

  useEffect(() => {
    if (!userKey || !last || !shouldShowLastRanked(last, serverNow, (m) => rankCeremonySeen(userKey, m))) { setShown(null); return; }
    setShown({ userKey, matchId: last.matchId, delta: readPositionDelta(userKey, last.matchId) });
  }, [last, serverNow, userKey]);

  // Se marca DESPUÉS de montar la ceremonia: su primer render ya decidió si anima.
  useEffect(() => { if (shown) markRankCeremonySeen(shown.userKey, shown.matchId); }, [shown]);

  if (!shown || !last || shown.userKey !== userKey || last.matchId !== shown.matchId) return null;
  return (
    <section aria-label={tr("Tu última partida clasificatoria")} data-testid="last-ranked" data-match={shown.matchId} className={className}>
      <RankChange movement={last.movement} matchId={shown.matchId} positions={shown.delta?.positions ?? null} position={shown.delta?.position ?? null} className="!mt-0" />
    </section>
  );
}
