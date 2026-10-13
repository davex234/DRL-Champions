"use client";

/**
 * PLAYER JOURNEY · PRIMER COMBATE (Fase 40). Va en la PRE-PARTIDA (nunca encima del tablero, la mano ni los botones).
 * Las reglas son las del motor (`FIRST_MATCH_RULES`, reflejo de duel-combat-2); el detalle completo sigue en «?»
 * (HelpSheet canónico). Ganar no es obligatorio: terminar la partida completa la primera sesión.
 */
import { FIRST_MATCH_RULES } from "@/domain/journey";
import { JourneyCoach } from "./JourneyCoach";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("journey");

export function FirstMatchCoach({ onHelp }: { onHelp?: () => void }) {
  useLocale();
  return (
    <JourneyCoach eyebrow={t("Tu inicio · 5/6 · Primera partida")} title={t("Tu primera partida")} testId="journey-first-match" className="mb-5">
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {FIRST_MATCH_RULES.map((r, i) => (
          <li key={r.title}><b className="font-display uppercase tracking-wide text-white/90">{i + 1}. {td(r.title)}.</b> {td(r.text)}</li>
        ))}
      </ol>
      <p className="mt-2">{fill(t("Te proponemos el bot {nivel}; puedes cambiarlo. Ganes, pierdas o empates, cuenta igual.", slots("nivel")), { nivel: <b className="text-white">{t("Fácil")}</b> })}{onHelp ? (" " + t("Las reglas completas están en «?».")) : ""}</p>
    </JourneyCoach>
  );
}
