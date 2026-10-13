"use client";

/**
 * COMMAND CENTER — EL ESCENARIO.
 *
 * ══════════════════════════ QUÉ ES ══════════════════════════
 *
 * La pieza que define la identidad del producto. No es un hero con una tarjeta al lado: es
 * un PLANO con cuatro capas, y cada una contesta una pregunta distinta:
 *
 *   cinta        ¿qué está pasando ahora?      (directo, evento, o sin conexión)
 *   titular      ¿a qué se juega aquí?         (el modo, no el nombre del producto)
 *   vitrina      ¿qué tengo yo?                (tus cartas, como objetos)
 *   raíl         ¿en qué punto estoy?          (rango, nivel, colección, créditos)
 *
 * ══════════════════════════ TRES DECISIONES ══════════════════════════
 *
 * **1. El escenario NO espera a la red.** El vestíbulo anterior montaba todo detrás de una
 * sola lectura de torneos: con el servidor caído, un jugador con doce cartas y 18.450
 * créditos veía un spinner indefinido sobre fondo negro. Aquí el plano se dibuja con el
 * estado local —que existe siempre— y lo online entra cuando llega. Una capa que falla se
 * queda fuera; no se lleva la pantalla por delante.
 *
 * **2. El plano reacciona, React no.** El parallax escribe dos variables CSS en el nodo
 * raíz (`--px`, `--py`) y las capas de atmósfera las leen desde su `transform`. Cero
 * `setState`, cero re-render, cero layout. Es el mismo `useParallax` del launcher, movido a
 * `components/visual` para no tener dos.
 *
 * **3. La luz va detrás de las cartas, no encima.** Dos focos —uno cálido abajo a la
 * izquierda bajo el titular y uno frío arriba a la derecha recortando la vitrina— y una
 * retícula tenue. Nada más: un escenario con quince efectos deja de ser un escenario.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Stage } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { useParallax } from "@/components/visual/useParallax";
import { LobbyShowcase, type ShowcaseCard } from "./LobbyShowcase";
import { LobbyHud, type LobbyHudRank } from "./LobbyHud";
import { cn } from "@/lib/format";

/** La cinta superior: lo que está ocurriendo ahora mismo, en una línea. */
export interface LobbyTicker {
  tone: "key" | "info" | "ok" | "warn" | "muted";
  /** Etiqueta corta a la izquierda («En directo», «Circuito», «Modo local»). */
  badge: string;
  /** El texto largo. Se trunca; nunca envuelve. */
  text: string;
  /** Detalle secundario (el enfrentamiento en curso). Se oculta en pantallas estrechas. */
  detail?: string;
  href?: string;
  live?: boolean;
}

/** El estado del mazo con el que se entraría a jugar. */
export interface LobbyDeck {
  name: string;
  size: number;
  ovr: number;
  valid: boolean;
}

