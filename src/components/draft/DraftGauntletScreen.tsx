"use client";

/**
 * DRAFT GAUNTLET · SALA DE GUERRA (Fase 39) — pantalla PURA: recibe la foto del servidor y el estado de la elección,
 * y avisa de intenciones. La usan la ruta real y el arnés `/design-system/fase39` (mismo componente, estados reales).
 *
 * Momentos: sin run (portada + última run + historial) → DRAFT (3 opciones → vista previa → CONFIRMAR ELECCIÓN) →
 * PLANTILLA COMPLETA → mapa de 5 combates → combate (arena canónica) → resumen. Nada de «MEJOR» ni «RECOMENDADA».
 * F72 · la portada enseña la ENTRADA y la escalera de premios del servidor y entra con confirmación (ENTRAR · 2.000);
 * una run con la entrada sin cobrar pide completarla; la última run dice lo que pagó.
 */
import { MotionConfig, motion } from "framer-motion";
import { cn } from "@/lib/format";
import { NxButton } from "@/components/ui/NxButton";
import type { DraftSnapshot } from "@/domain/draft/snapshot";
import type { DraftRunView } from "@/domain/draft/run";
import { DRAFT_PICKS, GAUNTLET_STAGES } from "@/domain/draft/rules";
import {
  compareWithRole, isFinal, roleProgress, rosterSlots, runHeadline, type PickUi,
} from "@/lib/draft/presentation";
import { GauntletMap } from "./GauntletMap";
import { ComparePanel, DraftOption, RosterStrip } from "./DraftCards";
import { playerMessage } from "@/components/ui/game/GameStates";
import { DraftEntryButton, DraftRewardLadder } from "./DraftEntry";
import { rewardSummary } from "@/lib/draft/presentation";

export interface DraftNotice { tone: "info" | "warn" | "error"; text: string }

