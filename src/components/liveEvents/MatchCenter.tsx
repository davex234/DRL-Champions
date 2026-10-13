"use client";

/**
 * MATCH CENTER (Fase 30). Un partido real: equipos, estado con texto, marcador, formato si el
 * backend lo trae, mapas (TBD se queda TBD), marcadores por mapa, estadísticas por jugador si
 * existen, y la predicción relacionada (solo lectura + enlace al panel real). El ganador solo
 * si `winner_team_id` lo confirma. Recibe UN `EventMatchSnapshot`.
 */
import Link from "next/link";
import { Stage, Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { AgentChip } from "@/components/agents/AgentArt";
import type { EventMatchSnapshot } from "@/server/services/liveEvents";
import { MatchStatusBadge, Score, SyncNotice, TeamName, DemoTag, fmtWhen } from "./bits";

export function MatchCenter({ snap, onPickemCta }: { snap: EventMatchSnapshot; onPickemCta?: () => void }) {
  const m = snap.match;
  const a = snap.teams.a, b = snap.teams.b;
  const winnerName = m.winner === "a" ? m.teamA : m.winner === "b" ? m.teamB : null;
  const byMap = new Map<number, EventMatchSnapshot["stats"]>();
  for (const s of snap.stats) byMap.set(s.mapOrder, [...(byMap.get(s.mapOrder) ?? []), s]);
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6" data-scene="match-center" data-match={m.id} data-status={m.label}>
      <Link href={`/torneos/${snap.event.id}`} className="nx-focus -ml-2 inline-flex min-h-[44px] items-center rounded-control px-2 font-display text-label uppercase tracking-wide2 text-ink-muted transition hover:bg-white/[0.06] hover:text-white">‹ {snap.event.name}</Link>
      <Stage tone={m.label === "EN CURSO" ? "cyan" : "neutral"} grid className="p-5 sm:p-7" data-testid="match-hero">
        <div className="flex flex-wrap items-center gap-2">
          <MatchStatusBadge label={m.label} />
          <DemoTag isDemo={snap.event.isDemo} />
          {m.stageName && <span className="nx-label">{m.stageName}</span>}
          {m.round && <span className="nx-label">· {m.round}</span>}
          {m.format ? <span className="nx-label">· {m.format.toUpperCase()}</span> : m.bestOf ? <span className="nx-label">· BO{m.bestOf}</span> : null}
        </div>
        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0 text-right"><TeamName name={m.teamA} identity={a?.identity} className={`block truncate text-[clamp(16px,3vw,28px)] ${m.winner === "a" ? "text-white" : m.winner === "b" ? "text-ink-faint" : "text-white"}`} />{a?.tag && <span className="nx-label">{a.tag}</span>}</div>
          <Score m={m} size="lg" />
          <div className="min-w-0"><TeamName name={m.teamB} identity={b?.identity} className={`block truncate text-[clamp(16px,3vw,28px)] ${m.winner === "b" ? "text-white" : m.winner === "a" ? "text-ink-faint" : "text-white"}`} />{b?.tag && <span className="nx-label">{b.tag}</span>}</div>
        </div>
        <p className="mt-3 text-center text-caption text-ink-muted" data-testid="match-verdict">
          {m.label === "FINALIZADO" ? (winnerName ? `Ganó ${winnerName}` : "Terminado · resultado sin confirmar") : m.label === "EN CURSO" ? "En juego ahora mismo" : `Programado · ${fmtWhen(m.startTime)}`}
        </p>
      </Stage>
      <SyncNotice sync={snap.sync} />

      <section aria-label="Mapas" data-testid="match-maps" data-count={snap.maps.length}>
        <SectionTitle>Mapas</SectionTitle>
        {snap.maps.length === 0 ? (
          <Plate className="px-4 py-4 text-caption text-ink-muted">{m.label === "PROGRAMADO" ? "Los mapas se publican cuando empieza el partido." : "Sin mapas publicados para este partido."}</Plate>
        ) : (
          <ol className="grid gap-2 sm:grid-cols-3">
            {snap.maps.map((mp) => (
              <li key={mp.order}>
                <Plate className="px-3 py-3" data-map-order={mp.order} data-map={mp.tbd ? "tbd" : "known"}>
                  <div className="flex items-center justify-between"><span className="nx-label">Mapa {mp.order}</span>{mp.winner && <Badge tone="ok">{mp.winner === "a" ? m.teamA : m.teamB}</Badge>}</div>
                  <p className={`mt-1 font-display text-[16px] font-bold uppercase ${mp.tbd ? "text-ink-faint" : "text-white"}`}>{mp.name}</p>
                  <p className="nx-readout mt-1 text-[20px] tabular-nums text-white/85">{mp.scoreA ?? "—"}<span className="text-white/35"> – </span>{mp.scoreB ?? "—"}</p>
                  {mp.duration ? <p className="text-[11px] text-white/40">{Math.round(mp.duration / 60)} min</p> : null}
                </Plate>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Estadísticas" data-testid="match-stats" data-count={snap.stats.length}>
        <SectionTitle>Estadísticas</SectionTitle>
        {snap.stats.length === 0 ? (
          <Plate className="px-4 py-4 text-caption text-ink-muted">Sin estadísticas publicadas.</Plate>
        ) : (
          <div className="space-y-3">
            {[...byMap.entries()].sort((x, y) => x[0] - y[0]).map(([order, rows]) => (
              <Plate key={order} className="overflow-x-auto p-3">
                <p className="nx-label mb-2">Mapa {order}</p>
                <table className="w-full text-[12px]">
                  <thead><tr className="text-left text-[10px] uppercase tracking-wide text-white/40"><th>Jugador</th><th className="hidden sm:table-cell">Agente</th><th className="text-right">ACS</th><th className="text-right">K</th><th className="text-right">D</th><th className="text-right">A</th><th className="hidden text-right sm:table-cell">ADR</th><th className="text-right">Rating</th></tr></thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={`${order}:${s.playerId}`} className="border-t border-white/[0.06]" data-player={s.playerId}>
                        <td className="py-1 text-white"><AgentChip value={s.agent} size={16} hideName className="mr-1.5 sm:hidden" />{s.nick}<span className="ml-1 text-white/35">{s.teamId === m.teamAId ? a?.tag ?? "" : s.teamId === m.teamBId ? b?.tag ?? "" : ""}</span></td>
                        <td className="hidden py-1 text-white/70 sm:table-cell"><AgentChip value={s.agent} size={22} /></td>
                        <td className="py-1 text-right tabular-nums text-white/85">{s.acs ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums">{s.kills ?? "—"}</td><td className="py-1 text-right tabular-nums">{s.deaths ?? "—"}</td><td className="py-1 text-right tabular-nums">{s.assists ?? "—"}</td>
                        <td className="hidden py-1 text-right tabular-nums sm:table-cell">{s.adr ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums text-drl-cyan">{s.rating ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Plate>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Tu predicción" data-testid="match-pickem" data-state={!snap.question ? "none" : snap.question.locked ? "locked" : "open"}>
        <SectionTitle>Tu predicción</SectionTitle>
        {!snap.question ? (
          <Plate className="px-4 py-4 text-caption text-ink-muted">Este partido no tiene predicción asociada.</Plate>
        ) : (
          <Plate tone={!snap.question.locked ? "cyan" : "neutral"} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] text-white">{snap.question.prompt}</p>
              <p className="mt-0.5 text-[11px] text-white/50">
                {snap.question.locked ? `Cerrada · ${fmtWhen(snap.question.locksAt)}` : `Cierra ${fmtWhen(snap.question.locksAt)}`} · {snap.question.points} pts
                {snap.signedIn && (snap.question.myOption ? ` · tu elección: ${snap.question.options.find((o) => o.key === snap.question!.myOption)?.label ?? snap.question.myOption}` : " · sin predicción")}
                {snap.question.locked && snap.question.correctOption && ` · correcta: ${snap.question.options.find((o) => o.key === snap.question!.correctOption)?.label ?? snap.question.correctOption}`}
                {snap.question.myCorrect !== null && (snap.question.myCorrect ? " · acertaste" : " · fallaste")}
              </p>
            </div>
            {!snap.question.locked && <Link href={`/torneos/${snap.event.id}#pickems`} onClick={onPickemCta} className="nx-focus nx-clip-sm inline-flex min-h-[44px] items-center border border-drl-cyan/50 px-4 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan transition hover:bg-drl-cyan/10">Hacer Pick&apos;em</Link>}
          </Plate>
        )}
      </section>
    </div>
  );
}
