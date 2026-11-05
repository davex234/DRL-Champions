"use client";

/**
 * PLAYER JOURNEY · MISSION CONTROL DE LA PRIMERA SESIÓN (Fase 40).
 *
 * Sustituye al héroe del vestíbulo SOLO cuando la acción principal que el servidor decidió es del recorrido (una partida a
 * medias siempre gana y entonces esto no se pinta). Pinta, sin inventar nada:
 *
 *   · bienvenida (nada hecho todavía): NEXUS · Colecciona. Construye. Compite. + tres cartas REALES del catálogo
 *   · la línea de los cuatro pasos (Abre · Colecciona · Construye · Juega) con estado en TEXTO
 *   · el contexto del paso: roles que faltan (Colecciona) o la plantilla guardada (Juega)
 *   · el CTA de la acción principal, un segundo camino real y «Explorar por mi cuenta» (solo presentación)
 *
 * La navegación no se oculta. Sin modales, sin flechas, sin animaciones obligatorias (reduced motion respetado arriba).
 */
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { NxButton } from "@/components/ui/NxButton";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardThumb } from "@/components/cards/CardThumb";
import { cn } from "@/lib/format";
import { getCard } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import type { DailyAction } from "@/domain/dailyLoop";
import type { PlayerJourney } from "@/domain/journey";
import { STEP_STATE_LABEL, WELCOME_PILLARS, roleChips } from "@/lib/journey/presentation";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("journey");

