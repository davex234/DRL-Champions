"use client";

/**
 * CARD3D — la carta como objeto físico (Fase 9B, ampliado en 9.6).
 *
 * Es un ENVOLTORIO, no otra carta. La carta la siguen dibujando `PlayerCard` y `DuelCard`;
 * esto solo añade el volumen: inclinación con el puntero, brillo que se desplaza con ella,
 * sombra que se separa del plano y, en las variantes altas, un halo del color de la rareza.
 * Duplicar el dibujado habría creado un segundo sistema de cartas, que es justo lo que la
 * Fase 9 prohíbe (§27).
 *
 * ───────────────────────────── QUÉ CAMBIA EN 9.6 ─────────────────────────────
 *
 * **1. El envoltorio se usaba en UN sitio.** Estaba escrito para «la carta es un objeto» y
 * solo lo envolvía el abanico del vestíbulo. La rejilla de la colección dibujaba a mano su
 * propio hover, su propio candado (un emoji 🔒 encima de la carta) y su propio contador de
 * duplicados. Tres tratamientos distintos para la misma carta en tres pantallas.
 *
 * **2. `static` ya no monta framer-motion.** Ese era el motivo real por el que no se podía
 * usar en las rejillas: sesenta cartas envueltas en `motion.div` son sesenta suscripciones
 * a un motor de animación para no animar nada. Ahora el camino estático es un `div` con
 * una animación CSS de entrada — y el presupuesto de nodos de `/coleccion`, que la Fase
 * 9.5 dejó justo por debajo de 4.000, no se mueve.
 *
 * **3. Estado ≠ movimiento.** `mode` dice cómo SE MUEVE la carta; `status` dice QUÉ ES
 * (nueva, bloqueada, duplicada). Antes iban mezclados y por eso una carta bloqueada no
 * podía existir en una rejilla estática.
 *
 * Modos, y qué resuelve cada uno:
 *   · `static`      — sin interacción ni motor de animación. Rejillas de cientos de cartas.
 *   · `hover`       — inclinación al puntero. El modo por defecto de una carta pulsable.
 *   · `selected`    — elegida: se eleva y se queda quieta, para que se lea como estado.
 *   · `reveal`      — entra girando desde el dorso. Una carta que aparece.
 *   · `legendary`   — `hover` con halo y barrido continuos. Solo para rareza alta.
 *   · `packReveal`  — la revelación de un sobre: irrumpe, sobrepasa y asienta.
 *   · `showcase`    — vitrina: flota sola, sin que nadie la toque.
 *
 * Reglas que no se negocian:
 *   · El puntero fino inclina; el táctil NO. En un móvil el dedo tapa la carta y el
 *     giro solo estorba: ahí el modo interactivo se degrada a pulsación.
 *   · `prefers-reduced-motion` apaga giro, flotación y barrido. Queda la carta, legible.
 *   · La inclinación es `transform` puro (compositor); nunca anima layout.
 */
import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/format";
import { DURATION } from "@/design/tokens";
import { EASE } from "@/design/motion";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("visual");

export type Card3DMode =
  | "static"
  | "hover"
  | "selected"
  | "reveal"
  | "legendary"
  | "packReveal"
  | "showcase";

/**
 * Qué ES la carta, con independencia de cómo se mueva.
 *
 *   · `new`    — recién obtenida y todavía sin mirar.
 *   · `locked` — está en el catálogo pero no la tienes. Se ve, y por eso se quiere.
 */
export type Card3DStatus = "new" | "locked";

interface Card3DProps {
  children: ReactNode;
  mode?: Card3DMode;
  status?: Card3DStatus;
  /** Duplicados en propiedad. Se pinta como cuño en la esquina; 1 o menos no se pinta. */
  count?: number;
  /** Color del halo. Normalmente el de la rareza de la variante. */
  glow?: string;
  /** Grados máximos de inclinación. Más de ~14 se siente a caricatura. */
  tilt?: number;
  /** Retardo de entrada, para escalonar una rejilla que se revela. */
  delay?: number;
  className?: string;
  onClick?: () => void;
  /** Etiqueta accesible cuando la carta es pulsable. */
  label?: string;
  /**
   * La carta se dibuja como control pero no se puede pulsar (una carta del catálogo que
   * todavía no tienes). Sigue siendo un `<button>`: una rejilla mitad botones y mitad
   * `div` deja de ser una rejilla de controles para cualquiera que la recorra —lector de
   * pantalla o automatismo—, y `audit:interactions` localiza la colección exactamente así.
   */
  disabled?: boolean;
}

const INTERACTIVE: Card3DMode[] = ["hover", "legendary", "selected"];

