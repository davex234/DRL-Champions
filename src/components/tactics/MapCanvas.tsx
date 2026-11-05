"use client";

/**
 * LIENZO TÁCTICO — el armazón con cámara sobre el que se monta todo lo demás.
 *
 * ────────────────────────── LA REGLA QUE ORDENA ESTE FICHERO ──────────────────────────
 *
 * **El PNG es una capa visual y nada más.** Se pinta entero, en su tamaño real, en
 * `<image x=0 y=0 width=W height=H>`. No se recorta, no se escala de forma permanente, no
 * se convierte y no se le aplica ningún filtro. Zoom y encuadre mueven la CÁMARA —el
 * `viewBox` del SVG—, jamás la imagen.
 *
 * ────────────────────────── POR QUÉ NO HAY UN `viewBox` UNIVERSAL ──────────────────────────
 *
 * Antes la pizarra usaba `viewBox="0 0 100 100"` para todos los mapas. Con doce assets de
 * proporciones distintas —de 0,922 en Corrode a 1,113 en Lotus— eso **estiraría diez de los
 * doce** para que llenaran un cuadrado. Aquí el `viewBox` se deriva de las dimensiones
 * reales del mapa y `preserveAspectRatio="xMidYMid meet"` hace el resto: si el contenedor
 * no tiene la proporción del mapa, sobra margen; nunca se deforma.
 *
 * ────────────────────────── LAS CAPAS VAN TODAS DENTRO ──────────────────────────
 *
 * Jugadores, utilidades, dibujos y anotaciones son `<g>` hermanos del `<image>`, dentro del
 * MISMO `<svg>`. Por eso comparten `viewBox` y **no puede haber desalineación**: no hay dos
 * sistemas de coordenadas que sincronizar, hay uno.
 *
 * Las coordenadas del dominio siguen siendo la rejilla 0..100; la conversión a píxeles del
 * PNG la hace `toPixels`/`toGrid` del catálogo, no este componente.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { toGrid, type TacticalMap } from "@/domain/tactics";
import { mapImageSrc } from "@/lib/assets";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("tactics");

/** Posición de la cámara: centro en píxeles del PNG y aumento. */
export interface Camera {
  cx: number;
  cy: number;
  /** 1 = el encuadre del mapa llena el área. Mayor, más cerca. */
  scale: number;
}

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 6;

/** Cámara inicial: el encuadre medido del mapa, centrado. */
export const fitCamera = (map: TacticalMap): Camera => ({
  cx: map.frame.x + map.frame.width / 2,
  cy: map.frame.y + map.frame.height / 2,
  scale: 1,
});

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * ¿Este gesto de rueda es de zoom?
 *
 * Solo con Ctrl o Cmd. Sin ellos la rueda pertenece a la página, y el lienzo no la toca.
 */
const conZoom = (e: { ctrlKey: boolean; metaKey: boolean }): boolean => e.ctrlKey || e.metaKey;

interface CanvasApi {
  map: TacticalMap;
  /** Punto de pantalla → rejilla 0..100. Es lo que usan las capas al arrastrar. */
  toGridPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /** Cuántos píxeles del PNG mide un píxel de pantalla. Sirve para grosores constantes. */
  pxPerScreen: () => number;
}

const Ctx = createContext<CanvasApi | null>(null);

/** Acceso al lienzo desde cualquier capa. Falla ruidosamente fuera de sitio. */
export function useMapCanvas(): CanvasApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useMapCanvas fuera de <MapCanvas>");
  return api;
}

