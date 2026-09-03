"use client";

/**
 * PIZARRA TÁCTICA (Fase 9I).
 *
 * Un mapa propio de NEXUS en SVG y unas fichas que se arrastran encima. Nada más, y esa
 * es la idea: una pizarra es útil porque no te hace pensar en la herramienta.
 *
 * DECISIONES QUE IMPORTAN
 *
 *  1. **SVG con `viewBox="0 0 100 100"`.** El dominio guarda las coordenadas en una
 *     rejilla 0..100, así que aquí no se convierte NADA: se pintan tal cual y el
 *     navegador escala. La misma estrategia se ve igual en un móvil de 320 px y en un
 *     monitor de 900, y una posición guardada hace un año significa el mismo punto.
 *  2. **Punteros, no ratón.** `onPointer*` cubre ratón, dedo y lápiz con el mismo código.
 *     `setPointerCapture` hace que arrastrar siga funcionando aunque el dedo se salga de
 *     la ficha, que es lo que pasa siempre en una pantalla pequeña.
 *  3. **También con teclado.** Cada ficha es enfocable y las flechas la mueven de 2 en 2
 *     unidades. Una pizarra que solo funciona arrastrando deja fuera a quien no puede.
 *  4. **La pizarra NO decide nada.** No valida la estrategia, no simula la ronda y no
 *     conoce el motor de partido. Recibe un `Strat`, avisa de los cambios y ya.
 */
import { useCallback, useRef, useState } from "react";
import {
  ZONE_COLOR, zoneCenter,
  type Strat, type StratMarker, type TacticalMap,
} from "@/domain/tactics";
import { ROLE_ABBR } from "@/lib/flags";
import { cn } from "@/lib/format";

/**
 * Color de cada rol sobre la pizarra: cinco tonos separables de un vistazo.
 * Las claves son los ids reales de `DUEL_ROLES`, no abreviaturas.
 */
const ROLE_COLOR: Record<string, string> = {
  Duelista: "#ff2e63",
  Controlador: "#19e3ff",
  Iniciador: "#ffd35c",
  Centinela: "#3fc07a",
  Flex: "#a78bfa",
};

export function StrategyBoard({
  map, strat, step, selectedId, onSelect, onMove, className,
}: {
  map: TacticalMap;
  strat: Strat;
  /** Paso visible. Los marcadores de pasos posteriores se atenúan. */
  step: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Mover una ficha. El id de la PUNTA de una flecha es `${markerId}::to`, para que el
   * mismo gesto de arrastre sirva para las dos cosas sin duplicar el manejo del puntero.
   */
  onMove: (id: string, x: number, y: number) => void;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  /**
   * Punto del puntero en coordenadas del mapa (0..100).
   *
   * Se usa la matriz del propio SVG en vez de restar el `getBoundingClientRect`: con
   * `preserveAspectRatio` el lienzo puede tener bandas a los lados, y restar el rectángulo
   * colocaría la ficha desplazada justo en las pantallas estrechas.
   */
  const pointAt = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragging(id);
    onSelect(id);
  };

  const onPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!dragging) return;
    const p = pointAt(e.clientX, e.clientY);
    if (p) onMove(dragging, p.x, p.y);
  };

  const endDrag = () => setDragging(null);

  return (
    <div className={cn("relative overflow-hidden rounded-panel border border-white/12", className)}>
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="block h-auto w-full touch-none select-none"
        role="application"
        aria-label={`Pizarra táctica de ${map.name}`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerDown={() => onSelect(null)}
      >
        <defs>
          <marker
            id="nx-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Fondo del tablero. */}
        <rect x="0" y="0" width="100" height="100" fill="#0a0c15" />
        {/* Rejilla cada 10 unidades: da escala sin competir con las zonas. */}
        {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((g) => (
          <g key={g} stroke="rgba(255,255,255,0.05)" strokeWidth="0.15">
            <line x1={g} y1="0" x2={g} y2="100" />
            <line x1="0" y1={g} x2="100" y2={g} />
          </g>
        ))}

        {/* Zonas. */}
        {map.zones.map((z) => {
          const color = ZONE_COLOR[z.kind];
          const c = zoneCenter(z);
          return (
            <g key={z.id}>
              <polygon
                points={z.polygon.map(([x, y]) => `${x},${y}`).join(" ")}
                fill={color}
                fillOpacity={z.kind === "site" ? 0.16 : z.kind === "choke" ? 0.13 : 0.07}
                stroke={color}
                strokeOpacity={0.45}
                strokeWidth="0.3"
              />
              <text
                x={c.x}
                y={c.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255,255,255,0.42)"
                fontSize={z.kind === "site" ? 3 : 2.2}
                fontWeight="700"
                letterSpacing="0.15"
                style={{ pointerEvents: "none", textTransform: "uppercase" }}
              >
                {z.label}
              </text>
            </g>
          );
        })}

        {/* Flechas de movimiento, DEBAJO de las fichas para que no las tapen. */}
        {strat.markers.map((m) =>
          m.to ? (
            <line
              key={`to-${m.id}`}
              x1={m.x}
              y1={m.y}
              x2={m.to.x}
              y2={m.to.y}
              stroke={markerColor(m)}
              strokeOpacity={m.step > step ? 0.18 : 0.75}
              strokeWidth="0.6"
              strokeDasharray="1.6 1.2"
              markerEnd="url(#nx-arrow)"
              color={markerColor(m)}
              style={{ pointerEvents: "none" }}
            />
          ) : null,
        )}

        {/*
          La PUNTA de cada flecha es un tirador propio. Sin él, el destino de un movimiento
          solo se podría fijar escribiendo coordenadas, que es justo lo que una pizarra
          existe para evitar.
        */}
        {strat.markers.map((m) =>
          m.to ? (
            <TargetHandle
              key={`h-${m.id}`}
              x={m.to.x}
              y={m.to.y}
              color={markerColor(m)}
              dimmed={m.step > step}
              label={`Destino de ${m.label}`}
              onPointerDown={(e) => onPointerDown(e, `${m.id}::to`)}
              onMove={(dx, dy) => onMove(`${m.id}::to`, m.to!.x + dx, m.to!.y + dy)}
            />
          ) : null,
        )}

        {/* Fichas. */}
        {strat.markers.map((m) => (
          <Marker
            key={m.id}
            marker={m}
            dimmed={m.step > step}
            selected={selectedId === m.id}
            onPointerDown={(e) => onPointerDown(e, m.id)}
            onMove={(dx, dy) => onMove(m.id, m.x + dx, m.y + dy)}
          />
        ))}
      </svg>
    </div>
  );
}

