"use client";

/**
 * PACK OPENING EXPERIENCE 3.0 · THE REVEAL (Fase 38).
 *
 * ══════════════════════════ EL SERVIDOR DECIDE, LA CEREMONIA PRESENTA ══════════════════════════
 *
 *   gesto → pestillo → UNA petición (`openPackOutcome`, clave de gesto fijada por `lib/game/sync`) → resultado
 *   AUTORITATIVO recibido → rotura → cartas boca abajo → revelado carta a carta → resumen.
 *
 * Nada se revela antes de que el servidor confirme: mientras espera, el sobre solo usa el color DEL SOBRE. Si la
 * petición falla, no hubo ceremonia: error honesto y reintento con la MISMA clave (recupera lo abierto o abre por
 * primera vez, nunca dos). Ni una probabilidad, ni una carta, ni un serial se calculan en esta pantalla.
 *
 * ══════════════════════════ PRESENTACIÓN, NO ESTADO DE JUEGO ══════════════════════════
 *
 * La fase de la ceremonia es una máquina de estados PURA (`domain/packs/reveal · revealReducer`): no se persiste.
 * Qué es nueva, duplicada ×N o nueva variante, la rareza real, el serial y su prestigio, el resumen (colección
 * X → Y / TOTAL, sets, primera legendaria) salen de `buildRevealPlan` con el resultado persistido y la foto de la
 * colección de ANTES de abrir (tomada al pulsar; encadenada al abrir otro, sin volver a pedirla). Si esa foto no
 * existe, la pantalla no afirma nada sobre «nueva».
 *
 * ══════════════════════════ RECUPERACIÓN ══════════════════════════
 *
 *   · recarga con el revelado ya guardado en la pestaña → resumen directo (`loadOpenReveal`);
 *   · recarga con la petición enviada y sin respuesta → se pide el resultado con la MISMA clave (`hasPendingOpen`);
 *   · otra pestaña ya lo abrió → «no te queda este sobre», sin error fatal.
 *
 * Sin valor en monedas, sin «vender repetidas», sin mercado. El sobre entrega cartas; la carta es el premio.
 */
import { usePacksVersion } from "@/lib/packs/usePacksVersion";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { getPack } from "@/data/packs";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { useGameStore, type OpenedResult } from "@/store/useGameStore";
import { useEventsStore } from "@/store/useEventsStore";
import { getVariant } from "@/domain/cards/variants";
import type { OwnedInstanceFact } from "@/domain/collection/room";
import {
  INITIAL_REVEAL, beforeExcluding, buildRevealPlan, cinematicFor, classifyOpenFailure, hasResult, revealReducer, toInstanceFact, toOpenedInstances,
} from "@/domain/packs/reveal";
import { primeAudio, playCutTick, playBurst, playCue } from "@/lib/sound";
import { dimEnvironment, packChamberDim } from "@/design/environment";
import { packMusicDuck } from "@/lib/audio/music";
import { useMusicDuck } from "@/components/audio/MusicDirector";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { openPackOutcome, hasPendingOpen } from "@/lib/game/sync";
import { isPubliclyOpenable } from "@/domain/packs/lifecycle";
import { saveOpenReveal, loadOpenReveal, clearOpenReveal, markOpenRevealSeen, isReloadOf } from "@/lib/game/openRecovery";
import { useCollectionPersonal } from "@/lib/collection/client";
import { trackFlow } from "@/lib/telemetry/client";
import { AddToDeckSheet } from "@/components/deck/AddToDeckSheet";
import type { DeckCardLike } from "@/domain/cardgame/deckInsert";
import { toDeckCard } from "@/components/deck/deckCard";
import { invalidateOnboarding, useOnboarding } from "@/lib/onboarding/client";
import { FirstCardLesson, OnboardingPackNext } from "@/components/onboarding/FirstCardLesson";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { useProgressionDelta } from "@/lib/progression/meta";
import { PostMatchProgress } from "@/components/progression/PostMatchProgress";
import type { HandSlot } from "./PackHand";
import { PackBackdrop, PackStage, RUPTURE_MS, RUPTURE_REDUCED_MS } from "./PackStage";
import { HeroReveal } from "./HeroReveal";
import { RestReveal } from "./RestReveal";
import { PackSummary } from "./PackSummary";
import { MAIN_PACK_LINE } from "@/domain/packs/packClass";
import { NextUpAfter } from "@/components/liveService/NextUpAfter";
import { PackStatus } from "./PackStatus";
import { useServerEconomy, SESSION_PENDING } from "@/lib/game/serverEconomy";
import dynamic from "next/dynamic";
import { PACK_WALKOUT_3D_ENABLED } from "@/config/features";
import { PACK_WALKOUT_DEV_KEY, packWalkoutAllowed, packWalkoutQueue, walkoutFlow, type PackWalkoutItem } from "@/domain/walkout/packWalkout";
import { useAdminSession } from "@/lib/supabase/useAdminSession";
import { ns, td } from "@/i18n/runtime";
import { useCriticalOperation, useLocale } from "@/i18n/react";

