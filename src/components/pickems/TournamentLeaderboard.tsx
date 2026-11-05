"use client";

/**
 * CLASIFICACIÓN DEL TORNEO — dentro de la experiencia de Pick'ems (Fase 24.1).
 *
 * ────────────────────────── QUÉ CIERRA ──────────────────────────
 *
 * El bucle de Pick'ems termina en CLASIFICACIÓN, pero hasta ahora esa tabla solo vivía en
 * `/ranking` y en la ficha del torneo: desde la pantalla donde predices no se veía contra
 * quién compites. Esto la trae aquí, para el evento activo, sin sistema nuevo.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * No calcula ni un punto. Lee la MISMA vista server-authoritative que `/ranking`
 * (`ranking_pickem_event`, vía `fetchTournamentRanking`), que ordena por `points` que solo
 * escribe el corrector (`app_score_pickem_event`). El navegador no ordena, no suma y no
 * declara posiciones: pinta filas ya resueltas. No expone dato privado alguno: solo el
 * nick y el avatar públicos, los puntos y los aciertos, que ya son de lectura pública por RLS.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchTournamentRanking, type TournamentRankingRow } from "@/lib/game/client";
import { Plate } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Loading, EmptyState } from "@/components/ui/States";
import { formatCredits } from "@/lib/format";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

/** Miles con el mismo formato que el resto del juego (puntos, no créditos). */
const fmt = (n: number) => formatCredits(n);

/** Cuántas filas se enseñan aquí; la tabla completa está en `/ranking`. */
const TOP = 10;

export function TournamentLeaderboard({
  pickemEventId, currentUserId, rows: given, className,
}: {
  pickemEventId: string;
  currentUserId?: string;
  /**
   * Filas ya cargadas por el contenedor (Fase 24.2: `usePickem` las trae con el resto del
   * torneo). Si vienen, no se vuelve a pedir la vista; si no, se pide aquí como en la 24.1.
   */
  rows?: TournamentRankingRow[] | null;
  className?: string;
}) {
  useLocale();
  const [fetched, setFetched] = useState<TournamentRankingRow[] | null>(null);

  useEffect(() => {
    if (given !== undefined) return;
    let alive = true;
    setFetched(null);
    fetchTournamentRanking(pickemEventId)
      .then((r) => { if (alive) setFetched(r); })
      .catch(() => { if (alive) setFetched([]); });
    return () => { alive = false; };
  }, [pickemEventId, given]);

  const rows = given !== undefined ? given : fetched;

  return (
    <section className={className ?? "mt-4"} aria-label={t("Clasificación del torneo")}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionTitle as="h2">{t("Clasificación del torneo")}</SectionTitle>
        <Link href="/ranking" className="nx-focus text-[13px] text-drl underline-offset-2 hover:underline">
          {t("Ver clasificación completa →")}
        </Link>
      </div>

      {rows === null ? (
        <Loading label={t("Cargando la clasificación")} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🏆"
          title={t("Todavía sin clasificación")}
          hint={t("Aparecerá en cuanto se corrijan las primeras predicciones de este torneo.")}
        />
      ) : (
        <LeaderboardTable rows={rows} currentUserId={currentUserId} />
      )}
    </section>
  );
}

/**
 * La tabla, presentación pura (separada para poder probarla sin red). Marca tu fila con
 * texto —«tú»—, no solo con color, y usa `tabular-nums` para que las columnas cuadren.
 */
export function LeaderboardTable({
  rows, currentUserId,
}: {
  rows: TournamentRankingRow[];
  currentUserId?: string;
}) {
  useLocale();
  const top = rows.slice(0, TOP);
  const myIndex = rows.findIndex((r) => r.user_id === currentUserId);
  const meBelow = myIndex >= TOP ? { row: rows[myIndex], position: myIndex + 1 } : null;

  return (
    <ol className="space-y-2" aria-label={t("Mejores pronosticadores del torneo")}>
      {top.map((r, i) => (
        <LeaderRow key={r.user_id} position={i + 1} row={r} isMe={r.user_id === currentUserId} />
      ))}
      {meBelow && (
        <>
          <li aria-hidden className="py-1 text-center text-[12px] text-white/25">···</li>
          <LeaderRow position={meBelow.position} row={meBelow.row} isMe />
        </>
      )}
    </ol>
  );
}

function LeaderRow({ position, row, isMe }: { position: number; row: TournamentRankingRow; isMe?: boolean }) {
  useLocale();
  const podium = position <= 3;
  return (
    <li>
      <Plate
        tone={isMe ? "primary" : podium ? "gold" : "neutral"}
        className="flex items-center gap-3 px-4 py-2.5"
      >
        <span
          className="nx-clip-sm grid h-9 w-10 shrink-0 place-items-center border font-display text-[14px] font-bold tabular-nums"
          style={{
            borderColor: podium ? "rgba(255,211,92,0.45)" : "rgba(255,255,255,0.1)",
            background: podium ? "rgba(255,211,92,0.1)" : "rgba(255,255,255,0.03)",
            color: position === 1 ? "#ffd35c" : position === 2 ? "#c8d2dc" : position === 3 ? "#cd7f32" : "rgba(255,255,255,0.5)",
            ["--nx-chamfer-sm" as string]: "7px",
          }}
        >
          {position}
        </span>
        <span className="nx-clip-sm grid h-10 w-10 shrink-0 place-items-center bg-base-800 text-lg" aria-hidden>
          {row.avatar}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display font-bold text-white">
            {row.username}
            {isMe && <span className="ml-2 text-xs font-normal text-drl">{t("tú")}</span>}
          </span>
          <span className="block text-[11px] text-white/40">{row.correct}/{row.total} {t("aciertos")}</span>
        </span>
        <span className="nx-readout shrink-0 text-[16px] tabular-nums text-drl-gold">
          {fmt(row.points)} <span className="text-[10px] text-white/40">{t("pts")}</span>
        </span>
      </Plate>
    </li>
  );
}
