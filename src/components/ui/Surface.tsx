"use client";

/**
 * LAS SUPERFICIES DE NEXUS — cinco, y solo cinco.
 *
 * ────────────────────────── POR QUÉ ──────────────────────────
 *
 * Medido: **39 fondos distintos en el vestíbulo, 39 en la colección, 35 en la tienda, 30 en el
 * perfil.** No sobran valores: falta un vocabulario. Cada componente decide su propio
 * `background`, su propio borde y su propia sombra, y el resultado es que dos paneles vecinos
 * no parecen del mismo material.
 *
 * `globals.css` ya tenía cuatro utilidades solapadas —`.nx-panel`, `.nx-card`, `.nx-plate`,
 * `.nx-stage`— sin una regla que dijera cuál usar cuándo. Esto no añade una quinta: **pone
 * nombre a los cinco papeles** y los ata a los tokens.
 *
 *     stage      el escenario donde ocurre algo   (héroe, arena, vitrina)
 *     plate      la unidad de contenido            (panel, sección, bloque)
 *     recessed   un hueco practicado en una placa  (campo, pista, pozo)
 *     rail       la línea que separa dos zonas     (con su etiqueta incrustada)
 *     medallion  la placa pequeña troquelada       (sello, nodo, insignia)
 *
 * El fondo de la aplicación no es un componente: es el lienzo, y ya lo pinta el armazón.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No maqueta. No decide anchos, ni columnas, ni espaciados internos más allá de su relleno:
 * son SUPERFICIES con `children`. Y no reemplaza a `.nx-panel` ni a `.nx-card` todavía — esos
 * siguen ahí, en uso, y su retirada es trabajo de las fases de pantalla.
 */
import { CHAMFER, DEPTH, SURFACE, SURFACES } from "@/design/tokens";
import { cn } from "@/lib/format";

type Tone = "neutral" | "primary" | "cyan" | "gold" | "success";

/** El tinte de una superficie. Semántico: el color dice de qué habla, no adorna. */
const TINT: Record<Tone, string> = {
  neutral: "255,255,255",
  primary: "255,46,99",
  cyan: "25,227,255",
  gold: "255,211,92",
  success: "63,192,122",
};

/**
 * ESCENARIO. El plano donde ocurre algo: un héroe, una arena, una vitrina. Lleva su propia
 * luz ambiental porque es lo que lo separa del lienzo — un escenario sin luz propia es un div.
 */
