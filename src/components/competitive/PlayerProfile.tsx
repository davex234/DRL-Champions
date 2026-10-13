"use client";

/**
 * PERFIL COMPETITIVO PÚBLICO (Fase 28). Solo lo que la escalera ya hace público: nombre, avatar,
 * rating y posición (si ha jugado), récord, winrate, forma reciente, sus últimas partidas (sin
 * cartas) y el cara a cara con quien mira. NUNCA su mazo actual, ni cartas no jugadas, ni correo.
 */
import { playerHref } from "@/lib/player/href";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { Plate, Stage } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { OUTCOME_LABEL, PLACEMENT_GAMES } from "@/domain/pvpLadder/ladder";
import type { CompetitivePlayerView } from "@/server/services/competitive";
import { RecentForm } from "./RecentForm";
import { outcomeTone } from "./MatchHistoryList";

const fmt = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

export function PlayerProfile({ view, isSelf, social }: { view: CompetitivePlayerView; isSelf: boolean; social?: React.ReactNode }) {
  const r = view.rating;
  return (
    <div className="space-y-6" data-scene="player-profile" data-player={view.player.userId}>
      <Stage tone="cyan" grid className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span aria-hidden className="grid h-16 w-16 place-items-center rounded-full bg-white/[0.06] text-3xl">{view.player.avatar}</span>
            <div>
              <span className="nx-label">Perfil competitivo{isSelf ? " · tú" : ""}</span>
              <h1 className="font-display text-[clamp(24px,4vw,36px)] font-bold uppercase leading-none text-white">{view.player.username}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                {r?.provisional && <Badge tone="warn" dot>Provisional · {r.gamesPlayed} / {PLACEMENT_GAMES}</Badge>}
                {!r || r.gamesPlayed === 0 ? <Badge tone="muted">Sin clasificar</Badge> : null}
              </div>
            </div>
          </div>
          <div className="flex gap-6">
            <Readout size="md" label="Rating" value={r ? r.rating : "—"} tone="var(--nx-cyan)" />
            <Readout size="md" label="Posición" value={view.position !== null ? `#${view.position}` : "—"} />
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-[auto_auto_auto_1fr] sm:items-end">
          <Readout size="sm" label="Récord" value={`${view.stats.wins}–${view.stats.losses}${view.stats.draws > 0 ? `–${view.stats.draws}` : ""}`} tone="var(--nx-ok)" />
          <Readout size="sm" label="Winrate" value={view.stats.winrate !== null ? `${view.stats.winrate} %` : "—"} />
          <Readout size="sm" label="Partidas" value={view.stats.matches} />
          <RecentForm form={view.stats.form} streak={view.stats.streak} />
        </div>
      </Stage>

      {/* FASE 29 · acciones sociales (amigo, reto, bloqueo) y cara a cara RANKED/PRIVADO/TOTAL. Lo trae la página. */}
      {social}

      {view.h2h && (
        <Plate className="p-4" data-h2h={`${view.h2h.wins}-${view.h2h.losses}-${view.h2h.draws}`}>
          <span className="nx-label">Cara a cara contigo</span>
          {view.h2h.matches === 0 ? (
            <p className="mt-1 text-caption text-ink-muted">Todavía no os habéis enfrentado.</p>
          ) : (
            <p className="mt-1 text-body text-white">
              <b className="nx-readout text-[22px] text-ok">{view.h2h.wins}</b>
              <span className="text-white/35"> – </span>
              <b className="nx-readout text-[22px] text-drl">{view.h2h.losses}</b>
              {view.h2h.draws > 0 && <><span className="text-white/35"> – </span><b className="nx-readout text-[22px] text-drl-gold">{view.h2h.draws}</b></>}
              <span className="ml-2 text-caption text-ink-muted">en {view.h2h.matches} {view.h2h.matches === 1 ? "partida" : "partidas"} (tus victorias – las suyas)</span>
            </p>
          )}
        </Plate>
      )}

      <section aria-label="Últimas partidas">
        <SectionTitle>Últimas partidas</SectionTitle>
        {view.recentMatches.length === 0 ? (
          <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-4 text-center text-caption text-ink-muted">Sin partidas ranked todavía.</p>
        ) : (
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
            {view.recentMatches.map((m) => (
              <li key={m.matchId} className="flex items-center gap-3 px-3 py-2 text-[13px]" data-outcome={m.outcome}>
                <Badge tone={outcomeTone(m.outcome)} className="w-[2.6rem] justify-center">{m.letter ?? "—"}</Badge>
                <span className="min-w-0 flex-1 truncate text-white/85">
                  vs <Link href={playerHref(m.rival.userId)} className="nx-focus text-white underline-offset-2 hover:underline">{m.rival.username}</Link>
                  <span className="ml-2 text-white/40">{OUTCOME_LABEL[m.outcome]}</span>
                </span>
                <span className="nx-readout text-white/70">{m.scoreYou}–{m.scoreRival}</span>
                <time className="text-[11px] text-white/35">{fmt(m.at)}</time>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-caption text-ink-faint">Solo lo público: nunca el mazo de otro jugador ni sus cartas no jugadas.</p>
      </section>
    </div>
  );
}
