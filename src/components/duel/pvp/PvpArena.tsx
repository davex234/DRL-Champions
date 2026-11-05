"use client";

/**
 * ARENA PvP (Bloque 7.5).
 *
 * ─────────────────────── QUÉ APORTA Y QUÉ NO ───────────────────────
 *
 * Esta pantalla **no dibuja el duelo**. Lo dibuja `MatchBoard`, que es la misma mesa, las mismas
 * cartas, el mismo choque y las mismas animaciones del duelo contra el bot. Construir un tablero
 * paralelo para PvP habría sido tener dos tableros que envejecen por separado.
 *
 * Lo que aporta la arena es lo que el PvE no necesita y el PvP sí:
 *
 *   · el RELOJ del turno, que en PvE no existe;
 *   · el aviso de que ahora mismo te toca a ti o al rival — y que la otra persona está pensando;
 *   · el abandono con confirmación;
 *   · el estado de la conexión, porque aquí hay alguien al otro lado.
 *
 * ─────────────────────── LA UI NO ES AUTORIDAD ───────────────────────
 *
 * Aquí no se calcula NADA del juego. Ni quién gana, ni el marcador, ni el desempate, ni de quién
 * es el turno, ni si el tiempo se acabó. Todo eso llega resuelto en el `snapshot` del servidor:
 *
 *   `isYourTurn`      → lo dice el servidor. No se deduce comparando ids.
 *   `match`           → ya viene REDACTADO: el mazo oculto del rival no está en los datos.
 *   `turnDeadlineAt`  → el instante lo fija el servidor; aquí solo se resta para pintar.
 *   `lifecycle`       → FINISHED/ABANDONED/EXPIRED. La pantalla no declara un final por su cuenta.
 *
 * La cuenta atrás que se ve **no decide nada**. Cuando llega a cero la pantalla no anuncia
 * derrota: se queda esperando a que el servidor cierre la partida (bloque 7.4.3) y entonces
 * enseña el resultado que ese cierre haya producido.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CardRegistry } from "@/collection/registry";
import { buildMatchView } from "@/lib/duel/matchView";
import { turnRemainingMs, type SyncState } from "@/lib/duel/pvpPoller";
import type { CombatStatKey } from "@/lib/duel/types";
import { MatchBoard } from "@/components/duel/MatchBoard";
import { TurnTimer, TimeoutNotice } from "@/components/duel/arena/TurnTimer";
import { useTimeoutNotice } from "@/lib/duel/useDecisionClock";
import { FullscreenToggle } from "@/components/duel/FullscreenToggle";
import { SoundToggle } from "@/components/duel/SoundToggle";
import { HelpSheet } from "@/components/duel/HelpSheet";
import { NxButton } from "@/components/ui/NxButton";
import { Plate } from "@/components/ui/Surface";
import { connectionCopy } from "@/lib/duel/gameplayUx";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { DuelMoment } from "@/components/duel/DuelMoment";
import { MatchIntro } from "@/components/duel/MatchIntro";
import { LeaveMatchDialog } from "@/components/duel/experience/LeaveMatchDialog";
import { leaveConsequence } from "@/lib/duel/matchFlow";
import { useLeaveGuard } from "@/lib/duel/useLeaveGuard";
import { useRouter } from "next/navigation";
import { planReveals, syncBanner, timeoutPresentation } from "@/lib/duel/experience";
import type { DuelMatchView, DuelTurnView } from "@/lib/duel/types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("duel");

/** Una sola instancia por pestaña: el registro es un catálogo, no un estado. */
const registry = new CardRegistry();

/** Reloj de pared para la cuenta atrás. NO es autoridad: solo mueve el número. */
function useTick(activo: boolean): number {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!activo) return;
    const id = setInterval(() => setN((n) => (n + 1) % 1_000_000), 500);
    return () => clearInterval(id);
  }, [activo]);
  return Date.now();
}