export function Card3D({
  children,
  mode = "hover",
  status,
  count,
  glow,
  tilt = 10,
  delay = 0,
  className,
  onClick,
  label,
  disabled = false,
}: Card3DProps) {
  useLocale();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [pose, setPose] = useState({ rx: 0, ry: 0, gx: 50, gy: 50, lifted: false });

  const interactive = INTERACTIVE.includes(mode) && !reduced;
  const halo = glow ?? "rgba(255,46,99,0.55)";
  const locked = status === "locked";

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Solo puntero fino: con el dedo encima, girar la carta la esconde.
      if (!interactive || e.pointerType !== "mouse") return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      setPose({
        rx: (0.5 - py) * tilt * 2,
        ry: (px - 0.5) * tilt * 2,
        gx: px * 100,
        gy: py * 100,
        lifted: true,
      });
    },
    [interactive, tilt],
  );

  const reset = useCallback(() => setPose({ rx: 0, ry: 0, gx: 50, gy: 50, lifted: false }), []);

  const lifted = pose.lifted || mode === "selected";

  /*
   * CARD ART = CARD VISUAL (limpieza global de cartas). Todo lo que este envoltorio añadía era
   * RECTANGULAR —filo interior del color de la rareza, brillo especular, barrido y halo
   * legendario, anillo de selección, velo de bloqueada, mancha de sombra— y sobre una carta
   * diseñada (un WebP con margen transparente) eso se leía como otra carta alrededor de la
   * carta. Ahora el volumen y los estados son UN filtro sobre la silueta del contenido:
   * apagada si está bloqueada, halo del color de la rareza al elegirla o en las legendarias,
   * y la sombra que se separa del plano al levantarla. `drop-shadow` sigue la transparencia.
   */
  const filtroSilueta = [
    locked ? "brightness(0.42)" : "",
    (mode === "selected" || (mode === "legendary" && !reduced)) ? `drop-shadow(0 0 14px ${halo})` : "",
    lifted && !locked ? "drop-shadow(0 16px 18px rgba(0,0,0,0.55))" : "",
  ].filter(Boolean).join(" ") || undefined;
  const cara = <span className="block" data-card3d-face style={{ filter: filtroSilueta }}>{children}</span>;

  /**
   * Las marcas de estado. Van FUERA del `switch` del movimiento porque una carta puede
   * ser nueva estando quieta, y bloqueada estando en una vitrina.
   */
  const marks = (
    <>
      {/*
        BLOQUEADA. Antes era `opacity-30 grayscale` y un emoji 🔒 centrado sobre la carta.
        Un emoji del sistema encima del arte es lo contrario de premium —y además cambia de
        dibujo según el dispositivo—. Ahora la carta se apaga hasta silueta y lleva una
        placa grabada con un candado geométrico propio: se sigue viendo QUÉ carta es, que
        es justo lo que hace que se quiera.
      */}
      {locked && (
        <>
          {/*
            CARD ART = CARD VISUAL: la carta ya no se tapa con un velo rectangular (dibujaba una caja
            oscura sobre el margen transparente del asset). Se apaga con un filtro sobre la silueta
            (ver `filtroSilueta`); este nodo solo marca el estado para las auditorías.
          */}
          <span aria-hidden className="sr-only" data-locked />
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-black/55"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="2">
              <rect x="5" y="11" width="14" height="9" rx="1.5" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
        </>
      )}

      {/*
        NUEVA. Un cuño en diagonal sobre la esquina, no una píldora redondeada: la píldora
        se lee como una notificación de navegador y el cuño como una marca sobre el objeto.
      */}
      {status === "new" && !locked && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-px -top-px z-20 bg-drl px-2 py-[3px] font-display text-[9px] font-bold uppercase tracking-[0.14em] text-white shadow-glow"
          style={{ clipPath: "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)" }}
        >
          {t("Nueva")}
        </span>
      )}

      {/* Duplicados. Cuño discreto: es inventario, no una recompensa. */}
      {typeof count === "number" && count > 1 && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1 z-20 rounded-chip border border-white/20 bg-black/70 px-1.5 py-0.5 font-display text-[10px] font-bold tabular-nums text-white/90"
        >
          ×{count}
        </span>
      )}
    </>
  );

  /**
   * ¿EL LLAMANTE TRAE SU PROPIO ANCHO?
   *
   * La carta se dibujaba con `w-full` fijo y quien le pasaba `className="w-[118px]"` no
   * ganaba: `clsx` concatena, no resuelve conflictos, y cuál de las dos clases manda lo
   * decide el ORDEN EN EL CSS, no el orden en el atributo. En el resumen de la apertura eso
   * convertía «el resto del sobre» en una columna de cartas apiladas a ancho completo, cada
   * una en su propia fila y saliéndose del cuadro.
   *
   * `w-full` pasa a ser lo que siempre debió ser: el valor POR DEFECTO, que se aparta si a
   * la carta le dan una medida.
   */
  const anchoPropio = /(?:^|\s)(?:w-|max-w-)/.test(className ?? "");

  const Tag = onClick ? "button" : "div";

  /*
    ── Camino ESTÁTICO: sin framer-motion. Es el que usan las rejillas largas. ──

    UN SOLO NODO. La primera versión envolvía la carta en un `div` de posicionamiento y
    metía el `button` dentro. Eso rompió `audit:interactions`, que localiza la rejilla de la
    colección buscando el contenedor cuyos hijos son TODOS botones —un heurístico razonable
    y que estaba ahí porque un selector más frágil ya había fallado antes—. Con el
    envoltorio, los hijos pasaban a ser `div` y la auditoría dejaba de encontrar cartas.

    La solución no es relajar la auditoría: es que no hiciera falta el envoltorio. El
    elemento raíz lleva ahora la animación de entrada, el ancho y la elevación, y sale
    gratis un nodo menos por carta —sesenta menos en `/coleccion`, cuyo presupuesto la Fase
    9.5 dejó al límite—.

    La animación es `animate-rise` (`fill-mode: backwards`) y NO `animate-rise-in`
    (`both`): con `both`, el elemento conserva para siempre el `transform` del último
    fotograma y ese transform GANA sobre la propiedad CSS, así que la elevación al pasar el
    ratón dejaba de aplicarse. Es la misma trampa que ya está documentada en `globals.css`.
  */
  if (mode === "static") {
    return (
      <Tag
        type={onClick ? "button" : undefined}
        aria-label={td(label)}
        onClick={onClick}
        disabled={onClick ? disabled : undefined}
        className={cn(
          "relative block origin-center transition-transform duration-fast ease-out",
          !anchoPropio && "w-full",
          className,
          onClick && !disabled && "cursor-pointer text-left hover:-translate-y-1.5",
          // `grayscale` (y no `saturate`) porque es además el marcador por el que
          // `audit:interactions` distingue una carta que NO tienes de una que sí.
          locked && "grayscale",
          !reduced && "motion-safe:animate-rise",
        )}
        style={!reduced ? ({ animationDelay: `${delay}s` } as CSSProperties) : undefined}
      >
        {/* La sombra la pone la propia carta (sobre su silueta): aquí no se dibuja ninguna mancha. */}
        {cara}
        {marks}
      </Tag>
    );
  }

  // ── Animación de entrada según el modo ──
  const enter = (() => {
    if (reduced) return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2, delay } };
    switch (mode) {
      case "reveal":
        return {
          initial: { opacity: 0, rotateY: 180, scale: 0.86 },
          animate: { opacity: 1, rotateY: 0, scale: 1 },
          transition: { duration: DURATION.reveal / 1000, delay, ease: EASE.out },
        };
      case "packReveal":
        return {
          initial: { opacity: 0, scale: 0.4, y: 60, rotateZ: -8 },
          // Sobrepasa y vuelve: una carta que "aterriza" en lugar de aparecer.
          animate: { opacity: 1, scale: [0.4, 1.12, 1], y: [60, -10, 0], rotateZ: [-8, 3, 0] },
          transition: { duration: 0.9, delay, times: [0, 0.62, 1], ease: EASE.out },
        };
      case "showcase":
        return {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: [0, -9, 0] },
          transition: {
            opacity: { duration: 0.4, delay },
            y: { duration: 5.5, repeat: Infinity, ease: "easeInOut" as const, delay },
          },
        };
      default:
        return {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: DURATION.normal / 1000, delay, ease: EASE.out },
        };
    }
  })();

  return (
    // La perspectiva vive en el padre: aplicada al mismo nodo que rota, el giro se aplana.
    <motion.div
      className={cn("relative", className)}
      style={{ perspective: 1000 }}
      {...enter}
    >
      <Tag
        ref={ref as never}
        type={onClick ? "button" : undefined}
        aria-label={td(label)}
        onClick={onClick}
        onPointerMove={onPointerMove}
        onPointerLeave={reset}
        onBlur={reset}
        className={cn(
          "relative block origin-center",
          !anchoPropio && "w-full",
          onClick && "cursor-pointer text-left",
          locked && "grayscale",
        )}
        style={
          {
            transformStyle: "preserve-3d",
            transform: `rotateX(${pose.rx}deg) rotateY(${pose.ry}deg) translateZ(0) scale(${lifted ? 1.035 : 1})`,
            transition: `transform ${pose.lifted ? DURATION.instant : DURATION.normal}ms cubic-bezier(0.16,1,0.3,1)`,
          } as CSSProperties
        }
      >
        {/*
          La carta y su volumen: sombra que se separa al levantarla, halo de rareza o de selección,
          apagado si está bloqueada — todo sobre la silueta (`filtroSilueta`). Sin filo interior,
          sin brillo rectangular, sin anillo: nada que dibuje una caja alrededor del asset.
        */}
        {cara}

        {marks}
      </Tag>
    </motion.div>
  );
}

/**
 * Rejilla de cartas que se revelan escalonadas. El retardo se acota: con 200 cartas, un
 * escalonado lineal dejaría la última entrando quince segundos tarde.
 */
export function card3DStagger(index: number, step = 0.035, max = 0.5): number {
  return Math.min(index * step, max);
}
