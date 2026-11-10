"use client";

/**
 * FASE 63 · TU COLECCIÓN — un bloque arriba de la colección REAL mientras la guía está activa. Dice lo imprescindible
 * («estas son tus cartas; con ellas formas tu equipo») y cuántos jugadores DISTINTOS tiene de cada rol, con el dato del
 * servidor (`readiness` de la guía, rol de la CARTA). Filtros, forja, sets: nada de eso se enseña aquí.
 *
 * Paso 3 → abrir el siguiente sobre (o el Sobre Inicial gratis). Paso 4 → «Crear mi primer equipo» (orden del servidor)
 * y, hecho, las diez cartas y JUGAR MI PRIMERA PARTIDA.
 */
import { useState } from "react";
import { cn } from "@/lib/format";
import type { OnboardingView } from "@/domain/onboarding";
import type { OnboardingCommandResult } from "@/lib/onboarding/client";
import { OnboardingCoach, OnboardingCta, OnboardingSecondary, TeamReady } from "./OnboardingKit";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("onboarding");

export function OnboardingCollectionCoach({ view: initial }: { view: OnboardingView }) {
  useLocale();
  const [view, setView] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setView(initial); }
  if (!view.active || !view.next) return null;
  const { readiness, readyDeck } = view.context;
  const onDone = (r: OnboardingCommandResult) => setView(r.onboarding);
  const title = view.current === "match" ? t("Tu equipo está listo") : t("Estas son tus cartas");
  return (
    <OnboardingCoach
      view={view}
      title={td(title)}
      testId="onboarding-collection"
      className="mb-2"
      actions={<>
        <OnboardingCta next={view.next} onDone={view.next.command === "first-team" ? onDone : undefined} big={view.current === "match"} />
        {view.current !== "match" && <OnboardingSecondary next={{ ...view.next, secondary: view.next.secondary?.href.startsWith("/coleccion") ? null : view.next.secondary }} />}
      </>}
    >
      {view.current === "match" && readyDeck ? (
        <TeamReady cardIds={readyDeck.cardIds} name={readyDeck.name} className="mt-1" />
      ) : (
        <>
          <p>{fill(t("Cada carta es un jugador real. Con ellas formas tu {regla}.", slots("regla")), { regla: <b className="text-white">{t("equipo: 10 cartas, 2 de cada rol, sin repetir jugador")}</b> })}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("Jugadores distintos por rol")} data-testid="onboarding-roles">
            {readiness.roles.map((r) => {
              const ok = r.have >= r.need;
              return (
                <li key={r.role} data-complete={ok ? "true" : "false"} className={cn("rounded-[3px] border px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.12em]", ok ? "border-ok/60 text-ok" : "border-warn/60 text-warn")}>
                  {ok ? "✓ " : "· "}{td(r.role)} {r.have}/{r.need}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-white/85">{td(view.next.detail)}</p>
        </>
      )}
    </OnboardingCoach>
  );
}
