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

export function Panel({ id, title, kicker, children, action, className, tone = "cyan" }: {
  id?: string; title: string; kicker?: string; children: React.ReactNode; action?: React.ReactNode; className?: string; tone?: "cyan" | "gold" | "red" | "violet";
}) {
  const rgb = { cyan: "25,227,255", gold: "255,211,92", red: "255,46,99", violet: "123,92,255" }[tone];
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn("nx-clip-sm relative flex min-w-0 flex-col border border-white/10 bg-[#0a0d16]/90 p-4 sm:p-5", className)} style={{ boxShadow: `inset 0 1px 0 rgba(${rgb},0.25)` }}>
      <span aria-hidden className="absolute left-0 top-0 h-full w-[3px]" style={{ background: `linear-gradient(180deg, rgba(${rgb},0.9), transparent)` }} />
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          {kicker && <span className="nx-label">{kicker}</span>}
          <h2 id={id ? `${id}-title` : undefined} className="font-display text-[clamp(16px,1.6vw,20px)] font-bold uppercase tracking-[0.08em] text-white">{title}</h2>
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
  const lo = Math.max(1, current - 2);
  const shown = levels.length <= 8 ? levels : levels.filter((l) => l.level >= lo).slice(0, 8);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="nx-label">{label}</span>
        <span className="text-[11px] text-ink-muted">{open ? "Abierto" : "Cerrado"}</span>
      </div>
      <ol className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" aria-label={label}>
        {shown.map((l) => {
          const st = l.claimed ? STATE.claimed : l.claimable ? STATE.claimable : STATE.locked;
          return (
            <li key={l.level} className={cn("flex w-[104px] shrink-0 flex-col rounded-[4px] border px-2 py-1.5", st.cls, l.level === current && "ring-1 ring-drl-cyan/60")} aria-label={`Nivel ${l.level}: ${describeReward(l.reward)}. ${st.text}.`}>
              <span className="flex items-center justify-between font-display text-[11px] font-bold"><span>N{l.level}</span><span aria-hidden>{st.glyph}</span></span>
              <span className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-white/80">{describeReward(l.reward)}</span>
              <span className="mt-auto pt-0.5 text-[10px] uppercase tracking-[0.1em]">{st.text}</span>
            </li>
          );
        })}
      </ol>
      {note && <p className="mt-1 text-[11px] text-ink-muted">{note}</p>}
    </div>
  );
}

export function PassPanel({ pass, account }: { pass: SeasonPassView | null; account: SeasonPersonal["account"] | null }) {
  if (!pass) {
    return (
      <Panel id="pase" kicker="Pase" title="Pase de temporada">
        <p className="text-body text-ink-muted">No hay pase activo para esta temporada.</p>
      </Panel>
    );
  }
  const claimable = pass.claimable.free + pass.claimable.competitive;
  const compNote = pass.competitiveUnlocked ? null
    : pass.competitiveUnlockPending ? "Has llegado al umbral: el carril se abre al entrar en Logros y pase."
      : `Se abre con ${pass.competitiveMinPoints} puntos de rango. Te faltan ${Math.max(0, pass.competitiveMinPoints - pass.points)}.`;
  return (
    <Panel id="pase" kicker="Pase de temporada" title={`Nivel ${pass.level} de ${pass.maxLevel}`}
      action={<NxButton variant={claimable > 0 ? "primary" : "secondary"} size="md" href="/logros" onClick={() => trackSeason("season_pass_open")}>{claimable > 0 ? `Reclamar ${claimable} en Logros y pase` : "Ver el pase completo"}</NxButton>}>
      <Meter value={pass.progress * 100} tone="info" height={8} label={`XP de pase: ${pass.xpIntoLevel} de ${pass.xpForNext}`} />
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="nx-label">XP de pase · <b className="nx-readout text-white">{pass.xpIntoLevel}</b> / {pass.xpForNext}</p>
        {account && <p className="nx-label" title="La XP de cuenta la dan duelos, sobres y Pick'ems y sube tu nivel de perfil. La XP de pase la dan los objetivos.">Nivel de cuenta <b className="nx-readout text-white">{account.level}</b> · XP de cuenta {account.xp}</p>}
      </div>
      {pass.nextReward && (
        <p className="mt-3 text-caption text-ink-secondary" data-testid="next-reward">
          Siguiente: <b className="text-white">nivel {pass.nextReward.level}</b> ({pass.nextReward.track === "free" ? "carril libre" : "carril competitivo"}) · {describeReward(pass.nextReward.reward)}
        </p>
      )}
      <div className="mt-4 grid gap-4">
        <TrackStrip label="Carril libre" levels={pass.tracks.free} current={pass.level} open />
        <TrackStrip label="Carril competitivo" levels={pass.tracks.competitive} current={pass.level} open={pass.competitiveUnlocked} note={compNote} />
      </div>
    </Panel>
  );
}