export interface PvpArenaProps {
  state: SyncState;
  busy: boolean;
  error: string | null;
  onPlay: (cardUid: string, stat?: CombatStatKey) => void;
  onAbandon: () => void;
  onDismissError: () => void;
  /**
   * FASE 29 · DUELO PRIVADO. Misma arena, mismas reglas, misma reconexión; solo cambia el rótulo
   * («Duelo privado · sin rating») y que se enseña quién hay enfrente. Lo dice el servidor.
   */
  mode?: "PVP" | "PVP_PRIVATE";
  rival?: { username: string; avatar: string } | null;
  /** FASE 55 · la transición «Rival encontrado» ya presentó el duelo: la intro no se repite (nada de esperas dobles). */
  skipIntro?: boolean;
}

export function PvpArena({ state, busy, error, onPlay, onAbandon, onDismissError, mode = "PVP", rival = null, skipIntro = false }: PvpArenaProps) {
  useLocale();
  const privada = mode === "PVP_PRIVATE";
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  /* F61 · el botón Atrás abre el diálogo de salida (seguir, salir sin abandonar o abandonar) en vez de sacar sin avisar. */
  const [saliendo, setSaliendo] = useState(false);
  const [help, setHelp] = useState(false);
  const snap = state.snapshot;
  /*
   * ESTADO DE LA CONEXIÓN (Fase 26). El poller ya distingue SYNCING/STALE/ERROR; aquí solo se
   * traduce a una frase cuando el jugador debe saber que se está recuperando. No decide nada:
   * la partida sigue en el servidor y el propio poller reintenta con su retroceso.
   */
  const conexion = connectionCopy(state.status, snap !== null);

  const enJuego = snap !== null && snap.lifecycle !== "FINISHED"
    && snap.lifecycle !== "ABANDONED" && snap.lifecycle !== "EXPIRED";
  const ahora = useTick(enJuego);
  const restante = useMemo(() => turnRemainingMs(state, ahora), [state, ahora]);

  /*
   * La vista del tablero se construye con `buildMatchView` desde el bando QUE DICE EL SERVIDOR.
   * Es la misma función que proyecta el PvE (`toPublicView` la llama con `side: "A"`), así que no
   * hay una segunda forma de mirar la misma partida.
   */
  const view = useMemo(() => {
    if (!snap) return null;
    return buildMatchView(snap.match, {
      side: snap.yourSide,
      registry,
      // En PvP no hay dificultad: el tablero usa `rivalLabel` y nunca pinta esta etiqueta.
      difficulty: "NORMAL",
      rivalLabel: t("Rival"),
    });
  }, [snap]);

  const tuTurno = snap?.isYourTurn ?? false;
  // F72.8 · «Tiempo agotado · jugada automática», el tuyo o el del rival, sin modal.
  const timeoutNotice = useTimeoutNotice(view?.matchId, view?.timeouts);

  /*
   * FASE 33 · INTRO Y REVELACIÓN, SIN AUTORIDAD. La intro solo al entrar en una partida recién
   * empezada (sin turnos jugados); la revelación, solo del turno que acaba de resolverse. La PRIMERA
   * foto (entrada o reconexión) no anima nada, y si llegan varios turnos de golpe se enseña el último
   * (`planReveals`, cola acotada). Nada de esto frena el poller, retrasa una acción ni cambia la mesa:
   * el tablero de debajo ya está en el estado del servidor.
   */
  const vistos = useRef<number | null>(null);
  const [revelar, setRevelar] = useState<DuelTurnView | null>(null);
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    if (!view) return;
    const primera = vistos.current === null;
    const plan = planReveals(vistos.current, view.history);
    vistos.current = plan.seen;
    /*
     * F61 · la entrada es la misma que en PvE. Si la partida viene de «Rival encontrado» (ranked, `skipIntro`), ese
     * primer tiempo ya se vio: la entrada empieza en el equipo (`from="LINEUP"`). Solo en una partida recién creada.
     */
    if (primera) { if (view.history.length === 0 && enJuego) setIntro(true); return; }
    if (plan.reveal) setRevelar(plan.reveal);
  }, [view, enJuego, skipIntro]);
  const cerrarIntro = useCallback(() => setIntro(false), []);
  const abrirSalida = useCallback(() => setSaliendo(true), []);
  const quedarse = useCallback(() => setSaliendo(false), []);
  useLeaveGuard(enJuego, abrirSalida);
  const cerrarRevelar = useCallback(() => setRevelar(null), []);
  const resync = syncBanner(state.status, state.error?.kind ?? null);
  const tiempo = timeoutPresentation(restante, tuTurno);

  // Si deja de ser tu turno, se cierra cualquier confirmación abierta: el contexto ya cambió.
  const eraTuTurno = useRef(tuTurno);
  useEffect(() => {
    if (eraTuTurno.current !== tuTurno) { eraTuTurno.current = tuTurno; setConfirmando(false); }
  }, [tuTurno]);

  const jugar = useCallback((cardUid: string, stat?: CombatStatKey) => {
    // Doble red contra el spam: el servidor rechaza igualmente, pero no se manda a sabiendas.
    if (!tuTurno || busy) return;
    onPlay(cardUid, stat);
  }, [tuTurno, busy, onPlay]);

  if (!view || !snap) return null;

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex flex-col gap-3" data-scene="pvp-arena" data-mode={mode}>
      <HelpSheet open={help} onClose={() => setHelp(false)} mode="PVP" />
      <TimeoutNotice notice={timeoutNotice} />
      <LeaveMatchDialog
        open={saliendo && enJuego}
        consequence={leaveConsequence(privada ? "private" : "ranked")}
        busy={busy}
        onStay={quedarse}
        onKeep={() => { setSaliendo(false); router.push(privada ? "/duelos" : "/competitivo"); }}
        onAbandon={() => { setSaliendo(false); onAbandon(); }}
      />

      <AnimatePresence>
        {intro && (
          <MatchIntro
            key="intro"
            view={view}
            rivalName={rival?.username ?? t("Rival")}
            rivalAvatar={rival?.avatar ?? null}
            mode={privada ? "private" : "ranked"}
            from={skipIntro ? "LINEUP" : "FOUND"}
            onDone={cerrarIntro}
          />
        )}
        {revelar && !intro && cartaDe(view, revelar.you.uid) && cartaDe(view, revelar.rival.uid) && (
          <DuelMoment
            key={`t${revelar.number}`}
            turn={revelar}
            yourCard={cartaDe(view, revelar.you.uid)!}
            rivalCard={cartaDe(view, revelar.rival.uid)!}
            totalTurns={view.totalTurns}
            onClose={cerrarRevelar}
          />
        )}
      </AnimatePresence>

      {/* ── Fase 29 · rótulo del duelo privado: quién hay enfrente y que aquí no hay rating en juego ── */}
      {privada && (
        <p className="nx-clip-sm flex flex-wrap items-center justify-between gap-2 border border-drl-cyan/35 bg-drl-cyan/[0.06] px-3 py-1.5 text-caption" data-testid="private-badge">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan">{t("Duelo privado · sin rating")}</span>
          {rival && <span className="text-white/70"><span aria-hidden className="mr-1">{rival.avatar}</span>{fill(t("contra {nombre}", slots("nombre")), { nombre: <b className="text-white">{rival.username}</b> })}</span>}
        </p>
      )}

      {/* ── Fase 55 · rótulo ranked: contra quién (identidad pública del servidor) y que el rating está en juego ── */}
      {!privada && rival && (
        <p className="nx-clip-sm flex flex-wrap items-center justify-between gap-2 border border-drl/35 bg-drl/[0.06] px-3 py-1.5 text-caption" data-testid="ranked-badge">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-glow">{t("Ranked · rating en juego")}</span>
          <span className="text-white/70"><span aria-hidden className="mr-1">{rival.avatar}</span>{fill(t("contra {nombre} · jugador real", slots("nombre")), { nombre: <b className="text-white">{rival.username}</b> })}</span>
        </p>
      )}

      {/* ── Conexión: solo cuando hay algo que decir (recuperando, reconectando, sin red) ── */}
      {conexion && (
        <p
          role="status"
          data-connection={state.status}
          className={`nx-clip-sm border-l-2 px-3 py-1.5 text-caption ${
            conexion.tone === "bad" ? "border-l-drl-red text-drl-red" : conexion.tone === "warn" ? "border-l-drl-gold text-drl-gold" : "border-l-drl-cyan text-drl-cyan"
          } bg-white/[0.03]`}
        >
          {td(conexion.text)}
        </p>
      )}

      {/* ── Fase 33 · resincronización tras un conflicto de versión y turno vencido (plazo del servidor) ── */}
      {resync && (
        <p role="status" data-resync="conflict" className="nx-clip-sm border-l-2 border-l-drl-gold bg-white/[0.03] px-3 py-1.5 text-caption text-drl-gold">{td(resync.text)}</p>
      )}
      {enJuego && tiempo.expired && tiempo.text && (
        <p role="status" data-timeout={tuTurno ? "you" : "rival"} className="nx-clip-sm border-l-2 border-l-drl-red bg-white/[0.03] px-3 py-1.5 text-caption text-drl-red">{td(tiempo.text)}</p>
      )}

      {/* ── Barra de estado del duelo ── */}
      <Plate className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <div className="flex items-center gap-3">
          <span
            className={`nx-label ${tuTurno ? "text-drl-cyan" : "text-white/45"}`}
            data-testid="pvp-turn"
            /* El cambio de turno SÍ merece anuncio: es lo que decide si puedes actuar. */
            aria-live="polite"
          >
            {tuTurno ? t("Tu turno") : t("Turno del rival")}
          </span>
          {!tuTurno && enJuego && (
            <span className="text-[11px] text-white/35">{rival ? t("{username} está decidiendo…", { username: rival.username }) : t("El rival está decidiendo…")}</span>
          )}
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          {/* F72.8 · el MISMO contador que el PvE: el plazo lo fija el servidor por decisión (30 s) y lo juega al vencer. */}
          {enJuego && <TurnTimer ms={restante} yours={tuTurno} />}
          <button
            type="button"
            onClick={() => setHelp(true)}
            aria-label={t("Cómo se juega")}
            className="nx-focus grid h-9 w-9 shrink-0 place-items-center rounded-control border border-white/12 bg-white/[0.04] font-display text-[14px] font-bold text-white/70 transition hover:bg-white/[0.1] hover:text-white"
          >
            ?
          </button>
          <SoundToggle className="!h-9 !w-9 hidden sm:grid" />
          {/* Fase 22.2 (§20): pantalla completa, la misma que en PvE. Se oculta si la API no está. */}
          <FullscreenToggle className="!h-9 !w-9 !min-h-0" />
          {/* F61 · la ruta es inmersiva: «Salir» abre el diálogo (seguir, salir sin abandonar o abandonar). */}
          {enJuego && !confirmando && (
            <NxButton size="sm" variant="ghost" onClick={abrirSalida} data-testid="pvp-leave">{t("Salir")}</NxButton>
          )}
          {enJuego && (
            confirmando ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/60">{t("¿Abandonar? Cuenta como derrota.")}</span>
                <NxButton size="sm" variant="danger" onClick={onAbandon} disabled={busy}>{t("Sí, abandonar")}</NxButton>
                <NxButton size="sm" variant="ghost" onClick={() => setConfirmando(false)}>{t("No")}</NxButton>
              </div>
            ) : (
              <NxButton size="sm" variant="ghost" onClick={() => setConfirmando(true)}>{t("Abandonar")}</NxButton>
            )
          )}
        </div>
      </Plate>

      {/* ── La mesa. La misma que el duelo contra el bot. ── */}
      <MatchBoard
        view={view}
        onPlay={jugar}
        /* `busy` bloquea la mesa cuando hay una acción en vuelo O cuando no te toca: en PvP
           esperar al rival es un estado normal, no un error, y la mesa tiene que reflejarlo. */
        busy={busy || !tuTurno}
        waitingRival={!tuTurno && enJuego}
        revealing={revelar !== null}
        sync={{ status: state.status, isYourTurn: tuTurno, lifecycle: snap.lifecycle }}
        error={td(error)}
        onDismissError={onDismissError}
      />
    </div>
    </MotionConfig>
  );
}

/** Carta conocida por la vista (tuya, o del rival YA jugada). Nunca una no revelada. */
function cartaDe(view: DuelMatchView, uid: string) {
  return [...view.yourHand, ...view.yourUsed, ...view.rivalUsed].find((c) => c.uid === uid);
}
