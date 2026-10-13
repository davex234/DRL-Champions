"use client";

/**
 * LA MESA — la superficie física sobre la que se juega el duelo.
 *
 * ────────────────────────── FASE 50 · DE MESA A ESCENARIO ──────────────────────────
 *
 * Hasta la Fase 45 esto era un MUEBLE: un canto claro, un tapete hundido, una retícula y cuatro
 * tornillos. Bien construido, pero la silueta seguía siendo la de un rectángulo oscuro con
 * cartas dentro —un panel sobre un fondo—, y eso es lo que hacía que la partida se leyera como
 * una web.
 *
 * Ahora la mesa desaparece como objeto y en su sitio quedan las piezas de un ESCENARIO:
 *
 *     ┌──────────── plataforma del rival (roja, al fondo) ────────────┐
 *     │                                                               │
 *        ◢ marcador ◣   [carta rival]   VS   [tu carta]   ◢ marcador ◣     ← zona de duelo, sin caja
 *     ┌──────────── tu plataforma (cian, en primer plano) ───────────────┐
 *     │                                                                  │
 *
 * Cada plataforma es un trapecio con su filo de neón del color del bando, más estrecho por
 * arriba (la perspectiva de alguien sentado delante del escenario) y con el suelo del recinto
 * asomando a través. La zona de duelo no tiene fondo propio: es el aire entre las dos
 * plataformas, cruzado por la línea de energía del enfrentamiento.
 *
 * ────────────────────────── LO QUE SE CONSERVA ──────────────────────────
 *
 * **La medida.** Sigue habiendo UNA variable, `--pos` —el ancho de una posición de carta—, y de
 * ella sale todo el tablero (ver `arenaVars`). Las plataformas miden lo que mide el juego; nada
 * se estira hasta el ancho de la página.
 *
 * **Los nombres y los atributos.** `data-arena="mesa" | "hud" | "zona-rival" | "zona-jugador" |
 * "clash" | "mano"`, `data-slot`, `aria-label` de las zonas y `aria-live` del duelo: los leen las
 * verificaciones y los lectores de pantalla, y no cambian.
 *
 * ────────────────────────── QUÉ NO HACE ──────────────────────────
 *
 * Nada. No conoce el estado del duelo y no decide nada: son superficies con `children`.
 */
import { cn } from "@/lib/format";
import { ARENA_ACCENT } from "@/lib/duel/arenas";

/** Tonos de bando. Salen de la configuración de la arena, y en el tablero no se escriben en otro sitio. */
export const TONO = {
  rival: ARENA_ACCENT.opponent,
  jugador: ARENA_ACCENT.player,
} as const;

/**
 * LA MEDIDA DEL TABLERO.
 *
 * `--pos` es el ancho de una posición de carta, y es la única medida libre de todo el tablero.
 * Está atada a lo ANCHO y a lo ALTO a la vez, con `min()`: manda la dimensión que va más justa.
 *
 * El término de altura descuenta lo que NO escala —la barra de la partida, la cinta del turno,
 * los controles y la mano— y reparte el resto entre las alturas del tablero medidas en
 * posiciones. FASE 50: la mano crece (es lo que se sostiene), la cabecera del rival lleva sus
 * dorsos y las filas de lo jugado encogen (son historial). MEDIDO en la arena (`_fase50-shots
 * --measure`): el tablero mide 4,9 posiciones de alto (dos filas de 0,84 y el duelo de 3,22) y lo
 * que no escala con `--pos` —barra, cabecera rival, raíles, controles y la mano, que a su vez crece
 * con `vh`— ocupa ≈ 154 px + 0,364·vh. Despejando, `--pos = (0,636·vh − 162 px) / 4,9`, que es
 * `13vh − 33px`: la mano cabe entera en el pliegue en 1920×1080, 1440×900 y 1366×768. El techo sube
 * de 92 a 112 px para que en pantallas grandes el duelo se vea grande de verdad.
 *
 *   1920×1080 → 107 px · 1440×900 → 84 px · 1366×768 → 67 px · 1024×768 → 67 px · 390 → 50 px
 *
 * El suelo de 50 px no es estético: por debajo, una carta en la mesa deja de ser una carta.
 *
 * `--pos-hist` es la medida de las cartas YA JUGADAS: el 72 % de `--pos`. En la jerarquía de la
 * pantalla la carta que pelea manda, la de la mano acompaña y la de lo jugado es memoria.
 */
