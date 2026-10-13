"use client";

/**
 * F83 · RUTA DE TEMPORADA — la pantalla. Recibe la vista del servidor (`SeasonOverview`) y la pinta; no calcula XP,
 * niveles, retos ni reclamables. El carril se recorre en horizontal (scroll propio, accesible con teclado y táctil),
 * nunca empuja la página. Reclamar es manual (botón por nivel) y lo decide el servidor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/format";
import { Stage, Plate } from "@/components/ui/Surface";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { RewardDisplay } from "@/components/rewards/RewardDisplay";
import { TrophyBadge } from "@/components/trophies/TrophyBadge";
import { seasonBadgeFact } from "@/domain/collectionSets/badges";
import type { ChallengeGroup, SeasonOverview, TrackNode } from "@/domain/seasonTrack/view";
import type { SeasonReward } from "@/domain/seasonTrack/types";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("seasonTrack");

const fmt = (n: number) => new Intl.NumberFormat(getIntlLocale(), { useGrouping: "always" } as Intl.NumberFormatOptions).format(n);

/** «12 d 4 h» / «3 h 20 min» / «menos de 1 min». Solo presentación: la autoridad es el servidor. */
export function remaining(ms: number): string {
  if (ms <= 60_000) return t("menos de 1 min");
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Hora del servidor estimada en el cliente (para cuentas atrás): serverNow + tiempo transcurrido desde que llegó la foto. */
function useServerClock(serverNow: number): number {
  const [base] = useState(() => ({ server: serverNow, local: Date.now() }));
  const [, tick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => tick((x) => x + 1), 30_000); return () => window.clearInterval(id); }, []);
  return base.server + (Date.now() - base.local);
}

const PHASE: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "En curso", tone: "#3ee6a0" },
  GRACE: { label: "Terminada · periodo de reclamo", tone: "#ffce4f" },
  SCHEDULED: { label: "Próximamente", tone: "#19e3ff" },
};

const SOURCE: Record<string, string> = { MATCH: "Partida", CRAFT: "Crafteo", COLLECTION: "Colección completada", CHALLENGE: "Reto completado" };

export interface SeasonTrackScreenProps {
  data: SeasonOverview;
  onClaim?: (level: number) => void;
  claimingLevel?: number | null;
  notice?: { ok: boolean; text: string } | null;
  /**
   * BATTLE PASS CLEANUP (2026-10-07) · «pass» = la pantalla del PASE (`/temporada/pase`): cabecera + ruta con reclamos.
   * Los retos son Objetivos (su sitio es Temporada → Objetivos); reglas, última XP e historial no hacen falta para usar
   * el pase. «full» (por defecto) conserva la pantalla completa para quien la monte.
   */
  variant?: "full" | "pass";
}

