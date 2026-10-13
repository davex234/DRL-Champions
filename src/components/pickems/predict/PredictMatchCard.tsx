"use client";

/**
 * F87 · UN PARTIDO DEL CUADRO DE PREDICCIÓN.
 *
 *   ┌ CUARTOS ALTO · Bo3 ─────────── cierra 07:00 ┐
 *   │ ● [logo] G2 ESPORTS                    2 ✓ │   ← fila = <button> mientras está abierto
 *   │   [logo] 100 THIEVES                   1   │
 *   ├────────────────────────────────────────────┤
 *   │ ✓ Acertado · +1                             │   ← el estado con PALABRAS (no solo color)
 *   └────────────────────────────────────────────┘
 *
 * Los participantes son los de MI cuadro predicho (curado con la realidad); el marcador y el ganador son los
 * REALES, y solo se pintan junto al equipo real que los consiguió. Nada se decide aquí: el pick lo valida el
 * servidor y el cierre lo pone la BD.
 */
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { cn } from "@/lib/format";
import type { TeamRef } from "@/domain/pickems/format";
import type { MatchScore, RealState } from "@/domain/pickems/prediction";
import type { PickNotice } from "@/lib/pickems/bracketClient";

const fmtLock = (iso: string | null): string => {
  if (!iso) return "sin hora";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export interface PredictMatchProps {
  matchId: string;
  roundLabel: string;
  bestOf: number;
  points: number;
  pair: [TeamRef | null, TeamRef | null];
  real: RealState | undefined;
  lockAt: string | null;
  locked: boolean;
  voided: boolean;
  pick: string | null;
  score: MatchScore | undefined;
  /** Destinos («Ganador → Semis alto», «Perdedor → Ronda 1 baja»), en palabras. */
  next?: string[];
  notice?: PickNotice | null;
  busy?: boolean;
  signedIn: boolean;
  onPick?: (matchId: string, teamId: string | null) => void;
  compact?: boolean;
  className?: string;
}

export function PredictMatchCard(p: PredictMatchProps) {
  const { matchId, roundLabel, bestOf, points, pair, real, lockAt, locked, voided, pick, score, next, notice, busy, signedIn, onPick, compact, className } = p;
  const known = !!pair[0] && !!pair[1];
  const live = real?.status === "live";
  const final = !!real?.final;
  const outcome = score?.outcome;
  const canPick = signedIn && !!onPick && known && !locked && !voided;
  const dead = !!score?.dead;
  const tone = voided ? "160,166,184" : outcome === "CORRECT" ? "63,192,122" : outcome === "WRONG" || dead ? "255,46,99" : live ? "25,227,255" : pick ? "255,211,92" : "255,255,255";
  const pickName = pick ? (pair[0]?.id === pick ? pair[0].name : pair[1]?.id === pick ? pair[1].name : realName(real, pick)) : null;

  const footer = (() => {
    if (notice) return <span className={cn("nx-label", notice.status === "saved" && "!text-ok", notice.status === "error" && "!text-bad")} role={notice.status === "error" ? "alert" : undefined}>{notice.message}</span>;
    if (voided) return <span className="nx-label">Anulado · no puntúa</span>;
    if (outcome === "CORRECT") return <span className="nx-label !text-ok">✓ Acertado · +{score?.awarded ?? points}</span>;
    if (outcome === "WRONG") return <span className="nx-label !text-bad">✕ Fallado · tu pick: {pickName}</span>;
    if (outcome === "MISSED" && final) return <span className="nx-label !text-warn">Sin pick · 0</span>;
    if (dead) return <span className="nx-label !text-bad">✕ Tu pick ({pickName}) ya no juega este cruce</span>;
    if (locked && pick) return <span className="nx-label">Cerrado · tu pick: <b className="text-white">{pickName}</b></span>;
    if (locked) return <span className="nx-label !text-warn">Cerrado sin pick</span>;
    if (!known) return <span className="nx-label">Por definir · {signedIn ? "elige antes el cruce anterior" : "esperando a los anteriores"}</span>;
    if (!signedIn) return <span className="nx-label">Inicia sesión para predecir · +{points}</span>;
    if (pick) return <span className="nx-label">Tu pick: <b className="text-white">{pickName}</b> · +{points} · puedes cambiarlo</span>;
    return <span className="nx-label">Elige ganador · <b className="text-drl-gold">+{points}</b></span>;
  })();

  return (
    <article
      data-match-id={matchId}
      data-outcome={outcome ?? "none"}
      data-locked={locked ? "true" : "false"}
      aria-label={`${roundLabel}: ${pair[0]?.name ?? "por definir"} contra ${pair[1]?.name ?? "por definir"}${locked ? ", cerrado" : ""}`}
      className={cn("nx-clip-sm relative flex flex-col", compact ? "w-full" : "w-[244px] lg:w-[256px]", className)}
      style={{
        background: `linear-gradient(180deg, rgba(${tone},0.10), rgba(255,255,255,0.02) 60%), rgba(10,12,22,0.96)`,
        boxShadow: `inset 0 0 0 1px rgba(${tone},${tone === "255,255,255" ? 0.16 : 0.5}), 0 10px 24px -14px rgba(0,0,0,0.9)`,
      }}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="nx-label truncate"><span className={compact ? undefined : "sr-only"}>{roundLabel} · </span>Bo{bestOf}</span>
        <span className="nx-label shrink-0" title={lockAt ? new Date(lockAt).toISOString() : undefined}>
          {live ? <span className="text-drl-cyan">En juego</span> : final ? "Final" : voided ? "Anulado" : locked ? "Cerrado" : `Cierra ${fmtLock(lockAt)}`}
        </span>
      </header>
      <div className="flex flex-col border-t border-white/[0.06]">
        {([0, 1] as const).map((i) => {
          const team = pair[i];
          const selected = !!team && pick === team.id;
          const realScore = team && real ? (real.teamA?.id === team.id ? real.scoreA : real.teamB?.id === team.id ? real.scoreB : null) : null;
          const won = !!team && final && real?.winnerId === team.id;
          const lost = !!team && final && real?.winnerId !== team.id;
          const inner = (
            <>
              <span className="grid w-4 shrink-0 place-items-center" aria-hidden>
                {selected && outcome === "CORRECT" ? <Mark ok /> : selected && (outcome === "WRONG" || dead) ? <Mark /> : selected ? <span className="h-2 w-2 rounded-full bg-drl-gold" /> : null}
              </span>
              {team ? <span className="shrink-0" aria-hidden><TeamLogo team={team.name} size={20} /></span>
                : <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded bg-white/5 text-[10px] text-ink-faint">?</span>}
              <span className={cn("min-w-0 flex-1 truncate text-left font-display text-[13px] font-bold uppercase tracking-[0.03em]",
                won ? "text-white" : lost ? "text-ink-faint line-through decoration-white/20" : team ? "text-ink-primary" : "italic normal-case text-ink-faint")}>
                {team?.name ?? "Por definir"}
              </span>
              {won && <span className="sr-only">ganador real</span>}
              {won && <span aria-hidden className="h-4 w-[3px] shrink-0 bg-ok" />}
              <span className={cn("nx-readout w-5 shrink-0 text-right text-[14px] tabular-nums", won ? "text-white" : "text-ink-muted")}>{realScore ?? "–"}</span>
            </>
          );
          const cls = cn("flex min-h-[44px] w-full items-center gap-2 px-2.5 py-1.5", i === 0 && "border-b border-white/[0.06]", selected && "bg-drl-gold/[0.09]");
          return canPick && team ? (
            <button
              key={i}
              type="button"
              disabled={busy}
              aria-pressed={selected}
              aria-label={`${selected ? "Quitar" : "Elegir"} ${team.name} como ganador de ${roundLabel} frente a ${pair[i === 0 ? 1 : 0]?.name ?? "por definir"}`}
              onClick={() => onPick!(matchId, selected ? null : team.id)}
              className={cn(cls, "nx-focus text-left transition duration-fast hover:bg-white/[0.06] disabled:cursor-wait motion-reduce:transition-none", selected && "nx-pick-pop")}
            >
              {inner}
            </button>
          ) : (
            <div key={i} className={cls} aria-current={selected ? "true" : undefined}>{inner}</div>
          );
        })}
      </div>
      <footer className="flex flex-col gap-0.5 border-t border-white/[0.06] px-3 py-1.5" aria-live="polite">
        {footer}
        {next && next.length > 0 && !final && <span className="text-[11px] leading-snug text-ink-faint">{next.join(" · ")}</span>}
        {busy && !notice && <span className="nx-label">Guardando…</span>}
      </footer>
    </article>
  );
}

function realName(real: RealState | undefined, id: string): string {
  if (real?.teamA?.id === id) return real.teamA.name;
  if (real?.teamB?.id === id) return real.teamB.name;
  return id;
}

function Mark({ ok }: { ok?: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke={ok ? "var(--nx-ok)" : "var(--nx-bad)"} strokeWidth="2" strokeLinecap="round">
      {ok ? <path d="M2 6.4 4.8 9.2 10 3.4" /> : <><path d="M3 3l6 6" /><path d="M9 3l-6 6" /></>}
    </svg>
  );
}