const tr = ns("packs");

/*
 * WALKOUT 0.5 · el walkout se carga BAJO DEMANDA (solo si esta apertura trae una carta especial y el despliegue lo
 * permite); three.js, a su vez, solo si su escenario 3D llega a montarse. Mientras llega el código, un fondo oscuro.
 */
const loadPackWalkout = () => import("./PackWalkout");
const PackWalkout = dynamic(() => loadPackWalkout().then((m) => m.PackWalkout), {
  ssr: false,
  loading: () => <div className="absolute inset-0 z-surface grid place-items-center bg-[#030409] font-display text-label font-bold uppercase tracking-wide2 text-white/60" role="status">{tr("Preparando…")}</div>,
});

/** Pregunta al servidor si la cuenta es admin SOLO cuando el despliegue es «admins» (con «off» no se monta: 0 peticiones). */
function AdminProbe({ onResult }: { onResult: (g: ReturnType<typeof useAdminSession>) => void }) {
  const gate = useAdminSession();
  useEffect(() => { onResult(gate); }, [gate, onResult]);
  return null;
}

const CUT_DISTANCE = 220; // px de deslizamiento para abrir
const CATALOG = { cards: CARDS, getCard, getPlayer };

/**
 * F81 · ¿Se puede presentar una hero con este resultado PERSISTIDO? Si una carta no tiene OVR válido o no se resuelve en
 * el catálogo, no se inventa nada: sin cinemática, resumen directo y la inconsistencia queda registrada (consola y
 * telemetría). Las cartas siguen siendo del jugador: esto solo decide la PRESENTACIÓN.
 */
function heroIsPresentable(res: readonly OpenedResult[]): boolean {
  const c = cinematicFor(buildRevealPlan(toOpenedInstances(res), null, CATALOG));
  if (c.ok) return true;
  console.error("[pack-opening] hero no presentable:", c.reason, c.detail);
  trackFlow("pack_ceremony", `hero_unavailable:${c.reason}`);
  return false;
}