export function Stage({
  tone = "neutral", grid, className, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone; grid?: boolean }) {
  return (
    <div
      data-surface="stage"
      className={cn("nx-clip relative isolate", grid && "nx-stage-grid", className)}
      style={{
        ["--nx-tint" as string]: TINT[tone],
        ["--nx-chamfer" as string]: CHAMFER.stage,
        border: `1px solid rgb(${TINT[tone]} / 0.22)`,
        background:
          `radial-gradient(120% 100% at 50% 0%, rgb(${TINT[tone]} / 0.10), transparent 62%),` +
          "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.25))",
        boxShadow: "0 32px 80px -20px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.09)",
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * PLACA. La unidad de contenido. Es lo que sustituye a la tarjeta redondeada: mismo trabajo,
 * geometría de la casa — chaflán de placa, canto de luz arriba, asiento abajo.
 */
export function Plate({
  tone = "neutral", className, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return (
    <div
      data-surface="plate"
      className={cn("nx-clip relative", className)}
      style={{
        ["--nx-chamfer" as string]: CHAMFER.plate,
        border: `1px solid rgb(${TINT[tone]} / ${tone === "neutral" ? 0.1 : 0.28})`,
        background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012))",
        boxShadow: "0 6px 16px -4px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.07)",
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * HUNDIDA. Un hueco practicado en una placa: más oscura que lo que la rodea, filo superior en
 * sombra y filo inferior iluminado. Es la superficie que le faltaba al sistema, y la que hace
 * que una posición de carta se lea como excavada y no como pegada encima.
 */
export function Recessed({
  depth = "md", className, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { depth?: "sm" | "md" | "lg" }) {
  const shadow = {
    sm: "inset 0 1px 3px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.07)",
    md: "inset 0 3px 7px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(255,255,255,0.12)",
    lg: "inset 0 16px 30px -18px rgba(0,0,0,0.95), inset 0 -16px 30px -18px rgba(0,0,0,0.95)",
  }[depth];
  return (
    <div
      data-surface="recessed"
      className={cn("nx-clip-sm relative", className)}
      style={{
        ["--nx-chamfer-sm" as string]: CHAMFER.control,
        background: "linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0.22))",
        boxShadow: shadow,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * RAÍL. La línea que separa dos zonas, con su etiqueta incrustada en medio.
 *
 * No es un `<hr>` ni un borde: son dos filos, uno oscuro y otro claro, como un corte en la
 * chapa. Ya se usaba en la mesa de duelo y en el pase; aquí deja de estar dibujado a mano.
 */
export function Rail({
  label, tone = "neutral", className, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { label?: string; tone?: Tone }) {
  const c = TINT[tone];
  return (
    <div data-surface="rail" className={cn("relative flex items-center gap-3", className)} {...rest}>
      <Filo tint={c} />
      {label && (
        <span
          className="nx-clip-sm shrink-0 px-2.5 py-0.5 font-display text-[9px] font-bold uppercase tracking-[0.3em]"
          style={{
            ["--nx-chamfer-sm" as string]: CHAMFER.medallion,
            color: `rgb(${c} / 0.85)`,
            background: "rgba(6,8,14,0.8)",
            boxShadow: `inset 0 0 0 1px rgb(${c} / 0.28)`,
          }}
        >
          {label}
        </span>
      )}
      <Filo tint={c} />
    </div>
  );
}

function Filo({ tint }: { tint: string }) {
  return (
    <span aria-hidden className="relative h-[2px] flex-1">
      <span className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, rgb(${tint} / 0.4) 25%, rgb(${tint} / 0.4) 75%, transparent)` }} />
      <span className="absolute inset-x-0 bottom-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(0,0,0,0.9) 25%, rgba(0,0,0,0.9) 75%, transparent)" }} />
    </span>
  );
}

/**
 * MEDALLÓN. La placa pequeña troquelada: un sello, un nodo del pase, una insignia.
 *
 * Es la pieza que ya usaban el sello de variante de la carta y el nivel del pase, cada uno con
 * su propio dibujo. Un medallón NO es un chip redondeado: es metal con canto y un dato dentro.
 */
export function Medallion({
  tone = "neutral", size = 36, className, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone; size?: number }) {
  const c = TINT[tone];
  return (
    <div
      data-surface="medallion"
      className={cn("nx-clip-sm relative grid shrink-0 place-items-center", className)}
      style={{
        ["--nx-chamfer-sm" as string]: CHAMFER.medallion,
        width: size,
        height: size,
        color: `rgb(${c})`,
        background: "linear-gradient(160deg, rgba(255,255,255,0.1), rgba(0,0,0,0.4))",
        boxShadow: `inset 0 0 0 1px rgb(${c} / 0.5), inset 0 1px 0 rgba(255,255,255,0.16), 0 2px 8px -2px rgba(0,0,0,0.8)`,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ═══════════════════════ FASE 3B · los dos papeles que faltaban ═══════════════════════
 *
 * La gramática aprobada nombra CINCO papeles —background, stage, plate, recessed, object— y
 * el sistema solo tenía tres de ellos como pieza. `background` lo pintaba `globals.css` a
 * mano (y el launcher se lo repintaba encima con su propio gradiente en línea), y `object`
 * sencillamente no existía pese a que la carta, el sobre y el sello lo son.
 *
 * `Rail` y `Medallion` NO son papeles nuevos: un raíl es un separador y un medallón es un
 * objeto de formato pequeño. Se quedan donde están, ahora con su papel dicho.
 *
 * La tabla de papeles vive en `SURFACES` (tokens). Ninguna de estas piezas decide su chaflán
 * ni su profundidad: los lee de ahí.
 */

/**
 * FONDO. El lienzo sobre el que se monta una ventana entera.
 *
 * No es decoración: es la superficie de nivel 0, y hasta ahora cada pantalla que quería un
 * lienzo propio se escribía tres gradientes en un `style`. Acepta tintes porque un cliente con
 * temas los necesita — pero el que no pasa ninguno obtiene el lienzo del sistema.
 */
export function Backdrop({
  base = SURFACE.canvas, tintA, tintB, grid, className, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  base?: string;
  /** Tinte superior izquierdo (identidad de la sección o del tema). */
  tintA?: string;
  /** Tinte superior derecho. */
  tintB?: string;
  grid?: boolean;
}) {
  const capas = [
    tintA && `radial-gradient(1100px 620px at 18% -8%, ${tintA}, transparent 62%)`,
    tintB && `radial-gradient(900px 520px at 92% 6%, ${tintB}, transparent 58%)`,
    base,
  ].filter(Boolean).join(",");
  return (
    <div
      data-surface="background"
      className={cn("relative isolate", grid && "bg-grid", className)}
      style={{ background: capas }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * OBJETO. Una pieza que se coge: carta, sobre, sello, recompensa.
 *
 * Se distingue de la PLACA en una cosa y es la que importa: la placa está apoyada en el plano
 * y el objeto se ha DESPEGADO de él (`DEPTH.object`). Por eso proyecta sombra larga y tiene
 * canto propio; una placa con esa sombra parecería que flota, y un objeto sin ella, pegado.
 */
export function Piece({
  tone = "neutral", lifted, className, children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  tone?: Tone;
  /** Estado levantado (seleccionado, arrastrado, en primer plano). */
  lifted?: boolean;
}) {
  return (
    <div
      data-surface="object"
      className={cn("nx-clip relative", className)}
      style={{
        ["--nx-chamfer" as string]: SURFACES.object.chamfer,
        border: `1px solid rgb(${TINT[tone]} / ${tone === "neutral" ? 0.14 : 0.36})`,
        background:
          `radial-gradient(120% 100% at 50% 0%, rgb(${TINT[tone]} / 0.10), transparent 60%),` +
          "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))",
        boxShadow: lifted ? DEPTH.impact : DEPTH.object,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