export function SeasonTrackScreen({ data, onClaim, claimingLevel = null, notice = null, variant = "full" }: SeasonTrackScreenProps) {
  useLocale();
  const now = useServerClock(data.serverNow);
  const s = data.season!;
  const p = data.progress!;
  const phase = PHASE[data.phase] ?? PHASE.ACTIVE;
  const until = data.phase === "SCHEDULED" ? s.startsAt : data.phase === "GRACE" ? s.claimUntil : s.endsAt;
  const untilLabel = data.phase === "SCHEDULED" ? t("Empieza en") : data.phase === "GRACE" ? t("Reclama antes de") : t("Termina en");
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8" data-scene="season-track" data-phase={data.phase} data-season={s.id}>
      <Stage grid className="relative overflow-hidden p-5 sm:p-8 lg:p-10" data-testid="season-hero">
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "radial-gradient(760px 340px at 0% 0%, rgba(255,206,79,0.20), transparent 70%), radial-gradient(620px 320px at 100% 100%, rgba(25,227,255,0.16), transparent 70%), repeating-linear-gradient(115deg, rgba(255,255,255,0.025) 0 2px, transparent 2px 22px)" }} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:items-center sm:gap-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="nx-label">{t("Ruta de temporada")}</span>
              <span className="nx-clip-sm px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-[0.14em]" style={{ background: `${phase.tone}22`, color: phase.tone }} data-testid="season-phase">{td(phase.label)}</span>
            </div>
            <h1 className="mt-2 break-words font-display text-[clamp(28px,5.5vw,56px)] font-bold uppercase leading-[0.95] text-white [overflow-wrap:anywhere]">{s.name}</h1>
            {s.description && <p className="mt-2 max-w-2xl text-[14px] text-white/65">{td(s.description)}</p>}
            <div className="mt-5 max-w-xl" data-testid="season-xp" data-level={p.level} data-xp={p.xp}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-white/60">
                <span>{p.isMax ? t("Nivel máximo alcanzado") : t("Nivel {level} → {v}", { level: p.level, v: p.level + 1 })}</span>
                <span className="tabular-nums">{p.isMax ? t("{xp} XP de temporada", { xp: fmt(p.xp) }) : t("{xpIntoLevel} / {xpForNext} XP de temporada", { xpIntoLevel: fmt(p.xpIntoLevel), xpForNext: fmt(p.xpForNext) })}</span>
              </div>
              <Meter value={Math.round(p.progress * 100)} tone="gold" height={8} label={p.isMax ? t("Nivel máximo") : t("Nivel {level}: {xpIntoLevel} de {xpForNext} XP de temporada", { level: p.level, xpIntoLevel: p.xpIntoLevel, xpForNext: p.xpForNext })} className="mt-1.5" />
            </div>
            <p className="mt-3 text-[13px] text-white/55" data-testid="season-countdown">{td(untilLabel)} <b className="text-white">{remaining(Math.max(0, until - now))}</b></p>
          </div>
          <LevelMedal level={p.level} max={s.maxLevel} />
        </div>
        {data.claimable.length > 0 && (
          <a href="#ruta" className="nx-focus nx-clip mt-6 flex min-h-[44px] items-center justify-between gap-3 border border-drl-gold/50 bg-drl-gold/10 px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-drl-gold" data-testid="claimable-banner">
            <span>{data.claimable.length === 1 ? t("Tienes 1 recompensa lista para reclamar") : t("Tienes {length} recompensas listas para reclamar", { length: data.claimable.length })}</span><span aria-hidden>→</span>
          </a>
        )}
        {notice && <p role="status" className={cn("mt-4 text-[13px]", notice.ok ? "text-emerald-300" : "text-drl")}>{td(notice.text)}</p>}
      </Stage>

      <TrackRail track={data.track} level={p.level} onClaim={onClaim} claimingLevel={claimingLevel} />

      {variant === "pass" && (
        <p className="text-center"><a href="/misiones" className="nx-focus nx-action inline-flex min-h-[44px] items-center" data-testid="season-objectives-link">{t("Ver objetivos →")}</a></p>
      )}

      {variant === "full" && (data.daily || data.weekly) && (
        <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-2">
          {data.daily && <Challenges title={t("Retos diarios")} group={data.daily} now={now} testId="daily" />}
          {data.weekly && <Challenges title={t("Retos semanales")} group={data.weekly} now={now} testId="weekly" />}
        </div>
      )}
      {variant === "full" && data.phase === "SCHEDULED" && <Plate className="px-5 py-4 text-caption text-ink-muted">{t("Los retos y la XP de temporada empiezan cuando empiece la temporada.")}</Plate>}

      {variant === "full" && <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[1fr_1fr]">
        {data.rules && (
          <section aria-labelledby="season-rules-title" data-testid="season-rules">
            <SectionTitle><span id="season-rules-title">{t("Cómo se gana XP de temporada")}</span></SectionTitle>
            <Plate className="p-5">
              <ul className="space-y-2 text-[13px] text-white/75">
                <li>{fill(t("Partida terminada: {pve} XP contra la IA, {draft} en Draft, {ranked} en ranked; victoria {bonus}. Hasta {tope} XP al día por partidas.", { ...slots("pve", "draft", "ranked", "bonus"), tope: fmt(data.rules.match.dailyCap) }), {
                  pve: <b className="text-white">{data.rules.match.PVE}</b>,
                  draft: <b className="text-white">{data.rules.match.DRAFT}</b>,
                  ranked: <b className="text-white">{data.rules.match.RANKED}</b>,
                  bonus: <b className="text-white">+{data.rules.match.winBonus}</b>,
                })}</li>
                <li>{fill(t("Crafteo completado: {xp} XP (hasta {tope} al día).", { ...slots("xp"), tope: data.rules.craft.dailyCap }), { xp: <b className="text-white">{data.rules.craft.amount}</b> })}</li>
                <li>{fill(t("Colección completada durante la temporada: {xp} XP.", slots("xp")), { xp: <b className="text-white">{data.rules.collection}</b> })}</li>
                <li>{t("Retos diarios y semanales: la XP de cada reto, al completarlo.")}</li>
                <li className="text-white/45">{t("No dan XP: partidas privadas, abandonos, partidas jugadas por el reloj, abrir sobres ni desguazar.")}</li>
              </ul>
            </Plate>
          </section>
        )}
        <section aria-labelledby="season-recent-title" data-testid="season-recent">
          <SectionTitle><span id="season-recent-title">{t("Última XP")}</span></SectionTitle>
          <Plate className="p-2 sm:p-3">
            {data.recent.length === 0 ? <p className="px-3 py-4 text-caption text-ink-muted">{t("Aún no has ganado XP en esta temporada.")}</p> : (
              <ol className="divide-y divide-white/[0.06]">
                {data.recent.slice(0, 8).map((r) => (
                  <li key={`${r.eventKey}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
                    <span className="min-w-0 truncate text-white/75">{td(SOURCE[r.source]) ?? td(r.source)}</span>
                    <span className="shrink-0 font-display font-bold tabular-nums text-drl-gold">+{fmt(r.amount)} {t("XP")}</span>
                  </li>
                ))}
              </ol>
            )}
          </Plate>
        </section>
      </div>}

      {variant === "full" && data.history.length > 0 && (
        <section aria-labelledby="season-history-title" data-testid="season-history">
          <SectionTitle><span id="season-history-title">{t("Temporadas anteriores")}</span></SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.history.map((h) => (
              <li key={h.seasonId}><Plate className="px-4 py-3"><b className="block font-display text-[14px] uppercase text-white">{h.name}</b><span className="text-[12px] text-white/55">{t("Nivel {nivel} de {max} · {xp} XP · {n} recompensas", { nivel: h.finalLevel, max: h.maxLevel, xp: fmt(h.xp), n: h.rewardsClaimed })}</span></Plate></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LevelMedal({ level, max }: { level: number; max: number }) {
  useLocale();
  return (
    <div className="relative grid h-[104px] w-[90px] place-items-center sm:h-48 sm:w-44" data-testid="season-level" aria-label={t("Nivel de temporada {level} de {max}", { level, max })} role="img">
      <span aria-hidden className="absolute inset-0" style={{ clipPath: "polygon(50% 0, 100% 22%, 100% 78%, 50% 100%, 0 78%, 0 22%)", background: "linear-gradient(160deg, #ffce4f, rgba(255,255,255,0.3) 45%, #19e3ff)" }} />
      <span aria-hidden className="absolute inset-[3px]" style={{ clipPath: "polygon(50% 0, 100% 22%, 100% 78%, 50% 100%, 0 78%, 0 22%)", background: "radial-gradient(70% 60% at 50% 30%, rgba(255,255,255,0.12), rgba(7,8,14,0.96) 70%)" }} />
      <span className="relative text-center">
        <span className="block font-display text-[9px] font-bold uppercase tracking-[0.2em] text-white/55 sm:text-[11px] sm:tracking-[0.25em]">{t("Nivel")}</span>
        <span className="block font-display text-[36px] font-black leading-none text-white sm:text-[68px]">{level}</span>
        <span className="block text-[10px] text-white/45 sm:text-[11px]">{t("de {max}", { max })}</span>
      </span>
    </div>
  );
}

function rewardOnly(r: SeasonReward | null) { return r ? { credits: r.credits, packId: r.packId, packCount: r.packCount } : null; }

function TrackRail({ track, level, onClaim, claimingLevel }: { track: TrackNode[]; level: number; onClaim?: (level: number) => void; claimingLevel: number | null }) {
  useLocale();
  const rail = useRef<HTMLDivElement | null>(null);
  const current = useMemo(() => Math.min(track.length, level + 1), [track.length, level]);
  // Centra el nivel actual DENTRO del carril (scrollLeft del propio carril: nunca desplaza la página).
  useEffect(() => {
    const el = rail.current; const node = el?.querySelector<HTMLElement>(`[data-level="${current}"]`);
    if (el && node) el.scrollLeft = Math.max(0, node.offsetLeft - el.clientWidth / 2 + node.clientWidth / 2);
  }, [current]);
  return (
    <section id="ruta" aria-labelledby="season-track-title" data-testid="season-track">
      <SectionTitle><span id="season-track-title">{t("Ruta")}</span></SectionTitle>
      <div ref={rail} tabIndex={0} role="region" aria-label={t("Niveles de la ruta de temporada (desplázate en horizontal)")}
        className="nx-focus -mx-4 overflow-x-auto px-4 pb-3 [scrollbar-width:thin] sm:mx-0 sm:px-0">
        <ol className="flex w-max items-stretch gap-2.5">
          {track.map((n) => {
            const badge = n.reward?.badge ? seasonBadgeFact(n.reward.badge) : null;
            const tone = n.state === "CLAIMED" ? "border-emerald-400/40 bg-emerald-400/[0.06]" : n.state === "AVAILABLE" ? "border-drl-gold/70 bg-drl-gold/[0.10] shadow-[0_0_24px_rgba(255,206,79,0.25)]" : n.current ? "border-drl-cyan/60 bg-drl-cyan/[0.07]" : "border-white/[0.08] bg-white/[0.02]";
            return (
              <li key={n.level} data-level={n.level} data-state={n.state} data-current={n.current ? "1" : "0"}
                className={cn("nx-clip-sm flex w-[132px] shrink-0 flex-col items-center gap-2 border px-2 py-3 text-center", tone)}>
                <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">{t("Nivel")}</span>
                <span className={cn("font-display text-[26px] font-black leading-none", n.level <= level ? "text-white" : "text-white/40")}>{n.level}</span>
                <span className="flex min-h-[64px] items-center justify-center">
                  {badge ? <TrophyBadge badge={badge} size="sm" locked={n.state === "LOCKED"} />
                    : n.reward ? <RewardDisplay reward={rewardOnly(n.reward)} size="sm" layout="stack" dim={n.state === "LOCKED" || n.state === "EXPIRED"} />
                      : <span aria-hidden className="text-white/20">·</span>}
                </span>
                {badge && n.reward?.packId && <RewardDisplay reward={rewardOnly(n.reward)} size="sm" dim={n.state === "LOCKED"} />}
                <span className="min-h-[44px] w-full">
                  {n.state === "AVAILABLE" && onClaim ? (
                    <button type="button" onClick={() => onClaim(n.level)} disabled={claimingLevel !== null} data-action="claim" data-level={n.level}
                      className="nx-focus nx-clip-sm min-h-[44px] w-full bg-drl-gold px-2 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-[#221703] disabled:opacity-60">
                      {claimingLevel === n.level ? t("Reclamando…") : t("Reclamar")}
                    </button>
                  ) : (
                    <span className="block py-3 text-[11px] uppercase tracking-[0.12em] text-white/45">
                      {n.state === "CLAIMED" ? t("✓ Reclamada") : n.state === "EXPIRED" ? t("Plazo cerrado") : n.reward ? (n.current ? t("Siguiente") : t("Bloqueada")) : n.current ? t("Siguiente") : ""}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Challenges({ title, group, now, testId }: { title: string; group: ChallengeGroup; now: number; testId: string }) {
  useLocale();
  const done = group.challenges.filter((c) => c.completed).length;
  return (
    <section aria-labelledby={`${testId}-title`} data-testid={`challenges-${testId}`} data-period={group.periodKey}>
      <SectionTitle><span id={`${testId}-title`}>{td(title)}</span><span className="ml-2 text-ink-faint">{t("· {hechos}/{total} · se renuevan en {tiempo}", { hechos: done, total: group.challenges.length, tiempo: remaining(Math.max(0, group.endsAt - now)) })}</span></SectionTitle>
      <Plate className="p-2 sm:p-3">
        <ol className="divide-y divide-white/[0.06]">
          {group.challenges.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-3" data-challenge={c.id} data-completed={c.completed ? "1" : "0"}>
              <span aria-hidden className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full border font-display text-[14px]", c.completed ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300" : "border-white/15 text-white/40")}>{c.completed ? "✓" : "◆"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-white">{td(c.label)}</p>
                <Meter value={Math.round((c.progress / c.target) * 100)} tone={c.completed ? "ok" : "info"} height={4} label={t("{label}: {progress} de {target}", { label: td(c.label), progress: c.progress, target: c.target })} className="mt-1.5" />
              </div>
              <span className="shrink-0 text-right">
                <span className="block font-display text-[13px] font-bold tabular-nums text-white">{c.progress}/{c.target}</span>
                <span className={cn("block text-[11px] tabular-nums", c.completed ? "text-emerald-300" : "text-drl-gold")}>{c.completed ? t("Completado") : t("+{xp} XP", { xp: c.xp })}</span>
              </span>
            </li>
          ))}
        </ol>
      </Plate>
    </section>
  );
}
