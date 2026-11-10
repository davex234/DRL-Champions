"use client";

/**
 * RESULTADO FINAL DEL DUELO CONTRA LA IA (campaña Road to Champions, Draft Gauntlet y cualquier PvE que no sea la partida
 * rápida) — adaptador de la pantalla única de resultados (`result/DuelResult`).
 *
 * Misma pantalla que el resto de duelos: VICTORIA/DERROTA/EMPATE, marcador, recompensas en una línea y tres acciones. El
 * modo solo decide los datos: la acción principal (JUGAR OTRA = revancha con el mismo equipo y rival; en Draft, volver al
 * gauntlet; en campaña tras ganar, el siguiente nodo) y a qué lobby se vuelve (en campaña, el mapa).
 *
 * Lo que antes se apilaba aquí (carta destacada, turno a turno, cifras, lectura estratégica, progreso, temporada, aviso de
 * Road to Champions…) ya no se enseña en el resultado, pero el servidor lo sigue liquidando y guardando igual y cada cosa
 * vive en su apartado (repetición de la partida, progresión, temporada, mapa de la campaña). Las props `xp`, `extra`,
 * `progress`, `onChange`, `onDecks` y `deckId` se aceptan por compatibilidad y no pintan nada.
 */
import { DuelResult, TONE, type DuelResultAction } from "./result/DuelResult";
import type { DuelMatchView } from "@/lib/duel/types";
import type { MatchMode } from "@/lib/duel/experience";
import { MAIN_MENU_HREF } from "@/lib/duel/quickResult";
import { dailyCapReached, resultEarnings, resultKind } from "@/lib/duel/resultSummary";
import { DailyRewardSlot } from "./DailyRewardSlot";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duel");

/** El tono de cada desenlace vive en la pantalla única; se reexporta por compatibilidad. */
export { TONE };

export function ResultScreen({
  view, onPlayAgain, playAgainLabel = "Revancha", mode = "PVE", campaign = null,
}: {
  view: DuelMatchView;
  /** Draft Gauntlet: la acción principal vuelve al gauntlet (no hay revancha). */
  mode?: MatchMode;
  /** JUGAR OTRA: revancha con el mismo equipo y rival (o la acción del modo). */
  onPlayAgain: () => void;
  /** Rótulo de la acción principal cuando NO es la revancha («Volver al gauntlet»). */
  playAgainLabel?: string;
  /**
   * Road to Champions: a dónde se vuelve (el mapa, con el nodo abierto) y, si el servidor liquidó una victoria con nodo
   * siguiente, su enlace (la acción principal pasa a ser SIGUIENTE NODO).
   */
  campaign?: { mapHref: string; nextHref: string | null } | null;
  /** @deprecated La repetición se abre con VER PARTIDA (`/duelos/replay/<id>`). */
  onReplay?: () => void;
  /** @deprecated Ya no se pinta en el resultado. */
  onChange?: () => void;
  /** @deprecated Ya no se pinta en el resultado. */
  onDecks?: () => void;
  /** @deprecated Ya no se pinta en el resultado (la XP ganada sí, en la línea de recompensas). */
  xp?: number | null;
  /** @deprecated Ya no se pinta en el resultado. */
  extra?: React.ReactNode;
  /** @deprecated Ya no se pinta en el resultado. */
  progress?: React.ReactNode;
  /** @deprecated Ya no se pinta en el resultado. */
  deckId?: string | null;
}) {
  useLocale();
  const r = view.result;
  const kind = resultKind(r);
  if (!r || !kind) return null;

  const primary: DuelResultAction = campaign?.nextHref
    ? { label: t("Siguiente nodo"), href: campaign.nextHref, testId: "result-play-again" }
    : { label: playAgainLabel === "Revancha" ? t("Jugar otra") : td(playAgainLabel), onClick: onPlayAgain, once: true, testId: "result-play-again" };
  const lobby: DuelResultAction = campaign
    ? { label: t("Volver al mapa"), href: campaign.mapHref }
    : { label: t("Volver al lobby"), href: MAIN_MENU_HREF };

  return (
    <DuelResult
      mode={mode === "DRAFT_GAUNTLET" ? "DRAFT" : campaign || view.context === "CAMPAIGN" ? "CAMPAIGN" : "PVE"}
      kind={kind}
      score={{ you: r.scoreYou, rival: r.scoreRival }}
      earnings={resultEarnings(r)}
      footnote={dailyCapReached(r) ? <DailyRewardSlot receipt={r.rewards} className="mt-5" /> : null}
      primary={primary}
      replayHref={`/duelos/replay/${view.matchId}`}
      lobby={lobby}
    />
  );
}