export function arenaVars(slots: number): React.CSSProperties {
  return {
    /* F71 · `--pos-cap` (opcional) lo pone el tablero en `lg` para descontar la columna de decisión. */
    "--pos": "clamp(50px, min(7.6vw, calc(13vh - 33px), var(--pos-cap, 112px)), 112px)",
    "--pos-hist": "calc(var(--pos) * 0.72)",
    "--pos-gap": "clamp(4px, 0.7vw, 10px)",
    "--pos-pad": "clamp(10px, 1.4vw, 22px)",
    /*
     * EL ANCHO DEL TABLERO. Diez posiciones, sus huecos y los márgenes: ni un píxel más.
     * `min(100%, …)` deja que en móvil siga llenando la pantalla. Lo heredan también los controles
     * y la mano, y por eso las piezas comparten borde izquierdo y derecho.
     */
    "--arena-w": `min(100%, calc(var(--pos) * ${slots} + var(--pos-gap) * ${slots - 1} + var(--pos-pad) * 2 + 10px))`,
  } as React.CSSProperties;
}

export function ArenaSurface({
  children, className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    /*
     * EL ESCENARIO. Ya no pinta canto ni tapete: es el contenedor que mide lo que mide el juego y
     * sobre el que se apoyan las dos plataformas. `data-arena="mesa"` se conserva porque el último
     * turno y el impacto del turno se enganchan a él desde la CSS.
     */
    <div
      data-arena="mesa"
      className={cn("nx-a50-stage relative isolate mx-auto w-full", className)}
      style={{ maxWidth: "var(--arena-w, 100%)" }}
    >
      {children}
    </div>
  );
}

/**
 * EL CANTO SUPERIOR — la tira del turno.
 *
 * En la Fase 50 el turno, la pista de los diez y la fase viven en la barra de la partida. Esta tira
 * se queda para donde esa barra no llega —móvil y la arena PvP— y se dibuja como una línea de luz,
 * no como una caja.
 */
