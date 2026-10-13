"use client";

/**
 * FASE 63 · LA PRIMERA SESIÓN EN LA PORTADA.
 *
 * Tres caras, todas sobre la MISMA foto del vestíbulo (`snap.onboarding`, sin lecturas nuevas):
 *
 *   · BIENVENIDA (NOT_STARTED)  NEXUS · Construye tu equipo. Juega. Progresa. → EMPEZAR (orden `start` en el servidor).
 *   · TUS RECURSOS (paso 2)     lo que la cuenta TIENE de verdad —sobres con su arte real y créditos— y ABRIR MI PRIMER
 *                               SOBRE. No concede nada: el alta ya lo concedió, esto lo enseña.
 *   · CONTINÚA TU INICIO        «Paso X/6», el objetivo y UN botón. En el paso del equipo el botón crea el equipo en el
 *                               servidor y enseña las diez cartas; después, JUGAR MI PRIMERA PARTIDA.
 *
 * La cabecera del menú (MÁS, créditos) sigue ahí: nada queda bloqueado. «Saltar tutorial» siempre a mano.
 */
import { SealedPack } from "@/components/packs/SealedPack";
import { getPack } from "@/data/packs";
import { formatCredits } from "@/lib/format";
import type { OnboardingView } from "@/domain/onboarding";
import type { OnboardingCommandResult } from "@/lib/onboarding/client";
import { OnboardingCta, OnboardingPill, OnboardingSecondary, SkipTutorial, TeamReady } from "./OnboardingKit";

const PILLARS = [
  { verb: "Colecciona", line: "Cartas de jugadores reales del circuito." },
  { verb: "Construye", line: "Tu equipo: diez cartas, dos de cada rol." },
  { verb: "Juega", line: "Partidas de diez turnos contra bots y personas." },
] as const;

type OnView = (v: OnboardingView) => void;
const take = (onView?: OnView) => (r: OnboardingCommandResult) => onView?.(r.onboarding);

