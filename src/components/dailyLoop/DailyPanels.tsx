"use client";

/**
 * VESTÍBULO · BLOQUES (Fase 36): después, hoy, temporada, jugar, circuito y colección.
 *
 * Cada bloque pinta un modelo PURO de `lib/dailyLoop/presentation` y tiene tres estados honestos: con dato,
 * vacío útil (sin prometer recompensas) y no disponible (su subsistema no respondió). Ningún número aparece
 * antes de conocerse. El color nunca es la única señal: cada estado lleva texto.
 */
import Link from "next/link";
import { NxButton } from "@/components/ui/NxButton";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { LobbyShowcase, type ShowcaseCard } from "@/components/lobby/LobbyShowcase";
import { cn } from "@/lib/format";
import { PLACEMENT_GAMES } from "@/domain/cardgame/rating/types";
import { DAILY_ROUTES, type DailyAction, type DailyLoopSnapshot } from "@/domain/dailyLoop";
import {
  TONE_RGB, VISUAL_TONE, campaignModel, competitiveModel, liveModel, seasonModel, stashModel, todayRows,
  type LiveCardModel,
} from "@/lib/dailyLoop/presentation";
import { objectiveRoute } from "@/domain/dailyLoop";
import { deadlineChip, objectiveSections, returningModel } from "@/lib/liveService/presentation";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("dailyLoop");

/* ───────────────────────────── piezas ───────────────────────────── */