export function JourneyTrack({ journey, compact = false }: { journey: PlayerJourney; compact?: boolean }) {
  useLocale();
  return (
    <ol aria-label={t("Primera sesión · {label}", { label: td(journey.progress.label) })} data-testid="journey-track" className={cn("grid gap-2", compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
      {journey.steps.map((s) => (
        <li
          key={s.id}
          data-step={s.id}
          data-state={s.done ? "done" : s.current ? "current" : "next"}
          aria-current={s.current ? "step" : undefined}
          className={cn(
            "nx-clip-sm relative flex min-h-[44px] flex-col justify-center border-t-2 bg-black/30 px-3 py-2",
            s.done ? "border-t-ok" : s.current ? "border-t-drl bg-drl/[0.07]" : "border-t-white/15",
          )}
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">{s.index}</span>
            <span className={cn("font-display text-[10px] font-bold uppercase tracking-[0.14em]", s.done ? "text-ok" : s.current ? "text-drl-glow" : "text-white/40")}>
              {s.done ? "✓ " : ""}{STEP_STATE_LABEL(s)}
            </span>
          </span>
          <span className="mt-0.5 block font-display text-[15px] font-bold uppercase leading-tight text-white">{td(s.verb)}</span>
          {!compact && <span className="mt-0.5 hidden text-[12px] leading-snug text-ink-muted sm:block">{td(s.line)}</span>}
        </li>
      ))}
    </ol>
  );
}

export function JourneyMissionControl({
  journey, action, welcomeCards, offline = false, onDismiss,
}: {
  journey: PlayerJourney;
  action: DailyAction;
  welcomeCards: CardDef[];
  offline?: boolean;
  onDismiss: () => void;
}) {
  useLocale();
  const reduce = useReducedMotion();
  const deckCards = (journey.context.readyDeck?.cardIds ?? []).map((id) => getCard(id)).filter((c): c is CardDef => !!c);
  const step = journey.currentStep;
  return (
    <section
      aria-labelledby="journey-title"
      data-testid="journey-mission"
      data-step={step ?? "complete"}
      data-welcome={journey.welcome ? "true" : "false"}
      className="nx-clip relative isolate overflow-hidden border border-drl/35"
      style={{
        background:
          "radial-gradient(900px 480px at 8% 115%, rgba(255,46,99,0.26), transparent 62%)," +
          "radial-gradient(700px 460px at 95% -20%, rgba(25,227,255,0.14), transparent 60%)," +
          "linear-gradient(160deg, rgba(12,15,26,0.97), rgba(6,8,14,0.99))",
      }}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grid opacity-25" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px overflow-hidden">
        <span className="nx-lobby-sweep block h-px w-1/2" style={{ background: "linear-gradient(90deg, transparent, rgb(255,46,99), transparent)" }} />
      </span>

      <div className="relative grid gap-6 px-5 py-7 sm:px-9 sm:py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
        <motion.div key={action.id} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="min-w-0">
          {journey.welcome ? (
            <>
              <p className="font-display text-[12px] font-bold uppercase tracking-[0.3em] text-drl-glow">{t("Bienvenida")}</p>
              <h1 id="journey-title" className="mt-1 font-display text-[clamp(56px,11vw,120px)] font-bold uppercase leading-[0.82] tracking-[0.02em] text-white">
                {t("NEX")}<span className="text-drl">{t("US")}</span>
              </h1>
              <ul className="mt-4 grid gap-2 sm:grid-cols-3" data-testid="journey-pillars">
                {WELCOME_PILLARS.map((p) => (
                  <li key={p.verb} className="border-l-2 border-drl/70 pl-3">
                    <span className="block font-display text-[18px] font-bold uppercase leading-none text-white">{td(p.verb)}.</span>
                    <span className="mt-1 block text-[13px] leading-snug text-ink-muted">{td(p.line)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-drl-glow">{td(action.eyebrow)}</p>
              <h1 id="journey-title" className="mt-2 break-words font-display text-[clamp(30px,5.6vw,60px)] font-bold uppercase leading-[0.94] text-white">{td(action.title)}</h1>
            </>
          )}
          <p className="mt-4 max-w-xl text-body leading-relaxed text-ink-secondary">{td(action.detail)}</p>

          {step === "collect" && (
            <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={t("Jugadores distintos por rol")} data-testid="journey-roles">
              {roleChips(journey).map((r) => (
                <li key={r.role} className={cn("rounded-[3px] border px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.12em]", r.complete ? "border-ok/60 text-ok" : "border-warn/60 text-warn")}>
                  {r.complete ? "✓ " : "· "}{td(r.label)}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {offline ? (
              <NxButton variant="primary" size="lg" disabled className="w-full sm:w-auto" data-testid="journey-primary-cta">{td(action.cta)}</NxButton>
            ) : step === "play" ? (
              // Fase 44 · PRIMER COMBATE: el botón de la guía es el botón JUGAR del juego, en grande (misma pieza visual).
              <span className="nx-play-wrap inline-flex w-full sm:w-auto">
                <span aria-hidden className="nx-play-halo" />
                <Link href={action.href} className="nx-play w-full sm:w-auto" data-size="hero" data-kind="play" data-game-cta="play" data-cta="primary" data-testid="journey-primary-cta">{td(action.cta)}</Link>
              </span>
            ) : (
              <NxButton variant="primary" size="lg" href={action.href} className="w-full sm:w-auto" data-testid="journey-primary-cta">{td(action.cta)}</NxButton>
            )}
            {journey.nextAction?.secondary && (
              <NxButton variant="secondary" size="lg" href={journey.nextAction.secondary.href} className="w-full sm:w-auto" data-testid="journey-secondary-cta">{td(journey.nextAction.secondary.label)}</NxButton>
            )}
            <NxButton variant="ghost" size="lg" onClick={onDismiss} className="w-full sm:w-auto" data-testid="journey-dismiss">{t("Explorar por mi cuenta")}</NxButton>
          </div>
          {offline && (
            <p role="status" className="mt-3 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-warn">{t("Sin conexión · tu progreso sigue guardado en el servidor")}</p>
          )}
        </motion.div>

        <div className="min-w-0 space-y-4">
          {journey.welcome && welcomeCards.length > 0 && (
            <figure data-testid="journey-welcome-cards" className="min-w-0">
              {/* Móvil: miniaturas estáticas (tres cartas grandes no caben en 390 px sin recortarse). */}
              <div className="flex items-end justify-center gap-3 sm:hidden" aria-hidden data-testid="journey-welcome-thumbs">
                {welcomeCards.map((c) => <CardThumb key={c.id} card={c} width={78} />)}
              </div>
              <div className="hidden items-end justify-center gap-3 sm:flex" aria-hidden>
                {welcomeCards.map((c, i) => (
                  <div key={c.id} className={cn("w-[31%] max-w-[150px]", i === 1 ? "-translate-y-3" : "")}>
                    <PlayerCard card={c} size="sm" interactive={false} />
                  </div>
                ))}
              </div>
              <figcaption className="mt-2 text-center text-[11px] uppercase tracking-[0.14em] text-white/45">{t("Cartas reales del catálogo · las tuyas saldrán de tus sobres")}</figcaption>
            </figure>
          )}
          {step === "play" && deckCards.length > 0 && (
            <figure data-testid="journey-deck-ready" className="nx-clip-sm border border-ok/40 bg-ok/[0.06] p-3">
              <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-[16px] font-bold uppercase tracking-[0.1em] text-ok">{t("Equipo listo")}</span>
                <span className="text-[12px] text-ink-muted">«{journey.context.readyDeck!.name}»{journey.context.readyDeck!.active ? (" " + t("· equipo activo")) : ""}</span>
              </figcaption>
              <ul className="grid grid-cols-5 gap-1.5" aria-label={t("Las diez cartas de tu plantilla")}>
                {deckCards.map((c) => <li key={c.id} className="grid place-items-center"><CardThumb card={c} width={48} /></li>)}
              </ul>
            </figure>
          )}
          <JourneyTrack journey={journey} />
          <p className="text-[12px] text-ink-muted">{t("Todo lo que ves aquí sale de tu cuenta: sobres, cartas, equipos y partidas reales. La guía no da recompensas extra.")}</p>
        </div>
      </div>
    </section>
  );
}

/** Tira discreta: la guía bajada (explorando por libre, o con algo más urgente delante). */
export function JourneyStrip({ journey, dismissed, offline = false, onResume, showCta = true }: { journey: PlayerJourney; dismissed: boolean; offline?: boolean; onResume: () => void; showCta?: boolean }) {
  useLocale();
  const n = journey.nextAction;
  const current = journey.steps.find((s) => s.current);
  return (
    <section aria-label={t("Primera sesión")} data-testid="journey-strip" className="nx-clip-sm flex flex-wrap items-center justify-between gap-3 border border-white/12 bg-white/[0.02] px-4 py-3">
      <p className="min-w-0 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white">
        {t("Primera sesión")} <span className="nx-readout text-drl-glow">{td(journey.progress.label)}</span>
        {current && <span className="ml-2 font-body text-[13px] normal-case tracking-normal text-ink-muted">{t("Ahora:")} {current.verb.toLowerCase()} · {td(n?.title)}</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {n && !offline && showCta && <NxButton variant="secondary" size="md" href={n.href} data-testid="journey-strip-cta">{td(n.cta)}</NxButton>}
        {dismissed && <NxButton variant="ghost" size="md" onClick={onResume} data-testid="journey-resume">{t("Ver la guía")}</NxButton>}
      </div>
    </section>
  );
}