export function OnboardingWelcome({ view, onView }: { view: OnboardingView; onView?: OnView }) {
  return (
    <section aria-labelledby="f63-welcome" data-testid="onboarding-welcome" className="nx-f63-stage w-full max-w-[620px] px-5 py-6 sm:px-8 sm:py-8">
      <p className="nx-f63-rise font-display text-[12px] font-bold uppercase tracking-[0.34em] text-drl-glow">Bienvenida</p>
      <h1 id="f63-welcome" className="nx-f63-rise mt-1 font-display text-[clamp(52px,9vw,96px)] font-extrabold uppercase leading-[0.84] tracking-[0.03em] text-white">
        NEX<span className="text-drl">US</span>
      </h1>
      <p className="nx-f63-rise-2 mt-3 font-display text-[clamp(18px,2.4vw,24px)] font-bold uppercase leading-snug tracking-[0.06em] text-white">
        Construye tu equipo. Juega. Progresa.
      </p>
      <ul className="nx-f63-rise-3 mt-5 grid gap-3 sm:grid-cols-3" data-testid="onboarding-pillars">
        {PILLARS.map((p) => (
          <li key={p.verb} className="border-l-2 border-drl/70 pl-3">
            <span className="block font-display text-[17px] font-bold uppercase leading-none text-white">{p.verb}</span>
            <span className="mt-1 block text-[13px] leading-snug text-white/65">{p.line}</span>
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        {view.next && <OnboardingCta next={view.next} big onDone={take(onView)} testId="onboarding-start" />}
        <SkipTutorial onSkipped={take(onView)} />
      </div>
    </section>
  );
}

/** Paso 2 · lo que la cuenta tiene AHORA (servidor) y el primer sobre. */
export function StarterMoment({ view, onView, credits: balance }: { view: OnboardingView; onView?: OnView; credits?: number | null }) {
  const packs = (view.starter?.packs ?? []).map((p) => ({ ...p, def: getPack(p.packId) })).filter((p) => !!p.def);
  const credits = balance ?? view.starter?.credits ?? null;
  const total = packs.reduce((s, p) => s + p.qty, 0);
  return (
    <section aria-labelledby="f63-starter" data-testid="onboarding-starter" className="nx-f63-stage w-full max-w-[680px] px-5 py-6 sm:px-8 sm:py-7">
      <OnboardingPill view={view} />
      <h1 id="f63-starter" className="nx-f63-rise mt-3 font-display text-[clamp(30px,4.6vw,48px)] font-extrabold uppercase leading-[0.95] text-white">Tus recursos para empezar</h1>
      <p className="nx-f63-rise-2 mt-2 text-[15px] leading-relaxed text-white/75">Ya están en tu cuenta. Los sobres añaden cartas a tu colección: con ellas formarás tu equipo.</p>
      {packs.length > 0 && (
        <ul className="nx-f63-rise-2 mt-5 flex flex-wrap items-end gap-4" aria-label="Tus sobres sin abrir" data-testid="onboarding-starter-packs">
          {packs.map((p) => (
            <li key={p.packId} className="flex flex-col items-center" data-pack={p.packId} data-qty={p.qty}>
              <div aria-hidden className="pointer-events-none"><SealedPack pack={p.def!} cutProgress={0} width={96} /></div>
              <span className="mt-2 font-display text-[13px] font-bold uppercase tracking-[0.1em] text-white">{p.def!.name}</span>
              <span className="nx-readout text-[18px] text-drl-glow">×{p.qty}</span>
            </li>
          ))}
          {credits !== null && (
            <li className="nx-f62-panel flex min-w-[140px] flex-col justify-center self-stretch px-4 py-3" data-testid="onboarding-starter-credits">
              <span className="nx-label !text-[10px] text-white/55">Créditos</span>
              <span className="nx-readout text-[26px] text-drl-gold">{formatCredits(credits)}</span>
              <span className="text-[12px] leading-snug text-white/55">Para comprar más sobres en la Tienda.</span>
            </li>
          )}
        </ul>
      )}
      {packs.length === 0 && <p className="mt-4 text-[14px] text-white/70">No tienes sobres sin abrir ahora mismo.</p>}
      <p className="sr-only" data-testid="onboarding-starter-summary">{`${total} sobres sin abrir${credits !== null ? ` y ${formatCredits(credits)} créditos` : ""}.`}</p>
      <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        {view.next && <OnboardingCta next={view.next} big testId="onboarding-open-first" />}
        <SkipTutorial onSkipped={take(onView)} />
      </div>
    </section>
  );
}

/** Pasos 3–6 · «Continúa tu inicio» bajo el menú (el menú sigue mandando). */
export function OnboardingContinue({ view, onView }: { view: OnboardingView; onView?: OnView }) {
  const next = view.next;
  if (!next) return null;
  const deck = view.context.readyDeck;
  return (
    <section aria-labelledby="f63-continue" data-testid="onboarding-continue" data-step={view.current ?? ""} className="nx-f63-stage nx-f63-rise mt-[clamp(10px,2vh,22px)] w-full max-w-[560px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="nx-label !text-[10px] text-white/60">Continúa tu inicio</span>
        <OnboardingPill view={view} />
      </div>
      <h2 id="f63-continue" className="mt-2 font-display text-[22px] font-extrabold uppercase leading-tight text-white">{next.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-white/70">{next.detail}</p>
      {/* El botón ANTES de las diez cartas: en portátil el equipo empujaba JUGAR por debajo del pliegue. */}
      <div className="mt-3.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <OnboardingCta next={next} onDone={next.command ? take(onView) : undefined} />
        <OnboardingSecondary next={next} />
        <SkipTutorial onSkipped={take(onView)} />
      </div>
      {view.current === "match" && deck && <TeamReady cardIds={deck.cardIds} name={deck.name} className="mt-3" />}
    </section>
  );
}