export function Panel({ id, title, kicker, action, children, className, testId }: {
  id: string; title: string; kicker?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string;
}) {
  useLocale();
  return (
    <section aria-labelledby={`${id}-title`} data-testid={testId ?? `daily-${id}`} className={cn("nx-clip-sm relative min-w-0 border border-white/10 bg-[linear-gradient(160deg,rgba(18,22,36,0.74),rgba(8,10,18,0.86))] p-4 sm:p-5", className)}>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          {kicker && <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">{td(kicker)}</p>}
          <h2 id={`${id}-title`} className="font-display text-[20px] font-bold uppercase leading-tight tracking-[0.04em] text-white">{td(title)}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Unavailable({ what }: { what: string }) {
  useLocale();
  return <p role="status" className="border border-dashed border-white/12 px-3 py-4 text-center text-caption text-ink-muted">{t("No se ha podido leer")} {td(what)}{t(". El resto del vestíbulo sigue disponible.")}</p>;
}

function TextLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className="nx-focus inline-flex min-h-[44px] items-center font-display text-[12px] font-bold uppercase tracking-[0.12em] text-drl-cyan hover:text-white">
      {children} <span aria-hidden className="ml-1">→</span>
    </Link>
  );
}

/* ───────────────────────────── después (acciones secundarias) ───────────────────────────── */

/** Arte de cada tipo de siguiente paso: geometría de la casa, nada de arte de equipos (no hay licencia ni dato). */
const NEXT_ART: Record<string, React.ReactNode> = {
  pickem: <path d="M4 10h16v10h14M4 30h16v-10M34 20h14v12h14M34 44h14v-12" />,
  campaign: <><path d="M4 50 C 16 38, 26 46, 36 30 S 52 16, 60 10" strokeDasharray="4 5" /><circle cx="36" cy="30" r="4" /><circle cx="60" cy="10" r="5" /></>,
  ranked: <path d="M8 52h12V40H8zM26 52h12V28H26zM44 52h12V14H44z" />,
  match: <path d="M22 12 50 32 22 52Z" />,
  claim: <path d="M32 6 40 24 58 26 44 38 48 56 32 46 16 56 20 38 6 26 24 24Z" />,
  packs: <><path d="M16 8h32v48H16z" /><path d="M16 20h32M26 34l6-4 6 4-6 4z" /></>,
  team: <path d="M32 6 56 20v24L32 58 8 44V20z" />,
  objective: <><circle cx="32" cy="32" r="22" /><circle cx="32" cy="32" r="10" /></>,
};

export function NextRail({ actions, offline, layout = "row" }: { actions: DailyAction[]; offline: boolean; layout?: "row" | "stack" }) {
  useLocale();
  if (actions.length === 0) return null;
  const stack = layout === "stack";
  return (
    <nav aria-label={t("Después")} data-testid="daily-next" data-layout={layout} className={cn("grid gap-2.5", stack ? "content-stretch" : "sm:grid-cols-3")}>
      {actions.map((a) => {
        const visual = visualOf(a);
        const rgb = TONE_RGB[VISUAL_TONE[visual]];
        const body = (
          <>
            <svg aria-hidden viewBox="0 0 64 64" className={cn("nx-mode-art pointer-events-none absolute top-1/2 -z-10 -translate-y-1/2", stack ? "right-5 h-20 w-20 opacity-55" : "right-3 h-16 w-16 opacity-40")} fill="none" stroke={`rgb(${rgb})`} strokeWidth="2">{NEXT_ART[visual] ?? NEXT_ART.objective}</svg>
            <span className="block font-display text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: `rgb(${rgb})` }}>{td(a.eyebrow)}</span>
            <span className="mt-1 block truncate pr-16 font-display text-[18px] font-bold uppercase leading-tight text-white">{td(a.cta)}</span>
            <span className="mt-0.5 block truncate pr-16 text-[14px] text-ink-muted">{td(a.title)}</span>
            {!offline && <span aria-hidden className="mt-2 inline-flex items-center gap-1 font-display text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: `rgb(${rgb})` }}>{t("Ir")} <span className="transition-transform duration-fast group-hover:translate-x-1">›</span></span>}
          </>
        );
        const cls = cn("nx-clip-sm nx-mode group relative isolate block min-w-0 overflow-hidden border px-5 py-4 transition", stack ? "min-h-[104px]" : "min-h-[96px]");
        const style = { borderColor: `rgba(${rgb}, 0.38)`, background: `radial-gradient(120% 140% at 100% 50%, rgba(${rgb}, 0.18), transparent 60%), linear-gradient(150deg, rgba(${rgb}, 0.10), rgba(6,7,13,0.7) 70%)` };
        return offline
          ? <div key={a.id} aria-disabled="true" className={cn(cls, "opacity-60")} style={style} data-action={a.id}>{body}</div>
          : <Link key={a.id} href={a.href} className={cn(cls, "nx-focus hover:brightness-110")} style={style} data-action={a.id}>{body}</Link>;
      })}
    </nav>
  );
}

const visualOf = (a: DailyAction) =>
  a.kind === "resume" ? "match" : a.kind === "challenge" ? "challenge" : a.kind === "claim" ? "claim" : a.kind === "predict" ? "pickem"
    : a.kind === "objective" ? "objective" : a.kind === "open" ? "packs" : a.kind === "build" ? "team" : a.kind === "explore" ? "live"
      : a.id === "campaign" ? "campaign" : a.id === "ranked" ? "ranked" : "quick";

/* ───────────────────────────── hoy ───────────────────────────── */

const STATUS_TONE = { CLAIMABLE: "gold", NEAR: "info", IN_PROGRESS: "muted", PENDING: "warn", AVAILABLE: "ok" } as const;

const URGENCY_TONE = { NORMAL: "muted", SOON: "info", VERY_SOON: "warn" } as const;
const OBJ_TONE = { CLAIMABLE: "gold", CLAIMED: "ok", IN_PROGRESS: "muted" } as const;

/** Fase 42 · «de vuelta en NEXUS»: como mucho 3 hechos verdaderos, sin recompensa, sin racha, sin reproche. */
export function ReturningBanner({ snap }: { snap: DailyLoopSnapshot }) {
  useLocale();
  const m = returningModel(snap);
  if (!m) return null;
  return (
    <section aria-labelledby="daily-returning-title" data-testid="daily-returning" className="nx-clip-sm border border-drl-cyan/30 bg-drl-cyan/[0.06] px-4 py-3 sm:px-5">
      <h2 id="daily-returning-title" className="font-display text-[15px] font-bold uppercase tracking-[0.12em] text-drl-cyan">{td(m.title)}</h2>
      <p className="text-caption text-ink-muted">{td(m.subtitle)}</p>
      <ul className="mt-1.5 space-y-0.5" data-count={m.facts.length}>
        {m.facts.map((f) => <li key={f} className="text-[14px] text-white"><span aria-hidden className="mr-2 text-drl-cyan">•</span>{td(f)}</li>)}
      </ul>
    </section>
  );
}

function ObjectiveSectionView({ s, testId }: { s: NonNullable<ReturnType<typeof objectiveSections>>[number]; testId: string }) {
  useLocale();
  return (
    <div data-testid={testId} data-done={s.done ? "true" : "false"}>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-display text-[13px] font-bold uppercase tracking-[0.14em] text-white/80">{td(s.kicker)}</h3>
        <span className="text-caption text-ink-muted" data-testid={`${testId}-reset`}>{td(s.reset)}</span>
      </div>
      {s.rows.length === 0 ? <p className="text-caption text-ink-muted">{td(s.empty)}</p> : (
        <ol className="space-y-2" data-count={s.rows.length}>
          {s.rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} data-status={r.status} className="nx-focus nx-clip-sm grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border border-white/8 bg-black/25 px-3 py-2.5 transition hover:border-white/25">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-white">{td(r.label)}</span>
                  <span className="block truncate text-caption text-ink-muted">{td(r.reward)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="nx-readout text-[14px] text-white/85">{td(r.progressLabel)}</span>
                  <Badge tone={OBJ_TONE[r.status]}>{td(r.statusLabel)}</Badge>
                </span>
                <Meter value={r.pct} tone={r.status === "CLAIMABLE" ? "gold" : r.status === "CLAIMED" ? "ok" : "info"} height={5} label={`${r.label}: ${r.progressLabel}`} className="col-span-2" />
              </Link>
            </li>
          ))}
        </ol>
      )}
      {s.done && <p className="mt-1.5 text-caption text-ok" data-testid={`${testId}-done`}>{t("Completado. El juego sigue: campaña, Draft, competitivo o partida rápida.")}</p>}
    </div>
  );
}