export function LobbyStage({
  ticker, deck, cards, packs, hud, primary, secondary, showcaseAction = true,
}: {
  ticker: LobbyTicker;
  /** `null` = todavía no se sabe (sin sesión o sin respuesta). No se inventa un estado. */
  deck: LobbyDeck | null;
  cards: ShowcaseCard[];
  packs: number;
  hud: {
    rank: LobbyHudRank | null;
    level: { level: number; xpIntoLevel: number; xpForNext: number; progress: number };
    collection: { distinct: number; total: number; owned: number };
    credits: number;
  };
  primary: { label: string; href: string; accent?: "primary" | "gold" | "cyan" };
  secondary: { label: string; href: string };
  /** La vitrina calla su botón si el CTA principal ya lleva al mismo destino. */
  showcaseAction?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [motion, setMotion] = useState(0);

  // El movimiento lo decide el sistema operativo, no la pantalla.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotion(mq.matches ? 0 : 1);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useParallax(ref, motion * 0.5);

  /*
   * El `ref` va en un envoltorio y no en `Stage`: las variables CSS del parallax SE HEREDAN,
   * así que escribirlas un nivel más arriba llega igual a las capas — y no hace falta
   * convertir una primitiva del sistema en `forwardRef` solo para esta pantalla.
   */
  return (
    <div ref={ref}>
    <Stage
      tone="primary"
      className="nx-stage-grid relative isolate overflow-hidden"
      aria-label="Duelos, el modo principal"
    >
      {/* ── Atmósfera. Solo transform y opacidad: el compositor hace todo el trabajo. ── */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-12 -z-10"
        style={{
          transform: "translate3d(calc(var(--px,0) * 14px), calc(var(--py,0) * 9px), 0)",
          willChange: "transform",
          background:
            "radial-gradient(760px 420px at 8% 108%, rgba(255,46,99,0.32), transparent 66%)," +
            "radial-gradient(680px 460px at 88% -12%, rgba(25,227,255,0.15), transparent 62%)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-8 -z-10 bg-grid opacity-40"
        style={{ transform: "translate3d(calc(var(--px,0) * -6px), calc(var(--py,0) * -4px), 0)" }}
      />

      <Ticker {...ticker} />

      <div className="relative grid gap-7 px-5 py-8 sm:px-9 sm:py-11 lg:grid-cols-[1.05fr_minmax(0,0.95fr)] lg:items-center">
        {/* ── Columna de acción ── */}
        <div className="min-w-0">
          <span className="font-display text-label uppercase tracking-wide2 text-drl">
            Modo principal · 1 vs 1
          </span>

          {/*
            El titular es el MODO, no el producto. Un vestíbulo encabezado con el nombre del
            juego no dice qué hacer; uno encabezado con «DUELOS», sí.
          */}
          <h1 className="mt-2 font-display text-[clamp(44px,8.5vw,84px)] font-bold uppercase leading-[0.88] tracking-[-0.01em] text-white">
            Duelos
          </h1>
          <p className="mt-3 max-w-md text-body leading-relaxed text-ink-muted">
            Tu mazo contra un rival. Diez turnos, una estadística por carta y ningún dado:
            gana quien lee mejor al otro.
          </p>

          {/*
            En móvil la acción principal ocupa el ancho y la secundaria se pone a su lado en
            cuanto hay sitio. Dos botones a media pantalla, uno debajo del otro, se leen como
            dos opciones equivalentes — y aquí solo hay una decisión.
          */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <NxButton variant="primary" accent={primary.accent} size="lg" href={primary.href} className="w-full sm:w-auto">
              {primary.label}
            </NxButton>
            <NxButton variant="secondary" size="lg" href={secondary.href} className="w-full sm:w-auto">
              {secondary.label}
            </NxButton>
          </div>

          {/*
            ESTADO DEL MAZO. «Jugar» sin saber si hay mazo es un botón que lleva a un error.
            Se dice ANTES de pulsar, con el dato real de la misma API que usa `/duelos`.
          */}
          {deck !== null && (
            <p className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 font-display text-caption uppercase tracking-label">
              <Badge tone={deck.valid ? "ok" : "warn"} dot>
                {deck.valid ? "Equipo listo" : "Equipo incompleto"}
              </Badge>
              <span className="text-ink-muted">{deck.name}</span>
              <Readout size="xs" value={`${deck.size}/10`} className="inline-flex" />
              {deck.ovr > 0 && (
                <Readout size="xs" value={deck.ovr} label={undefined} unit="OVR" tone="var(--nx-cyan)" className="inline-flex" />
              )}
            </p>
          )}
        </div>

        {/* ── Vitrina ── */}
        <LobbyShowcase cards={cards} packs={packs} offerAction={showcaseAction} />
      </div>

      <LobbyHud
        rank={hud.rank}
        level={hud.level}
        collection={hud.collection}
        credits={hud.credits}
        packs={packs}
      />
    </Stage>
    </div>
  );
}

/**
 * LA CINTA. Contesta «¿qué está pasando ahora?» en una línea y lleva allí de un clic.
 *
 * Es el sitio donde vive el directo del circuito, el evento activo o —cuando no hay red— el
 * aviso de modo local. Nunca las tres a la vez: una pantalla con tres cintas ya no tiene una.
 */
function Ticker({ tone, badge, text, detail, href, live }: LobbyTicker) {
  const contenido = (
    <>
      <Badge tone={tone} dot={live} pulse={live} className="shrink-0">
        {badge}
      </Badge>
      <span className="min-w-0 flex-1 truncate font-display text-caption font-bold uppercase tracking-label text-white/85">
        {text}
      </span>
      {detail && <span className="hidden shrink-0 truncate text-caption text-ink-muted sm:block">{detail}</span>}
      {href && (
        <span aria-hidden className="shrink-0 font-display text-caption text-drl transition-transform duration-fast group-hover:translate-x-1">
          →
        </span>
      )}
    </>
  );

  const clases = cn(
    "group relative flex min-h-[44px] items-center gap-3 border-b border-edge bg-black/35 px-5 sm:px-9",
    href && "transition-colors duration-fast hover:bg-black/55",
  );

  return href ? (
    <Link href={href} className={cn(clases, "nx-focus")}>
      {contenido}
    </Link>
  ) : (
    <div className={clases}>{contenido}</div>
  );
}
