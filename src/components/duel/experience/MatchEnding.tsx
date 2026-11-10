"use client";

/**
 * FASE 61 · EL FINAL DE UNA PARTIDA PvP, VIVIDO EN DIRECTO.
 *
 * En PvP la página cambia a `PvpOutcome` en cuanto el servidor declara la partida terminada: la arena se desmonta y
 * con ella la revelación del ÚLTIMO turno. El jugador veía su turno 9, jugaba el 10 y aparecía el resultado sin haber
 * visto el enfrentamiento que lo decidió (ni el desempate, si lo hubo).
 *
 * Esta capa se monta ENCIMA del resultado (que ya está en pantalla, con los datos del servidor) y reproduce, una sola
 * vez, la misma secuencia que el PvE: último turno (`DuelMoment`) → desempate si el marcador no decidió
 * (`TiebreakReveal`) → golpe final (`MatchComplete`). Solo si el final ocurrió DELANTE del jugador: quien entra por
 * URL o recarga sobre una partida terminada va directo al resultado (lo decide la página con `witnessedLive`).
 *
 * No decide nada ni pide nada: todo sale de la vista ya proyectada.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { DuelMoment } from "../DuelMoment";
import { MatchComplete } from "../MatchComplete";
import { TiebreakReveal } from "./TiebreakReveal";
import { endSequence } from "@/lib/duel/matchFlow";
import type { DuelMatchView } from "@/lib/duel/types";

type Beat = "TURN" | "TIEBREAK" | "COMPLETE" | "DONE";

export function MatchEnding({ view, onDone }: { view: DuelMatchView; onDone?: () => void }) {
  const last = view.lastTurn ?? view.history[view.history.length - 1] ?? null;
  const cards = [...view.yourUsed, ...view.yourHand, ...view.rivalUsed];
  const yourCard = last ? cards.find((c) => c.uid === last.you.uid) ?? null : null;
  const rivalCard = last ? cards.find((c) => c.uid === last.rival.uid) ?? null : null;
  const decidedBy = view.result?.decidedBy ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seq = useMemo(() => endSequence(view.result, true), [decidedBy]);
  const first: Beat = last && yourCard && rivalCard ? "TURN" : seq[0] ?? "DONE";
  const [beat, setBeat] = useState<Beat>(view.result ? first : "DONE");

  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const next = useCallback((from: Beat) => {
    setBeat((cur) => {
      if (cur !== from) return cur; // idempotente: un doble cierre no salta dos pasos
      const order: Beat[] = ["TURN", ...seq, "DONE"];
      const n = order[order.indexOf(from) + 1] ?? "DONE";
      if (n === "DONE") doneRef.current?.();
      return n;
    });
  }, [seq]);
  /* Cierres ESTABLES: la página PvP se re-renderiza con cada foto del servidor y un callback nuevo reiniciaría los relojes. */
  const closeTurn = useCallback(() => next("TURN"), [next]);
  const closeTiebreak = useCallback(() => next("TIEBREAK"), [next]);
  const closeComplete = useCallback(() => next("COMPLETE"), [next]);

  if (!view.result || beat === "DONE") return null;
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {beat === "TURN" && last && yourCard && rivalCard && (
          <DuelMoment key="last-turn" turn={last} yourCard={yourCard} rivalCard={rivalCard} totalTurns={view.totalTurns} onClose={closeTurn} />
        )}
        {beat === "TIEBREAK" && <TiebreakReveal key="tiebreak" result={view.result} onDone={closeTiebreak} />}
        {beat === "COMPLETE" && <MatchComplete key="complete" result={view.result} onDone={closeComplete} />}
      </AnimatePresence>
    </MotionConfig>
  );
}
