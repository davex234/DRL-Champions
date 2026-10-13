"use client";

/**
 * FASE 63 · AYUDA DE LA PRIMERA PARTIDA — sobre el tablero REAL de F61, nunca encima de las cartas.
 *
 *   · `FirstMatchHint`     la primera vez que ATACAS y la primera vez que DEFIENDES: dos líneas con la regla del motor
 *                          (`MATCH_HINTS`). Una franja fina ENCIMA del tablero, con «Entendido». No bloquea: se puede
 *                          jugar con ella abierta. Lo visto se recuerda por partida en `sessionStorage` (presentación:
 *                          una recarga no la repite; no es estado del juego).
 *   · `OnboardingAfterMatch` en el resultado (gane, pierda o empate): «tu partida ya cuenta» y VER MI PROGRESO. Las
 *                          cifras reales (XP, créditos, objetivos) las enseña el propio resultado de F61/F62 debajo.
 */
import { useCallback, useEffect, useState } from "react";
import { MATCH_HINTS, matchHintFor, type MatchHintId, type OnboardingView } from "@/domain/onboarding";
import { OnboardingCoach, OnboardingCta } from "./OnboardingKit";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("onboarding");

const KEY = (matchId: string) => `nx-f63-hints:${matchId}`;

function readSeen(matchId: string): Set<MatchHintId> {
  try {
    const raw = sessionStorage.getItem(KEY(matchId));
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is MatchHintId => x === "attack" || x === "defend") : []);
  } catch { return new Set(); }
}

export function FirstMatchHint({ view }: { view: { matchId: string; status: string; youAreAttacker: boolean } }) {
  useLocale();
  const [seen, setSeen] = useState<Set<MatchHintId>>(() => new Set());
  useEffect(() => { setSeen(readSeen(view.matchId)); }, [view.matchId]);
  const hint = matchHintFor(view, seen);
  const dismiss = useCallback(() => {
    if (!hint) return;
    const next = new Set(seen); next.add(hint);
    setSeen(next);
    try { sessionStorage.setItem(KEY(view.matchId), JSON.stringify([...next])); } catch { /* sin almacenamiento: solo esta vista */ }
  }, [hint, seen, view.matchId]);
  if (!hint) return null;
  const h = MATCH_HINTS[hint];
  return (
    <div role="note" aria-label={t("Ayuda: {title}", { title: td(h.title) })} data-testid="first-match-hint" data-hint={hint} className="nx-f63-hint nx-f63-rise mb-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/85">
        <b className="mr-1.5 font-display text-[13px] font-extrabold uppercase tracking-[0.12em] text-white">{td(h.title)}.</b>
        {h.lines.join(" ")}
      </p>
      <button type="button" onClick={dismiss} data-testid="first-match-hint-ok" className="nx-focus min-h-[44px] shrink-0 px-3 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-white/80 hover:text-white">
        {t("Entendido")}
      </button>
    </div>
  );
}

export function OnboardingAfterMatch({ view }: { view: OnboardingView }) {
  useLocale();
  if (!view.active || view.current !== "progress" || !view.next) return null;
  return (
    <OnboardingCoach
      view={view}
      title={t("Tu primera partida ya cuenta")}
      testId="onboarding-after-match"
      className="mt-3"
      actions={<OnboardingCta next={view.next} big testId="onboarding-see-progress" />}
    >
      <p>{fill(t("Ganes, pierdas o empates, tus partidas suman {cuenta} y avanzan tus {objetivos}. Al reclamar objetivos ganas {temporada}. Lo que ha cambiado lo tienes más arriba, en este resultado.", slots("cuenta", "objetivos", "temporada")), {
        cuenta: <b className="text-white">{t("XP de cuenta")}</b>,
        objetivos: <b className="text-white">{t("objetivos")}</b>,
        temporada: <b className="text-white">{t("XP de temporada")}</b>,
      })}</p>
    </OnboardingCoach>
  );
}
