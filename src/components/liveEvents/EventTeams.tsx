"use client";

/**
 * EQUIPOS DEL EVENTO (Fase 30). Participantes REALES (ids vistos en los partidos): identidad
 * verificada si existe y no es ambigua (nunca se fusiona ni se adivina), récord derivado solo de
 * partidos con ganador escrito, estado en el evento solo si `standings` lo dice, jugadores
 * vinculados y el sobre del equipo SOLO si está ACTIVE.
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { TeamView } from "@/server/services/liveEvents";
import { TeamName } from "./bits";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("liveEvents");

export function EventTeams({ teams, onPackCta }: { teams: TeamView[]; onPackCta?: () => void }) {
  useLocale();
  return (
    <section id="equipos" aria-label={tr("Equipos")} data-testid="event-teams" data-count={teams.length}>
      <SectionTitle>{tr("Equipos")} <span className="ml-2 text-ink-faint">({teams.length})</span></SectionTitle>
      {teams.length === 0 ? (
        <Plate className="px-4 py-4 text-caption text-ink-muted">{tr("Los participantes aparecerán cuando se publiquen los partidos.")}</Plate>
      ) : (
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((t) => (
            <li key={t.id}>
              <Plate className="flex h-full flex-col gap-2 px-3 py-3" data-team={t.id} data-verified={t.identity?.verified ? "yes" : "no"}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center bg-white/[0.06] font-display text-[11px] font-bold text-white/80">{(t.identity?.tag ?? t.tag ?? t.name.slice(0, 3)).slice(0, 3).toUpperCase()}</span>
                    <TeamName name={t.name} identity={t.identity} className="truncate text-[14px] text-white" />
                  </span>
                  {t.eventStatus && <Badge tone={t.eventStatus === "qualified" ? "ok" : "muted"}>{t.eventStatus === "qualified" ? tr("Clasificado") : tr("Eliminado")}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/50">
                  {t.region && <span>{td(t.region)}</span>}
                  {t.record && t.record.played > 0 ? <span className="tabular-nums text-white/75">{t.record.wins}–{t.record.losses}</span> : <span>{tr("Sin resultados")}</span>}
                  {t.players > 0 && <span>{t.players} {t.players === 1 ? tr("jugador") : tr("jugadores")}</span>}
                </div>
                {t.pack && (
                  <Link href={`/packs/${t.pack.id}`} onClick={onPackCta} className="nx-focus nx-clip-sm mt-auto inline-flex min-h-[44px] items-center justify-center border border-drl-gold/50 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-gold transition hover:bg-drl-gold/10" data-pack={t.pack.id}>
                    {tr("Ver sobre del equipo")}
                  </Link>
                )}
              </Plate>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
