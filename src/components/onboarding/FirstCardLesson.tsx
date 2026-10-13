"use client";

/**
 * FASE 63 · TU PRIMERA CARTA — dentro del resumen REAL del primer sobre (F57), nunca una carta inventada.
 *
 * La carta es la DESTACADA de ese sobre (`plan.summary.featured`: rareza → OVR → serial, criterio escrito en el propio
 * resumen). Se explica lo mínimo, con los nombres que la carta imprime y el motor usa:
 *
 *   · OVR   — su valoración general (1–99).
 *   · ROL   — el ROL DE LA CARTA (manda sobre el del jugador): tu equipo lleva dos de cada uno.
 *   · 6 estadísticas impresas — DMG · SCR · FKS · HS · AST · CLU: el rendimiento real del jugador.
 *   · 3 estadísticas de combate — SH · GS · EF: con ESTAS compite en la partida.
 *
 * Todo es texto además de color. Movimiento: solo la entrada (fundido con movimiento reducido).
 */
import { PlayerCard } from "@/components/cards/PlayerCard";
import { displayedStats } from "@/domain/cards/ovr";
import { COMBAT_STAT_META, COMBAT_STAT_ORDER } from "@/domain/cards/combat";
import { getPlayer } from "@/data/catalog";
import type { CardDef } from "@/domain/cards/types";
import type { OnboardingView } from "@/domain/onboarding";
import { OnboardingCta, OnboardingPill, OnboardingSecondary, type OnboardingHere } from "./OnboardingKit";

export function cardRoleOf(card: CardDef): string | null {
  return card.role ?? getPlayer(card.playerId)?.role ?? null;
}

export function FirstCardLesson({ card, view, here }: { card: CardDef; view: OnboardingView; here?: OnboardingHere }) {
  const player = getPlayer(card.playerId);
  const role = cardRoleOf(card);
  const printed = displayedStats(card);
  const combat = card.combat;
  return (
    <section aria-labelledby="f63-first-card" data-testid="onboarding-first-card" data-card-id={card.id} className="nx-f63-stage nx-f63-rise mx-auto mb-8 max-w-4xl px-4 py-5 sm:px-6">
      <OnboardingPill view={view} />
      <div className="mt-3 grid gap-5 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
        <div className="mx-auto w-[180px] md:w-[200px]" aria-hidden>
          <PlayerCard card={card} size="md" interactive={false} />
        </div>
        <div className="min-w-0">
          <p className="nx-label !text-[11px] text-drl-glow">Tu primera carta</p>
          <h2 id="f63-first-card" className="mt-1 font-display text-[clamp(24px,3.4vw,34px)] font-extrabold uppercase leading-none text-white">{player?.nick ?? card.id}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-white/75">Cada carta es un jugador real. Esto es lo que tienes que saber:</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="nx-f63-callout px-3 py-2" data-testid="lesson-ovr">
              <dt className="nx-label !text-[10px] text-white/60">OVR</dt>
              <dd className="flex items-baseline gap-2"><span className="nx-readout text-[26px] text-white">{card.ovr}</span><span className="text-[13px] text-white/70">Su valoración general, de 1 a 99.</span></dd>
            </div>
            <div className="nx-f63-callout px-3 py-2" data-testid="lesson-role">
              <dt className="nx-label !text-[10px] text-white/60">Rol de la carta</dt>
              <dd className="flex items-baseline gap-2"><span className="font-display text-[20px] font-bold uppercase text-white">{role ?? "—"}</span><span className="text-[13px] text-white/70">Tu equipo lleva 2 de cada rol.</span></dd>
            </div>
          </dl>
          {combat && (
            <div className="mt-3" data-testid="lesson-combat">
              <p className="text-[13px] text-white/75"><b className="text-white">En la partida</b> compite con tres estadísticas de combate:</p>
              <ul className="mt-1.5 grid grid-cols-3 gap-2">
                {COMBAT_STAT_ORDER.map((k) => (
                  <li key={k} className="nx-f63-stat px-2 py-1.5 text-center">
                    <span className="block font-display text-[12px] font-bold tracking-[0.12em]" style={{ color: COMBAT_STAT_META[k].color }}>{COMBAT_STAT_META[k].label}</span>
                    <span className="nx-readout block text-[20px] text-white">{combat[k]}</span>
                    <span className="block text-[11px] text-white/55">{COMBAT_STAT_META[k].full}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="mt-3 text-[13px] text-white/70" data-testid="lesson-printed">
            <summary className="nx-focus min-h-[44px] cursor-pointer py-2 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/80">Las seis cifras de la carta</summary>
            <p>Son el rendimiento real del jugador:</p>
            <ul className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {printed.map((s) => (
                <li key={s.key} className="nx-f63-stat flex items-baseline justify-between gap-2 px-2 py-1">
                  <span><b className="font-display tracking-[0.1em] text-white">{s.label}</b> <span className="text-white/55">{s.full}</span></span>
                  <span className="nx-readout text-white">{s.value}</span>
                </li>
              ))}
            </ul>
          </details>
          {view.next && (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {view.next.secondary && view.current === "collection"
                ? <NextToCollection view={view} here={here} />
                : <><OnboardingCta next={view.next} here={here} /><OnboardingSecondary next={view.next} /></>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Tras el PRIMER sobre el siguiente sitio es la colección (paso 3); abrir el siguiente sobre queda como segunda opción. */
function NextToCollection({ view, here }: { view: OnboardingView; here?: OnboardingHere }) {
  const n = view.next!;
  return (
    <>
      <OnboardingCta next={{ ...n, cta: "Ver mi colección", href: n.secondary!.href, command: null, secondary: null }} testId="onboarding-to-collection" />
      <OnboardingCta next={{ ...n, secondary: null }} testId="onboarding-open-next" tone="secondary" here={here} />
    </>
  );
}

/**
 * Después de los sobres siguientes: una línea con el paso y su botón (sin repetir la lección). F68 · `here` = este sobre:
 * si el siguiente paso es abrir OTRO del mismo tipo, el botón reinicia la ceremonia (antes era un enlace a esta misma URL
 * y no hacía nada).
 */
export function OnboardingPackNext({ view, here }: { view: OnboardingView; here?: OnboardingHere }) {
  if (!view.next) return null;
  return (
    <section aria-label="Tu inicio" data-testid="onboarding-pack-next" data-step={view.current ?? ""} className="nx-f63-coach nx-f63-rise mx-auto mb-6 max-w-4xl px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <OnboardingPill view={view} />
          <p className="mt-1.5 font-display text-[18px] font-extrabold uppercase leading-tight text-white">{view.next.title}</p>
          <p className="text-[13px] text-white/70">{view.next.detail}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <OnboardingCta next={view.next} here={here} />
          <OnboardingSecondary next={view.next} />
        </div>
      </div>
    </section>
  );
}
