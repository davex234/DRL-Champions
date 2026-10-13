"use client";

/**
 * FASE 63 · TU PROGRESO — paso 6 de la guía, ENCIMA del hub real de F62 (`/progresion`). No es otra pantalla de
 * progresión: explica en tres líneas los tres bloques que el jugador tiene justo debajo (XP de cuenta, objetivos,
 * temporada) y cierra la guía con «Ya estás listo» y SEGUIR JUGANDO (orden `finish`: el servidor exige una partida
 * terminada). El hub sigue siendo interactivo: se puede reclamar antes, después o nunca.
 */
import { useRouter } from "next/navigation";
import type { OnboardingView } from "@/domain/onboarding";
import { ONBOARDING_ROUTES } from "@/domain/onboarding";
import { OnboardingCoach, OnboardingCta } from "./OnboardingKit";

const BLOCKS = [
  { id: "account", label: "XP de cuenta", line: "Sube tu nivel jugando partidas y abriendo sobres.", tone: "text-drl-cyan" },
  { id: "objectives", label: "Objetivos", line: "Cumple retos del día y de la semana. Cuando estén completos, reclámalos aquí.", tone: "text-white" },
  { id: "season", label: "XP de temporada", line: "La ganas reclamando objetivos. Cada nivel de temporada abre una recompensa.", tone: "text-drl-gold" },
] as const;

export function OnboardingProgressCoach({ view }: { view: OnboardingView }) {
  const router = useRouter();
  if (!view.active || view.current !== "progress") return null;
  return (
    <OnboardingCoach
      view={view}
      title="Así avanzas en NEXUS"
      testId="onboarding-progress"
      className="mb-6"
    >
      <ul className="mt-1 grid gap-2 md:grid-cols-3" data-testid="onboarding-progress-blocks">
        {BLOCKS.map((b) => (
          <li key={b.id} data-block={b.id} className="nx-f63-stat px-3 py-2">
            <span className={`block font-display text-[13px] font-bold uppercase tracking-[0.12em] ${b.tone}`}>{b.label}</span>
            <span className="mt-0.5 block text-[13px] leading-snug text-white/70">{b.line}</span>
          </li>
        ))}
      </ul>
      <section aria-labelledby="f63-ready" data-testid="onboarding-complete" className="nx-f63-stage mt-4 px-4 py-4 sm:px-5">
        <p className="nx-label !text-[10px] text-ok">✓ Tu inicio está hecho</p>
        <h3 id="f63-ready" className="mt-1 font-display text-[clamp(26px,3.6vw,38px)] font-extrabold uppercase leading-none text-white">Ya estás listo</h3>
        <p className="mt-2 text-[14px] text-white/75">Ahora puedes:</p>
        <ul className="mt-1 grid gap-1 text-[14px] text-white sm:grid-cols-3">
          <li>▸ Jugar más partidas</li>
          <li>▸ Mejorar tu equipo</li>
          <li>▸ Completar objetivos</li>
        </ul>
        <div className="mt-4">
          <OnboardingCta
            next={{ step: "progress", title: "Ya estás listo", detail: "", cta: "Seguir jugando", href: ONBOARDING_ROUTES.play, command: "finish", secondary: null }}
            big
            testId="onboarding-finish"
            onDone={() => router.push(ONBOARDING_ROUTES.play)}
          />
        </div>
      </section>
    </OnboardingCoach>
  );
}
