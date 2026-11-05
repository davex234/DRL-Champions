"use client";

/**
 * F89 · CARRERA EN EL PERFIL — estadísticas, historial de partidas (paginado por cursor) y momentos destacados.
 *
 * Todo sale de `snap.career`, calculado en el servidor con las reglas del competitivo (Fase 28): cuenta lo TERMINADO
 * con desenlace; el % de victorias es victorias / (victorias + derrotas + empates). El perfil público no recibe los
 * duelos privados (ni en números ni en el historial). Nada se recalcula aquí.
 */
import { useState } from "react";
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { playerHref } from "@/lib/player/href";
import { fetchPlayerHistory } from "@/lib/player/client";
import { MODE_LABEL, type CareerMode, type HistoryItem } from "@/domain/profile/career";
import type { PlayerIdentitySnapshot } from "@/domain/profile/identity";
import { fmtDate, ProfileButton } from "./bits";

const LETTER_TEXT = { W: "Victoria", L: "Derrota", D: "Empate" } as const;
const LETTER_TONE = { W: "#3ee6a0", L: "#ff5470", D: "#c9d1e0" } as const;

/* ───────────── estadísticas ───────────── */

export function CareerStats({ snap }: { snap: PlayerIdentitySnapshot }) {
  const c = snap.career;
  if (!c) return null;
  const t = c.stats.total;
  const isSelf = snap.view === "SELF";
  const modes = (Object.keys(c.stats.byMode) as CareerMode[]).filter((m) => (c.stats.byMode[m]?.played ?? 0) > 0);
  const streak = c.stats.currentStreak;
  return (
    <section aria-labelledby="career-title" data-testid="career-stats" data-played={t.played} data-wins={t.wins} data-losses={t.losses} data-draws={t.draws}>
      <SectionTitle><span id="career-title">Estadísticas</span></SectionTitle>
      {t.played === 0 ? (
        <Plate className="px-5 py-6 text-caption text-ink-muted" data-testid="career-empty">
          {isSelf ? "Sin partidas registradas todavía. Tu primera partida empezará a escribir tu carrera." : "Sin partidas registradas todavía."}
        </Plate>
      ) : (
        <Plate className="relative overflow-hidden p-5 sm:p-6">
          <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
            <WinRing pct={t.winrate ?? 0} played={t.played} />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Stat label="Partidas" value={t.played} stat="played" />
              <Stat label="Victorias" value={t.wins} stat="wins" tone="#3ee6a0" />
              <Stat label="Derrotas" value={t.losses} stat="losses" tone="#ff5470" />
              <Stat label="Empates" value={t.draws} stat="draws" />
              <Stat label="Racha actual" value={streak ? `${streak.n} ${streak.kind === "W" ? (streak.n === 1 ? "victoria" : "victorias") : streak.kind === "L" ? (streak.n === 1 ? "derrota" : "derrotas") : (streak.n === 1 ? "empate" : "empates")}` : "—"} stat="streak" />
              <Stat label="Mejor racha" value={c.stats.bestWinStreak > 0 ? `${c.stats.bestWinStreak} ${c.stats.bestWinStreak === 1 ? "victoria" : "victorias"}` : "—"} stat="best-streak" tone="var(--nx-gold)" />
            </dl>
          </div>
          {modes.length > 0 && (
            <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Por modo">
              {modes.map((m) => {
                const r = c.stats.byMode[m]!;
                return (
                  <li key={m} className="nx-clip-sm border border-white/[0.08] bg-black/25 px-3 py-2.5" data-mode={m}>
                    <span className="block font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/55">{MODE_LABEL[m]}{m === "PRIVATE" && <span className="ml-1 normal-case tracking-normal text-white/35">· solo tú</span>}</span>
                    <span className="mt-0.5 block tabular-nums text-[15px] text-white">{r.wins}V · {r.losses}D{r.draws ? ` · ${r.draws}E` : ""}<span className="ml-2 text-white/50">{r.winrate ?? 0} %</span></span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-[11px] text-white/40" data-testid="career-denominator">
            % de victorias sobre {t.played} {t.played === 1 ? "partida terminada" : "partidas terminadas"} ({c.stats.modes.map((m) => MODE_LABEL[m]).join(", ")}). No cuentan las partidas en curso ni las que quedaron sin resolver.
            {c.stats.sample.capped ? " Se muestran las más recientes (lectura acotada)." : ""}
          </p>
        </Plate>
      )}
    </section>
  );
}

function Stat({ label, value, tone, stat }: { label: string; value: string | number; tone?: string; stat: string }) {
  return (
    <div data-stat={stat} className="min-w-0">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/45">{label}</dt>
      <dd className="mt-0.5 truncate font-display text-[22px] font-bold tabular-nums text-white sm:text-[26px]" style={tone ? { color: tone } : undefined}>{value}</dd>
    </div>
  );
}

/** Anillo del % de victorias (SVG, sin animación obligatoria). El número va en texto: no depende del color. */
function WinRing({ pct, played }: { pct: number; played: number }) {
  const r = 46, len = 2 * Math.PI * r;
  return (
    <figure className="m-0 flex items-center gap-4 md:flex-col md:gap-2" data-stat="winrate" aria-label={`${pct} % de victorias en ${played} partidas`}>
      <svg viewBox="0 0 120 120" className="h-24 w-24 shrink-0 sm:h-32 sm:w-32" aria-hidden>
        <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke="url(#wr)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * len} ${len}`} transform="rotate(-90 60 60)" />
        <defs><linearGradient id="wr" x1="0" x2="1"><stop offset="0" stopColor="#19e3ff" /><stop offset="1" stopColor="#3ee6a0" /></linearGradient></defs>
        <text x="60" y="66" textAnchor="middle" className="fill-white font-display" fontSize="26" fontWeight="700">{pct}%</text>
      </svg>
      <figcaption className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">Victorias</figcaption>
    </figure>
  );
}

/* ───────────── historial ───────────── */

export function MatchHistory({ snap }: { snap: PlayerIdentitySnapshot }) {
  const first = snap.career?.history ?? null;
  const key = `${snap.player.userId}:${snap.view}`;
  const [state, setState] = useState<{ key: string; items: HistoryItem[]; next: number | null; busy: boolean; error: string | null }>({ key, items: first?.items ?? [], next: first?.nextBefore ?? null, busy: false, error: null });
  // Otro perfil u otra cuenta: nunca se mezclan páginas de un perfil con otro.
  const cur = state.key === key ? state : { key, items: first?.items ?? [], next: first?.nextBefore ?? null, busy: false, error: null };
  if (!first) return null;
  const more = async () => {
    if (cur.busy || cur.next === null) return;
    setState({ ...cur, busy: true, error: null });
    try {
      const page = await fetchPlayerHistory(snap.player.userId, cur.next);
      setState((s) => (s.key !== key ? s : { key, items: [...cur.items, ...page.items.filter((i) => !cur.items.some((x) => x.matchId === i.matchId))], next: page.nextBefore, busy: false, error: null }));
    } catch (e) {
      setState((s) => (s.key !== key ? s : { ...cur, busy: false, error: e instanceof Error ? e.message : "No se pudo cargar" }));
    }
  };
  return (
    <section aria-labelledby="history-title" data-testid="match-history" data-count={cur.items.length}>
      <SectionTitle><span id="history-title">Historial de partidas</span></SectionTitle>
      {cur.items.length === 0 ? (
        <Plate className="px-5 py-6 text-caption text-ink-muted">Sin partidas registradas.</Plate>
      ) : (
        <Plate className="p-2 sm:p-3">
          <ol className="divide-y divide-white/[0.06]">
            {cur.items.map((m) => <HistoryRow key={m.matchId} m={m} />)}
          </ol>
          {cur.next !== null && (
            <div className="flex justify-center p-3">
              <ProfileButton onClick={() => void more()} disabled={cur.busy} data-action="history-more">{cur.busy ? "Cargando…" : "Cargar más"}</ProfileButton>
            </div>
          )}
          {cur.error && <p role="alert" className="px-3 pb-3 text-center text-[12px] text-drl">{cur.error}</p>}
        </Plate>
      )}
    </section>
  );
}

function HistoryRow({ m }: { m: HistoryItem }) {
  const tone = m.letter ? LETTER_TONE[m.letter] : "#8892a6";
  const body = (
    <div className="flex min-w-0 items-center gap-3 px-2 py-3 sm:gap-4 sm:px-3">
      <span className="nx-clip-sm grid h-11 w-11 shrink-0 place-items-center font-display text-[18px] font-black" style={{ background: `${tone}1f`, color: tone, boxShadow: `inset 0 0 0 1px ${tone}55` }} aria-hidden>{m.letter ?? "—"}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-white">
          <span className="font-display font-bold uppercase tracking-wide" style={{ color: tone }}>{m.letter ? LETTER_TEXT[m.letter] : m.outcomeLabel}</span>
          <span className="text-white/50"> · {m.opponent.kind === "PLAYER" ? `contra ${m.opponent.username}` : m.opponent.label}</span>
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-white/45">{m.modeLabel} · {fmtDate(m.day)}{m.letter && m.outcomeLabel !== LETTER_TEXT[m.letter] ? ` · ${m.outcomeLabel}` : ""}</p>
      </div>
      <span className="shrink-0 font-display text-[18px] font-bold tabular-nums text-white" aria-label={`Marcador ${m.scoreYou} a ${m.scoreRival}`}>{m.scoreYou}<span className="mx-1 text-white/30">–</span>{m.scoreRival}</span>
    </div>
  );
  return (
    <li data-match={m.matchId} data-mode={m.mode} data-letter={m.letter ?? ""}>
      {m.href ? (
        <Link href={m.href} className="nx-focus block rounded-sm transition hover:bg-white/[0.04]" aria-label={`Ver la partida: ${m.letter ? LETTER_TEXT[m.letter] : m.outcomeLabel}, ${m.modeLabel}`}>{body}</Link>
      ) : m.opponent.kind === "PLAYER" && m.opponent.profileId ? (
        <div className="relative">
          {body}
          <Link href={playerHref(m.opponent.profileId)} className="nx-focus absolute inset-0" aria-label={`Ver el perfil de ${m.opponent.username}`} />
        </div>
      ) : body}
    </li>
  );
}

/* ───────────── momentos destacados ───────────── */

export function CareerHighlights({ snap }: { snap: PlayerIdentitySnapshot }) {
  const list = snap.career?.highlights ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="highlights-title" data-testid="career-highlights" data-count={list.length}>
      <SectionTitle><span id="highlights-title">Momentos destacados</span></SectionTitle>
      <ol className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {list.map((h) => {
          const inner = (
            <Plate className="flex h-full items-center gap-3 px-4 py-4">
              {h.logo
                ? <img src={h.logo} alt="" width={36} height={36} className="h-9 w-9 shrink-0 object-contain" draggable={false} />
                : <span aria-hidden className="nx-clip-sm grid h-9 w-9 shrink-0 place-items-center bg-white/[0.06] font-display text-[15px] text-drl-cyan">{h.kind === "FIRST_WIN" ? "★" : h.kind === "MATCH_MILESTONE" ? "◈" : h.kind === "COLLECTION_COMPLETED" ? "⬢" : "▶"}</span>}
              <span className="min-w-0">
                <span className="block truncate font-display text-[13px] font-bold uppercase tracking-wide text-white">{h.title}</span>
                <span className="block truncate text-[11.5px] text-white/50">{h.detail} · {fmtDate(h.at)}</span>
              </span>
            </Plate>
          );
          return <li key={h.id} data-highlight={h.kind}>{h.href ? <Link href={h.href} className="nx-focus block h-full">{inner}</Link> : inner}</li>;
        })}
      </ol>
    </section>
  );
}
