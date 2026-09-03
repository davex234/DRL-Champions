"use client";

/**
 * LA CEREMONIA DE APERTURA (Fase 9.6).
 *
 * DE DÓNDE VIENE. Lo que había era correcto y estaba vacío: un sobre flotando en negro,
 * «desliza para abrir», un fogonazo blanco, las cartas una a una y una lista al final. Se
 * abría un sobre; no se celebraba nada. Y era, además, lo que el encargo señaló como lo
 * que MÁS había que mejorar.
 *
 * LOS CINCO ACTOS. Cada uno responde a una pregunta y ninguno se salta:
 *
 *   1. `intro`    — **¿qué tengo delante?** El sobre llega desde el fondo, la sala se
 *                   enciende y el objeto se planta. Antes aparecía ya puesto, sin llegada.
 *   2. `sealed`   — **¿qué hago?** El sobre respira, la costura se ve, y el gesto (o el
 *                   botón) están escritos. La carga se acumula en la propia costura.
 *   3. `rupture`  — **ha pasado.** El sobre se PARTE: las dos mitades salen de cuadro, una
 *                   columna de luz sube por la costura y una onda de choque barre la sala.
 *                   Antes esto era un fogonazo blanco — un corte de cámara, no una rotura.
 *   4. `reveal`   — **¿qué me ha tocado?** Carta a carta, con la ceremonia de su rareza
 *                   (`CardReveal` + `ceremony.ts`).
 *   5. `summary`  — **¿qué me llevo?** La mejor carta grande, el botín alrededor y a dónde
 *                   ir después. Antes era una fila de cartas pequeñas y tres botones.
 *
 * LO QUE NO CAMBIA. Con sesión, la tirada la decide el SERVIDOR (`/api/game/packs`) y aquí
 * solo se anima lo que devuelve. Sin sesión se usa el motor local, que es el modo de un
 * solo jugador. Ni una probabilidad, ni un valor, ni una carta se calculan en esta
 * pantalla, exactamente igual que antes.
 *
 * ACCESIBILIDAD. El corte por arrastre se conserva porque es lo que hace el gesto físico,
 * pero ya no es la ÚNICA vía: hay un botón. Una ceremonia que solo se puede empezar
 * arrastrando el ratón deja fuera a quien navega con teclado.
 *
 * RENDIMIENTO. Todo son `transform` y `opacity`. Las partículas de ambiente bajan de 28 a
 * 18 —el escenario ya no está vacío y no hacen falta tantas— y desaparecen en cuanto el
 * sobre se rompe: a partir de ahí la ceremonia de la carta pone las suyas y sumar las dos
 * era gastar el doble para ver lo mismo.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { getPack } from "@/data/packs";
import { useGameStore, type OpenedResult } from "@/store/useGameStore";
import { useEventsStore } from "@/store/useEventsStore";
import { getVariant } from "@/domain/cards/variants";
import { SealedPack } from "./SealedPack";
import { AmbientParticles, ParticleBurst } from "./Particles";
import { CardReveal } from "./CardReveal";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Card3D, card3DStagger } from "@/components/visual/Card3D";
import { primeAudio, playCutTick, playBurst } from "@/lib/sound";
import { formatCredits } from "@/lib/format";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { openPackOnline } from "@/lib/game/sync";
import { ErrorState } from "@/components/ui/States";
import { EASE } from "@/design/motion";

type Phase = "intro" | "sealed" | "rupture" | "reveal" | "summary";

const CUT_DISTANCE = 220; // px de deslizamiento para abrir
const INTRO_MS = 700;
const RUPTURE_MS = 1100;

export function PackOpeningExperience({ packId }: { packId: string }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const pack = getPack(packId);
  const { user } = useAuth();
  const online = isSupabaseConfigured() && !!user;
  const available = useGameStore((s) => s.unopenedPacks[packId] ?? 0);
  const openFromInventory = useGameStore((s) => s.openPackFromInventory);
  const quickSellMany = useGameStore((s) => s.quickSellMany);

  const [phase, setPhase] = useState<Phase>("intro");
  const [cutProgress, setCutProgress] = useState(0);
  const [results, setResults] = useState<OpenedResult[]>([]);
  const [revealIndex, setRevealIndex] = useState(0);

  const [openError, setOpenError] = useState<string | null>(null);
  /*
   * Con sesión, la tirada la decide el SERVIDOR, así que entre el corte del sobre y
   * la explosión hay una ida y vuelta por la red. Sin este estado la pantalla se
   * quedaba con el sobre cortado y quieto, sin decir nada: parecía colgada.
   */
  const [processing, setProcessing] = useState(false);

  const cutting = useRef(false);
  const startX = useRef(0);
  const lastTick = useRef(0);
  const opened = useRef(false);

  const accent = pack?.accent ?? "#ff2e63";

  /** ACTO 1 → ACTO 2. La llegada del sobre no espera a nadie: se planta y cede el turno. */
  useEffect(() => {
    if (phase !== "intro") return;
    const t = setTimeout(() => setPhase("sealed"), reduced ? 120 : INTRO_MS);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  /**
   * Abre el sobre. Con sesión iniciada la tirada la DECIDE EL SERVIDOR
   * (`/api/game/packs`), y aquí solo se anima el resultado que devuelve. Sin
   * sesión se usa el motor local (modo de un solo jugador).
   */
  const triggerOpen = useCallback(async () => {
    if (opened.current) return;
    opened.current = true;

    let res: OpenedResult[] | null = null;
    setProcessing(true);
    try {
      res = online ? await openPackOnline(packId) : openFromInventory(packId);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : "No se pudo abrir el sobre");
      opened.current = false;
      return;
    } finally {
      setProcessing(false);
    }

    if (!res || res.length === 0) {
      router.push("/tienda");
      return;
    }
    setResults(res);
    useEventsStore.getState().recordPackOpened(packId, res);
    playBurst();
    setPhase("rupture");
    setTimeout(() => {
      setPhase("reveal");
      setRevealIndex(0);
    }, reduced ? 220 : RUPTURE_MS);
  }, [online, openFromInventory, packId, router, reduced]);

  // --- Interacción de corte (ratón / táctil) ---
  function onPointerDown(e: React.PointerEvent) {
    if (phase !== "sealed" || processing) return;
    primeAudio();
    cutting.current = true;
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!cutting.current || phase !== "sealed" || processing) return;
    const delta = e.clientX - startX.current;
    const progress = Math.max(0, Math.min(1, delta / CUT_DISTANCE));
    setCutProgress(progress);
    if (progress - lastTick.current > 0.08) {
      lastTick.current = progress;
      playCutTick();
    }
    if (progress >= 0.92) {
      cutting.current = false;
      setCutProgress(1);
      triggerOpen();
    }
  }
  function onPointerUp() {
    if (phase !== "sealed") return;
    cutting.current = false;
    if (cutProgress < 0.92) {
      setCutProgress(0);
      lastTick.current = 0;
    }
  }

  /** Vía accesible: el mismo final sin arrastrar. Anima el corte y abre. */
  const openWithButton = useCallback(() => {
    if (phase !== "sealed" || processing || opened.current) return;
    primeAudio();
    setCutProgress(1);
    triggerOpen();
  }, [phase, processing, triggerOpen]);

  const handleNext = useCallback(() => {
    setRevealIndex((i) => {
      if (i + 1 >= results.length) {
        setPhase("summary");
        return i;
      }
      return i + 1;
    });
  }, [results.length]);

  /*
    --- Estados límite ---

    Al hacer la ceremonia INMERSIVA (Fase 9.6) estas pantallas se quedaron solas: ya no hay
    barra superior ni menú alrededor que las acompañe. La de «sobre no encontrado» decía
    literalmente «Sobre no encontrado.» y un botón — **28 caracteres en toda la pantalla**,
    que es lo que `audit:stability` marcó como pantalla en blanco, y con razón: alguien que
    llega por un enlace viejo se encuentra el vacío y una frase.

    Ahora los tres estados explican qué ha pasado, por qué y qué se puede hacer, y ofrecen
    DOS salidas: la tienda (comprar otro) y el inventario (mirar lo que ya tienes).
  */
  if (!pack) {
    return (
      <Centered
        title="Ese sobre no existe"
        body="El enlace apunta a un sobre que no está en el catálogo. Puede que fuera de un evento que ya terminó, o que la dirección esté mal escrita."
      >
        <Exits router={router} />
      </Centered>
    );
  }
  if (openError) {
    return (
      <Centered
        title="No se pudo abrir"
        body="El servidor no ha podido completar la apertura, así que el sobre sigue en tu inventario. Nada se ha perdido."
      >
        <ErrorState message={openError} onRetry={() => { setOpenError(null); }} />
        <Exits router={router} />
      </Centered>
    );
  }
  if (available <= 0 && (phase === "sealed" || phase === "intro")) {
    return (
      <Centered
        title="No tienes este sobre"
        body={`No queda ninguna unidad de «${pack.name}» en tu inventario. Compra uno en la tienda para abrirlo, o revisa los que ya tienes pendientes.`}
      >
        <Exits router={router} />
      </Centered>
    );
  }

  const totalValue = results.reduce((s, r) => s + r.value, 0);
  const newCount = results.filter((r) => r.isNew).length;
  const duplicates = results.filter((r) => !r.isNew);
  /** La mejor del botín: mayor rareza y, a igualdad, mayor media. Es la que se enseña. */
  const best = [...results].sort(
    (a, b) => getVariant(b.card.variantId).rank - getVariant(a.card.variantId).rank || b.card.ovr - a.card.ovr,
  )[0];
  const rest = results.filter((r) => r.uid !== best?.uid);

  const sealedStage = phase === "intro" || phase === "sealed";

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-base-900">
      {/*
        EL ESCENARIO. Antes era un solo degradado radial del color del sobre sobre negro.
        Ahora hay suelo: un halo cenital, una retícula en perspectiva que se pierde hacia
        el horizonte y una viñeta. Sin suelo, el sobre no está EN ningún sitio — flota en
        un vacío, que es exactamente como se veía en la captura.
      */}
      <div
        aria-hidden
        className="absolute inset-0 transition-opacity duration-slow"
        style={{
          background: `radial-gradient(900px 620px at 50% 34%, ${accent}26, transparent 72%), radial-gradient(700px 400px at 50% 108%, ${accent}1c, transparent 66%)`,
        }}
      />
      {/*
        EL SUELO. La primera versión usaba una retícula al 40 % con líneas a `22` de alfa y
        en la captura no se veía nada: el sobre seguía flotando en un vacío. Un escenario
        que no se ve no es un escenario. Subida a opacidad plena con líneas al 55 % y la
        perspectiva más cerrada, para que el horizonte quede dentro del encuadre.
      */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[46%]"
        style={{
          backgroundImage: `linear-gradient(${accent}8c 1px, transparent 1px), linear-gradient(90deg, ${accent}8c 1px, transparent 1px)`,
          backgroundSize: "72px 72px",
          transform: "perspective(260px) rotateX(58deg)",
          transformOrigin: "bottom center",
          maskImage: "linear-gradient(to top, rgba(0,0,0,0.9), transparent 74%)",
          WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.9), transparent 74%)",
        }}
      />
      {/* Línea de horizonte: cierra el suelo y separa el plano del fondo. */}
      <div
        aria-hidden
        className="absolute inset-x-0 h-px"
        style={{
          bottom: "46%",
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
          boxShadow: `0 0 30px ${accent}`,
          opacity: 0.55,
        }}
      />
      {sealedStage && <AmbientParticles color={accent} count={18} />}
      <div aria-hidden className="absolute inset-0" style={{ boxShadow: "inset 0 0 240px 70px rgba(6,7,13,0.9)" }} />

      {/* Botón cerrar */}
      <button
        onClick={() => router.push(phase === "summary" ? "/coleccion" : "/tienda")}
        className="absolute right-4 top-4 z-50 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/40 text-white/70 backdrop-blur transition hover:bg-black/70 hover:text-white"
        aria-label="Cerrar"
      >
        ✕
      </button>

      {/* ═══ ACTOS 1 y 2 — llegada y sobre sellado ═══ */}
      <AnimatePresence>
        {sealedStage && (
          <motion.div
            key="sealed"
            className="absolute inset-0 grid touch-none place-items-center"
            exit={{ opacity: 0, scale: 1.08 }}
            transition={{ duration: 0.4 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/*
              LLEGADA. El sobre entra desde el fondo del escenario. Es medio segundo, y es
              lo que separa «hay un sobre en la pantalla» de «me han traído un sobre».
            */}
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.55, y: 90, rotateX: 28 }}
              animate={
                reduced
                  ? { opacity: 1 }
                  : {
                      opacity: 1, scale: 1, y: phase === "sealed" ? [0, -14, 0] : 0, rotateX: 0,
                      rotateZ: phase === "sealed" ? [-1.5, 1.5, -1.5] : 0,
                    }
              }
              transition={
                reduced
                  ? { duration: 0.2 }
                  : {
                      opacity: { duration: 0.45 },
                      scale: { duration: INTRO_MS / 1000, ease: EASE.out },
                      rotateX: { duration: INTRO_MS / 1000, ease: EASE.out },
                      y: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: INTRO_MS / 1000 },
                      rotateZ: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: INTRO_MS / 1000 },
                    }
              }
              style={{ transformPerspective: 900 }}
            >
              <SealedPack accent={accent} name={pack.name} cutProgress={cutProgress} width={272} />
            </motion.div>

            {/* Instrucciones. Se apagan en cuanto empieza el corte: estorban a la tensión. */}
            {phase === "sealed" && !processing && (
              <motion.div
                className="absolute bottom-14 flex flex-col items-center gap-3 px-6 text-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: cutProgress > 0.05 ? 0 : 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <p className="font-display text-lg font-bold uppercase tracking-[0.28em] text-white">
                  Desliza para abrir
                </p>
                <p className="text-sm text-white/45">Arrastra sobre la costura →</p>
                <div className="h-1.5 w-52 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-instant"
                    style={{ width: `${cutProgress * 100}%`, background: accent, boxShadow: `0 0 14px ${accent}` }}
                  />
                </div>
                {/*
                  Vía accesible. El arrastre es el gesto bonito, pero no puede ser el único:
                  con teclado no hay forma de arrastrar y la ceremonia quedaba cerrada.
                */}
                <button
                  type="button"
                  onClick={openWithButton}
                  className="nx-clip-sm mt-1 border border-white/20 px-5 py-2.5 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-white/70 transition duration-fast hover:border-white/45 hover:text-white"
                >
                  Abrir sobre
                </button>
              </motion.div>
            )}

            {/* El sobre lo está abriendo el servidor: decirlo, en vez de parecer colgado. */}
            {processing && (
              <div
                role="status"
                aria-live="polite"
                className="absolute bottom-16 flex flex-col items-center gap-3 px-6 text-center"
              >
                <div
                  className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: accent, borderTopColor: "transparent" }}
                />
                <p className="font-display text-sm uppercase tracking-[0.3em] text-white">
                  Procesando…
                </p>
                <p className="text-xs text-white/45">Abriendo tu sobre en el servidor</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ ACTO 3 — la rotura ═══ */}
      {phase === "rupture" && (
        <div className="absolute inset-0 grid place-items-center">
          {/*
            COLUMNA DE LUZ. Sube por donde estaba la costura. Es la pieza que cuenta que el
            sobre se ha abierto POR ALGÚN SITIO; el fogonazo blanco anterior podía haber
            sido cualquier cosa.
          */}
          <motion.span
            aria-hidden
            className="absolute w-[3px] origin-bottom"
            style={{
              height: "100vh",
              background: `linear-gradient(to top, ${accent}, #fff, transparent)`,
              boxShadow: `0 0 60px 12px ${accent}`,
            }}
            initial={{ scaleY: 0, scaleX: 1, opacity: 0 }}
            animate={{ scaleY: [0, 1, 1], scaleX: [1, 34, 60], opacity: [0, 1, 0] }}
            transition={{ duration: RUPTURE_MS / 1000, times: [0, 0.28, 1], ease: "easeOut" }}
          />

          {/* Onda de choque: un anillo que barre la sala. Un solo elemento. */}
          <motion.span
            aria-hidden
            className="absolute rounded-full border-2"
            style={{ borderColor: accent, width: 220, height: 220 }}
            initial={{ scale: 0.2, opacity: 1 }}
            animate={{ scale: 9, opacity: 0 }}
            transition={{ duration: RUPTURE_MS / 1000, ease: "easeOut" }}
          />

          {/* Las dos mitades del sobre salen de cuadro. */}
          {!reduced &&
            [-1, 1].map((dir) => (
              <motion.span
                key={dir}
                aria-hidden
                className="absolute h-40 w-52 rounded-lg border"
                style={{
                  borderColor: `${accent}88`,
                  background: `linear-gradient(160deg, #171a2b, #06070d)`,
                  clipPath:
                    dir < 0
                      ? "polygon(0 0, 100% 0, 88% 100%, 0 100%)"
                      : "polygon(12% 0, 100% 0, 100% 100%, 0 100%)",
                }}
                initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                animate={{ x: dir * 620, y: dir * 90, rotate: dir * 52, opacity: 0 }}
                transition={{ duration: RUPTURE_MS / 1000, ease: "easeOut" }}
              />
            ))}

          <ParticleBurst color={accent} big count={110} />

          {/*
            El fogonazo. Bajado de 0.95 a 0.7 y de 0.75 s a 0.5: a plena opacidad lavaba
            toda la escena —la rotura, las mitades y las partículas dejaban de verse— y
            además un blanco casi total a pantalla completa es agresivo. Aquí la luz
            acompaña a la rotura; no la sustituye.
          */}
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.7, 0] }}
            transition={{ duration: 0.5, times: [0, 0.24, 1] }}
          />
        </div>
      )}

      {/* ═══ ACTO 4 — revelado carta a carta ═══ */}
      {phase === "reveal" && results[revealIndex] && (
        <CardReveal
          key={results[revealIndex].uid}
          result={results[revealIndex]}
          index={revealIndex}
          total={results.length}
          onNext={handleNext}
        />
      )}

      {/* ═══ ACTO 5 — el botín ═══ */}
      {phase === "summary" && best && (
        <motion.div
          className="absolute inset-0 overflow-y-auto px-4 py-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="mx-auto max-w-5xl">
            <p className="nx-label text-center">{pack.name}</p>
            <h2 className="mt-1 text-center font-display text-[clamp(28px,6vw,48px)] font-bold uppercase leading-none text-white">
              Tu botín
            </h2>

            {/*
              LA MEJOR CARTA, GRANDE. Antes el resumen era una fila de cartas del mismo
              tamaño: la Icon Series que acababa de salir quedaba igual de grande que la
              cuarta Bronce. El botín tiene un protagonista y hay que enseñarlo.
            */}
            <div className="mt-7 grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
              <div className="mx-auto">
                <Card3D
                  mode="showcase"
                  glow={getVariant(best.card.variantId).palette.primary}
                  status={best.isNew ? "new" : undefined}
                  className="w-[210px] sm:w-[240px]"
                >
                  <PlayerCard card={best.card} size="lg" serial={best.serial} interactive={false} />
                </Card3D>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap gap-x-8 gap-y-4">
                  <Readout label="Cartas" value={String(results.length)} />
                  <Readout label="Nuevas" value={String(newCount)} accent="#3fc07a" />
                  <Readout label="Valor total" value={formatCredits(totalValue)} accent="#ffd35c" prefix="🪙 " />
                </div>

                {rest.length > 0 && (
                  <>
                    <p className="nx-label mt-7">El resto del sobre</p>
                    <div className="mt-2.5 flex flex-wrap gap-3">
                      {rest
                        .slice()
                        .sort((a, b) => getVariant(b.card.variantId).rank - getVariant(a.card.variantId).rank)
                        .map((r, i) => (
                          <Card3D
                            key={r.uid}
                            mode="static"
                            status={r.isNew ? "new" : undefined}
                            delay={card3DStagger(i, 0.06, 0.4)}
                            className="w-[118px]"
                          >
                            <PlayerCard card={r.card} size="sm" serial={r.serial} interactive={false} />
                          </Card3D>
                        ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mt-10 flex flex-wrap justify-center gap-3">
              {/* Venta local: con sesión la lleva el servidor, así que no se ofrece. */}
              {duplicates.length > 0 && !online && (
                <button
                  onClick={() => {
                    quickSellMany(duplicates.map((d) => d.uid));
                    router.push("/coleccion");
                  }}
                  className="nx-clip-sm border border-drl-gold/40 bg-drl-gold/10 px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.12em] text-drl-gold transition hover:bg-drl-gold/20"
                >
                  Vender {duplicates.length} duplicado(s) · 🪙{" "}
                  {formatCredits(duplicates.reduce((s, d) => s + Math.round(d.value * 0.8), 0))}
                </button>
              )}
              <button
                onClick={() => router.push("/coleccion")}
                className="nx-clip-sm border border-white/15 bg-white/5 px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.12em] text-white transition hover:bg-white/10"
              >
                Ver colección
              </button>
              <button
                onClick={() => router.push("/tienda")}
                className="nx-clip-sm bg-drl px-6 py-3 font-display text-sm font-bold uppercase tracking-[0.12em] text-white shadow-glow transition hover:brightness-110"
              >
                Abrir otro
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/** Cifra del botín. Sin caja: etiqueta encima, cifra grande, nada alrededor. */
function Readout({
  label, value, accent = "#ffffff", prefix = "",
}: { label: string; value: string; accent?: string; prefix?: string }) {
  return (
    <div>
      <p className="nx-label">{label}</p>
      <p className="nx-readout mt-1 text-[30px]" style={{ color: accent }}>
        {prefix}{value}
      </p>
    </div>
  );
}

/** Un estado límite de la ceremonia: título, explicación y salidas. Nunca una frase suelta. */
function Centered({
  title, body, children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-base-900 px-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="nx-label">Apertura de sobres</span>
        <h1 className="font-display text-[clamp(26px,6vw,40px)] font-bold uppercase leading-none text-white">
          {title}
        </h1>
        <p className="text-[14px] leading-relaxed text-white/55">{body}</p>
        {children}
      </div>
    </div>
  );
}

/** Dos salidas, no una: comprar otro y mirar lo que ya tienes son respuestas distintas. */
function Exits({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-2.5">
      <button
        onClick={() => router.push("/tienda")}
        className="nx-clip-sm bg-drl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] text-white shadow-glow transition hover:brightness-110"
      >
        Ir a la tienda
      </button>
      <button
        onClick={() => router.push("/inventario")}
        className="nx-clip-sm border border-white/18 px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.12em] text-white/75 transition hover:border-white/40 hover:text-white"
      >
        Ver mi inventario
      </button>
    </div>
  );
}