export function TableEdge({ left, center, right, className }: {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-arena="hud"
      className={cn("nx-a50-edge relative flex items-center gap-2 px-[var(--pos-pad)] py-[clamp(3px,0.6vh,7px)] sm:gap-4", className)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
      <div className="flex shrink-0 items-center gap-2">{center}</div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{right}</div>
    </div>
  );
}

/**
 * LA PLATAFORMA DE UN BANDO.
 *
 * Un trapecio con filo de neón —rojo arriba, cian abajo— y el suelo del recinto asomando a través.
 * El tinte responde a «¿cuál es mi zona?» antes de leer ninguna etiqueta. La placa es un nodo
 * decorativo DETRÁS del contenido: las cartas no se deforman, solo el suelo tiene perspectiva.
 *
 * Las cartas jugadas son historial, no protagonistas: dentro de la plataforma `--pos` pasa a
 * valer `--pos-hist`, así que las filas de lo jugado miden un 72 % de una posición del duelo sin
 * que la fila cambie su forma de medirse.
 */
export function ZoneBand({
  side, children, className,
}: {
  side: "rival" | "jugador";
  children: React.ReactNode;
  className?: string;
}) {
  const arriba = side === "rival";
  return (
    <section
      data-arena={arriba ? "zona-rival" : "zona-jugador"}
      data-side={side}
      className={cn("nx-a50-zone relative px-[calc(var(--pos-pad)*1.6)] py-[clamp(4px,0.9vh,10px)]", className)}
      style={{ "--pos": "var(--pos-hist)" } as React.CSSProperties}
      aria-label={arriba ? "Zona del rival" : "Tu zona"}
    >
      <span aria-hidden className="nx-a50-plate" />
      {children}
    </section>
  );
}

/**
 * RAÍL — el nombre de la zona que empieza, grabado en un filo de luz.
 *
 * Dos filos que se encienden hacia la etiqueta, como la placa de un escenario. Decorativo: los
 * lectores de pantalla ya tienen el nombre de cada zona.
 */
export function ZoneRail({ label, tone, className }: { label: string; tone: string; className?: string }) {
  return (
    <div className={cn("relative flex items-center gap-3 px-[var(--pos-pad)]", className)} aria-hidden>
      <Filo tone={tone} hacia="derecha" />
      <span
        className="nx-a50-rail-tag shrink-0 px-3 py-0.5 font-display text-[9px] font-bold uppercase tracking-[0.32em]"
        style={{ color: `${tone}ee`, "--tag": tone } as React.CSSProperties}
      >
        {label}
      </span>
      <Filo tone={tone} hacia="izquierda" />
    </div>
  );
}

function Filo({ tone, hacia }: { tone: string; hacia: "derecha" | "izquierda" }) {
  return (
    <span
      className="h-px flex-1"
      style={{
        background: `linear-gradient(${hacia === "derecha" ? "90deg" : "270deg"}, transparent, ${tone}99)`,
        boxShadow: `0 0 8px ${tone}55`,
      }}
    />
  );
}

/**
 * ZONA DE DUELO — el corazón del escenario.
 *
 * Sin fondo propio: es el aire entre las dos plataformas. La cruza la LÍNEA DE ENERGÍA del
 * enfrentamiento —roja desde el lado del rival, cian desde el tuyo— y debajo de las dos cartas
 * cae el charco de luz del foco, teñido por el bando que ataca (`--env-tone`, heredado).
 */
export function ClashBand({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      data-arena="clash"
      className={cn("nx-a50-duel relative px-[var(--pos-pad)] py-[clamp(4px,1vh,12px)]", className)}
      aria-live="polite"
      aria-label="Zona de duelo"
    >
      <span aria-hidden className="nx-clash-pool" />
      <span aria-hidden className="nx-a50-duel-line" />
      {children}
    </section>
  );
}

/**
 * POSICIÓN DE CARTA — una placa holográfica del escenario.
 *
 * Vacía es un marco de energía del color del bando: un cristal apenas teñido con sus escuadras
 * encendidas. La que TOCA AHORA late; las demás se quedan en un susurro. Ocupada, la carta se
 * apoya encima y tapa la placa.
 */
export function Slot({
  tone, children, filled, active, index, className, label,
}: {
  tone: string;
  children?: React.ReactNode;
  filled?: boolean;
  /** Aquí puede colocarse algo ahora mismo: la placa se enciende. */
  active?: boolean;
  /** Número grabado en la placa vacía. */
  index?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      data-slot={filled ? "lleno" : "vacio"}
      data-active={active ? "true" : undefined}
      className={cn("nx-a50-slot relative grid shrink-0 place-items-center rounded-[6px]", className)}
      style={
        filled
          ? undefined
          : ({
              "--slot": tone,
              background: `linear-gradient(180deg, ${tone}17 0%, ${tone}08 55%, rgba(4,6,14,0.55) 100%)`,
              boxShadow: active
                ? `0 0 24px -4px ${tone}, inset 0 0 0 1px ${tone}cc, inset 0 0 22px -6px ${tone}`
                : `inset 0 0 0 1px ${tone}3a, inset 0 0 14px -8px ${tone}`,
            } as React.CSSProperties)
      }
    >
      {!filled && (
        <>
          {/* Escuadras de la placa: cuatro marcas de luz, no un rectángulo punteado. */}
          {[
            "left-[3px] top-[3px] border-l-2 border-t-2",
            "right-[3px] top-[3px] border-r-2 border-t-2",
            "left-[3px] bottom-[3px] border-l-2 border-b-2",
            "right-[3px] bottom-[3px] border-r-2 border-b-2",
          ].map((c) => (
            <span
              key={c}
              aria-hidden
              className={cn("absolute h-2.5 w-2.5 rounded-[1px] transition-colors duration-normal", c)}
              style={{ borderColor: active ? `${tone}` : `${tone}55` }}
            />
          ))}
          {index != null && (
            <span
              aria-hidden
              className="font-display text-[12px] font-bold tabular-nums transition-colors duration-normal"
              style={{ color: active ? `${tone}` : `${tone}55`, textShadow: active ? `0 0 10px ${tone}` : undefined }}
            >
              {index}
            </span>
          )}
          {label && (
            <span
              className="absolute inset-x-0 bottom-2 whitespace-pre-line text-center font-display text-[9px] font-bold uppercase leading-tight tracking-[0.22em]"
              style={{ color: `${tone}99` }}
            >
              {label}
            </span>
          )}
        </>
      )}
      {children}
    </div>
  );
}

/**
 * LA MANO — el borde del escenario desde el que juegas.
 *
 * Ya no es una bandeja oscura: es el filo de tu plataforma, con su raíl cian y el rótulo de la mano
 * grabado en el centro. Las cartas se asoman por encima del raíl, como sostenidas delante del
 * escenario. La etiqueta va SOBREPUESTA: una línea de texto aquí son píxeles que le hacen falta a
 * las cartas.
 */
export function HandTray({
  children, left, right, className, style,
}: {
  children: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      data-arena="mano"
      className={cn("nx-a50-hand relative mx-auto w-full", className)}
      style={style}
    >
      <span aria-hidden className="nx-a50-hand-rail" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-baseline justify-between px-3 pt-1 sm:px-5">
        {left}
        {right}
      </div>
      {children}
    </div>
  );
}