function markerColor(m: StratMarker): string {
  if (m.kind === "player") return ROLE_COLOR[m.role ?? ""] ?? "#ffffff";
  if (m.kind === "utility") return "#ffd35c";
  return "#8b96a3";
}

function Marker({
  marker, dimmed, selected, onPointerDown, onMove,
}: {
  marker: StratMarker;
  dimmed: boolean;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onMove: (dx: number, dy: number) => void;
}) {
  const color = markerColor(marker);
  const r = marker.kind === "player" ? 3.2 : 2.4;

  /** Las flechas mueven la ficha de 2 en 2; con Shift, de 0,5 en 0,5 para afinar. */
  const onKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
    const d = e.shiftKey ? 0.5 : 2;
    const map: Record<string, [number, number]> = {
      ArrowUp: [0, -d], ArrowDown: [0, d], ArrowLeft: [-d, 0], ArrowRight: [d, 0],
    };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    onMove(delta[0], delta[1]);
  };

  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={`${marker.label} en ${Math.round(marker.x)}, ${Math.round(marker.y)}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="cursor-grab outline-none focus-visible:opacity-100"
      opacity={dimmed ? 0.28 : 1}
      style={{ transition: "opacity 200ms" }}
    >
      {selected && (
        <circle cx={marker.x} cy={marker.y} r={r + 1.6} fill="none" stroke={color} strokeWidth="0.5" strokeOpacity="0.9" />
      )}
      {marker.kind === "note" ? (
        <rect
          x={marker.x - r}
          y={marker.y - r}
          width={r * 2}
          height={r * 2}
          rx="0.6"
          fill="#0a0c15"
          stroke={color}
          strokeWidth="0.5"
        />
      ) : (
        <circle cx={marker.x} cy={marker.y} r={r} fill="#0a0c15" stroke={color} strokeWidth="0.6" />
      )}
      <text
        x={marker.x}
        y={marker.y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={marker.kind === "player" ? 2.4 : 1.9}
        fontWeight="700"
        style={{ pointerEvents: "none" }}
      >
        {marker.kind === "player"
          ? ROLE_ABBR[marker.role ?? ""] ?? marker.role
          : marker.label.slice(0, 2).toUpperCase()}
      </text>
    </g>
  );
}

/**
 * Tirador del final de una flecha. Es más pequeño que una ficha y va hueco a propósito:
 * se tiene que leer como «el sitio al que va», no como «alguien que está ahí».
 */
function TargetHandle({
  x, y, color, dimmed, label, onPointerDown, onMove,
}: {
  x: number;
  y: number;
  color: string;
  dimmed: boolean;
  label: string;
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
  onMove: (dx: number, dy: number) => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent<SVGGElement>) => {
    const d = e.shiftKey ? 0.5 : 2;
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [0, -d], ArrowDown: [0, d], ArrowLeft: [-d, 0], ArrowRight: [d, 0],
    };
    const delta = deltas[e.key];
    if (!delta) return;
    e.preventDefault();
    onMove(delta[0], delta[1]);
  };

  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="cursor-grab outline-none"
      opacity={dimmed ? 0.25 : 0.9}
    >
      {/* Área de agarre invisible: 2,2 unidades de radio son ~7 px en un móvil. */}
      <circle cx={x} cy={y} r="3.4" fill="transparent" />
      <circle cx={x} cy={y} r="1.7" fill="none" stroke={color} strokeWidth="0.5" strokeDasharray="0.9 0.7" />
    </g>
  );
}
