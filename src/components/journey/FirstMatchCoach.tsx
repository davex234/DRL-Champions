"use client";

/**
 * PLAYER JOURNEY · PRIMER COMBATE (Fase 40). Va en la PRE-PARTIDA (nunca encima del tablero, la mano ni los botones).
 * Las reglas son las del motor (`FIRST_MATCH_RULES`, reflejo de duel-combat-2); el detalle completo sigue en «?»
 * (HelpSheet canónico). Ganar no es obligatorio: terminar la partida completa la primera sesión.
 */
import { FIRST_MATCH_RULES } from "@/domain/journey";
import { JourneyCoach } from "./JourneyCoach";

export function FirstMatchCoach({ onHelp }: { onHelp?: () => void }) {
  return (
    <JourneyCoach eyebrow="Tu inicio · 5/6 · Primera partida" title="Tu primera partida" testId="journey-first-match" className="mb-5">
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {FIRST_MATCH_RULES.map((r, i) => (
          <li key={r.title}><b className="font-display uppercase tracking-wide text-white/90">{i + 1}. {r.title}.</b> {r.text}</li>
        ))}
      </ol>
      <p className="mt-2">Te proponemos el bot <b className="text-white">Fácil</b>; puedes cambiarlo. Ganes, pierdas o empates, cuenta igual.{onHelp ? " Las reglas completas están en «?»." : ""}</p>
    </JourneyCoach>
  );
}
