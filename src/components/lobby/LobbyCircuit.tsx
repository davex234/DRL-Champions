"use client";

/**
 * COMMAND CENTER — EL CIRCUITO Y LA ACTIVIDAD.
 *
 * La banda de abajo: lo que ocurre en el competitivo real y lo último que ha pasado en tu
 * cuenta. Es contenido de SEGUIMIENTO, no de acción, y por eso vive debajo del escenario y
 * con la mitad de su peso.
 *
 * ────────────────────────── QUÉ CAMBIA RESPECTO AL VESTÍBULO ANTERIOR ──────────────────────────
 *
 * Antes esto eran TRES bloques apilados —el circuito, una tabla de clasificación de cinco
 * filas y un panel de «última recompensa»— que juntos ocupaban dos pantallas y convertían
 * el final del vestíbulo en un cuadro de mando. Aquí es una sola banda: el circuito manda,
 * y la clasificación y la recompensa quedan como dos lecturas cortas a su derecha, cada una
 * con su enlace a la pantalla que sí las desarrolla.
 *
 * No se pierde nada: se deja de competir con «JUGAR».
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Readout } from "@/components/ui/Readout";
import { RankEmblem } from "@/components/progression/RankEmblem";
import { DemoBadge } from "@/components/ui/States";
import { rankProgress } from "@/domain/progression/rank";
import { formatCredits, cn } from "@/lib/format";

export interface CircuitMatch {
  id: string;
  teamA: string;
  teamB: string;
  live: boolean;
  when: string;
}

export interface CircuitRankRow {
  id: string;
  username: string;
  avatar: string;
  points: number;
  isMe: boolean;
}

export function LobbyCircuit({
  tournament, matches, pickem, ranking, reward, live = null,
}: {
  tournament: { id: string; name: string; demo: boolean } | null;
  /** Fase 30 · estado REAL del evento (derivado de sus partidos): etiqueta y cuántos partidos hay en directo. */
  live?: { label: string; lifecycle: "UPCOMING" | "ACTIVE" | "COMPLETED"; liveCount: number; nextWhen: string | null } | null;
  matches: CircuitMatch[];
  /** Predicciones abiertas y pendientes. `null` si el torneo no tiene Pick'em. */
  pickem: { open: number; pending: number } | null;
  ranking: CircuitRankRow[];
  /** La última recompensa cobrada. `null` sin sesión o sin recompensas. */
  reward: { label: string; credits: number; date: string; total: number } | null;
}) {
  if (!tournament && ranking.length === 0 && !reward) return null;

  return (
    <section aria-label="El circuito" className="grid gap-3 lg:grid-cols-[1.6fr_minmax(0,1fr)]">
      {tournament ? (
        <Plate className="relative overflow-hidden p-5 sm:p-6">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{ background: "radial-gradient(520px 240px at 6% 110%, rgba(255,138,61,0.15), transparent 66%)" }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warn">El circuito</Badge>
            {live && <Badge tone={live.liveCount > 0 ? "key" : live.lifecycle === "ACTIVE" ? "info" : "muted"} dot pulse={live.liveCount > 0}>{live.liveCount > 0 ? "En directo" : live.label}</Badge>}
            {tournament.demo && <DemoBadge />}
          </div>
          <h2 className="mt-2 font-display text-[clamp(20px,3vw,30px)] font-bold uppercase leading-tight text-white">
            {tournament.name}
          </h2>
          <p className="mt-2 max-w-lg text-caption leading-relaxed text-ink-muted">
            {pickem
              ? pickem.open === 0
                ? "Las predicciones de este torneo están cerradas."
                : pickem.pending > 0
                  ? `Te ${pickem.pending === 1 ? "queda 1 predicción" : `quedan ${pickem.pending} predicciones`} por hacer de ${pickem.open} ${pickem.open === 1 ? "abierta" : "abiertas"}.`
                  : `Ya has respondido las ${pickem.open} predicciones abiertas.`
              : "Sigue el competitivo, predice los resultados y colecciona a los profesionales."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2.5">
            {pickem && pickem.open > 0 && (
              <NxButton variant="primary" size="md" href="/pickems">
                Hacer mis predicciones
              </NxButton>
            )}
            <NxButton
              variant={pickem && pickem.open > 0 ? "secondary" : "primary"}
              size="md"
              href={`/torneos/${tournament.id}`}
            >
              Entrar al evento
            </NxButton>
          </div>

          {matches.length > 0 && (
            <ul className="mt-5 grid gap-1.5 border-t border-edge pt-4">
              {matches.map((m) => (
                <li key={m.id} className="flex min-h-[36px] items-center gap-3 text-caption">
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="min-w-0 flex-1 truncate text-right text-ink-secondary">{m.teamA}</span>
                    <span className="shrink-0 font-display text-[11px] font-bold text-ink-faint">VS</span>
                    <span className="min-w-0 flex-1 truncate text-ink-secondary">{m.teamB}</span>
                  </span>
                  <span className="hidden w-[92px] shrink-0 text-right sm:block">
                    {m.live ? <Badge tone="key" dot pulse>En vivo</Badge> : <span className="text-ink-faint">{m.when}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Plate>
      ) : (
        <Plate className="grid place-items-center p-8 text-center">
          <div>
            <p className="font-display text-label uppercase tracking-wide2 text-ink-faint">El circuito</p>
            <p className="mt-2 max-w-[34ch] text-caption text-ink-muted">
              No hay torneos publicados ahora mismo. Cuando empiece el siguiente aparecerá aquí,
              con sus predicciones.
            </p>
          </div>
        </Plate>
      )}

      <div className="grid gap-3 content-start">
        {ranking.length > 0 && (
          <Plate className="p-4">
            <SectionTitle
              as="h3"
              /*
                FASE 12 · `nx-action`, la pieza compartida de la acción de sección. Estaba
                escrita a mano con utilidades y medía 41 × 12 px: el fallo que `ux:verify`
                arrastraba desde la Fase 8. Mismo texto, mismo destino, misma tipografía.
              */
              action={<Link href="/ranking" className="nx-action">Ver todo</Link>}
            >
              Mejores pronosticadores
            </SectionTitle>
            <ol className="grid gap-1">
              {ranking.slice(0, 3).map((r, i) => (
                <li
                  key={r.id}
                  className={cn(
                    "nx-clip-sm flex min-h-[36px] items-center gap-2.5 px-2",
                    r.isMe && "bg-drl/[0.10]",
                  )}
                >
                  <span
                    className={cn(
                      "w-4 text-center font-display text-caption font-bold tabular-nums",
                      i === 0 ? "text-drl-gold" : i === 1 ? "text-ink-secondary" : "text-rarity-bronze",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span aria-hidden className="text-body">{r.avatar}</span>
                  <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">
                    {r.username}
                    {r.isMe && <span className="ml-1.5 font-display text-[10px] uppercase text-drl">tú</span>}
                  </span>
                  <RankEmblem
                    tierId={rankProgress(r.points).tier.id}
                    color={rankProgress(r.points).tier.color}
                    size={18}
                    className="shrink-0 opacity-80"
                  />
                  <Readout size="xs" value={r.points} tone="var(--nx-gold)" align="right" className="w-11" />
                </li>
              ))}
            </ol>
          </Plate>
        )}

        {reward && (
          <Plate className="p-4">
            <SectionTitle
              as="h3"
              action={<Link href="/recompensas" className="nx-action">Ver todo</Link>}
            >
              Última recompensa
            </SectionTitle>
            <div className="flex items-center gap-3">
              <span aria-hidden className="text-h3">🎁</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-caption font-bold uppercase tracking-label text-white">
                  {reward.label}
                </p>
                <p className="text-caption text-ink-faint">
                  {reward.credits > 0 ? `🪙 ${formatCredits(reward.credits)} · ` : ""}
                  {reward.date}
                </p>
              </div>
              <Readout size="xs" value={reward.total} label="Total" align="right" tone="var(--nx-ok)" />
            </div>
          </Plate>
        )}
      </div>
    </section>
  );
}
