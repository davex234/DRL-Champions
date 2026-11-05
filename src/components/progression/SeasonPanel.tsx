"use client";

/**
 * TEMPORADA (Fase 27). Solo datos reales: nombre e id de `CURRENT_SEASON`, nivel del pase y su
 * XP (lineal, del motor del pase), misiones completadas, y el carril competitivo (se abre por
 * puntos, lo decide el servidor). La temporada NO tiene fechas persistidas: no hay cuenta atrás y
 * se dice. Si algún día `endsAt` llega del servidor, el contador es local y derivado.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { Stage } from "@/components/ui/Surface";
import { remainingLabel } from "@/domain/progression/periods";
import type { MetaSnapshot } from "@/server/services/meta";

export function SeasonPanel({
  season, competitiveUnlocked, points, competitiveMinPoints, serverNow, className,
}: {
  season: MetaSnapshot["season"];
  competitiveUnlocked: boolean;
  points: number;
  competitiveMinPoints: number;
  serverNow: number;
  className?: string;
}) {
  // Contador LOCAL y derivado: el fin lo manda el servidor; aquí solo se resta cada minuto.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (season.endsAt === null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [season.endsAt]);
  const localNow = serverNow + tick * 60_000;
  // Fase 34: terminada según el servidor → no «Termina en 0 min»; la temporada pasa a lectura histórica.
  const ended = season.endsAt !== null && season.endsAt <= serverNow;
  const remaining = season.endsAt !== null && !ended ? remainingLabel(season.endsAt, localNow) : null;
  const done = season.level >= season.maxLevel;

  return (
    <Stage tone="cyan" grid className={`p-5 sm:p-6 ${className ?? ""}`} data-season={season.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="nx-label">Temporada</span>
          <h3 className="mt-0.5 font-display text-[clamp(20px,3vw,28px)] font-bold uppercase leading-none text-white">{season.name}</h3>
          <p className="mt-1.5 text-caption text-ink-muted">
            {ended
              ? "Finalizada · consulta tu resumen en Temporada"
              : remaining
                ? <>Termina en <b className="nx-readout text-white">{remaining}</b></>
                : "Activa · sin fecha de cierre publicada"}
            {season.durationDays !== null && !remaining && <span className="text-ink-faint"> · duración prevista {season.durationDays} días</span>}
          </p>
        </div>
        <Badge tone={done ? "ok" : "info"} dot>{done ? "Pase completado" : "En curso"}</Badge>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
        <Readout size="md" label="Nivel del pase" value={`${season.level} / ${season.maxLevel}`} tone="var(--nx-cyan)" />
        <div>
          <Meter value={season.progress * 100} tone="info" height={8} label={`XP del pase: ${season.xpIntoLevel} de ${season.xpForNext}`} />
          <p className="nx-label mt-1.5">
            {done ? "Todos los niveles alcanzados" : `${season.xpForNext - season.xpIntoLevel} XP de pase para el nivel ${season.level + 1}`}
            <span className="ml-2 text-ink-faint">· {season.missionsCompleted} objetivos completados</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-caption text-ink-secondary">
        {competitiveUnlocked ? (
          <Badge tone="key" dot>Carril competitivo abierto</Badge>
        ) : (
          <span>
            Carril competitivo: te faltan <b className="nx-readout text-drl">{Math.max(0, competitiveMinPoints - points)}</b> puntos de rango.
          </span>
        )}
        <Link href="/logros" className="nx-action">Carriles y reclamos →</Link>
      </div>
    </Stage>
  );
}