export function MapCanvas({
  map, camera, onCamera, children, className, onBackgroundDown, cursor, quietControls = false,
}: {
  map: TacticalMap;
  camera: Camera;
  onCamera: (c: Camera) => void;
  children: React.ReactNode;
  className?: string;
  /** Pulsación sobre el fondo (ni ficha ni control). Devuelve `true` si la consume. */
  onBackgroundDown?: (grid: { x: number; y: number }, e: React.PointerEvent) => boolean;
  cursor?: string;
  /**
   * En PRESENTACION el mando de camara se apaga hasta que se le acerca el puntero.
   *
   * No se quita: un entrenador querra acercarse a un sitio mientras explica, y «Ctrl + rueda»
   * no es evidente en una tele. Pero cuatro controles de edicion encendidos sobre el mapa son
   * ruido justo en la pantalla que existe para que no haya ninguno.
   */
  quietControls?: boolean;
}) {
  useLocale();
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const panFrom = useRef<{ cx: number; cy: number; x: number; y: number } | null>(null);
  const pinchFrom = useRef<{ dist: number; scale: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // ── La cámara, traducida a `viewBox` ───────────────────────────────────────
  const view = useMemo(() => {
    const vw = map.frame.width / camera.scale;
    const vh = map.frame.height / camera.scale;
    return { x: camera.cx - vw / 2, y: camera.cy - vh / 2, w: vw, h: vh };
  }, [map.frame.width, map.frame.height, camera]);

  /** Punto de pantalla → píxeles del PNG, con la matriz real del SVG. */
  const toImagePoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const q = p.matrixTransform(ctm.inverse());
    return { px: q.x, py: q.y };
  }, []);

  const toGridPoint = useCallback((clientX: number, clientY: number) => {
    const p = toImagePoint(clientX, clientY);
    return p ? toGrid(map, p.px, p.py) : null;
  }, [toImagePoint, map]);

  const pxPerScreen = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return 1;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return 1;
    // `meet` escala por el eje más restrictivo: el mismo factor en los dos ejes.
    return Math.max(view.w / rect.width, view.h / rect.height);
  }, [view.w, view.h]);

  const api = useMemo<CanvasApi>(() => ({ map, toGridPoint, pxPerScreen }), [map, toGridPoint, pxPerScreen]);

  // ── Mover la cámara, siempre dentro de límites razonables ──────────────────
  const setCamera = useCallback((next: Camera) => {
    const scale = clamp(next.scale, MIN_SCALE, MAX_SCALE);
    onCamera({
      scale,
      cx: clamp(next.cx, 0, map.width),
      cy: clamp(next.cy, 0, map.height),
    });
  }, [onCamera, map.width, map.height]);

  /**
   * Zoom con la rueda, ANCLADO al cursor: el punto del mapa que hay bajo el ratón se queda
   * donde está. Un zoom que salta al centro obliga a recolocar la vista en cada paso.
   *
   * ────────────────────────── LA RUEDA ES DE LA PÁGINA ──────────────────────────
   *
   * **Sin Ctrl (o Cmd), la rueda NO hace zoom: desplaza la página.** La primera versión se
   * la tragaba siempre, y se notaba enseguida usándolo: el tablero mide unos 640 × 1100 px
   * —casi todo el viewport—, así que el cursor está encima de él prácticamente siempre, y
   * en `/entrenador/mapas`, `/entrenador/strats` y `/entrenador/strats/revisar` la página
   * no bajaba con la rueda. Había que arrastrar la barra del navegador a mano.
   *
   * Un lienzo que se queda con la rueda dentro de una página que se desplaza es una trampa,
   * y es la razón por la que los mapas embebidos piden «Ctrl + rueda para hacer zoom».
   * Aquí se hace lo mismo, y el zoom sigue estando en los botones de la esquina y en la
   * pinza táctil.
   *
   * El pellizco de un trackpad llega como `wheel` con `ctrlKey`, así que sigue haciendo
   * zoom sin que el usuario tenga que pulsar nada.
   */
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!conZoom(e)) return;              // la rueda se la queda la página
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
    const k = camera.scale / scale;
    setCamera({ scale, cx: p.px + (camera.cx - p.px) * k, cy: p.py + (camera.cy - p.py) * k });
  }, [camera, toImagePoint, setCamera]);

  /*
   * `wheel` se registra a mano y no como `onWheel` de React porque React lo adjunta como
   * pasivo, y un oyente pasivo no puede llamar a `preventDefault`. Se cancela SOLO cuando
   * el gesto es de zoom; si no, el evento sigue su camino y la página se desplaza.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => { if (conZoom(e)) e.preventDefault(); };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchFrom.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: camera.scale };
      panFrom.current = null;
      return;
    }

    // ¿Se lo queda una capa? (colocar una utilidad, empezar un trazo…)
    const grid = toGridPoint(e.clientX, e.clientY);
    if (grid && onBackgroundDown?.(grid, e)) return;

    panFrom.current = { cx: camera.cx, cy: camera.cy, x: e.clientX, y: e.clientY };
    setPanning(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, [camera, onBackgroundDown, toGridPoint]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinza: dos dedos mandan sobre todo lo demás.
    if (pointers.current.size === 2 && pinchFrom.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchFrom.current.dist > 0) {
        setCamera({ ...camera, scale: pinchFrom.current.scale * (dist / pinchFrom.current.dist) });
      }
      return;
    }

    const from = panFrom.current;
    if (!from) return;
    const k = pxPerScreen();
    setCamera({ ...camera, cx: from.cx - (e.clientX - from.x) * k, cy: from.cy - (e.clientY - from.y) * k });
  }, [camera, pxPerScreen, setCamera]);

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
    if (pointers.current.size === 0) { panFrom.current = null; setPanning(false); }
  }, []);

  return (
    /*
     * FASE 10 · EL LIENZO ES UNA MESA, NO UN RECUADRO.
     *
     * Era un `rounded-panel` con un borde de 1 px sobre `#070a10`. Ahora lleva el canto del
     * sistema —chaflán, filo de luz arriba, sombra propia— para que el mapa se lea como una
     * superficie sobre la que se trabaja y no como un hueco en la página. **La geometría del
     * mapa no cambia**: el `viewBox`, el `preserveAspectRatio` y el `<image>` son los mismos.
     */
    <div
      data-tactical="lienzo"
      className={cn("nx-clip relative isolate overflow-hidden bg-[#070a10]", className)}
      style={{
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.14)," +
          "inset 0 1px 0 rgba(255,255,255,0.10)," +
          "0 28px 60px -28px rgba(0,0,0,0.95)",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full touch-none select-none"
        style={{ cursor: cursor ?? (panning ? "grabbing" : "grab") }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        role="application"
        aria-label={t("Mapa {name}", { name: td(map.name) })}
      >
        {/*
          CAPA BASE. El asset, entero y en su tamaño real. Nada de lo que hay encima lo
          modifica: son hermanos en el árbol, no filtros.
        */}
        <image
          href={mapImageSrc(map.asset)}
          x={0}
          y={0}
          width={map.width}
          height={map.height}
          preserveAspectRatio="none"
        />

        <Ctx.Provider value={api}>{children}</Ctx.Provider>
      </svg>

      <CameraControls
        map={map}
        camera={camera}
        onCamera={setCamera}
        quiet={quietControls}
      />
    </div>
  );
}