export interface DraftScreenProps {
  snapshot: DraftSnapshot | null;
  loading?: boolean;
  offline?: boolean;
  busy?: boolean;
  ui: PickUi;
  notice?: DraftNotice | null;
  abandonOpen?: boolean;
  forceArtFallback?: boolean;
  onStart: () => void;
  onSelect: (index: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onStartMatch: () => void;
  onResumeMatch: () => void;
  onAbandonRequest: () => void;
  onAbandonConfirm: () => void;
  onAbandonCancel: () => void;
  onRetry?: () => void;
}

const NOTICE_TONE = { info: "border-drl-cyan text-ink-secondary", warn: "border-drl-gold text-drl-gold", error: "border-drl text-drl-glow" } as const;

function Header({ run, children }: { run: DraftRunView | null; children?: React.ReactNode }) {
  const h = runHeadline(run);
  return (
    <header className="relative flex flex-wrap items-end justify-between gap-3" data-testid="draft-header">
      <div className="min-w-0">
        <p className="nx-label text-drl-gold">{h.kicker}</p>
        <h1 className="font-display text-[clamp(34px,6.4vw,72px)] font-bold uppercase leading-[0.88] text-white" data-testid="draft-title">{h.title}</h1>
        {h.detail && <p className="mt-1 font-display text-[clamp(13px,1.8vw,18px)] font-bold uppercase tracking-[0.2em] text-white/60" data-testid="draft-detail">{h.detail}</p>}
      </div>
      {children}
    </header>
  );
}

function AbandonConfirm({ onConfirm, onCancel, busy }: { onConfirm: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div role="alertdialog" aria-labelledby="draft-abandon-title" data-testid="draft-abandon-confirm" className="nx-clip-sm border border-drl/60 bg-drl/[0.07] px-4 py-3">
      <p id="draft-abandon-title" className="font-display text-[18px] font-bold uppercase text-white">¿Abandonar la run?</p>
      <p className="mt-1 text-caption text-ink-secondary">Cobras lo de tus victorias actuales, como si cayeras en este combate. La entrada no se devuelve.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <NxButton variant="danger" size="md" onClick={onConfirm} disabled={busy} data-testid="draft-abandon-yes">Sí, abandonar</NxButton>
        <NxButton variant="ghost" size="md" onClick={onCancel} disabled={busy} data-testid="draft-abandon-no" autoFocus>Seguir jugando</NxButton>
      </div>
    </div>
  );
}

function Landing({ snapshot, disabled, busy, onStart, pending = false }: { snapshot: DraftSnapshot; disabled: boolean; busy: boolean; onStart: () => void; pending?: boolean }) {
  const last = pending ? null : snapshot.lastRun;
  const h = last ? runHeadline(last) : null;
  const econ = snapshot.economy;
  return (
    <div className="space-y-5" data-testid="draft-landing">
      <section className="nx-clip relative isolate overflow-hidden border border-drl-gold/40 px-5 py-6 sm:px-8 sm:py-8" style={{ background: "radial-gradient(90% 130% at 90% 0%, rgba(255,211,92,0.2), transparent 58%), linear-gradient(160deg, #0c1220, #06070d)" }}>
        <p className="nx-label text-drl-gold">NEXUS · Modo PvE</p>
        <h1 className="mt-2 font-display text-[clamp(40px,7.5vw,88px)] font-bold uppercase leading-[0.85] text-white">Draft <span className="text-drl-gold">Gauntlet</span></h1>
        <p className="mt-2 font-display text-[clamp(14px,2vw,22px)] font-bold uppercase tracking-[0.22em] text-white/65">{snapshot.mode.tagline}</p>
        <ul className="mt-4 grid gap-1.5 text-body text-ink-secondary sm:grid-cols-2">
          <li>· {snapshot.mode.picks} elecciones, {snapshot.mode.options} cartas reales por elección.</li>
          <li>· Dos por rol: Duelista, Controlador, Iniciador, Centinela y Flex.</li>
          <li>· {snapshot.mode.stages} rivales seguidos. Pierdes o empatas y la run termina.</li>
          <li>· Las cartas del draft no entran en tu colección.</li>
        </ul>
        <div className="mt-6 grid items-end gap-5 md:grid-cols-[minmax(0,1fr)_320px]" data-testid="draft-entry">
          <div>
            <p className="flex items-baseline gap-2">
              <span className="font-display text-[13px] font-bold uppercase tracking-[0.18em] text-white/60">Entrada</span>
              <span className="nx-readout text-[34px] leading-none text-drl-gold" data-field="entry-fee">{new Intl.NumberFormat("es-ES", { useGrouping: "always" } as Intl.NumberFormatOptions).format(econ.entryFee)}</span>
              <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-drl-gold/80">créditos</span>
            </p>
            <DraftRewardLadder economy={econ} className="mt-3 max-w-[560px]" />
            <p className="mt-2 text-[12px] font-bold uppercase tracking-[0.08em] text-white/60">Completarlo: título «{econ.title}»</p>
          </div>
          <div>
            {pending && <p className="mb-2 text-[12.5px] font-bold uppercase tracking-[0.1em] text-drl-gold" data-testid="draft-entry-pending">Tu run espera la entrada</p>}
            <DraftEntryButton fee={econ.entryFee} disabled={disabled} busy={busy} onConfirm={onStart} testId="draft-start" className="min-h-[60px] text-[17px] tracking-[0.16em]" />
          </div>
        </div>
      </section>

      {last && h && (
        <section aria-label="Última run" data-testid="draft-last-run" data-status={last.status} className="nx-clip-sm space-y-3 border border-white/10 bg-white/[0.02] px-4 py-4">
          <div>
            <p className="nx-label">Última run</p>
            <p className="font-display text-[26px] font-bold uppercase leading-none text-white">{h.title}</p>
            <p className="mt-1 text-caption text-ink-muted">{h.detail} · {last.wins}/{GAUNTLET_STAGES} victorias</p>
            {last.reward && (
              <p className="mt-2 font-display text-[18px] font-bold uppercase tracking-[0.06em] text-drl-gold" data-testid="draft-last-reward" data-granted={last.reward.granted ? "true" : "false"}>
                {rewardSummary(last.reward)}
              </p>
            )}
          </div>
          <GauntletMap stages={last.stages} />
          {last.picks.length > 0 && <RosterStrip slots={rosterSlots(last, snapshot.cards)} />}
        </section>
      )}

      {snapshot.history.length > 0 && (
        <section aria-label="Historial" data-testid="draft-history" className="nx-clip-sm border border-white/10 bg-white/[0.02] px-4 py-3">
          <p className="nx-label">Historial</p>
          <ol className="mt-2 grid gap-1">
            {snapshot.history.map((r) => (
              <li key={r.runId} className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink-secondary">
                <span className="font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white">{r.status === "COMPLETED" ? "Completada" : r.status === "FAILED" ? "Terminada" : "Abandonada"}</span>
                <span className="nx-readout tabular-nums">{r.wins}/{GAUNTLET_STAGES} victorias</span>
                <time className="text-white/45" dateTime={r.completedAt ?? r.createdAt}>{new Date(r.completedAt ?? r.createdAt).toLocaleDateString("es-ES")}</time>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Drafting({ run, snapshot, ui, disabled, busy, forceArtFallback, onSelect, onCancel, onConfirm }: {
  run: DraftRunView; snapshot: DraftSnapshot; ui: PickUi; disabled: boolean; busy: boolean; forceArtFallback: boolean;
  onSelect: (i: number) => void; onCancel: () => void; onConfirm: () => void;
}) {
  const options = run.offer.map((id) => snapshot.cards[id]).filter(Boolean);
  const chosenIndex = ui.phase === "browse" ? null : ui.index;
  const chosen = chosenIndex !== null ? options[chosenIndex] ?? null : null;
  const progress = roleProgress(run, snapshot.cards);
  return (
    <div className="space-y-4" data-testid="draft-room" data-pick={run.pickIndex}>
      <ol aria-label="Roles del equipo" className="flex flex-wrap gap-1.5">
        {progress.map((p) => (
          <li key={p.role} className={cn("rounded-[3px] border px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]", run.currentRole === p.role ? "border-drl-gold text-drl-gold" : p.have === p.need ? "border-[#3fc07a]/60 text-[#6fe0a0]" : "border-white/15 text-white/55")}>
            {p.role} {p.have}/{p.need}
          </li>
        ))}
      </ol>

      {/* F72 · escenario: foco de luz y suelo DETRÁS de las tres cartas (la carta sigue siendo el asset). */}
      <div className="relative isolate" data-testid="draft-stage">
        <span aria-hidden className="pointer-events-none absolute -inset-x-4 -top-6 bottom-8 -z-10 hidden md:block" style={{ background: "radial-gradient(60% 55% at 50% 30%, rgba(255,211,92,0.14), transparent 70%), conic-gradient(from 180deg at 50% -10%, transparent 150deg, rgba(255,255,255,0.05) 170deg, transparent 190deg)" }} />
        <span aria-hidden className="pointer-events-none absolute inset-x-[6%] bottom-[34%] -z-10 hidden h-10 rounded-[50%] md:block" style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.08), transparent)" }} />
        <div role="group" aria-label={`Elige un ${run.currentRole ?? "jugador"}`} className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-2 pt-4 md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0" data-testid="draft-options" key={run.pickIndex}>
          {options.map((card, i) => (
            <DraftOption key={card.cardId} card={card} index={i} selected={chosenIndex === i} dimmed={chosenIndex !== null && chosenIndex !== i} disabled={disabled || busy} onSelect={onSelect} forceFallback={forceArtFallback} />
          ))}
        </div>
      </div>
      <p className="hidden text-center text-[11px] uppercase tracking-[0.14em] text-white/40 md:block">Teclas 1 · 2 · 3 para elegir · Enter confirma · Esc cancela</p>

      {chosen && (
        <>
          {/* `sticky` no se pega en DRLCards (overflow-x:hidden en html/body): pie `fixed` sobre la barra móvil + hueco. */}
          <div aria-hidden className="h-[min(46vh,300px)]" data-testid="draft-preview-spacer" />
          <div className="fixed inset-x-0 bottom-[var(--nx-mobilebar)] z-40 px-3 pb-2 lg:bottom-0 lg:pb-[calc(8px+env(safe-area-inset-bottom))]">
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} aria-live="polite" data-testid="draft-preview" className="nx-clip-sm mx-auto max-h-[46vh] w-full max-w-[1180px] space-y-3 overflow-y-auto border border-drl-gold/60 bg-[#0b0f19]/95 px-4 py-3 shadow-2xl backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 font-display text-[18px] font-bold uppercase leading-tight text-white">Elegir a <span className="text-drl-gold">{chosen.nick}</span> <span className="text-white/50">· {chosen.role}</span></p>
                <div className="flex gap-2">
                  <NxButton variant="ghost" size="md" onClick={onCancel} disabled={busy} data-testid="draft-cancel">Cancelar</NxButton>
                  <NxButton variant="primary" size="lg" onClick={onConfirm} disabled={disabled || busy} data-cta="primary" data-testid="draft-confirm" className="min-w-[220px]">{busy ? "Confirmando…" : "Confirmar elección"}</NxButton>
                </div>
              </div>
              <ComparePanel option={chosen} rows={compareWithRole(chosen, run, snapshot.cards)} />
            </motion.section>
          </div>
        </>
      )}

      <section aria-label="Tu equipo" className="space-y-2">
        <p className="nx-label">Equipo temporal · {run.pickIndex}/{DRAFT_PICKS}</p>
        <RosterStrip slots={rosterSlots(run, snapshot.cards)} freshIndex={run.pickIndex > 0 ? run.pickIndex - 1 : null} />
      </section>
    </div>
  );
}

function Gauntlet({ run, snapshot, disabled, busy, onStartMatch, onResumeMatch }: {
  run: DraftRunView; snapshot: DraftSnapshot; disabled: boolean; busy: boolean; onStartMatch: () => void; onResumeMatch: () => void;
}) {
  const fresh = run.status === "READY" && run.stage === 1 && run.stages.every((s) => s.state === "LOCKED" || s.state === "CURRENT");
  const next = run.stages[run.stage - 1];
  return (
    <div className="space-y-4" data-testid="draft-gauntlet" data-status={run.status}>
      {fresh && (
        <motion.p initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} data-testid="draft-complete" className="nx-clip-sm border border-[#3fc07a]/60 bg-[#3fc07a]/[0.08] px-4 py-3 text-center font-display text-[clamp(22px,4vw,36px)] font-bold uppercase tracking-[0.12em] text-[#6fe0a0]">
          Equipo completo
        </motion.p>
      )}
      <GauntletMap stages={run.stages} />
      <div className="flex flex-wrap items-center justify-between gap-3 nx-clip-sm border border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="min-w-0">
          <p className="nx-label">{run.status === "IN_MATCH" ? "Combate abierto" : "Siguiente combate"}</p>
          <p className="font-display text-[22px] font-bold uppercase leading-none text-white">{next?.label === "FINAL" ? "Final" : `Combate ${next?.label}`} · {next?.rivalName}</p>
        </div>
        {run.status === "IN_MATCH"
          ? <NxButton variant="primary" size="lg" onClick={onResumeMatch} disabled={disabled} data-testid="draft-resume-match">Retomar combate</NxButton>
          : <NxButton variant="primary" size="lg" onClick={onStartMatch} disabled={disabled || busy} data-testid="draft-start-match">{busy ? "Preparando…" : next?.label === "FINAL" ? "Jugar la final" : `Jugar combate ${next?.label}`}</NxButton>}
      </div>
      <section aria-label="Tu equipo" className="space-y-2">
        <p className="nx-label">Tu equipo</p>
        <RosterStrip slots={rosterSlots(run, snapshot.cards)} />
      </section>
    </div>
  );
}

export function DraftGauntletScreen(p: DraftScreenProps) {
  const { snapshot } = p;
  const disabled = !!p.offline || !snapshot || !snapshot.available;
  const run = snapshot?.run ?? null;
  const busy = !!p.busy;
  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1180px] space-y-5" data-testid="draft-screen" data-run-status={run?.status ?? "NONE"}>
        {run && (
          <Header run={run}>
            {!isFinal(run.status) && !p.abandonOpen && (
              <NxButton variant="ghost" size="md" onClick={p.onAbandonRequest} disabled={disabled || busy} data-testid="draft-abandon">Abandonar run</NxButton>
            )}
          </Header>
        )}

        {p.offline && (
          <p role="status" data-testid="draft-offline" className="border-l-2 border-drl-gold bg-white/[0.03] px-4 py-2 text-caption text-drl-gold">SIN CONEXIÓN · Esta es la última foto de tu run. Las acciones vuelven con la conexión.</p>
        )}
        {p.notice && (
          <p role="status" aria-live="polite" data-testid="draft-notice" data-tone={p.notice.tone} className={cn("border-l-2 bg-white/[0.03] px-4 py-2 text-caption", NOTICE_TONE[p.notice.tone])}>{playerMessage(p.notice.text)}</p>
        )}
        {p.abandonOpen && run && <AbandonConfirm onConfirm={p.onAbandonConfirm} onCancel={p.onAbandonCancel} busy={busy} />}

        {!snapshot ? (
          p.loading ? (
            <div data-testid="draft-loading" className="space-y-3" aria-busy="true">
              <div className="h-24 animate-pulse rounded bg-white/[0.04]" />
              <div className="grid gap-3 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="aspect-[5/7] animate-pulse rounded bg-white/[0.04]" />)}</div>
            </div>
          ) : (
            <div data-testid="draft-error" className="nx-clip-sm border border-white/10 px-4 py-4">
              <p className="text-body text-ink-secondary">No se pudo leer Draft Gauntlet.</p>
              {p.onRetry && <NxButton variant="secondary" size="md" className="mt-3" onClick={p.onRetry}>Reintentar</NxButton>}
            </div>
          )
        ) : !snapshot.available ? (
          <div data-testid="draft-unavailable" className="nx-clip border border-white/15 px-5 py-8 text-center">
            <p className="nx-label">Draft Gauntlet</p>
            <p className="mt-2 font-display text-[clamp(22px,4vw,40px)] font-bold uppercase text-white">Draft Gauntlet todavía no disponible</p>
            <p className="mt-2 text-caption text-ink-muted">Tu colección, tus sobres y tu progreso no cambian.</p>
          </div>
        ) : !run ? (
          <Landing snapshot={snapshot} disabled={disabled} busy={busy} onStart={p.onStart} />
        ) : run.entry && !run.entry.paid ? (
          <Landing snapshot={snapshot} disabled={disabled} busy={busy} onStart={p.onStart} pending />
        ) : run.status === "DRAFTING" ? (
          <Drafting run={run} snapshot={snapshot} ui={p.ui} disabled={disabled} busy={busy} forceArtFallback={!!p.forceArtFallback} onSelect={p.onSelect} onCancel={p.onCancel} onConfirm={p.onConfirm} />
        ) : (
          <Gauntlet run={run} snapshot={snapshot} disabled={disabled} busy={busy} onStartMatch={p.onStartMatch} onResumeMatch={p.onResumeMatch} />
        )}
      </div>
    </MotionConfig>
  );
}
