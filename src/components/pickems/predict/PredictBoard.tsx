"use client";

/**
 * F87 · EL CUADRO DE PREDICCIÓN — eliminatorias (simple / doble) y grupos (GSL / todos contra todos).
 *
 * ESCRITORIO (≥ 768 px): el cuadro entero en un área desplazable propia (la página nunca se desplaza en horizontal).
 *   Doble:  [ alto · col 0 ][ col 1 ][ col 2 ]            [ GRAN FINAL ]
 *           [ bajo · col 0 ][ col 1 ][ col 2 ][ col 3 ]   (centrada entre filas)
 *   GSL:    por grupo → [ Apertura ][ Ganadores / Eliminación ][ Decisivo ][ Clasificados ]
 *   Las líneas son `BracketConnectors` (las mismas del cuadro real): ganador continua, perdedor discontinua.
 * MÓVIL: no se encoge nada. Selector de sección (alto / bajo / final, o grupo) + selector de ronda y las cajas de
 *   esa ronda en vertical, a todo el ancho. Los MISMOS picks, la MISMA validación; solo cambia el reparto.
 *
 * Presentación pura: los participantes salen de `predictedParticipants` (mi cuadro) y la puntuación de
 * `scoreEntry`; el marcador y el ganador son los REALES.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/format";
import { useIsNarrow } from "@/lib/useMediaQuery";
import { BracketConnectors, type DrawableEdge } from "@/components/pickems/bracket/BracketConnector";
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { PredictMatchCard } from "./PredictMatchCard";
import type { FormatDescriptor, FormatNode, TeamRef } from "@/domain/pickems/format";
import { predictedParticipants, scoreEntry, type PredictionContext, type MatchScore, type Pair } from "@/domain/pickems/prediction";
import type { BracketView } from "@/server/services/pickemBrackets";
import type { PickNotice } from "@/lib/pickems/bracketClient";

export interface BoardProps {
  view: BracketView;
  ctx: PredictionContext;
  picks: Record<string, string>;
  notice: PickNotice | null;
  inFlight: string | null;
  signedIn: boolean;
  onPick?: (matchId: string, teamId: string | null) => void;
  /** Solo QA/pruebas sin `matchMedia`. */
  forceMode?: "desktop" | "mobile";
}

const SECTION_TONE: Record<string, string> = { upper: "var(--nx-cyan)", single: "var(--nx-cyan)", lower: "rgba(238,241,248,0.72)", grand: "var(--nx-gold)" };

/** Destinos en palabras para cada partido (ganador → X, perdedor → Y / eliminado). */
function destinations(d: FormatDescriptor): Map<string, string[]> {
  const label = new Map(d.nodes.map((n) => [n.matchId, n.roundLabel]));
  const out = new Map<string, string[]>();
  for (const n of d.nodes) {
    const w = d.edges.find((e) => e.from === n.matchId && e.source === "WINNER");
    const l = d.edges.find((e) => e.from === n.matchId && e.source === "LOSER");
    const q = d.qualifications.find((x) => x.from === n.matchId);
    const parts: string[] = [];
    if (w) parts.push(`Ganador → ${label.get(w.to)}`);
    else if (q) parts.push("Ganador → clasificado");
    else if (d.kind !== "ROUND_ROBIN") parts.push("Ganador → campeón");
    if (l) parts.push(`Perdedor → ${label.get(l.to)}`);
    else if (d.kind !== "ROUND_ROBIN") parts.push("Perdedor eliminado");
    out.set(n.matchId, parts);
  }
  return out;
}

