"use client";

/**
 * IA 2026-10-07 · MI CUENTA — una experiencia en lugar de cuatro páginas sueltas (Mi perfil, Cuenta, Progresión, Feedback).
 *
 *   PERFIL      tu identidad: la MISMA pantalla que `/jugador/[id]` (`PlayerProfileScreen`, editar, Sala de Trofeos,
 *               cerrar sesión). El perfil PÚBLICO sigue en `/jugador/[id]`.
 *   PROGRESIÓN  lo conseguido y lo que reclamar: la MISMA pantalla que era `/progresion` (`ProgressionScreen`, mismos
 *               reclamos del servidor). Lo que HAY QUE HACER vive en Temporada → Objetivos.
 *   CUENTA      ajustes y ficha de la cuenta: la pantalla que era `/cuenta`.
 *   DAR FEEDBACK (arriba a la derecha) el formulario REAL de F86.2 (`FeedbackForm`): mismas categorías y la misma API.
 *
 * La sección va en la URL (`?seccion=`): se puede enlazar, volver atrás y recargar. Aquí no se lee ni se escribe nada:
 * cada sección trae su propia lógica, que no cambia.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { ROUTES } from "@/design/nav";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerProfileScreen } from "@/components/player/PlayerProfileScreen";
import { ProgressionScreen } from "@/components/progression/ProgressionScreen";
import { FeedbackForm } from "@/components/feedback/FeedbackForm";
import { FEEDBACK_SOURCES, type FeedbackSource } from "@/domain/feedback/alpha";
import { ACCOUNT_TABS, type AccountSection } from "./accountSections";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("account");

export { ACCOUNT_TABS, accountSectionOf, type AccountSection } from "./accountSections";

function FeedbackIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

export function AccountHub({ userId, section, source, settings }: {
  userId: string;
  section: AccountSection;
  /** `?desde=` del feedback (de dónde se abrió); desconocido → «menu». */
  source?: string | null;
  /** La pestaña CUENTA: la pantalla de ajustes que ya existía (la pasa la página). */
  settings: ReactNode;
}) {
  useLocale();
  const feedbackSource: FeedbackSource = source && (FEEDBACK_SOURCES as readonly string[]).includes(source) ? (source as FeedbackSource) : "menu";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8" data-testid="account-hub" data-section={section}>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[clamp(28px,4vw,44px)] font-extrabold uppercase leading-none tracking-wide text-white">{tr("Mi cuenta")}</h1>
        <Link
          href={ROUTES.feedback}
          data-testid="account-feedback"
          aria-current={section === "feedback" ? "page" : undefined}
          className={cn(
            "nx-focus nx-clip-sm inline-flex min-h-[44px] items-center gap-2 border px-4 font-display text-[12px] font-bold uppercase tracking-[0.14em] transition",
            section === "feedback" ? "border-drl bg-drl/20 text-white" : "border-drl/50 bg-drl/[0.08] text-white/85 hover:bg-drl/20 hover:text-white",
          )}
        >
          <FeedbackIcon />
          {tr("Dar feedback")}
        </Link>
      </header>

      <nav aria-label={tr("Secciones de Mi cuenta")} className="mb-6 grid grid-cols-3 gap-2 sm:flex" data-testid="account-tabs">
        {ACCOUNT_TABS.map((t) => {
          const on = section === t.id;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={on ? "page" : undefined}
              data-testid={`account-tab-${t.id}`}
              className={cn(
                "nx-focus flex min-h-[48px] items-center justify-center border px-3 font-display text-[14px] font-bold uppercase tracking-[0.14em] transition sm:min-w-[180px] sm:px-6",
                on ? "border-drl-cyan/70 bg-drl-cyan/15 text-white shadow-[inset_0_-3px_0_#19e3ff]" : "border-white/10 bg-white/[0.03] text-white/60 hover:text-white",
              )}
            >
              {td(t.label)}
            </Link>
          );
        })}
      </nav>

      <div data-testid={`account-section-${section}`}>
        {section === "perfil" && <PlayerProfileScreen id={userId} embedded />}
        {section === "progresion" && <HydrationGate><ProgressionScreen embedded /></HydrationGate>}
        {section === "cuenta" && settings}
        {section === "feedback" && (
          <section aria-labelledby="h-feedback" className="mx-auto max-w-3xl">
            <h2 id="h-feedback" className="mb-1 font-display text-2xl font-bold uppercase tracking-wide text-white">{tr("Dar feedback")}</h2>
            <p className="mb-5 text-[13px] text-white/60">{tr("Tu opinión llega al equipo ligada a tu cuenta (nunca con tu correo).")}</p>
            <FeedbackForm userId={userId} source={feedbackSource} />
          </section>
        )}
      </div>
    </div>
  );
}
