"use client";

/**
 * FASE 62 · RECLAMAR DONDE SE VE (hub, post-partida). Transporte de los reclamos EXISTENTES —`claimMission`,
 * `claimPassLevel`, `claimAchievement` sobre `POST /api/game/progression`— con un cerrojo de cliente por clave.
 *
 * La autoridad sigue en el servidor: comprueba que la misión/el nivel/el logro está completo con SUS métricas, paga por la
 * ÚNICA ruta (`award`) con clave determinista (`mission:<temporada>:<id>:<tanda>:<baseline>`, `pass:<temporada>:<carril>:
 * <nivel>`, `achievement:<id>`) y guarda el pase con concurrencia optimista. El cerrojo de aquí solo evita MANDAR dos veces
 * a sabiendas (doble clic, «Reclamar todo» mientras otro reclamo vuela); si llegan dos, el libro mayor paga una.
 *
 * El cliente no envía ni cantidades, ni XP, ni «completado»: solo el id de lo que quiere reclamar.
 */
import { useCallback, useRef, useState } from "react";
import { claimAchievement, claimMission, claimPassLevel, ProgressionError } from "./client";
import { claimOrder, type Claimable } from "@/domain/progression/hub";
import { syncFromServer } from "@/lib/game/sync";

export interface ClaimOutcome { key: string; ok: boolean; error: string | null }

async function send(c: Claimable): Promise<void> {
  if (c.kind === "mission") await claimMission(c.id);
  else if (c.kind === "level") await claimPassLevel(c.level!, c.track ?? "free");
  else await claimAchievement(c.id);
}

export function useClaims(onAfter: () => Promise<void> | void) {
  const inFlight = useRef<Set<string>>(new Set());
  /* F62 · UNA tanda a la vez: un doble clic en «Reclamar todo» lanzaba dos tandas que chocaban en el pase (QA real). */
  const running = useRef(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [last, setLast] = useState<ClaimOutcome[]>([]);
  const [claimed, setClaimed] = useState<Claimable[]>([]);

  const mark = (key: string, on: boolean) => {
    if (on) inFlight.current.add(key); else inFlight.current.delete(key);
    setBusy(new Set(inFlight.current));
  };

  const run = useCallback(async (list: Claimable[]): Promise<ClaimOutcome[]> => {
    if (running.current) return [];
    running.current = true;
    const out: ClaimOutcome[] = [];
    const ok: Claimable[] = [];
    try {
    for (const c of claimOrder(list)) {
      if (inFlight.current.has(c.key)) continue; // ya en vuelo: no se manda otra vez
      mark(c.key, true);
      try {
        await send(c);
        out.push({ key: c.key, ok: true, error: null });
        ok.push(c);
      } catch (e) {
        // 409 = ya reclamado / ya no reclamable / el pase cambió: el servidor manda; se relee y se sigue.
        out.push({ key: c.key, ok: false, error: e instanceof ProgressionError ? e.message : "No se pudo reclamar" });
      } finally {
        mark(c.key, false);
      }
    }
    setLast(out);
    // Se acumula hasta que se cierra la revelación (una tanda encadenada enseña todo lo recogido).
    setClaimed((prev) => [...prev, ...ok.filter((c) => !prev.some((p) => p.key === c.key))]);
    await onAfter();
    /*
     * F68 · el saldo y la XP del HUD viven en el store de juego, no en la foto de progresión que relee `onAfter`: sin esto
     * el HUD seguía en 6.000 tras cobrar +3.430 (medido en la beta) hasta recargar. Una lectura, solo si algo se cobró.
     */
    if (ok.length > 0) await syncFromServer().catch(() => undefined);
    } finally {
      running.current = false;
    }
    return out;
  }, [onAfter]);

  const claimOne = useCallback((c: Claimable) => run([c]), [run]);
  const clearReveal = useCallback(() => setClaimed([]), []);
  return { busy, last, claimed, claimOne, claimAll: run, clearReveal };
}