export function PredictBoard(props: BoardProps) {
  const { view, ctx, picks } = props;
  const pairs = useMemo(() => predictedParticipants(ctx, picks), [ctx, picks]);
  const lockedSet = useMemo(() => new Set(view.nodes.filter((n) => n.locked).map((n) => n.matchId)), [view.nodes]);
  const scores = useMemo(() => new Map(scoreEntry(ctx, picks, (id) => lockedSet.has(id)).matches.map((m) => [m.matchId, m])), [ctx, picks, lockedSet]);
  const next = useMemo(() => destinations(view.descriptor), [view.descriptor]);
  const narrowVp = useIsNarrow();
  const narrow = props.forceMode ? props.forceMode === "mobile" : narrowVp;
  const shared = { ...props, pairs, scores, next, narrow };
  return view.descriptor.kind === "GSL_GROUPS" || view.descriptor.kind === "ROUND_ROBIN" ? <Groups {...shared} /> : <Elimination {...shared} />;
}

interface Shared extends BoardProps { pairs: Map<string, Pair>; scores: Map<string, MatchScore>; next: Map<string, string[]>; narrow: boolean }

function Card({ s, n, compact }: { s: Shared; n: FormatNode; compact?: boolean }) {
  const st = s.view.nodes.find((x) => x.matchId === n.matchId);
  return (
    <PredictMatchCard
      matchId={n.matchId} roundLabel={n.roundLabel} bestOf={n.bestOf} points={st?.points ?? n.points}
      pair={s.pairs.get(n.matchId) ?? [null, null]} real={s.ctx.real.get(n.matchId)}
      lockAt={st?.lockAt ?? null} locked={!!st?.locked} voided={!!st?.voided} pick={s.picks[n.matchId] ?? null}
      score={s.scores.get(n.matchId)} next={s.next.get(n.matchId)}
      notice={s.notice?.matchId === n.matchId ? s.notice : null} busy={s.inFlight !== null}
      signedIn={s.signedIn} onPick={s.onPick} compact={compact}
    />
  );
}

const toDrawable = (d: FormatDescriptor, ids?: Set<string>): DrawableEdge[] =>
  d.edges.filter((e) => !ids || (ids.has(e.from) && ids.has(e.to)))
    .map((e) => ({ from: e.from, to: e.to, source: e.source, slot: e.slot === 1 ? "a" : e.slot === 2 ? "b" : null, kind: "RESULT_VERIFIED" as const }));

function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/* ═══════════════════════════════ ELIMINATORIAS ═══════════════════════════════ */

interface Column { key: string; section: string; column: number; label: string; nodes: FormatNode[] }

function columnsOf(d: FormatDescriptor): Column[] {
  const cols = new Map<string, Column>();
  for (const n of d.nodes) {
    const key = `${n.section}#${n.column}`;
    const c = cols.get(key) ?? { key, section: n.section, column: n.column, label: n.roundLabel, nodes: [] };
    c.nodes.push(n);
    cols.set(key, c);
  }
  const order: Record<string, number> = { single: 0, upper: 0, lower: 1, grand: 2 };
  const sorted = [...cols.values()].map((c) => ({ ...c, nodes: c.nodes.sort((a, b) => a.row - b.row) }))
    .sort((a, b) => (order[a.section] ?? 9) - (order[b.section] ?? 9) || a.column - b.column);
  // Presentación: cada columna se ordena por la posición media de sus alimentadores (los de su sección primero), para
  // que las líneas no se crucen. El descriptor (y su orden) no cambia.
  const pos = new Map<string, number>();
  for (const c of sorted) {
    if (c.column > 0) {
      const key = (n: FormatNode) => {
        const feeds = d.edges.filter((e) => e.to === n.matchId);
        const same = feeds.filter((e) => d.nodes.find((x) => x.matchId === e.from)?.section === n.section);
        const use = (same.length ? same : feeds).map((e) => pos.get(e.from)).filter((x): x is number => x !== undefined);
        return use.length ? use.reduce((t, x) => t + x, 0) / use.length : n.row;
      };
      c.nodes.sort((a, b) => key(a) - key(b) || a.row - b.row);
    }
    c.nodes.forEach((n, i) => pos.set(n.matchId, i));
  }
  return sorted;
}

