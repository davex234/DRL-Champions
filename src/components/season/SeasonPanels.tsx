"use client";

/**
 * PANELES DEL SEASON HUB (Fase 34): pase, objetivos, ranked, eventos, colección y logros. Cada uno
 * RESUME un sistema que ya existe y enlaza a su casa (los reclamos siguen en `/logros`). Nada se
 * calcula como autoridad: todo llega en `SeasonPersonal` / `SeasonHubSnapshot`.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import { Meter } from "@/components/ui/Meter";
import { describeReward } from "@/components/progression/PassRail";
import { ObjectiveCard } from "@/components/progression/ObjectiveList";
import type { PassTrackLevelView } from "@/server/services/progression";
import type { SeasonHubSnapshot, SeasonPersonal, SeasonPassView, SeasonEventLite } from "@/server/services/season";
import { trackSeason } from "@/lib/season/telemetry";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("season");

export function Panel({ id, title, kicker, children, action, className, tone = "cyan" }: {
  id?: string; title: string; kicker?: string; children: React.ReactNode; action?: React.ReactNode; className?: string; tone?: "cyan" | "gold" | "red" | "violet";
}) {
  useLocale();
  const rgb = { cyan: "25,227,255", gold: "255,211,92", red: "255,46,99", violet: "123,92,255" }[tone];
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("nx-clip-sm relative flex min-w-0 flex-col border border-white/10 bg-[#0a0d16]/90 p-4 sm:p-5", className)} style={{ boxShadow: `inset 0 1px 0 rgba(${rgb},0.25)` }}>
      <span aria-hidden className="absolute left-0 top-0 h-full w-[3px]" style={{ background: `linear-gradient(180deg, rgba(${rgb},0.9), transparent)` }} />
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          {kicker && <span className="nx-label">{td(kicker)}</span>}
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-[clamp(16px,1.6vw,20px)] font-bold uppercase tracking-[0.08em] text-white">{td(title)}</h2>
        </div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </section>
  );
}

const STATE = {
  claimed: { text: "Reclamada", glyph: "✓", cls: "border-ok/40 text-ok" },
  claimable: { text: "Reclamable", glyph: "◆", cls: "border-drl-gold/70 text-drl-gold bg-drl-gold/10" },
  locked: { text: "Bloqueada", glyph: "·", cls: "border-white/10 text-white/45" },
} as const;

function TrackStrip({ label, levels, current, open, note }: { label: string; levels: PassTrackLevelView[]; current: number; open: boolean; note?: string | null }) {
  useLocale();
  const lo = Math.max(1, current - 2);
  const shown = levels.length <= 8 ? levels : levels.filter((l) => l.level >= lo).slice(0, 8);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="nx-label">{td(label)}</span>
        <span className="text-[11px] text-ink-muted">{open ? tr("Abierto") : tr("Cerrado")}</span>
      </div>
      <ol className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" aria-label={td(label)}>
        {shown.map((l) => {
          const st = l.claimed ? STATE.claimed : l.claimable ? STATE.claimable : STATE.locked;
          return (
            <li key={l.level} className={cn("flex w-[104px] shrink-0 flex-col rounded-[4px] border px-2 py-1.5", st.cls, l.level === current && "ring-1 ring-drl-cyan/60")} aria-label={tr("Nivel {level}: {reward}. {text}.", { level: l.level, reward: describeReward(l.reward), text: td(st.text) })}>
              <span className="flex items-center justify-between font-display text-[11px] font-bold"><span>N{l.level}</span><span aria-hidden>{st.glyph}</span></span>
              <span className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-white/80">{describeReward(l.reward)}</span>
              <span className="mt-auto pt-0.5 text-[10px] uppercase tracking-[0.1em]">{td(st.text)}</span>
            </li>
          );
        })}
      </ol>
      {note && <p className="mt-1 text-[11px] text-ink-muted">{td(note)}</p>}
    </div>
  );
}

export function PassPanel({ pass, account }: { pass: SeasonPassView | null; account: SeasonPersonal["account"] | null }) {
  useLocale();
  if (!pass) {
    return (
      <Panel id="pase" kicker={tr("Pase")} title={tr("Pase de temporada")}>
        <p className="text-body text-ink-muted">{tr("No hay pase activo para esta temporada.")}</p>
      </Panel>
    );
  }
  const claimable = pass.claimable.free + pass.claimable.competitive;
  const compNote = pass.competitiveUnlocked ? null
    : pass.competitiveUnlockPending ? tr("Has llegado al umbral: el carril se abre al entrar en Logros y pase.")
      : tr("Se abre con {competitiveMinPoints} puntos de rango. Te faltan {Math}.", { competitiveMinPoints: pass.competitiveMinPoints, Math: Math.max(0, pass.competitiveMinPoints - pass.points) });
  return (
    <Panel id="pase" kicker={tr("Pase de temporada")} title={tr("Nivel {level} de {maxLevel}", { level: pass.level, maxLevel: pass.maxLevel })}
      action={<NxButton variant={claimable > 0 ? "primary" : "secondary"} size="md" href="/logros" onClick={() => trackSeason("season_pass_open")}>{claimable > 0 ? tr("Reclamar {claimable} en Logros y pase", { claimable }) : tr("Ver el pase completo")}</NxButton>}>
      <Meter value={pass.progress * 100} tone="info" height={8} label={tr("XP de pase: {xpIntoLevel} de {xpForNext}", { xpIntoLevel: pass.xpIntoLevel, xpForNext: pass.xpForNext })} />
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="nx-label">{tr("XP de pase ·")} <b className="nx-readout text-white">{pass.xpIntoLevel}</b> / {pass.xpForNext}</p>
        {account && <p className="nx-label" title={tr("La XP de cuenta la dan duelos, sobres y Pick'ems y sube tu nivel de perfil. La XP de pase la dan los objetivos.")}>{tr("Nivel de cuenta")} <b className="nx-readout text-white">{account.level}</b> {tr("· XP de cuenta")} {account.xp}</p>}
      </div>
      {pass.nextReward && (
        <p className="mt-3 text-caption text-ink-secondary" data-testid="next-reward">
          {tr("Siguiente:")} <b className="text-white">{tr("nivel")} {pass.nextReward.level}</b> ({pass.nextReward.track === "free" ? tr("carril libre") : tr("carril competitivo")}) · {describeReward(pass.nextReward.reward)}
        </p>
      )}
      <div className="mt-4 grid gap-4">
        <TrackStrip label={tr("Carril libre")} levels={pass.tracks.free} current={pass.level} open />
        <TrackStrip label={tr("Carril competitivo")} levels={pass.tracks.competitive} current={pass.level} open={pass.competitiveUnlocked} note={td(compNote)} />
      </div>
    </Panel>
  );
}

function Counter({ label, value }: { label: string; value: { done: number; total: number } }) {
  useLocale();
  return (
    <div className="rounded-[4px] border border-white/10 bg-black/30 px-3 py-2" aria-label={tr("{label}: {done} de {total}", { label: td(label), done: value.done, total: value.total })}>
      <span className="nx-label block">{td(label)}</span>
      <b className="nx-readout text-[22px] leading-none text-white">{value.done}<span className="text-[14px] text-white/40">/{value.total}</span></b>
    </div>
  );
}

export function ObjectivesPanel({ objectives, serverNow }: { objectives: SeasonPersonal["objectives"]; serverNow: number }) {
  useLocale();
  return (
    <Panel id="objetivos" kicker={tr("Objetivos")} title={tr("Objetivos de temporada")} tone="gold"
      action={<NxButton variant="secondary" size="md" href="/misiones" onClick={() => trackSeason("season_objective_open")}>{tr("Ver objetivos")}</NxButton>}>
      {!objectives || objectives.unassigned ? (
        <p className="text-body text-ink-muted">{tr("Aún no tienes objetivos asignados. Se asignan al abrir Objetivos.")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Counter label={tr("Hoy")} value={objectives.daily} />
            <Counter label={tr("Esta semana")} value={objectives.weekly} />
            <Counter label={tr("Temporada")} value={objectives.seasonal} />
            <Counter label={tr("Hitos")} value={objectives.progressive} />
          </div>
          {objectives.rotationPending && <p className="mt-2 text-[11px] text-drl-gold">{tr("Hay una tanda nueva de objetivos: se renueva al abrir Objetivos.")}</p>}
          {objectives.claimable > 0 && <p className="mt-2 text-caption text-drl-gold">{objectives.claimable} {objectives.claimable === 1 ? tr("objetivo listo") : tr("objetivos listos")} {tr("para reclamar.")}</p>}
          {/* Una columna: en un panel estrecho la rejilla de `ObjectiveList` partía los títulos (medido en QA). */}
          {objectives.list.length > 0 && (
            <ul className="mt-3 grid gap-2" aria-label={tr("Objetivos destacados")}>
              {objectives.list.slice(0, 3).map((o) => <li key={`${o.id}@${o.assignedAt}`}><ObjectiveCard objective={o} now={serverNow} compact /></li>)}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

const RESULT = { WIN: { t: "V", cls: "bg-ok/20 text-ok", w: "Victoria" }, LOSS: { t: "D", cls: "bg-drl/20 text-drl-glow", w: "Derrota" }, DRAW: { t: "E", cls: "bg-white/10 text-white/70", w: "Empate" } } as const;

export function CompetitivePanel({ competitive }: { competitive: SeasonPersonal["competitive"] }) {
  useLocale();
  const cta = <NxButton variant="secondary" size="md" href="/competitivo" onClick={() => trackSeason("season_ranked_open")} data-testid="season-ranked-link">{tr("Ver competitivo")}</NxButton>;
  if (!competitive || competitive.gamesPlayed === 0) {
    return (
      <Panel id="ranked" kicker={tr("Ranked")} title={tr("Tu competitivo")} tone="red" action={<><NxButton variant="primary" size="md" href="/competitivo">{tr("Jugar ranked")}</NxButton>{td(cta)}</>}>
        <p className="text-body text-ink-muted">{tr("Aún no has jugado ninguna partida ranked. El rating empieza en 1000.")}</p>
      </Panel>
    );
  }
  const c = competitive;
  return (
    <Panel id="ranked" kicker={tr("Ranked")} title={tr("Tu competitivo")} tone="red" action={cta}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <span className="nx-label">{tr("Rating")}</span>
          <p className="nx-readout text-[40px] leading-none text-white">{c.rating}</p>
        </div>
        <div>
          <span className="nx-label">{tr("Posición")}</span>
          <p className="nx-readout text-[22px] leading-none text-white/85">{c.position !== null ? `#${c.position}` : tr("Sin clasificar")}<span className="text-[13px] text-white/40">{c.position !== null ? tr(" de {rankedTotal}", { rankedTotal: c.rankedTotal }) : ""}</span></p>
        </div>
        {c.provisional && <span className="rounded-[3px] border border-drl-gold/50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-drl-gold">{tr("Provisional ·")} {c.gamesPlayed}/10</span>}
      </div>
      <p className="mt-2 text-caption text-ink-secondary">{fill(tr("Total: {wins} V · {losses} D · {draws} E · {games} partidas", { ...slots("wins", "losses", "draws"), games: c.gamesPlayed }), { wins: <b className="text-white">{c.wins}</b>, losses: <b className="text-white">{c.losses}</b>, draws: <b className="text-white">{c.draws}</b> })}</p>
      <p className="text-caption text-ink-secondary" data-testid="ranked-in-season">{tr("Esta temporada:")} <b className="text-white">{c.inSeason.games}</b> {c.inSeason.games === 1 ? tr("partida") : tr("partidas")}{c.inSeason.games > 0 ? tr(" · {wins} V · {losses} D · {draws} E", { wins: c.inSeason.wins, losses: c.inSeason.losses, draws: c.inSeason.draws }) : ""}</p>
      {c.recent.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-1.5" aria-label={tr("Últimas partidas ranked")}>
          {c.recent.map((r) => (
            <li key={r.at} className={cn("rounded-[3px] px-2 py-1 font-display text-[12px] font-bold", RESULT[r.result].cls)} aria-label={`${RESULT[r.result].w}, ${r.delta >= 0 ? "+" : ""}${r.delta}`}>
              {RESULT[r.result].t} <span className="tabular-nums">{r.delta > 0 ? `+${r.delta}` : r.delta}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">{tr("El rating es permanente: la temporada no lo reinicia.")}</p>
    </Panel>
  );
}

function EventRow({ e, live }: { e: SeasonEventLite; live: boolean }) {
  useLocale();
  return (
    <li>
      <Link href={`/torneos/${e.id}`} onClick={() => trackSeason("season_event_open")} className="nx-focus flex min-h-[44px] items-center justify-between gap-3 rounded-[4px] border border-white/10 bg-black/30 px-3 py-2 hover:border-white/25">
        <span className="min-w-0">
          <b className="block truncate text-body text-white">{e.name}</b>
          <span className="text-[11px] text-ink-muted">{live ? tr("{liveCount} {v} en directo", { liveCount: e.liveCount, v: e.liveCount === 1 ? tr("partido") : tr("partidos") }) : e.startDate ? tr("Empieza el {v}", { v: new Date(e.startDate).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "long" }) }) : td(e.label)}</span>
        </span>
        {live ? <span className="shrink-0 rounded-[3px] bg-drl/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-drl-glow">{tr("● En directo en NEXUS")}</span> : <span className="shrink-0 text-[11px] uppercase tracking-[0.1em] text-white/50">{td(e.label)}</span>}
      </Link>
    </li>
  );
}

export function EventsPanel({ events, pickems }: { events: SeasonHubSnapshot["events"]; pickems: SeasonPersonal["pickems"] | null }) {
  useLocale();
  return (
    <Panel id="eventos" kicker={tr("Eventos")} title={tr("En directo en NEXUS")} tone="violet"
      action={<NxButton variant="secondary" size="md" href="/torneos" onClick={() => trackSeason("season_event_open")}>{tr("Ver eventos")}</NxButton>}>
      {!events.available ? (
        <p className="text-body text-ink-muted">{tr("No se pudieron leer los eventos ahora mismo.")}</p>
      ) : events.live.length === 0 && events.upcoming.length === 0 ? (
        <p className="text-body text-ink-muted">{tr("No hay eventos en directo ni programados ahora mismo.")}</p>
      ) : (
        <ul className="space-y-1.5">
          {events.live.map((e) => <EventRow key={e.id} e={e} live />)}
          {events.upcoming.map((e) => <EventRow key={e.id} e={e} live={false} />)}
        </ul>
      )}
      {pickems && (
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="pickems-summary">
          <div className="rounded-[4px] border border-white/10 bg-black/30 px-2 py-1.5"><span className="nx-label block">{tr("Pick'ems pendientes")}</span><b className="nx-readout text-[20px] text-white">{pickems.pending}</b></div>
          <div className="rounded-[4px] border border-white/10 bg-black/30 px-2 py-1.5"><span className="nx-label block">{tr("Puntos (temporada)")}</span><b className="nx-readout text-[20px] text-white">{pickems.inSeason.points}</b></div>
          <div className="rounded-[4px] border border-white/10 bg-black/30 px-2 py-1.5"><span className="nx-label block">{tr("Aciertos")}</span><b className="nx-readout text-[20px] text-white">{pickems.inSeason.correct}</b></div>
        </div>
      )}
      {pickems && pickems.pending === 0 && pickems.inSeason.scored === 0 && <p className="mt-2 text-[11px] text-ink-faint">{tr("Sin Pick'ems pendientes ni puntuados en esta temporada.")}</p>}
    </Panel>
  );
}

export function CollectionPanel({ collection }: { collection: SeasonPersonal["collection"] }) {
  useLocale();
  const pct = collection.catalog > 0 ? (collection.distinct / collection.catalog) * 100 : 0;
  return (
    <Panel id="coleccion" kicker={tr("Colección")} title={tr("Tu colección")} action={<NxButton variant="secondary" size="md" href="/coleccion">{tr("Ver colección")}</NxButton>}>
      <p className="nx-readout text-[30px] leading-none text-white">{collection.distinct}<span className="text-[15px] text-white/40"> / {collection.catalog} {tr("distintas")}</span></p>
      <Meter value={pct} tone="key" height={6} className="mt-2" label={tr("Colección total: {distinct} de {catalog} cartas distintas", { distinct: collection.distinct, catalog: collection.catalog })} />
      <p className="mt-1.5 text-caption text-ink-secondary">{tr("{n} ejemplares en total · colección TOTAL, no de esta temporada.", { n: collection.owned })}</p>
      {collection.windowReliable && collection.obtainedInSeason !== null ? (
        <p className="mt-2 text-caption text-white" data-testid="season-cards">{tr("+{n} cartas conseguidas esta temporada (que conservas).", { n: collection.obtainedInSeason })}</p>
      ) : (
        <p className="mt-2 text-[11px] text-ink-faint" data-testid="season-cards-omitted">{tr("Las cartas conseguidas por temporada no se muestran: la fecha de obtención no es fiable (el mercado y la sincronización la reescriben).")}</p>
      )}
    </Panel>
  );
}

export function AchievementsPanel({ achievements }: { achievements: SeasonPersonal["achievements"] }) {
  useLocale();
  return (
    <Panel id="logros" kicker={tr("Logros de NEXUS · permanentes")} title={tr("Logros")} tone="gold" action={<NxButton variant="secondary" size="md" href="/logros">{tr("Ver logros")}</NxButton>}>
      <p className="nx-readout text-[30px] leading-none text-white">{achievements.claimed}<span className="text-[15px] text-white/40"> / {achievements.total} {tr("conseguidos")}</span></p>
      {achievements.claimable > 0 && <p className="mt-1 text-caption text-drl-gold">{achievements.claimable} {achievements.claimable === 1 ? tr("logro pendiente") : tr("logros pendientes")} {tr("de recoger.")}</p>}
      {achievements.total === 0 ? <p className="mt-2 text-body text-ink-muted">{tr("Sin logros disponibles.")}</p> : (
        <ul className="mt-3 space-y-1.5">
          {achievements.highlights.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-[4px] border border-white/10 bg-black/30 px-3 py-1.5">
              <span className="min-w-0 truncate text-caption text-white"><GameGlyph symbol={a.icon} className="mr-1.5 h-3.5 w-3.5 align-[-2px] text-drl-cyan" />{a.name}</span>
              <span className="shrink-0 text-[11px] text-ink-muted">{a.claimed ? tr("Conseguido") : a.complete ? tr("Pendiente de recoger") : `${a.current}/${a.goal}`}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