function Counter({ label, value }: { label: string; value: { done: number; total: number } }) {
  return (
    <div className="rounded-[4px] border border-white/10 bg-black/30 px-3 py-2" aria-label={`${label}: ${value.done} de ${value.total}`}>
      <span className="nx-label block">{label}</span>
      <b className="nx-readout text-[22px] leading-none text-white">{value.done}<span className="text-[14px] text-white/40">/{value.total}</span></b>
    </div>
  );
}

export function ObjectivesPanel({ objectives, serverNow }: { objectives: SeasonPersonal["objectives"]; serverNow: number }) {
  return (
    <Panel id="objetivos" kicker="Objetivos" title="Objetivos de temporada" tone="gold"
      action={<NxButton variant="secondary" size="md" href="/misiones" onClick={() => trackSeason("season_objective_open")}>Ver objetivos</NxButton>}>
      {!objectives || objectives.unassigned ? (
        <p className="text-body text-ink-muted">Aún no tienes objetivos asignados. Se asignan al abrir Objetivos.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Counter label="Hoy" value={objectives.daily} />
            <Counter label="Esta semana" value={objectives.weekly} />
            <Counter label="Temporada" value={objectives.seasonal} />
            <Counter label="Hitos" value={objectives.progressive} />
          </div>
          {objectives.rotationPending && <p className="mt-2 text-[11px] text-drl-gold">Hay una tanda nueva de objetivos: se renueva al abrir Objetivos.</p>}
          {objectives.claimable > 0 && <p className="mt-2 text-caption text-drl-gold">{objectives.claimable} {objectives.claimable === 1 ? "objetivo listo" : "objetivos listos"} para reclamar.</p>}
          {/* Una columna: en un panel estrecho la rejilla de `ObjectiveList` partía los títulos (medido en QA). */}
          {objectives.list.length > 0 && (
            <ul className="mt-3 grid gap-2" aria-label="Objetivos destacados">
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
  const cta = <NxButton variant="secondary" size="md" href="/competitivo" onClick={() => trackSeason("season_ranked_open")} data-testid="season-ranked-link">Ver competitivo</NxButton>;
  if (!competitive || competitive.gamesPlayed === 0) {
    return (
      <Panel id="ranked" kicker="Ranked" title="Tu competitivo" tone="red" action={<><NxButton variant="primary" size="md" href="/competitivo">Jugar ranked</NxButton>{cta}</>}>
        <p className="text-body text-ink-muted">Aún no has jugado ninguna partida ranked. El rating empieza en 1000.</p>
      </Panel>
    );
  }
  const c = competitive;
  return (
    <Panel id="ranked" kicker="Ranked" title="Tu competitivo" tone="red" action={cta}>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <span className="nx-label">Rating</span>
          <p className="nx-readout text-[40px] leading-none text-white">{c.rating}</p>
        </div>
        <div>
          <span className="nx-label">Posición</span>
          <p className="nx-readout text-[22px] leading-none text-white/85">{c.position !== null ? `#${c.position}` : "Sin clasificar"}<span className="text-[13px] text-white/40">{c.position !== null ? ` de ${c.rankedTotal}` : ""}</span></p>
        </div>
        {c.provisional && <span className="rounded-[3px] border border-drl-gold/50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-drl-gold">Provisional · {c.gamesPlayed}/10</span>}
      </div>
      <p className="mt-2 text-caption text-ink-secondary">Total: <b className="text-white">{c.wins}</b> V · <b className="text-white">{c.losses}</b> D · <b className="text-white">{c.draws}</b> E · {c.gamesPlayed} partidas</p>
      <p className="text-caption text-ink-secondary" data-testid="ranked-in-season">Esta temporada: <b className="text-white">{c.inSeason.games}</b> {c.inSeason.games === 1 ? "partida" : "partidas"}{c.inSeason.games > 0 ? ` · ${c.inSeason.wins} V · ${c.inSeason.losses} D · ${c.inSeason.draws} E` : ""}</p>
      {c.recent.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Últimas partidas ranked">
          {c.recent.map((r) => (
            <li key={r.at} className={cn("rounded-[3px] px-2 py-1 font-display text-[12px] font-bold", RESULT[r.result].cls)} aria-label={`${RESULT[r.result].w}, ${r.delta >= 0 ? "+" : ""}${r.delta}`}>
              {RESULT[r.result].t} <span className="tabular-nums">{r.delta > 0 ? `+${r.delta}` : r.delta}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">El rating es permanente: la temporada no lo reinicia.</p>
    </Panel>
  );
}

function EventRow({ e, live }: { e: SeasonEventLite; live: boolean }) {
  return (
    <li>
      <Link href={`/torneos/${e.id}`} onClick={() => trackSeason("season_event_open")} className="nx-focus flex min-h-[44px] items-center justify-between gap-3 rounded-[4px] border border-white/10 bg-black/30 px-3 py-2 hover:border-white/25">
        <span className="min-w-0">
          <b className="block truncate text-body text-white">{e.name}</b>
          <span className="text-[11px] text-ink-muted">{live ? `${e.liveCount} ${e.liveCount === 1 ? "partido" : "partidos"} en directo` : e.startDate ? `Empieza el ${new Date(e.startDate).toLocaleDateString("es-ES", { day: "numeric", month: "long" })}` : e.label}</span>
        </span>
        {live ? <span className="shrink-0 rounded-[3px] bg-drl/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-drl-glow">● En directo en NEXUS</span> : <span className="shrink-0 text-[11px] uppercase tracking-[0.1em] text-white/50">{e.label}</span>}
      </Link>
    </li>
  );
}

export function EventsPanel({ events, pickems }: { events: SeasonHubSnapshot["events"]; pickems: SeasonPersonal["pickems"] | null }) {
  return (
    <Panel id="eventos" kicker="Eventos" title="En directo en NEXUS" tone="violet"
      action={<NxButton variant="secondary" size="md" href="/torneos" onClick={() => trackSeason("season_event_open")}>Ver eventos</NxButton>}>
      {!events.available ? (
        <p className="text-body text-ink-muted">No se pudieron leer los eventos ahora mismo.</p>
      ) : events.live.length === 0 && events.upcoming.length === 0 ? (
        <p className="text-body text-ink-muted">No hay eventos en directo ni programados ahora mismo.</p>
      ) : (
        <ul className="space-y-1.5">
          {events.live.map((e) => <EventRow key={e.id} e={e} live />)}
          {events.upcoming.map((e) => <EventRow key={e.id} e={e} live={false} />)}
        </ul>
      )}
      {pickems && (
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="pickems-summary">
          <div className="rounded-[4px] border border-white/10 bg-black/30 px-2 py-1.5"><span className="nx-label block">{"Pick'ems pendientes"}</span><b className="nx-readout text-[20px] text-white">{pickems.pending}</b></div>
          <div className="rounded-[4px] border border-white/10 bg-black/30 px-2 py-1.5"><span className="nx-label block">Puntos (temporada)</span><b className="nx-readout text-[20px] text-white">{pickems.inSeason.points}</b></div>
          <div className="rounded-[4px] border border-white/10 bg-black/30 px-2 py-1.5"><span className="nx-label block">Aciertos</span><b className="nx-readout text-[20px] text-white">{pickems.inSeason.correct}</b></div>
        </div>
      )}
      {pickems && pickems.pending === 0 && pickems.inSeason.scored === 0 && <p className="mt-2 text-[11px] text-ink-faint">{"Sin Pick'ems pendientes ni puntuados en esta temporada."}</p>}
    </Panel>
  );
}

export function CollectionPanel({ collection }: { collection: SeasonPersonal["collection"] }) {
  const pct = collection.catalog > 0 ? (collection.distinct / collection.catalog) * 100 : 0;
  return (
    <Panel id="coleccion" kicker="Colección" title="Tu colección" action={<NxButton variant="secondary" size="md" href="/coleccion">Ver colección</NxButton>}>
      <p className="nx-readout text-[30px] leading-none text-white">{collection.distinct}<span className="text-[15px] text-white/40"> / {collection.catalog} distintas</span></p>
      <Meter value={pct} tone="key" height={6} className="mt-2" label={`Colección total: ${collection.distinct} de ${collection.catalog} cartas distintas`} />
      <p className="mt-1.5 text-caption text-ink-secondary">{collection.owned} ejemplares en total · colección TOTAL, no de esta temporada.</p>
      {collection.windowReliable && collection.obtainedInSeason !== null ? (
        <p className="mt-2 text-caption text-white" data-testid="season-cards">+{collection.obtainedInSeason} cartas conseguidas esta temporada (que conservas).</p>
      ) : (
        <p className="mt-2 text-[11px] text-ink-faint" data-testid="season-cards-omitted">Las cartas conseguidas por temporada no se muestran: la fecha de obtención no es fiable (el mercado y la sincronización la reescriben).</p>
      )}
    </Panel>
  );
}

export function AchievementsPanel({ achievements }: { achievements: SeasonPersonal["achievements"] }) {
  return (
    <Panel id="logros" kicker="Logros de NEXUS · permanentes" title="Logros" tone="gold" action={<NxButton variant="secondary" size="md" href="/logros">Ver logros</NxButton>}>
      <p className="nx-readout text-[30px] leading-none text-white">{achievements.claimed}<span className="text-[15px] text-white/40"> / {achievements.total} conseguidos</span></p>
      {achievements.claimable > 0 && <p className="mt-1 text-caption text-drl-gold">{achievements.claimable} {achievements.claimable === 1 ? "logro pendiente" : "logros pendientes"} de recoger.</p>}
      {achievements.total === 0 ? <p className="mt-2 text-body text-ink-muted">Sin logros disponibles.</p> : (
        <ul className="mt-3 space-y-1.5">
          {achievements.highlights.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 rounded-[4px] border border-white/10 bg-black/30 px-3 py-1.5">
              <span className="min-w-0 truncate text-caption text-white"><GameGlyph symbol={a.icon} className="mr-1.5 h-3.5 w-3.5 align-[-2px] text-drl-cyan" />{a.name}</span>
              <span className="shrink-0 text-[11px] text-ink-muted">{a.claimed ? "Conseguido" : a.complete ? "Pendiente de recoger" : `${a.current}/${a.goal}`}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