/**
 * Mando de cámara. Compacto y en una esquina: el protagonista es el mapa.
 *
 * ────────────────────────── FASE 10 ──────────────────────────
 *
 * Medido: los tres botones eran de **32 × 32 px**, por debajo del objetivo táctil, y en una
 * herramienta que se usa con el dedo sobre un mapa son de los controles que más se pulsan.
 * Ahora miden 44 y llevan la geometría de la casa. El comportamiento —zoom por cámara,
 * `fitCamera`, Ctrl + rueda— **no cambia ni una línea**.
 */
function CameraControls({
  map, camera, onCamera, quiet = false,
}: {
  map: TacticalMap;
  camera: Camera;
  onCamera: (c: Camera) => void;
  /** Apagado hasta que se le acerca el puntero. Lo pide el modo presentacion. */
  quiet?: boolean;
}) {
  useLocale();
  const zoom = (factor: number) => onCamera({ ...camera, scale: camera.scale * factor });
  const btn =
    "nx-clip-sm grid h-11 w-11 place-items-center bg-[#0b0f18]/90 font-display text-[15px] " +
    "font-bold text-white/75 backdrop-blur transition duration-fast " +
    "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] " +
    "hover:bg-[#12182a]/90 hover:text-drl-gold " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl-gold";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-end gap-1.5 sm:inset-x-auto sm:right-2.5 sm:bottom-2.5",
        quiet && "opacity-25 transition-opacity duration-normal hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none",
      )}
    >
      {/* El zoom con rueda deja de ser evidente si hace falta Ctrl: se dice. */}
      <span
        className="nx-clip-sm pointer-events-auto hidden bg-[#0b0f18]/90 px-2.5 py-1.5 font-display text-[10px] uppercase tracking-wide text-white/40 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] backdrop-blur sm:block"
        title={t("La rueda sola desplaza la página")}
      >
        {t("Ctrl + rueda")}
      </span>
      <span className="nx-clip-sm pointer-events-auto bg-[#0b0f18]/90 px-2.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] backdrop-blur">
        <b className="nx-readout text-[13px] text-white/60">{Math.round(camera.scale * 100)} %</b>
      </span>
      <span className="pointer-events-auto flex items-center gap-1.5">
        <button type="button" className={btn} onClick={() => zoom(1 / 1.25)} aria-label={t("Alejar")} title={t("Alejar")}>−</button>
        <button type="button" className={btn} onClick={() => zoom(1.25)} aria-label={t("Acercar")} title={t("Acercar")}>+</button>
        <button
          type="button"
          className={cn(btn, "w-auto px-3 text-[11px] uppercase tracking-wide")}
          onClick={() => onCamera(fitCamera(map))}
          aria-label={t("Ajustar el mapa al área")}
          title={t("Ajustar al área")}
        >
          {t("Ajustar")}
        </button>
      </span>
    </div>
  );
}