function Elimination(s: Shared) {
  const d = s.view.descriptor;
  const cols = useMemo(() => columnsOf(d), [d]);
  const sections = useMemo(() => d.sections.filter((sec) => cols.some((c) => c.section === sec.id)), [d.sections, cols]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstOpen = cols.find((c) => c.nodes.some((n) => !s.view.nodes.find((x) => x.matchId === n.matchId)?.locked && (s.pairs.get(n.matchId) ?? [])[0] && (s.pairs.get(n.matchId) ?? [])[1])) ?? cols[0];
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = cols.find((c) => c.key === chosen) ?? firstOpen;
  const edges = useMemo(() => toDrawable(d), [d]);
  // El ref del área se asigna DESPUÉS del primer efecto de las líneas (hijo): se vuelve a medir tras montar.
  const mounted = useMounted();

  if (s.narrow) {
    const sec = selected?.section;
    return (
      <div data-bracket-mode="mobile" className="space-y-3">
        {sections.length > 1 && (
          <div role="tablist" aria-label="Secciones del cuadro" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
            {sections.map((x) => {
              const on = x.id === sec;
              return (
                <button key={x.id} role="tab" aria-selected={on} type="button"
                  onClick={() => setChosen(cols.find((c) => c.section === x.id)?.key ?? null)}
                  className={cn("nx-clip-sm nx-focus min-h-[44px] px-2 font-display text-[11px] font-bold uppercase tracking-[0.12em]", on ? "bg-white/[0.08] text-white" : "bg-white/[0.03] text-ink-secondary")}
                  style={{ boxShadow: on ? `inset 0 0 0 1.5px ${SECTION_TONE[x.id] ?? "var(--nx-cyan)"}` : "inset 0 0 0 1px rgba(255,255,255,0.1)" }}>
                  {x.label}
                </button>
              );
            })}
          </div>
        )}
        <nav aria-label="Rondas" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {cols.filter((c) => c.section === sec).map((c) => (
            <button key={c.key} type="button" aria-pressed={c.key === selected?.key} onClick={() => setChosen(c.key)}
              className={cn("nx-clip-sm nx-focus min-h-[44px] shrink-0 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em]", c.key === selected?.key ? "bg-drl-cyan/15 text-white" : "bg-white/[0.04] text-ink-secondary")}>
              {c.label} <span className="text-ink-faint">· {c.nodes.length}</span>
            </button>
          ))}
        </nav>
        {selected && (
          <section aria-label={selected.label} className="space-y-3">
            {selected.nodes.map((n) => <Card key={n.matchId} s={s} n={n} compact />)}
          </section>
        )}
        <p className="nx-label text-ink-faint">Cada pick alimenta el siguiente cruce de tu cuadro. Cambia de ronda arriba.</p>
      </div>
    );
  }

  const upper = cols.filter((c) => c.section === "upper" || c.section === "single");
  const lower = cols.filter((c) => c.section === "lower");
  const grand = cols.filter((c) => c.section === "grand");
  const width = Math.max(upper.length, lower.length);
  const template = `repeat(${width + grand.length}, max-content)`;
  return (
    <div data-bracket-mode="desktop" className="relative">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-base-900 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-base-900 to-transparent" />
      <div ref={scrollRef} className="relative overflow-x-auto px-4 pb-3 [scrollbar-width:thin]" role="group" aria-label="Cuadro de predicción, desplazable en horizontal" tabIndex={0}>
        <div className="relative min-w-max">
          <BracketConnectors containerRef={scrollRef} edges={edges} version={`${cols.length}:${Object.keys(s.picks).length}:${s.narrow}:${mounted}`} />
          <div className="relative grid items-stretch gap-x-12 gap-y-10" style={{ gridTemplateColumns: template }}>
            {upper.map((c, i) => <ColumnView key={c.key} s={s} c={c} style={{ gridColumn: i + 1, gridRow: 1 }} />)}
            {lower.map((c, i) => <ColumnView key={c.key} s={s} c={c} style={{ gridColumn: i + 1, gridRow: 2 }} />)}
            {grand.map((c, i) => <ColumnView key={c.key} s={s} c={c} style={{ gridColumn: width + i + 1, gridRow: lower.length ? "1 / span 2" : 1, alignSelf: "center" }} />)}
          </div>
        </div>
      </div>
      <p className="mt-1 nx-label text-ink-faint">Línea continua: avanza el ganador · discontinua: cae el perdedor · desplaza para ver todo el cuadro</p>
    </div>
  );
}

function ColumnView({ s, c, style }: { s: Shared; c: Column; style?: CSSProperties }) {
  return (
    <section aria-label={c.label} className="flex shrink-0 flex-col gap-3" style={style}>
      <h3>
        <span className="nx-clip-sm inline-block px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.24em]"
          style={{ color: SECTION_TONE[c.section] ?? "var(--nx-cyan)", background: "rgba(6,8,14,0.85)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)" }}>
          {c.label}
        </span>
      </h3>
      <div className="flex flex-1 flex-col justify-around gap-5">
        {c.nodes.map((n) => <Card key={n.matchId} s={s} n={n} />)}
      </div>
    </section>
  );
}

/* ═══════════════════════════════ GRUPOS ═══════════════════════════════ */

function Groups(s: Shared) {
  const d = s.view.descriptor;
  const groups = d.sections;
  const [chosen, setChosen] = useState<string | null>(null);
  const current = groups.find((g) => g.id === chosen) ?? groups[0];
  if (s.narrow) {
    return (
      <div data-bracket-mode="mobile" className="space-y-3">
        {groups.length > 1 && (
          <div role="tablist" aria-label="Grupos" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(groups.length, 4)}, minmax(0, 1fr))` }}>
            {groups.map((g) => (
              <button key={g.id} role="tab" type="button" aria-selected={g.id === current?.id} onClick={() => setChosen(g.id)}
                className={cn("nx-clip-sm nx-focus min-h-[44px] px-2 font-display text-[11px] font-bold uppercase tracking-[0.12em]", g.id === current?.id ? "bg-drl-cyan/15 text-white" : "bg-white/[0.04] text-ink-secondary")}>
                {g.label}
              </button>
            ))}
          </div>
        )}
        {current && <GroupBody s={s} groupId={current.id} label={current.label} compact />}
      </div>
    );
  }
  return (
    <div data-bracket-mode="desktop" className="space-y-8">
      {groups.map((g) => <GroupBody key={g.id} s={s} groupId={g.id} label={g.label} />)}
      <p className="nx-label text-ink-faint">Línea continua: avanza el ganador · discontinua: cae el perdedor</p>
    </div>
  );
}

function GroupBody({ s, groupId, label, compact }: { s: Shared; groupId: string; label: string; compact?: boolean }) {
  const d = s.view.descriptor;
  const nodes = d.nodes.filter((n) => n.section === groupId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => new Set(nodes.map((n) => n.matchId)), [nodes]);
  const edges = useMemo(() => toDrawable(d, ids), [d, ids]);
  const quals = d.qualifications.filter((q) => ids.has(q.from));
  const mounted = useMounted();

  if (d.kind === "ROUND_ROBIN") {
    return (
      <section aria-label={label}>
        <h3 className="mb-2 font-display text-sm font-bold uppercase tracking-[0.2em] text-white">{label}</h3>
        <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(244px,1fr))]")}>
          {nodes.map((n) => <Card key={n.matchId} s={s} n={n} compact={compact} />)}
        </div>
      </section>
    );
  }

  const by = (role: string) => nodes.filter((n) => n.role === role);
  const col = (title: string, list: FormatNode[], extra?: React.ReactNode) => (
    <section aria-label={title} className="flex flex-col gap-3">
      <h4><span className="nx-clip-sm inline-block px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.24em] text-drl-cyan" style={{ background: "rgba(6,8,14,0.85)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)" }}>{title}</span></h4>
      <div className="flex flex-1 flex-col justify-around gap-5">{list.map((n) => <Card key={n.matchId} s={s} n={n} compact={compact} />)}{extra}</div>
    </section>
  );
  const qualified = (
    <section aria-label="Clasificados" className="flex flex-col gap-3">
      <h4><span className="nx-clip-sm inline-block px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.24em] text-drl-gold" style={{ background: "rgba(6,8,14,0.85)", boxShadow: "inset 0 0 0 1px rgba(255,211,92,0.4)" }}>Clasificados</span></h4>
      <div className="flex flex-1 flex-col justify-around gap-5">
        {quals.map((q, i) => <QualifiedBox key={q.key} s={s} fromId={q.from} label={i === 0 ? "1.º del grupo" : "2.º del grupo"} compact={compact} />)}
      </div>
    </section>
  );

  if (compact) {
    return (
      <section aria-label={label} className="space-y-4">
        {col("Apertura", by("OPENING"))}
        {col("Ganadores", by("WINNERS"))}
        {col("Eliminación", by("ELIMINATION"))}
        {col("Decisivo", by("DECIDER"))}
        {qualified}
      </section>
    );
  }
  return (
    <section aria-label={label} className="relative">
      <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-[0.2em] text-white">{label}</h3>
      <div ref={scrollRef} className="relative overflow-x-auto pb-2 [scrollbar-width:thin]" role="group" aria-label={`${label}, desplazable en horizontal`} tabIndex={0}>
        <div className="relative min-w-max">
          <BracketConnectors containerRef={scrollRef} edges={edges} version={`${groupId}:${Object.keys(s.picks).length}:${mounted}`} />
          <div className="relative grid grid-cols-[repeat(4,max-content)] items-stretch gap-x-12">
            {col("Apertura", by("OPENING"))}
            <section aria-label="Ganadores y Eliminación" className="flex flex-col justify-between gap-8">
              {col("Ganadores", by("WINNERS"))}
              {col("Eliminación", by("ELIMINATION"))}
            </section>
            {col("Decisivo", by("DECIDER"))}
            {qualified}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Plaza: MI predicción (ganador de ese partido en mi cuadro) y, si ya se sabe, el clasificado REAL. */
function QualifiedBox({ s, fromId, label, compact }: { s: Shared; fromId: string; label: string; compact?: boolean }) {
  const pair = s.pairs.get(fromId) ?? [null, null];
  const pick = s.picks[fromId];
  const mine: TeamRef | null = pair[0]?.id === pick ? pair[0] : pair[1]?.id === pick ? pair[1] : null;
  const real = s.ctx.real.get(fromId);
  const realTeam = real?.final ? (real.teamA?.id === real.winnerId ? real.teamA : real.teamB) : null;
  const hit = !!realTeam && !!mine && realTeam.id === mine.id;
  return (
    <div className={cn("nx-clip-sm flex flex-col gap-1 px-3 py-2", compact ? "w-full" : "w-[220px]")} style={{ background: "rgba(8,10,18,0.94)", boxShadow: "inset 0 0 0 1px rgba(255,211,92,0.32)" }}>
      <span className="nx-label text-drl-gold">{label}</span>
      <span className="flex items-center gap-2">
        {mine ? <TeamLogo team={mine.name} size={18} /> : <span aria-hidden className="h-[18px] w-[18px] rounded bg-white/5" />}
        <span className="truncate font-display text-[12px] font-bold uppercase text-white">{mine?.name ?? "Sin predicción"}</span>
        <span className="nx-label ml-auto">tu pick</span>
      </span>
      {realTeam && <span className={cn("nx-label", hit ? "!text-ok" : "!text-bad")}>{hit ? "✓" : "✕"} Real: {realTeam.name}</span>}
    </div>
  );
}