export function PackOpeningExperience({ packId, qaOpen, qaWalkout }: {
  packId: string;
  /**
   * F81 · SOLO arneses QA (`/design-system/fase81`, 404 en producción): un resultado FIJO en lugar del servidor/motor,
   * para probar la ceremonia real de forma determinista. La ruta pública (`/abrir/[packId]`) nunca lo pasa.
   */
  qaOpen?: (packId: string) => OpenedResult[];
  /** WALKOUT 0.5 · SOLO arneses QA (fuera de producción no cuenta): presenta el walkout aunque el despliegue esté en «off». */
  qaWalkout?: boolean;
}) {
  useLocale();
  // I18N · con la apertura en pantalla, un cambio de idioma (otra pestaña, la cuenta) espera a que termine.
  useCriticalOperation(true);
  const router = useRouter();
  const reduced = !!useReducedMotion();
  usePacksVersion(); // F60: un sobre del panel llega con la sincronización de contenido
  const pack = getPack(packId);
  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;
  const serverEconomy = useServerEconomy();
  /*
   * FASE 27 · EL SOBRE ALIMENTA EL META. Una lectura del servidor ANTES de abrir y otra al llegar
   * al resumen: la diferencia (objetivos que avanzaron, logros conseguidos, XP) se enseña abajo.
   * No se concede nada desde aquí: la apertura ya lo hizo todo en `app_apply_pack_open`.
   */
  const progression = useProgressionDelta();
  const { begin: beginProgression, end: endProgression, reset: resetProgression } = progression;
  const available = useGameStore((s) => s.unopenedPacks[packId] ?? 0);
  const packsLeft = useGameStore((s) => Object.values(s.unopenedPacks).reduce((n, c) => n + (c > 0 ? c : 0), 0));
  const openFromInventory = useGameStore((s) => s.openPackFromInventory);
  const storeCards = useGameStore((s) => s.ownedCards);
  /* Fase 38 · la colección de ANTES (solo presentación: si no llega, la apertura sigue). */
  const personal = useCollectionPersonal({ enabled: online, userKey: user?.id ?? null });

  const [state, dispatch] = useReducer(revealReducer, INITIAL_REVEAL);
  /** F68 · el bucle «abrir otro» para la guía (se asigna más abajo, cuando existe `openAnother`). */
  const reopenRef = useRef<() => void>(() => undefined);
  const phase = state.phase;
  /*
   * FASE 40 · al SALIR (navegación del cliente) de un resumen ya visto, el revelado guardado se borra: la recuperación es
   * para una RECARGA a mitad de ceremonia (una recarga completa no ejecuta esta limpieza), no para que «Abrir el siguiente
   * sobre» desde el vestíbulo o la colección enseñe otra vez el resumen del sobre anterior en vez de un sobre sellado.
   */
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  /* Fase 44.1 · la cámara se apaga alrededor del sobre durante la ceremonia y vuelve al salir. */
  useEffect(() => { dimEnvironment(packChamberDim(phase)); }, [phase]);
  useEffect(() => () => dimEnvironment(0), []);
  useMusicDuck(packMusicDuck(phase));
  useEffect(() => () => { if (phaseRef.current === "summary") clearOpenReveal(); }, []);
  const [results, setResults] = useState<OpenedResult[]>([]);
  /*
   * WALKOUT 0.5 · ¿se presenta el walkout a este jugador? (despliegue + veredicto del servidor + prueba local). La cola se
   * FIJA al recibir el resultado: un veredicto que llegue tarde no cambia una ceremonia ya empezada.
   */
  const [adminGate, setAdminGate] = useState<ReturnType<typeof useAdminSession> | null>(null);
  const [devOptIn, setDevOptIn] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    try { setDevOptIn(window.localStorage.getItem(PACK_WALKOUT_DEV_KEY) === "1"); } catch { /* sin almacenamiento: apagado */ }
  }, []);
  const walkoutOn = packWalkoutAllowed({ rollout: PACK_WALKOUT_3D_ENABLED, admin: adminGate, devOptIn, production: process.env.NODE_ENV === "production", qa: qaWalkout });
  const [walkoutItems, setWalkoutItems] = useState<PackWalkoutItem[]>([]);
  const [before, setBefore] = useState<OwnedInstanceFact[] | null>(null);
  const [cutProgress, setCutProgress] = useState(0);
  /** Fase 25 · «Añadir al equipo» desde el resumen: la carta elegida para el mazo. */
  const [deckCard, setDeckCard] = useState<DeckCardLike | null>(null);

  const cutting = useRef(false);
  const startX = useRef(0);
  const lastTick = useRef(0);
  const opened = useRef(false);
  /** Foto «antes» encadenada tras «abrir otro» (la de la apertura anterior + lo que salió). */
  const nextBefore = useRef<OwnedInstanceFact[] | null | undefined>(undefined);
  const handHeading = useRef<HTMLHeadingElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);

  const accent = pack?.accent ?? "#ff2e63";

  const currentFacts = useCallback((): OwnedInstanceFact[] | null => {
    if (!online) return storeCards.map(toInstanceFact);
    if (personal.data) return personal.data.instances;
    return storeCards.length > 0 ? storeCards.map(toInstanceFact) : null;
  }, [online, personal.data, storeCards]);

  const openedInstances = useMemo(() => toOpenedInstances(results), [results]);
  const plan = useMemo(() => buildRevealPlan(openedInstances, before, CATALOG, { reduced }), [openedInstances, before, reduced]);

  /**
   * Abre el sobre. Con sesión iniciada la tirada la DECIDE EL SERVIDOR (`/api/game/packs`), y aquí solo se presenta
   * el resultado que devuelve. Sin sesión se usa el motor local (modo de un solo jugador).
   */
  /**
   * WALKOUT 0.5 · qué especiales de ESTE resultado (ya persistido) se presentan con un walkout y cómo encaja en el ritmo.
   * Solo lee: ni una carta, ni un orden del contenido, ni una petición. Con el despliegue apagado → 0 walkouts.
   */
  const ceremonyFlow = useCallback((res: readonly OpenedResult[]) => {
    if (!walkoutOn) { setWalkoutItems([]); return {}; }
    const p = buildRevealPlan(toOpenedInstances(res), null, CATALOG);
    const queue = packWalkoutQueue(p.order);
    setWalkoutItems(queue);
    if (queue.length > 0) void loadPackWalkout().catch(() => undefined);   // el código del walkout, mientras se rasga el sobre
    return walkoutFlow(res.length, p.hero.ok ? p.hero.hero.uid : null, queue);
  }, [walkoutOn]);

  const triggerOpen = useCallback(async () => {
    if (opened.current) return;
    opened.current = true;
    dispatch({ type: "OPEN_REQUESTED" });
    const snapshot = nextBefore.current !== undefined ? nextBefore.current : currentFacts();
    nextBefore.current = undefined;
    setBefore(snapshot);

    let res: OpenedResult[] | null = null;
    let repeated = false;
    try {
      // Fase 27 · lectura «antes» (solo lectura; si falla, no habrá deltas y ya está).
      if (online && !qaOpen) await beginProgression();
      // Fase 25/38 · con sesión, `openPackOutcome` fija UN gesto por apertura (ver `lib/game/sync`):
      // reintentar tras un fallo de red repite la misma apertura, nunca abre un segundo sobre.
      if (qaOpen) {
        res = qaOpen(packId);
      } else if (online) {
        const out = await openPackOutcome(packId);
        res = out.results;
        repeated = out.repeated;
      } else {
        // F69 · sesión resolviéndose: no se abre en local (inventaría cartas en el HUD).
        if (serverEconomy) throw new Error(SESSION_PENDING);
        res = openFromInventory(packId);
      }
    } catch (e) {
      opened.current = false;
      dispatch({ type: "OPEN_FAILED", failure: classifyOpenFailure(e) });
      return;
    }

    if (!res || res.length === 0) {
      opened.current = false;
      dispatch({ type: "OPEN_FAILED", failure: classifyOpenFailure(new Error("No tienes ese sobre")) });
      return;
    }
    setResults(res);
    // Fase 21.2: guarda el resultado para recuperarlo si el navegador recarga a mitad de la ceremonia.
    saveOpenReveal(packId, res);
    if (!repeated) useEventsStore.getState().recordPackOpened(packId, res);
    trackFlow("pack_ceremony", `pack_opened:${packId}:${res.length}`);
    dispatch({ type: "OPEN_SUCCEEDED", count: res.length, repeated, cinematic: heroIsPresentable(res), ...ceremonyFlow(res) });
    playBurst();
  }, [online, serverEconomy, openFromInventory, packId, beginProgression, currentFacts, qaOpen, ceremonyFlow]);

  /* F81 · INTRO (el sobre se rasga y suelta sus cartas) → TENSIÓN. Los relojes solo avisan; manda la máquina. */
  useEffect(() => {
    if (phase !== "opening") return;
    const t = setTimeout(() => {
      playCue("whoosh");
      dispatch({ type: "INTRO_DONE" });
    }, reduced ? RUPTURE_REDUCED_MS : RUPTURE_MS);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  /* Fase 27 · lectura «después» al llegar al resumen: los deltas los calcula el cliente entre dos verdades del servidor. */
  useEffect(() => {
    if (phase === "summary" && online) void endProgression();
  }, [phase, online, endProgression]);

  /*
   * F63 · LA GUÍA DE LA PRIMERA SESIÓN. Al llegar al resumen la foto de la guía ya es vieja (este sobre acaba de abrirse
   * en el servidor): se invalida y se relee. Solo se pinta con una foto POSTERIOR a la apertura (`packsOpened > 0`).
   */
  const onboarding = useOnboarding(user?.id ?? null, online);
  useEffect(() => {
    if (phase === "summary" && online) invalidateOnboarding();
  }, [phase, online]);
  const guide = onboarding.view?.active && onboarding.view.context.packsOpened > 0 ? onboarding.view : null;
  /* F68 · «abrir el siguiente sobre» del MISMO tipo es el bucle de esta pantalla, no una navegación a la misma URL. */
  const guideHere = useMemo(() => ({ href: `/abrir/${packId}`, run: () => reopenRef.current() }), [packId]);

  /* Foco controlado: hero quieta → CONTINUAR; resumen → su título. */
  useEffect(() => {
    if (phase === "hero_hold") continueButton.current?.focus({ preventScroll: true });
    if (phase === "hero_hold") trackFlow("pack_ceremony", "hero_revealed");
    if (phase === "summary") summaryHeading.current?.focus({ preventScroll: true });
    if (phase === "summary") markOpenRevealSeen(packId);
  }, [phase, packId]);

  // --- Interacción de corte (ratón / táctil) ---
  function onPointerDown(e: React.PointerEvent) {
    if (phase !== "ready") return;
    primeAudio();
    cutting.current = true;
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!cutting.current || phase !== "ready") return;
    const progress = Math.max(0, Math.min(1, (e.clientX - startX.current) / CUT_DISTANCE));
    setCutProgress(progress);
    if (progress - lastTick.current > 0.08) {
      lastTick.current = progress;
      playCutTick();
    }
    if (progress >= 0.92) {
      cutting.current = false;
      setCutProgress(1);
      void triggerOpen();
    }
  }
  function onPointerUp() {
    if (phase !== "ready") return;
    cutting.current = false;
    if (cutProgress < 0.92) {
      setCutProgress(0);
      lastTick.current = 0;
    }
  }

  /** Vía accesible: el mismo final sin arrastrar. */
  const openWithButton = useCallback(() => {
    if (phase !== "ready" || opened.current) return;
    primeAudio();
    setCutProgress(1);
    void triggerOpen();
  }, [phase, triggerOpen]);

  /* F81 · la cinemática: relojes que solo avisan y gestos que avanzan un paso. Ninguno toca el resultado. */
  const onBuildupDone = useCallback(() => dispatch({ type: "BUILDUP_DONE" }), []);
  const onHeroShown = useCallback(() => dispatch({ type: "HERO_SHOWN" }), []);
  const onRestDone = useCallback(() => dispatch({ type: "REST_DONE" }), []);
  const onWalkoutDone = useCallback(() => dispatch({ type: "WALKOUT_DONE" }), []);
  const advance = useCallback(() => { primeAudio(); dispatch({ type: "ADVANCE" }); }, []);
  const continueFromHero = useCallback(() => { trackFlow("pack_ceremony", "hero_continue"); dispatch({ type: "CONTINUE" }); }, []);

  /**
   * SALTAR / REVELAR TODAS. Salta SOLO la presentación: el resultado ya está en `results`. No reabre, no vuelve a
   * sortear, no llama al servidor.
   */
  const skipToSummary = useCallback(() => {
    if (results.length === 0) return;
    trackFlow("pack_ceremony", "opening_skipped");
    dispatch({ type: "SKIP" });
  }, [results.length]);

  /**
   * EL BUCLE. Otra unidad del MISMO sobre, sin salir de la pantalla: otra operación con OTRA clave (la anterior ya se
   * confirmó y `lib/game/sync` la borró). La foto «antes» de la siguiente es la de esta más lo que acaba de salir.
   */
  const openAnother = useCallback(() => {
    opened.current = false;
    cutting.current = false;
    lastTick.current = 0;
    clearOpenReveal();
    nextBefore.current = before ? [...before, ...openedInstances.map(toInstanceFact)] : undefined;
    setResults([]);
    setWalkoutItems([]);
    setCutProgress(0);
    resetProgression(); // Fase 27: los deltas eran de la apertura anterior.
    personal.refresh();
    dispatch({ type: "RESET" });
  }, [before, openedInstances, resetProgression, personal]);
  reopenRef.current = openAnother;

  /**
   * RECUPERACIÓN TRAS RECARGA (Fase 21.2 / 38). Si el revelado ya se guardó en esta pestaña, se restaura y se va al
   * resumen: `opened.current` queda marcado, así que nunca se reabre.
   */
  useEffect(() => {
    if (opened.current || results.length > 0) return;
    // Fase 40 · un resumen ya visto solo vuelve al RECARGAR esta pantalla, no al llegar desde otra.
    const saved = loadOpenReveal(packId, { allowSeen: isReloadOf(window.location.pathname) });
    if (saved && saved.length > 0) {
      opened.current = true;
      setResults(saved);
      dispatch({ type: "RECOVERED", count: saved.length });
    }
    // Solo al montar / cambiar de sobre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId]);

  /* Fase 38 · recarga con la petición ENVIADA y sin respuesta: se pide el resultado con la MISMA clave. */
  useEffect(() => {
    if (!online || opened.current || results.length > 0 || phase !== "ready") return;
    if (!hasPendingOpen(packId)) return;
    opened.current = true;
    dispatch({ type: "RECOVER_STARTED" });
    void (async () => {
      try {
        const out = await openPackOutcome(packId);
        setResults(out.results);
        saveOpenReveal(packId, out.results);
        // (una recuperación va al resumen directo: el walkout no se repite tras recargar)
        dispatch({ type: "OPEN_SUCCEEDED", count: out.results.length, repeated: out.repeated, cinematic: heroIsPresentable(out.results) });
      } catch (e) {
        opened.current = false;
        dispatch({ type: "OPEN_FAILED", failure: classifyOpenFailure(e) });
      }
    })();
  }, [online, packId, results.length, phase]);

  /* En una recuperación, la foto «antes» es la colección actual sin las instancias de esta apertura. */
  useEffect(() => {
    if (!state.recovered || before !== null || openedInstances.length === 0) return;
    const current = currentFacts();
    if (current) setBefore(beforeExcluding(current, openedInstances));
  }, [state.recovered, before, openedInstances, currentFacts]);

  /**
   * TECLADO. Enter/Espacio: abrir; durante la cinemática, avanzar UN paso (nunca se salta la hero); con la hero quieta,
   * CONTINUAR. «S»/Escape: omitir al resumen — solo con el resultado ya en mano, así que nunca pierde nada.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key;
      if (phase === "ready" && !opened.current) {
        if (k === "Enter" || k === " ") { e.preventDefault(); openWithButton(); }
        return;
      }
      if (!hasResult(state) || phase === "summary") return;
      // WALKOUT 0.5 · durante un walkout, Escape/Enter/Espacio/→ son SUYOS (saltar esta animación / continuar); «S» omite todo.
      if (phase === "walkout") { if (k === "s" || k === "S") { e.preventDefault(); skipToSummary(); } return; }
      if (k === "s" || k === "S" || k === "Escape") { e.preventDefault(); skipToSummary(); }
      else if (k === "Enter" || k === " " || k === "ArrowRight") {
        e.preventDefault();
        // Con el foco en CONTINUAR el navegador ya pulsa el botón con Enter/Espacio: no se cuenta dos veces.
        if (phase === "hero_hold" && document.activeElement === continueButton.current) return;
        if (phase === "hero_hold") continueFromHero(); else advance();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, state, openWithButton, advance, continueFromHero, skipToSummary]);

  const navigate = useCallback((href: string) => {
    if (href === "/packs") clearOpenReveal();
    router.push(href);
  }, [router]);

  /* ─────────────── estados límite ─────────────── */
  if (!pack) {
    return <PackStatus kind="not_found" title={tr("Ese sobre no existe")} message={tr("El enlace apunta a un sobre que no está en el catálogo. Puede que fuera de un evento que ya terminó, o que la dirección esté mal escrita.")} packsLeft={packsLeft} onNavigate={navigate} />;
  }
  // Fase 21.2 (§13): un sobre DRAFT no se abre por la ruta pública —lo rechaza también el servidor (`guardPublicOpen`)—.
  if (!isPubliclyOpenable(pack) && results.length === 0) {
    return <PackStatus kind="unavailable" title={tr("Sobre no disponible")} message={tr("«{name}» no está disponible para abrir ahora mismo. Echa un vistazo al resto del catálogo.", { name: td(pack.name) })} packsLeft={packsLeft} onNavigate={navigate} />;
  }
  if (phase === "recovering") {
    return <PackStatus kind="recovering" title={tr("Recuperando tu sobre")} message={tr("Había una apertura en marcha en esta pestaña. Estamos pidiendo al servidor su resultado — no se abre ningún sobre nuevo.")} packsLeft={packsLeft} onNavigate={navigate} />;
  }
  if (phase === "error" && state.failure) {
    const failure = state.failure;
    return (
      <PackStatus
        kind="error" title={td(failure.title)} message={td(failure.message)} packsLeft={packsLeft} onNavigate={navigate}
        onRetry={failure.retrySameKey ? () => { dispatch({ type: "DISMISS_ERROR" }); void triggerOpen(); } : undefined}
      />
    );
  }
  if (phase === "no_pack") {
    return <PackStatus kind="no_pack" title={td(state.failure?.title) ?? tr("No te queda este sobre")} message={td(state.failure?.message) ?? tr("No queda ninguna unidad de este sobre.")} packsLeft={packsLeft} onNavigate={navigate} />;
  }
  if (available <= 0 && phase === "ready" && !(online && hasPendingOpen(packId))) {
    return <PackStatus kind="missing" title={tr("No tienes este sobre")} message={tr("No queda ninguna unidad de «{name}» en tu inventario. Consigue uno en la tienda o revisa los que ya tienes pendientes.", { name: td(pack.name) })} packsLeft={packsLeft} onNavigate={navigate} />;
  }

  const best = plan.summary.featured;
  const heroResult = best ? results.find((r) => r.uid === best.uid) : undefined;
  const walkedUids = new Set(walkoutItems.map((w) => w.uid));
  const restItems = plan.order.filter((i) => i.uid !== best?.uid && !walkedUids.has(i.uid));
  const walkoutItem = phase === "walkout" ? walkoutItems[state.walkoutIndex] : undefined;
  const slots: HandSlot[] = results.map((r) => ({ revealed: false, color: getVariant(r.card.variantId).palette.primary }));
  const stageKind = phase === "ready" || phase === "requesting" || phase === "opening" ? phase : null;
  const heroStage = phase === "buildup" || phase === "hero" || phase === "hero_hold" ? phase : null;
  const bestResult = heroResult;
  const showSkip = hasResult(state) && phase !== "summary";

  return (
    <div className="fixed inset-0 z-modal overflow-hidden bg-[#03040a]" data-testid="pack-opening" data-phase={phase} data-requests={state.requests} data-hero-uid={best?.uid ?? ""} data-walkouts={state.walkouts}>
      {PACK_WALKOUT_3D_ENABLED === "admins" && <AdminProbe onResult={setAdminGate} />}
      <PackBackdrop
        accent={accent}
        ambient={phase === "ready" || phase === "requesting"}
        reduced={reduced}
        intensity={phase === "ready" ? 0.6 : phase === "requesting" || phase === "opening" ? 1 : 0.45}
      />

      {/* Cerrar. 44 px. Cerrar nunca pierde nada: lo abierto ya está guardado en el servidor. */}
      <button
        onClick={() => navigate(phase === "summary" ? "/coleccion" : "/packs")}
        className="nx-focus absolute right-4 top-4 z-overlay grid h-11 w-11 min-h-[44px] place-items-center rounded-full border border-white/15 bg-black/40 text-white/70 transition hover:bg-black/70 hover:text-white"
        style={{ marginTop: "env(safe-area-inset-top)" }}
        aria-label={tr("Cerrar la apertura")}
      >
        <GameGlyph name="close" className="h-4 w-4" />
      </button>

      {stageKind && (
        <PackStage
          pack={pack}
          stage={stageKind}
          count={results.length || pack.cardCount}
          cutProgress={cutProgress}
          slots={slots}
          tease={null}
          reduced={reduced}
          onOpen={openWithButton}
          onStartReveal={advance}
          onRevealAll={skipToSummary}
          pointer={{ onPointerDown, onPointerMove, onPointerUp }}
          headingRef={handHeading}
        />
      )}

      {/* F81 · un toque durante la intro adelanta a la HERO (no al resumen). */}
      {phase === "opening" && <div className="absolute inset-0 z-surface" onClick={advance} data-testid="intro-advance" aria-hidden />}

      {heroStage && best && heroResult && (
        <HeroReveal
          key={best.uid}
          stage={heroStage}
          item={best}
          result={heroResult}
          total={results.length}
          reduced={reduced}
          onBuildupDone={onBuildupDone}
          onHeroShown={onHeroShown}
          onContinue={continueFromHero}
          onAdvance={advance}
          continueRef={continueButton}
        />
      )}

      {/* WALKOUT 0.5 · cada especial, su walkout (una escena por carta: se desmonta y libera antes de la siguiente) */}
      {walkoutItem && (
        <PackWalkout key={walkoutItem.uid} item={walkoutItem} index={state.walkoutIndex} total={walkoutItems.length} reduced={reduced} onDone={onWalkoutDone} />
      )}

      {phase === "rest" && <RestReveal items={restItems} reduced={reduced} onDone={onRestDone} onAdvance={advance} />}

      {/*
        OMITIR desde que existe el resultado (intro, tensión, hero, resto): lleva al resumen de ESAS MISMAS cartas. No
        cancela nada ni vuelve a pedir nada al servidor — la apertura ya está guardada.
      */}
      {showSkip && (
        <button
          type="button"
          onClick={skipToSummary}
          className="nx-focus absolute left-4 top-4 z-overlay inline-flex h-11 min-h-[44px] items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-4 font-display text-label font-bold uppercase tracking-wide2 text-white/75 transition hover:bg-black/70 hover:text-white"
          style={{ marginTop: "env(safe-area-inset-top)" }}
          aria-label={tr("Saltar la animación y ver todas las cartas")}
          data-testid="pack-skip"
        >
          {tr("Omitir ⏭")}
        </button>
      )}

      {phase === "summary" && plan.items.length === 0 && results.length > 0 && (
        <PackStatus kind="error" title={tr("No se pudieron mostrar tus cartas")} message={tr("El sobre se abrió y las cartas están guardadas en tu colección, pero no se pudieron presentar aquí. Ábrelas en tu colección.")} packsLeft={packsLeft} onNavigate={navigate} />
      )}

      {phase === "summary" && plan.items.length > 0 && (
        <div className="absolute inset-0 overflow-y-auto px-4 py-8" style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}>
          {!state.cinematic && (
            <p role="status" className="mx-auto mb-4 max-w-xl text-center text-caption text-ink-muted" data-testid="summary-no-cinematic">
              {tr("Tus cartas ya están guardadas. Esta vez se muestran sin animación.")}
              {plan.summary.unresolved > 0 && " " + tr("{n, plural, one {Una carta no se pudo mostrar aquí: está en tu colección.} other {# cartas no se pudieron mostrar aquí: están en tu colección.}}", { n: plan.summary.unresolved })}
            </p>
          )}
          <PackSummary
            packName={pack.name}
            plan={plan}
            available={available}
            packsLeft={packsLeft}
            recovered={state.recovered}
            repeated={state.repeated}
            reduced={reduced}
            onOpenAnother={openAnother}
            onNavigate={navigate}
            onAddToDeck={bestResult && toDeckCard(bestResult) ? () => setDeckCard(toDeckCard(bestResult)) : undefined}
            headingRef={summaryHeading}
            accent={pack.accent}
            intensity={MAIN_PACK_LINE.includes(pack.id) ? MAIN_PACK_LINE.indexOf(pack.id) + 1 : 3}
            lead={guide ? (guide.context.packsOpened === 1 && best ? <FirstCardLesson card={best.card} view={guide} here={guideHere} /> : <OnboardingPackNext view={guide} here={guideHere} />) : null}
            dockStatic={!!guide}
          >
            {/* Fase 27 · lo que este sobre ha movido en tus objetivos (dos lecturas del servidor). */}
            {online && <PostMatchProgress delta={progression.delta} className="mx-auto mt-8 max-w-2xl" />}
            {/* Fase 42 · qué sigue: objetivo de sobres que avanzó y la siguiente acción del vestíbulo (sin recompensa extra). */}
            {/* F63 · durante la primera sesión el «qué sigue» lo dice la guía (arriba): no dos siguientes pasos a la vez. */}
            {online && !guide && <NextUpAfter context="pack" className="mx-auto mt-4 max-w-2xl" />}
          </PackSummary>
        </div>
      )}

      {deckCard && (
        <AddToDeckSheet card={deckCard} origin="pack_summary" onClose={() => setDeckCard(null)} />
      )}
    </div>
  );
}