export function TodayBlock({ snap, now }: { snap: DailyLoopSnapshot; now: number }) {
  useLocale();
  const rows = todayRows(snap, now);
  const down = snap.unavailable.includes("progression");
  const sections = snap.service && !down ? objectiveSections(snap, now, { claims: DAILY_ROUTES.claims, objective: objectiveRoute }) : null;
  const expiring = snap.service?.expiring ?? [];
  const extras = rows.filter((r) => r.kind !== "objective");
  if (sections) {
    return (
      <Panel id="today" kicker={t("Hoy")} title={t("¿Qué puedo avanzar hoy?")} action={<TextLink href={DAILY_ROUTES.objectives}>{t("Objetivos")}</TextLink>}>
        {expiring.length > 0 && (
          <ul className="mb-3 space-y-1.5" data-testid="daily-expiring" aria-label={t("Termina pronto")}>
            {expiring.map((e) => {
              const chip = deadlineChip(e.endsAt, now, e.source === "pickems" ? t("Cierra en") : e.source === "season" ? t("Termina en") : t("Se renueva en"));
              return (
                <li key={e.id}>
                  <Link href={e.href} data-urgency={e.urgency} className="nx-focus nx-clip-sm flex min-h-[44px] flex-wrap items-center justify-between gap-2 border border-warn/25 bg-warn/[0.05] px-3 py-2">
                    <span className="min-w-0 truncate text-[14px] font-semibold text-white">{td(e.label)}</span>
                    {chip && <Badge tone={URGENCY_TONE[chip.urgency]}><span aria-label={td(chip.aria)}>{td(chip.label)}</span></Badge>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="grid gap-4">
          {sections.map((s, i) => <ObjectiveSectionView key={s.kicker} s={s} testId={i === 0 ? "daily-today-daily" : "daily-today-weekly"} />)}
        </div>
        {extras.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 border-t border-white/8 pt-2" data-testid="daily-today-extras">
            {extras.map((r) => <li key={r.id}><TextLink href={r.href}>{td(r.label)}</TextLink></li>)}
          </ul>
        )}
      </Panel>
    );
  }
  return (
    <Panel id="today" kicker={t("Hoy")} title={t("¿Qué puedo avanzar hoy?")} action={<TextLink href={DAILY_ROUTES.objectives}>{t("Objetivos")}</TextLink>}>
      {rows.length === 0 ? (
        down ? <Unavailable what={t("tus objetivos")} /> : (
          <div className="border border-dashed border-white/12 px-3 py-4 text-center">
            <p className="text-caption text-ink-muted">{t("Nada pendiente por aquí. Juega una partida para avanzar tu temporada.")}</p>
            <TextLink href={DAILY_ROUTES.play}>{t("Jugar")}</TextLink>
          </div>
        )
      ) : (
        <ol className="space-y-2" data-count={rows.length}>
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} data-status={r.status} className="nx-focus nx-clip-sm group grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border border-white/8 bg-black/25 px-3 py-2.5 transition hover:border-white/25">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-white">{td(r.label)}</span>
                  <span className="block truncate text-caption text-ink-muted">{td(r.detail)}{r.expires ? ` · ${r.expires}` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  {r.progress && <span className="nx-readout text-[14px] text-white/85">{td(r.progress.label)}</span>}
                  <Badge tone={STATUS_TONE[r.status]}>{td(r.statusLabel)}</Badge>
                </span>
                {r.pct !== null && (
                  <Meter value={r.pct} tone={r.status === "CLAIMABLE" ? "gold" : "info"} height={5} label={`${r.label}: ${r.progress?.label ?? ""}`} className="col-span-2" />
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* ───────────────────────────── temporada ───────────────────────────── */

export function SeasonBlock({ snap, now }: { snap: DailyLoopSnapshot; now: number }) {
  useLocale();
  const m = seasonModel(snap, now);
  if (!m) return snap.unavailable.includes("season") ? <Panel id="season" kicker={t("Temporada")} title={t("Temporada")}><Unavailable what={t("la temporada")} /></Panel> : null;
  return (
    <Panel id="season" kicker={t("Temporada")} title={m.name} action={<TextLink href={DAILY_ROUTES.season}>{t("Ver temporada")}</TextLink>}>
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={m.endingSoon ? "warn" : m.statusLabel === "Finalizada" ? "muted" : "info"}>{td(m.statusLabel)}</Badge>
        {m.timeLabel && <span className="font-display text-[14px] font-bold uppercase tracking-[0.08em] text-white">{td(m.timeLabel)}</span>}
      </p>
      <div className="mt-3"><Meter value={m.elapsedPct} tone={m.endingSoon ? "warn" : "info"} height={4} label={t("Tiempo transcurrido de la temporada")} /></div>
      <dl className="mt-4 space-y-3">
        {m.pass && (
          <div data-testid="daily-pass-xp">
            <dt className="flex items-baseline justify-between gap-2 text-[13px] text-white"><span className="font-semibold">{td(m.pass.levelLabel)}</span><span className="nx-readout text-white/80">{td(m.pass.xpLabel)}</span></dt>
            <dd className="mt-1.5"><Meter value={m.pass.pct} tone="gold" height={7} label={td(m.pass.xpLabel)} /></dd>
            {m.pass.nextReward && <dd className="mt-1 text-caption text-ink-muted">{t("Siguiente recompensa del pase ·")} {td(m.pass.nextReward)}</dd>}
          </div>
        )}
        {m.account && (
          <div data-testid="daily-account-xp">
            <dt className="flex items-baseline justify-between gap-2 text-[13px] text-white"><span className="font-semibold">{td(m.account.levelLabel)}</span><span className="nx-readout text-white/80">{td(m.account.xpLabel)}</span></dt>
            <dd className="mt-1.5"><Meter value={m.account.pct} tone="key" height={7} label={td(m.account.xpLabel)} /></dd>
          </div>
        )}
        {m.objectivesLabel && <div><dt className="sr-only">{t("Objetivos")}</dt><dd className="text-caption text-ink-muted">{t("Objetivos ·")} {td(m.objectivesLabel)}</dd></div>}
      </dl>
      {(snap.service?.recent.length ?? 0) > 0 && (
        <div className="mt-4 border-t border-white/8 pt-3" data-testid="daily-recent">
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">{t("Lo último")}</p>
          <ul className="mt-1 space-y-0.5">
            {snap.service!.recent.map((r) => <li key={r.id} className="truncate text-caption text-white/80">{td(r.label)}</li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────────── jugar: campaña + competitivo ───────────────────────────── */

export function PlayBlock({ snap, offline }: { snap: DailyLoopSnapshot; offline: boolean }) {
  useLocale();
  const camp = campaignModel(snap);
  const comp = competitiveModel(snap, PLACEMENT_GAMES);
  const deck = snap.deck;
  const ready = deck?.state === "READY";
  const cta = (label: string, href: string, testId: string) => offline
    ? <NxButton variant="secondary" size="md" disabled className="w-full sm:w-auto">{td(label)}</NxButton>
    : <NxButton variant="secondary" size="md" href={href} className="w-full sm:w-auto" data-testid={testId}>{td(label)}</NxButton>;

  return (
    <Panel id="play" kicker={t("Jugar")} title={t("Tus modos")} action={<TextLink href={DAILY_ROUTES.play} testId="daily-all-modes">{t("Todos los modos")}</TextLink>}>
      {deck && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-caption" data-testid="daily-deck" data-state={deck.state}>
          <Badge tone={ready ? "ok" : "warn"} dot>{ready ? t("Equipo listo") : deck.state === "NONE" ? t("Sin equipo") : t("Equipo no válido")}</Badge>
          {ready && deck.active && <span className="text-white/80">{deck.active.name} · {deck.active.sumOvr} {t("OVR")}</span>}
          {!ready && <TextLink href={deck.state === "NONE" ? DAILY_ROUTES.newDeck : deck.firstInvalid ? `${DAILY_ROUTES.decks}?deck=${encodeURIComponent(deck.firstInvalid.id)}` : DAILY_ROUTES.decks}>{deck.state === "NONE" ? t("Crear equipo") : t("Editar equipo")}</TextLink>}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <article aria-labelledby="daily-rtc-title" data-testid="daily-campaign" className="nx-clip-sm border border-drl/25 bg-drl/[0.05] p-4">
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-drl">{t("Campaña PvE")}</p>
          <h3 id="daily-rtc-title" className="font-display text-[18px] font-bold uppercase text-white">{t("Road to Champions")}</h3>
          {!camp ? <p className="mt-2 text-caption text-ink-muted">{snap.unavailable.includes("campaign") ? t("No disponible ahora mismo.") : t("Inicia sesión para ver tu progreso.")}</p> : (
            <>
              <p className="mt-2 flex items-center justify-between gap-2"><Badge tone={camp.statusLabel === "Completada" ? "ok" : "info"}>{td(camp.statusLabel)}</Badge><span className="nx-readout text-[18px] text-white">{td(camp.progressLabel)}</span></p>
              <div className="mt-2"><Meter value={camp.pct} tone="key" height={6} label={t("Road to Champions {progressLabel} nodos", { progressLabel: td(camp.progressLabel) })} /></div>
              <p className="mt-2 min-h-[20px] text-caption text-ink-muted">{camp.next ? `${camp.next.chapter} · ${camp.next.label}` : camp.statusLabel === "Completada" ? t("Los quince nodos superados. Puedes rejugarlos.") : ""}</p>
              <div className="mt-3">{ready ? cta(camp.statusLabel === "Completada" ? t("Rejugar nodos") : camp.statusLabel === "Sin empezar" ? t("Empezar campaña") : t("Continuar campaña"), camp.next?.href ?? DAILY_ROUTES.campaign, "daily-campaign-cta") : <TextLink href={DAILY_ROUTES.campaign}>{t("Ver el mapa")}</TextLink>}</div>
            </>
          )}
        </article>
        <article aria-labelledby="daily-ranked-title" data-testid="daily-competitive" className="nx-clip-sm border border-[rgba(123,92,255,0.3)] bg-[rgba(123,92,255,0.06)] p-4">
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-[rgb(160,140,255)]">{t("PvP ranked")}</p>
          <h3 id="daily-ranked-title" className="font-display text-[18px] font-bold uppercase text-white">{t("Competitivo")}</h3>
          {!comp ? <p className="mt-2 text-caption text-ink-muted">{snap.unavailable.includes("competitive") ? t("No disponible ahora mismo.") : t("Inicia sesión para ver tu rating.")}</p> : (
            <>
              <p className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <Badge tone={comp.stateLabel === "Clasificado" ? "ok" : "info"}>{td(comp.stateLabel)}</Badge>
                <span className="nx-readout text-[18px] text-white">{td(comp.ratingLabel)}{comp.positionLabel && <span className="ml-2 text-[14px] text-white/70">{td(comp.positionLabel)}</span>}</span>
              </p>
              {comp.placement && <div className="mt-2"><Meter value={(comp.placement.value / comp.placement.max) * 100} tone="info" height={6} label={t("Calibración {value} de {max} partidas", { value: comp.placement.value, max: comp.placement.max })} /></div>}
              <p className="mt-2 flex min-h-[20px] flex-wrap items-center gap-2 text-caption text-ink-muted">
                {comp.recordLabel && <span>{td(comp.recordLabel)}</span>}
                {comp.form.length > 0 && (
                  <span className="flex gap-1" aria-label={t("Últimas partidas: {v}", { v: comp.form.map((f) => f.label).join(", ") })}>
                    {comp.form.map((f, i) => (
                      <span key={i} aria-hidden className={cn("nx-readout grid h-6 w-6 place-items-center text-[12px]", f.letter === "V" ? "bg-ok/20 text-ok" : f.letter === "D" ? "bg-bad/20 text-bad" : "bg-white/10 text-white/70")}>{f.letter}</span>
                    ))}
                  </span>
                )}
                {comp.stateLabel === "Sin partidas" && <span>{t("Tu rating aparece tras tu primera partida ranked.")}</span>}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4">{ready ? cta(t("Jugar competitivo"), DAILY_ROUTES.pvp, "daily-ranked-cta") : null}<TextLink href={DAILY_ROUTES.competitive}>{t("Clasificación")}</TextLink></div>
            </>
          )}
        </article>
      </div>
    </Panel>
  );
}

/* ───────────────────────────── circuito ───────────────────────────── */

function LiveCard({ c, featured }: { c: LiveCardModel; featured: boolean }) {
  useLocale();
  return (
    <Link href={c.href} data-testid={featured ? "daily-live-featured" : "daily-live-upcoming"} data-badge={c.badge}
      className={cn("nx-focus nx-clip-sm block min-h-[88px] min-w-0 border p-4 transition hover:brightness-110", c.isLive ? "border-ok/40 bg-ok/[0.07]" : "border-white/10 bg-black/25")}>
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={c.isLive ? "ok" : c.badge === "EN CURSO" ? "info" : "muted"} dot={c.isLive} pulse={c.isLive}>{td(c.badge)}</Badge>
        {c.demo && c.badge !== "DEMO" && <Badge tone="muted">{t("Demo")}</Badge>}
      </span>
      <span className="mt-2 block truncate font-display text-[16px] font-bold uppercase text-white">{c.name}</span>
      {c.line && <span className="mt-0.5 block truncate text-caption text-ink-muted">{td(c.line)}</span>}
    </Link>
  );
}

export function LiveBlock({ snap, offline }: { snap: DailyLoopSnapshot; offline: boolean }) {
  useLocale();
  const m = liveModel(snap);
  return (
    <Panel id="live" kicker={t("Circuito")} title={t("Eventos y Pick'ems")} action={<TextLink href={DAILY_ROUTES.events}>{t("Eventos")}</TextLink>}>
      {!m ? <Unavailable what={t("el circuito")} /> : !m.featured && !m.upcoming ? (
        <p className="border border-dashed border-white/12 px-3 py-4 text-center text-caption text-ink-muted">{t("No hay ningún evento en curso ni programado ahora mismo.")}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {m.featured && <LiveCard c={m.featured} featured />}
          {m.upcoming && <LiveCard c={m.upcoming} featured={false} />}
        </div>
      )}
      {snap.signedIn && m && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-3" data-testid="daily-pickems">
          <p className="text-[14px] text-white">
            {m.pickemPending > 0 ? <><b className="nx-readout">{m.pickemPending}</b> {m.pickemPending === 1 ? t("predicción pendiente") : t("predicciones pendientes")}</> : <span className="text-ink-muted">{t("Sin predicciones pendientes")}</span>}
          </p>
          {m.pickemPending > 0
            ? (offline ? <NxButton variant="secondary" size="md" disabled>{t("Haz tu predicción")}</NxButton> : <NxButton variant="secondary" size="md" href={DAILY_ROUTES.pickems} data-testid="daily-pickem-cta">{t("Haz tu predicción")}</NxButton>)
            : <TextLink href={DAILY_ROUTES.pickems}>{t("Pick'ems")}</TextLink>}
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────────── colección ───────────────────────────── */

export function StashBlock({ snap, showcase, offline }: { snap: DailyLoopSnapshot; showcase: ShowcaseCard[]; offline: boolean }) {
  useLocale();
  const m = stashModel(snap);
  if (!m.packs && !m.collection && !m.achievements) return null;
  return (
    <Panel id="stash" kicker={t("Tu colección")} title={t("Sobres, cartas y logros")} action={<TextLink href={DAILY_ROUTES.collection}>{t("Colección")}</TextLink>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-3">
          {m.packs && (
            <div data-testid="daily-packs" className="nx-clip-sm flex flex-wrap items-center justify-between gap-3 border border-drl-gold/25 bg-drl-gold/[0.05] p-4">
              <p className="font-display text-[15px] font-bold uppercase text-white">{td(m.packs.label)}</p>
              {offline && snap.packs && snap.packs.unopened > 0
                ? <NxButton variant="secondary" size="md" disabled>{td(m.packs.cta.label)}</NxButton>
                : <NxButton variant="secondary" size="md" href={m.packs.cta.href}>{td(m.packs.cta.label)}</NxButton>}
            </div>
          )}
          {m.collection && (
            <div data-testid="daily-collection" className="nx-clip-sm border border-white/10 bg-black/25 p-4">
              <p className="flex items-baseline justify-between gap-2 text-[14px] text-white"><span className="font-semibold">{t("Colección")}</span><span className="nx-readout">{td(m.collection.label)}</span></p>
              <div className="mt-2"><Meter value={m.collection.pct} tone="info" height={6} label={t("Colección: {label}", { label: td(m.collection.label) })} /></div>
              <p className="mt-1 text-caption text-ink-muted">{td(m.collection.detail)}</p>
            </div>
          )}
          {m.achievements && (
            <Link href={m.achievements.href} data-testid="daily-achievements" className="nx-focus nx-clip-sm block min-h-[64px] border border-white/10 bg-black/25 p-4 transition hover:border-white/25">
              <span className="flex items-center justify-between gap-2">
                <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white/60">{t("Logros")}</span>
                {m.achievements.claimable && <Badge tone="gold">{t("Por reclamar")}</Badge>}
              </span>
              <span className="mt-1 block truncate text-[15px] font-semibold text-white">{td(m.achievements.label)}</span>
              {m.achievements.detail && <span className="block text-caption text-ink-muted">{td(m.achievements.detail)}</span>}
            </Link>
          )}
        </div>
        <div className="min-w-0"><LobbyShowcase cards={showcase} packs={snap.packs?.unopened ?? 0} offerAction={false} /></div>
      </div>
    </Panel>
  );
}
