"use client";

/**
 * F86 · MI PARTIDA DEL TORNEO · F86.1 · espera del rival sin segundo clic.
 *
 * JUGAR = «estoy listo» con un equipo. La partida nace SOLO cuando los dos estáis listos a la vez (el servidor reserva
 * su id una vez y la crea con el motor PvP de siempre): así el reloj de decisión nunca juega por alguien que no está.
 *
 * F86.1:
 *   · LISTO PERSISTE EN EL SERVIDOR: si recargas, la pantalla vuelve a «Esperando al rival» porque lo dice el servidor
 *     (`youReady`), no un estado local. El «listo» caduca a los 30 s sin renovar; esta pantalla lo renueva cada 10 s
 *     con la pestaña VISIBLE (y al instante al volver a ella o al recuperar la red). Si te vas, dejas de estar listo:
 *     nadie empieza una partida contigo ausente.
 *   · SIN SEGUNDO CLIC: el sondeo compartido de estado (3 s mientras esperas) descubre la partida que creó tu rival y
 *     entras solo, con guardas: solo si TÚ pulsaste listo, sigues en ESTA pantalla, la partida es la de ESTE cruce y la
 *     sesión es la misma. Si no se cumplen, se ofrece el botón «Entrar a la partida» (y el aviso global del armazón).
 *   · El plazo vencido, la revisión, un error de sesión o la falta de red dejan de decir «esperando» y explican qué pasa.
 * No hay botón de «mi rival no vino»: un plazo vencido lo resuelve la organización, nunca un sorteo ni el jugador.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";
import { formatTag } from "@/domain/account/tag";
import type { CupMe, CupStatusMatch } from "@/server/services/cups";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { readyCup, announceCupsChange, CupError } from "@/lib/cups/client";
import { playerMessage } from "@/components/ui/game/GameStates";
import { Countdown, fmtDate } from "./CupParts";
import { ns, td } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("cups");

export const CUP_RENEW_MS = 10_000;
const keyOf = (m: { slug?: string; round: number; slot: number }, slug: string) => `${slug}:${m.round}:${m.slot}`;

type Blocker = null | "SESSION" | "OFFLINE";

export function CupMyMatchPanel({ slug, me, decks, activeDeckId, offset, status = null, viewerId = null, onStarted, onRefresh, className, harness = false }: {
  slug: string; me: CupMe; decks: DuelDeckDTO[] | null; activeDeckId?: string | null; offset: number;
  /** F86.1 · mi cruce según el sondeo LIGERO compartido (más fresco que la ficha). */
  status?: CupStatusMatch | null;
  /** F86.1 · cuenta que ve la pantalla: la entrada automática exige que siga siendo la misma. */
  viewerId?: string | null;
  onStarted: (gameMatchId: string) => void; onRefresh: () => void; className?: string;
  /** Arnés visual: sin peticiones ni temporizadores. */
  harness?: boolean;
}) {
  useLocale();
  const m0 = me.match;
  const key = m0 ? keyOf(m0, slug) : null;
  // El sondeo de estado manda si habla de ESTE cruce (es más fresco que la ficha).
  const live = status && m0 && keyOf(status, status.slug) === key ? status : null;
  const state = live?.state ?? m0?.state ?? null;
  const youReadyServer = live ? live.youReady : !!m0?.youReady;
  const opponentReady = live ? live.opponentReady : !!m0?.opponentReady;
  const gameMatchId = live?.gameMatchId ?? m0?.gameMatchId ?? null;

  const valid = (decks ?? []).filter((d) => d.valid);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [waitingKey, setWaitingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<Blocker>(null);
  const alive = useRef(true);
  const navigated = useRef<string | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setDeckId((cur) => (cur && valid.some((d) => d.id === cur) ? cur : valid.find((d) => d.id === activeDeckId)?.id ?? valid[0]?.id ?? null));
  }, [decks, activeDeckId]); // eslint-disable-line react-hooks/exhaustive-deps

  // F5 / otra pestaña: si el SERVIDOR dice que estoy listo en este cruce jugable, la pantalla está esperando.
  useEffect(() => {
    if (key && state === "READY" && youReadyServer) setWaitingKey(key);
  }, [key, state, youReadyServer]);
  // Deja de esperar en cuanto el cruce no es jugable (plazo, revisión, terminado) o cambia de cruce.
  const waiting = !!key && waitingKey === key && state === "READY";

  const enter = useCallback((game: string) => {
    if (navigated.current === game || !alive.current) return;
    navigated.current = game;
    announceCupsChange();
    onStarted(game);
  }, [onStarted]);

  const ready = useCallback(async (renew = false) => {
    if (!m0 || !deckId || harness) return;
    if (!renew) { setBusy(true); setError(null); }
    try {
      const r = await readyCup(slug, m0.round, m0.slot, deckId);
      if (!alive.current) return;
      setBlocker(null);
      if (r.code === "STARTED" && r.gameMatchId) { setWaitingKey(null); enter(r.gameMatchId); return; }
      if (!renew) { setWaitingKey(key); announceCupsChange(); }
    } catch (e) {
      if (!alive.current) return;
      const err = e instanceof CupError ? e : null;
      if (err?.status === 401) { setWaitingKey(null); setBlocker("SESSION"); return; }
      if (!err && typeof navigator !== "undefined" && !navigator.onLine) { setBlocker("OFFLINE"); return; }
      if (!err) { setBlocker("OFFLINE"); return; } // fallo de red: se reintenta al volver la conexión
      setWaitingKey(null);
      setError(playerMessage(err.message));
      onRefresh();
    } finally { if (alive.current && !renew) setBusy(false); }
  }, [m0, deckId, harness, slug, key, enter, onRefresh]);

  // Renovación del «listo» mientras espero: cada 10 s con la pestaña visible; al volver a ella o a la red, en el acto.
  useEffect(() => {
    if (!waiting || harness) return;
    const tick = () => { if (document.visibilityState === "visible") void ready(true); };
    const id = window.setInterval(tick, CUP_RENEW_MS);
    const onVis = () => { if (document.visibilityState === "visible") void ready(true); };
    const onOnline = () => { setBlocker(null); void ready(true); };
    const onOffline = () => setBlocker("OFFLINE");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [waiting, harness, ready]);

  // ENTRADA AUTOMÁTICA (guardada): el cruce pasó a EN JUEGO mientras YO esperaba en ESTA pantalla (la partida la creó mi
  // rival al ponerse listo), es la de ESTE cruce y la sesión es la misma. Si cualquier guarda falla: botón, nunca salto.
  useEffect(() => {
    if (harness || !key || waitingKey !== key || state !== "ACTIVE" || !gameMatchId) return;
    if (typeof window === "undefined" || window.location.pathname !== `/copas/${slug}` || viewerId === null) return;
    enter(gameMatchId);
  }, [harness, key, waitingKey, state, gameMatchId, slug, viewerId, enter]);

  if (!m0 || !state) return null;
  const opp = m0.opponent ?? (live?.opponent ? { ...live.opponent, seed: null, you: false, userId: "" } : null);
  const oppName = opp ? `${opp.username}${opp.tag ? ` ${formatTag(opp.tag)}` : ""}` : null;
  const playable = state === "READY";
  const title = state === "ACTIVE" ? t("Tu partida está lista")
    : waiting ? t("Esperando a tu rival")
      : playable ? (opponentReady ? t("Tu rival ya está listo") : t("Tu partida está lista"))
        : state === "WAITING_WINDOW" ? t("Tu próxima partida")
          : state === "PENDING" ? t("Esperando rival")
            : state === "NO_SHOW_PENDING" ? t("Plazo vencido · en revisión")
              : state === "ACTION_REQUIRED" ? t("Cruce en revisión") : t("Tu último cruce");
  const tone = state === "ACTIVE" || waiting || (playable && opponentReady) ? "cyan" : playable ? "cyan" : state === "NO_SHOW_PENDING" || state === "ACTION_REQUIRED" ? "gold" : "neutral";
  const border = tone === "cyan" ? "rgba(25,227,255,0.55)" : tone === "gold" ? "rgba(255,206,79,0.5)" : "rgba(255,255,255,0.14)";
  const bg = tone === "cyan" ? "radial-gradient(120% 120% at 0% 0%, rgba(25,227,255,0.14), transparent 60%), rgba(255,255,255,0.03)"
    : tone === "gold" ? "radial-gradient(120% 120% at 0% 0%, rgba(255,206,79,0.12), transparent 60%), rgba(255,255,255,0.03)" : "rgba(255,255,255,0.03)";
  const announce = state === "ACTIVE" ? t("Tu partida de torneo está lista.")
    : waiting ? t("Estás listo. Esperando a {v}.", { v: td(oppName) ?? t("tu rival") })
      : playable && opponentReady ? t("Tu rival ya está listo.") : state === "NO_SHOW_PENDING" ? t("El plazo de la ronda terminó. El cruce está en revisión.")
        : state === "ACTION_REQUIRED" ? t("El cruce está en revisión.") : "";

  return (
    <section aria-labelledby="cup-my-match-title" data-testid="cup-my-match" data-state={state} data-waiting={waiting ? "1" : "0"} data-opponent-ready={opponentReady ? "1" : "0"}
      className={cn("nx-clip relative px-4 py-4 sm:px-6", className)} style={{ border: `1px solid ${border}`, background: bg }}>
      <p role="status" aria-live="polite" className="sr-only" data-testid="cup-announce">{td(announce)}</p>
      {m0.advancedFrom && (
        <p className="mb-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-[#ffce4f]" data-testid="cup-advanced">{t("✓ Has ganado {ronda} · avanzas a {siguiente}", { ronda: roundText(m0.advancedFrom), siguiente: roundText(m0.roundName) })}</p>
      )}
      <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-white/55">{roundText(m0.roundName)}</p>
      <h2 id="cup-my-match-title" className="mt-0.5 font-display text-[22px] font-black uppercase leading-tight text-white sm:text-[26px]">{td(title)}</h2>

      <div className="mt-3 flex min-w-0 items-center gap-3">
        <span aria-hidden className="text-[28px] leading-none">{opp?.avatar ?? "❔"}</span>
        <div className="min-w-0">
          <p className="text-[12px] uppercase tracking-[0.14em] text-white/45">{t("Rival")}</p>
          <p className="truncate font-display text-[18px] font-black uppercase text-white" data-field="cup-opponent">
            {opp ? opp.username : t("Por decidir")}{opp?.tag && <span className="ml-2 font-mono text-[12px] font-normal text-white/50">{formatTag(opp.tag)}</span>}
          </p>
          {!opp && m0.waitingFor && <p className="text-[12px] text-white/55">{(live?.rivalSource ?? m0.rivalSource) === "ACTIVE" ? t("{espera} · se está jugando ahora", { espera: td(m0.waitingFor) }) : td(m0.waitingFor)}</p>}
          {opp && playable && !waiting && (
            <p className="text-[12px]" style={{ color: opponentReady ? "#19e3ff" : "rgba(255,255,255,0.5)" }} data-field="cup-opponent-ready">{opponentReady ? t("✓ Tu rival está listo y te espera") : t("Tu rival aún no está listo")}</p>
          )}
        </div>
      </div>

      {state === "WAITING_WINDOW" && (
        <p className="mt-3 text-[13px] text-white/70">{fill(t("{cuenta} · plazo hasta {fecha}", { ...slots("cuenta"), fecha: fmtDate(m0.deadlineAt) }), { cuenta: <Countdown to={m0.availableAt} offset={offset} prefix={t("Se puede jugar en")} /> })}</p>
      )}

      {playable && (
        <>
          <p className="mt-3 text-[13px] text-white/70">{fill(t("{cuenta} · si nadie juega a tiempo, lo resuelve la organización.", slots("cuenta")), { cuenta: <Countdown to={m0.deadlineAt} offset={offset} prefix={t("Plazo:")} /> })}</p>
          {waiting ? (
            <div className="mt-4" data-testid="cup-waiting">
              <p className="flex items-center gap-2.5 font-display text-[16px] font-black uppercase tracking-[0.12em] text-[#19e3ff]">
                <span aria-hidden className={cn("inline-block h-2.5 w-2.5 rounded-full bg-[#19e3ff]", !reduced && "animate-pulse motion-reduce:animate-none")} />
                {t("✓ Listo · esperando a {rival}", { rival: td(oppName) ?? t("tu rival") })}
              </p>
              <p className="mt-1 text-[13px] text-white/70">{t("Ya estás listo. Entrarás en la partida automáticamente en cuanto tu rival esté preparado. Quédate en esta pantalla: si te vas, dejarás de estar listo.")}</p>
              {blocker === "OFFLINE" && <p role="alert" className="mt-2 text-[13px] text-[#ffce4f]" data-testid="cup-offline">{t("Sin conexión. Seguirás esperando en cuanto vuelva la red (nadie pierde por esto).")}</p>}
              <NxButton variant="ghost" size="md" className="mt-3 min-h-[44px]" onClick={() => setWaitingKey(null)} data-testid="cup-stop-waiting">{t("Dejar de esperar")}</NxButton>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[12px] uppercase tracking-[0.14em] text-white/55">{t("Tu equipo")}</span>
                {valid.length ? (
                  <select value={deckId ?? ""} onChange={(e) => setDeckId(e.target.value)} data-testid="cup-deck"
                    className="nx-focus min-h-[44px] w-full rounded-md bg-white/[0.06] px-3 text-[14px] text-white ring-1 ring-white/15">
                    {valid.map((d) => <option key={d.id} value={d.id} className="bg-[#0b0d14]">{d.name}</option>)}
                  </select>
                ) : (
                  <span className="block text-[13px] text-white/60">{decks === null ? t("Cargando tus equipos…") : fill(t("No tienes un equipo válido. {enlace}.", slots("enlace")), { enlace: <a href="/duelos/mazos" className="nx-focus text-[#19e3ff] underline">{t("Prepara uno")}</a> })}</span>
                )}
              </label>
              <NxButton variant="primary" accent="cyan" size="lg" className="min-h-[48px] sm:min-w-[180px]" onClick={() => void ready(false)} disabled={busy || !deckId} data-testid="cup-play">
                {busy ? t("Preparando…") : opponentReady ? t("Jugar ya") : t("Jugar")}
              </NxButton>
            </div>
          )}
        </>
      )}

      {state === "ACTIVE" && gameMatchId && (
        <div className="mt-4">
          <p className="text-[13px] text-white/75">{t("Los dos estáis listos: la partida ha empezado.")}</p>
          <NxButton variant="primary" accent="cyan" size="lg" className="mt-3 min-h-[48px]" onClick={() => enter(gameMatchId)} data-testid="cup-enter">{t("Entrar a la partida")}</NxButton>
        </div>
      )}
      {(state === "ACTION_REQUIRED" || state === "NO_SHOW_PENDING") && (
        <p className="mt-3 text-[13px] text-white/75" data-testid="cup-review">{state === "ACTION_REQUIRED" ? t("La partida terminó sin un ganador claro (empate exacto o cierre por tiempo).") : t("El plazo de la ronda terminó sin partida.")} {t("La organización resolverá el cruce; nadie avanza hasta entonces y no hay sorteo.")}</p>
      )}
      {state === "PENDING" && <p className="mt-3 text-[13px] text-white/70">{t("En cuanto se decida tu rival, tu partida aparecerá aquí y en el menú «Torneos».")}</p>}
      {blocker === "SESSION" && <p role="alert" className="mt-3 text-[13px] text-[#ff6b8a]" data-testid="cup-session">{fill(t("Tu sesión ha caducado: ya no estás listo. {entrar} para seguir.", slots("entrar")), { entrar: <a href="/cuenta" className="nx-focus underline">{t("Entra de nuevo")}</a> })}</p>}
      {error && <p role="alert" className="mt-3 text-[13px] text-[#ff6b8a]" data-testid="cup-error">{td(error)}</p>}
    </section>
  );
}
