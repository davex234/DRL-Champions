"use client";

/**
 * PIZARRA TÁCTICA — las capas de interacción sobre el mapa.
 *
 * ────────────────────────── EL ORDEN DE LAS CAPAS ──────────────────────────
 *
 *     ANOTACIONES        ← lo último que se lee, lo primero que se ve
 *     DIBUJOS            ← flechas, zonas, trazos
 *     UTILIDADES         ← humo, destello, muro…
 *     JUGADORES          ← las cinco fichas
 *     MAPA PNG           ← capa visual base, intocable
 *
 * En SVG se pinta en el orden del documento, así que ese es literalmente el orden en el
 * que están escritos los `<g>` de abajo. **Todos viven dentro del mismo `<svg>` y comparten
 * `viewBox`**, que es lo que hace imposible una desalineación: al hacer zoom no hay dos
 * sistemas de coordenadas que sincronizar, hay uno.
 *
 * ────────────────────────── EL PNG NO SE TOCA ──────────────────────────
 *
 * Ninguna herramienta de esta pizarra escribe en la imagen. Las capas son hermanas del
 * `<image>`, no filtros ni máscaras sobre él. Borrar todo lo dibujado deja el asset
 * exactamente como estaba.
 *
 * ────────────────────────── COORDENADAS ──────────────────────────
 *
 * El dominio guarda 0..100. Aquí se convierte a píxeles del PNG con `toPixels`, porque el
 * `viewBox` está en píxeles del PNG. La medida `U` —una centésima de la anchura del mapa—
 * dimensiona fichas y grosores para que se vean igual de grandes en Corrode que en Lotus.
 *
 * ────────────────────────── ACCESIBILIDAD ──────────────────────────
 *
 * Cada ficha es enfocable y las flechas la mueven de una unidad en una. Una pizarra que
 * solo funciona arrastrando deja fuera a quien no puede arrastrar.
 */
import { useCallback, useState } from "react";
import {
  toPixels, ROLE_COLOR, UTILITY_COLOR, UTILITY_LABEL,
  type TacticalMap, type StepState, type Point,
  type UtilityKind, type DrawKind, type DrawColor, type Drawing,
} from "@/domain/tactics";
import type { RoleId } from "@/domain/cards/types";
import { ROLE_ABBR } from "@/lib/flags";
import { AgentEmblemGlyph, agentById } from "./AgentEmblem";
import { AgentFaceSvg } from "@/components/agents/AgentArt";
import { MapCanvas, type Camera } from "./MapCanvas";
import { UtilityGlyph } from "./UtilityGlyph";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("tactics");

/** Qué hace el siguiente clic sobre el mapa. */
export type Tool =
  | { kind: "select" }
  | { kind: "player"; role: RoleId }
  | { kind: "utility"; utility: UtilityKind }
  | { kind: "draw"; draw: DrawKind; color: DrawColor }
  | { kind: "text"; text: string };

export interface BoardActions {
  onMove: (id: string, x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onPlacePlayer: (role: RoleId, x: number, y: number) => void;
  onPlaceUtility: (kind: UtilityKind, x: number, y: number) => void;
  onPlaceText: (text: string, x: number, y: number) => void;
  onDraw: (kind: DrawKind, color: DrawColor, points: Point[]) => void;
}

export function StrategyBoard({
  map, state, camera, onCamera, tool, selectedId, actions, readOnly = false, className,
}: {
  map: TacticalMap;
  state: StepState;
  camera: Camera;
  onCamera: (c: Camera) => void;
  tool: Tool;
  selectedId: string | null;
  actions: BoardActions;
  readOnly?: boolean;
  className?: string;
}) {
  useLocale();
  /** Una centésima de la anchura del mapa: la unidad con la que se dimensiona todo. */
  const U = map.width / 100;
  const [draft, setDraft] = useState<Point[] | null>(null);

  const px = useCallback((p: { x: number; y: number }) => toPixels(map, p.x, p.y), [map]);

  /*
   * ARRANQUE DE UN TRAZO.
   *
   * Los oyentes van en `window`, no en un nodo del SVG. La primera versión colgaba el
   * `pointermove` de un `<rect>` que solo se montaba DESPUÉS del `pointerdown`, y con la
   * captura del puntero ya tomada por el `<svg>` ese rectángulo no recibía ni un evento:
   * dibujar producía siempre una forma de dos puntos idénticos, o sea un punto. Se vio en
   * la primera captura del editor.
   */
  const comenzarTrazo = useCallback((inicio: Point, e: React.PointerEvent) => {
    if (tool.kind !== "draw") return;
    const kind = tool.draw;
    const color = tool.color;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    const punto = svg.createSVGPoint();
    let puntos: Point[] = [inicio, inicio];
    setDraft(puntos);

    const aRejilla = (cx: number, cy: number): Point | null => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      punto.x = cx;
      punto.y = cy;
      const q = punto.matrixTransform(ctm.inverse());
      return { x: (q.x / map.width) * 100, y: (q.y / map.height) * 100 };
    };

    const mover = (ev: PointerEvent) => {
      const g = aRejilla(ev.clientX, ev.clientY);
      if (!g) return;
      if (kind === "free" || kind === "zone") {
        const ultimo = puntos[puntos.length - 1];
        // Se simplifica al vuelo: un trazo a mano alzada son miles de eventos.
        if (Math.hypot(ultimo.x - g.x, ultimo.y - g.y) < 0.8) return;
        puntos = [...puntos, g];
      } else {
        puntos = [puntos[0], g];
      }
      setDraft(puntos);
    };

    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
      // Un trazo que no se ha movido es un clic, no un dibujo: no se guarda.
      const largo = Math.hypot(
        puntos[puntos.length - 1].x - puntos[0].x,
        puntos[puntos.length - 1].y - puntos[0].y,
      );
      if (puntos.length >= 2 && largo >= 1) actions.onDraw(kind, color, puntos);
      setDraft(null);
    };

    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
  }, [tool, map.width, map.height, actions]);

  return (
    <MapCanvas
      map={map}
      camera={camera}
      onCamera={onCamera}
      className={className}
      /* En presentación el mando de cámara se apaga hasta que se le acerca el puntero. */
      quietControls={readOnly}
      cursor={readOnly ? "default" : tool.kind === "select" ? undefined : "crosshair"}
      onBackgroundDown={(grid, e) => {
        if (readOnly) return false;

        if (tool.kind === "player") { actions.onPlacePlayer(tool.role, grid.x, grid.y); return true; }
        if (tool.kind === "utility") { actions.onPlaceUtility(tool.utility, grid.x, grid.y); return true; }
        if (tool.kind === "text") { actions.onPlaceText(tool.text, grid.x, grid.y); return true; }

        if (tool.kind === "draw") { comenzarTrazo(grid, e); return true; }

        // Herramienta de selección: pulsar el fondo deselecciona, y el arrastre hace pan.
        actions.onSelect(null);
        return false;
      }}
    >
      {/*
        ═══════════ CAPA 0 · DIBUJOS GUARDADOS ═══════════

        DEBAJO de fichas y utilidades, a propósito. En SVG gana el clic lo último que se pinta, y
        cada flecha o línea lleva una zona de agarre invisible de 2,4 U —el radio de una ficha—:
        encima de las fichas, una flecha que empezaba sobre una ficha se quedaba con su clic y la
        ficha no se podía ni seleccionar ni arrastrar (lo mismo dentro de una zona o un rectángulo,
        que tienen relleno). Por debajo, la ficha gana donde está y la flecha sigue pulsándose en
        todo su tramo libre. El trazo que se está dibujando sigue encima (capa 3).
      */}
      <g>
        {state.drawings.map((d) => (
          <Shape
            key={d.id} d={d} map={map} U={U}
            selected={selectedId === d.id}
            onDown={readOnly ? undefined : (e) => beginDrag(e, d.id, actions, readOnly, true)}
          />
        ))}
      </g>

      {/* ═══════════ CAPA 1 · JUGADORES ═══════════ */}
      <g>
        {state.players.map((p) => {
          const c = px(p);
          const color = ROLE_COLOR[p.role] ?? "#ffffff";
          const on = selectedId === p.id;
          /*
           * EL AGENTE, si lo tiene. Se lee del catálogo real por su `id`; una ficha sin agente
           * —o con uno que ya no existe— sigue enseñando su rol, que es como funcionaba la
           * pizarra antes de que las fichas pudieran llevar agente.
           */
          const agente = agentById(p.agentId);
          return (
            <g key={p.id}>
              {p.to && <Arrow from={c} to={px(p.to)} color={color} U={U} />}
              <Token
                cx={c.px} cy={c.py} r={2.4 * U} color={color} selected={on}
                label={td(ROLE_ABBR[p.role]) ?? p.role.slice(0, 2)} U={U}
                agentId={p.agentId}
                title={agente ? `${p.label} · ${agente.name} (${p.role})` : `${p.label} (${p.role})`}
                onDown={(e) => beginDrag(e, p.id, actions, readOnly)}
                onKey={(e) => keyMove(e, p.id, p, actions)}
              />
              {/* El nombre del agente, colgado bajo la ficha: identifica sin taparla. */}
              {agente && (
                <text
                  x={c.px}
                  y={c.py + 4.1 * U}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  style={{
                    fill: color,
                    fontSize: 1.7 * U,
                    fontWeight: 700,
                    letterSpacing: 0.1 * U,
                    paintOrder: "stroke",
                    stroke: "rgba(4,6,11,0.9)",
                    strokeWidth: 0.5 * U,
                  }}
                >
                  {agente.name.toUpperCase()}
                </text>
              )}
              {p.to && !readOnly && (
                <Handle cx={px(p.to).px} cy={px(p.to).py} r={1.2 * U} color={color}
                  onDown={(e) => beginDrag(e, `${p.id}::to`, actions, readOnly)} />
              )}
            </g>
          );
        })}
      </g>

      {/* ═══════════ CAPA 2 · UTILIDADES ═══════════ */}
      <g>
        {state.utilities.map((u) => {
          const c = px(u);
          const color = UTILITY_COLOR[u.kind];
          const on = selectedId === u.id;
          return (
            <g key={u.id}>
              {u.to && <Arrow from={px(u.to)} to={c} color={color} U={U} dashed />}
              <g
                transform={`translate(${c.px} ${c.py})`}
                tabIndex={readOnly ? -1 : 0}
                role={readOnly ? undefined : "button"}
                aria-label={td(UTILITY_LABEL[u.kind])}
                onPointerDown={(e) => beginDrag(e, u.id, actions, readOnly)}
                onKeyDown={(e) => keyMove(e, u.id, u, actions)}
                style={{ cursor: readOnly ? "default" : "grab", outline: "none" }}
              >
                <circle r={2.1 * U} fill="#0b0f18" fillOpacity={0.82}
                  stroke={color} strokeWidth={(on ? 0.45 : 0.28) * U} />
                <g transform={`scale(${U * 0.16})`} color={color}>
                  <UtilityGlyph kind={u.kind} />
                </g>
              </g>
              {u.to && !readOnly && (
                <Handle cx={px(u.to).px} cy={px(u.to).py} r={1.1 * U} color={color}
                  onDown={(e) => beginDrag(e, `${u.id}::to`, actions, readOnly)} />
              )}
            </g>
          );
        })}
      </g>

      {/* ═══════════ CAPA 3 · TRAZO EN CURSO (encima de todo mientras se dibuja) ═══════════ */}
      <g>
        {draft && draft.length >= 2 && tool.kind === "draw" && (
          <Shape
            d={{ id: "draft", kind: tool.draw, color: tool.color, points: draft }}
            map={map} U={U} selected={false} preview
          />
        )}
      </g>

      {/* ═══════════ CAPA 4 · ANOTACIONES ═══════════ */}
      <g>
        {state.annotations.map((a) => {
          const c = px(a);
          const on = selectedId === a.id;
          const ancho = Math.min(44, Math.max(6, a.text.length * 1.15)) * U;
          return (
            <g
              key={a.id}
              transform={`translate(${c.px} ${c.py})`}
              tabIndex={readOnly ? -1 : 0}
              role={readOnly ? undefined : "button"}
              aria-label={t("Nota: {text}", { text: td(a.text) })}
              onPointerDown={(e) => beginDrag(e, a.id, actions, readOnly)}
              onKeyDown={(e) => keyMove(e, a.id, a, actions)}
              style={{ cursor: readOnly ? "default" : "grab", outline: "none" }}
            >
              <rect
                x={-ancho / 2} y={-1.5 * U} width={ancho} height={3 * U} rx={0.6 * U}
                fill="#0b0f18" fillOpacity={0.88}
                stroke={on ? "#ffd35c" : "rgba(255,255,255,0.28)"} strokeWidth={(on ? 0.4 : 0.22) * U}
              />
              <text
                x={0} y={0} textAnchor="middle" dominantBaseline="central"
                fill="#ffffff" fontSize={1.7 * U} fontWeight={600}
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {td(a.text)}
              </text>
            </g>
          );
        })}
      </g>

    </MapCanvas>
  );
}

/* ─────────────────────────────── Piezas ─────────────────────────────── */

/**
 * Arrastre de cualquier objeto.
 *
 * Los oyentes se enganchan a `window`, no al nodo: en cuanto el dedo se sale de una ficha
 * de 24 px —que en un móvil es siempre— el nodo deja de recibir eventos y el arrastre se
 * queda a medias. Con `setPointerCapture` y `window` el gesto sigue hasta que se suelta.
 *
 * El `id` con sufijo `::to` mueve la PUNTA de la flecha en vez de la ficha, así que el
 * mismo código sirve para las dos cosas.
 */
function beginDrag(
  e: React.PointerEvent,
  id: string,
  actions: BoardActions,
  readOnly: boolean,
  soloSeleccionar = false,
): void {
  if (readOnly) return;
  e.stopPropagation();
  actions.onSelect(id.replace(/::to$/, ""));
  if (soloSeleccionar) return;

  const svg = (e.currentTarget as SVGElement).ownerSVGElement;
  if (!svg) return;

  const punto = svg.createSVGPoint();
  const aRejilla = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    punto.x = clientX;
    punto.y = clientY;
    const q = punto.matrixTransform(ctm.inverse());
    const vb = svg.viewBox.baseVal;
    void vb;
    return { x: q.x, y: q.y };
  };

  // El tamaño real del PNG sale del `<image>`: es la única capa que lo conoce sin props.
  const img = svg.querySelector("image");
  const W = Number(img?.getAttribute("width") ?? 0);
  const H = Number(img?.getAttribute("height") ?? 0);
  if (!W || !H) return;

  const mover = (ev: PointerEvent) => {
    const p = aRejilla(ev.clientX, ev.clientY);
    if (!p) return;
    actions.onMove(id, (p.x / W) * 100, (p.y / H) * 100);
  };
  const soltar = () => {
    window.removeEventListener("pointermove", mover);
    window.removeEventListener("pointerup", soltar);
    window.removeEventListener("pointercancel", soltar);
  };
  window.addEventListener("pointermove", mover);
  window.addEventListener("pointerup", soltar);
  window.addEventListener("pointercancel", soltar);
}

function keyMove(
  e: React.KeyboardEvent,
  id: string,
  pos: { x: number; y: number },
  actions: BoardActions,
): void {
  const paso = e.shiftKey ? 5 : 1;
  const d: Record<string, [number, number]> = {
    ArrowUp: [0, -paso], ArrowDown: [0, paso], ArrowLeft: [-paso, 0], ArrowRight: [paso, 0],
  };
  const mv = d[e.key];
  if (!mv) return;
  e.preventDefault();
  actions.onMove(id, pos.x + mv[0], pos.y + mv[1]);
}

/**
 * LA FICHA DE UN JUGADOR SOBRE EL MAPA.
 *
 * Era un círculo con DOS LETRAS (la abreviatura del rol). Con cinco fichas en un mapa eso obliga a
 * leer para saber quién es quién, y encima las abreviaturas de rol se repiten: dos duelistas eran
 * dos círculos idénticos. Ahora, cuando la ficha tiene agente asignado, dentro va su EMBLEMA —una
 * marca original, dibujada en `AgentEmblem`—, y la abreviatura de rol sólo se usa como respaldo
 * para las fichas que todavía no tienen agente (las jugadas antiguas siguen abriéndose igual).
 */
function Token({
  cx, cy, r, color, label, selected, U, title, agentId, onDown, onKey,
}: {
  cx: number; cy: number; r: number; color: string; label: string;
  selected: boolean; U: number; title: string;
  /** Si la ficha tiene agente, manda su emblema sobre la abreviatura de rol. */
  agentId?: string;
  onDown: (e: React.PointerEvent) => void;
  onKey: (e: React.KeyboardEvent) => void;
}) {
  useLocale();
  return (
    <g
      transform={`translate(${cx} ${cy})`}
      tabIndex={0}
      role="button"
      aria-label={td(title)}
      onPointerDown={onDown}
      onKeyDown={onKey}
      style={{ cursor: "grab", outline: "none" }}
    >
      <title>{td(title)}</title>
      {/*
        FASE 51 · la ficha es una pieza sobre el plano, no un círculo plano: sombra en el suelo, halo
        del color del rol y anillo interior. Solo presentación: el centro y el radio no cambian, así
        que las coordenadas guardadas siguen señalando el mismo punto.
      */}
      <ellipse cy={r * 0.78} rx={r * 0.92} ry={r * 0.3} fill="#000" fillOpacity={0.5} style={{ pointerEvents: "none" }} />
      <circle r={r + 0.55 * U} fill={color} fillOpacity={selected ? 0.24 : 0.1} style={{ pointerEvents: "none" }} />
      <circle r={r} fill="#07101f" fillOpacity={0.95} stroke={color} strokeWidth={(selected ? 0.6 : 0.35) * U} />
      <circle r={r - 0.5 * U} fill="none" stroke={color} strokeOpacity={0.3} strokeWidth={0.12 * U} style={{ pointerEvents: "none" }} />
      {selected && <circle r={r + 0.9 * U} fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={0.22 * U} strokeDasharray={`${0.9 * U} ${0.6 * U}`} />}
      {agentId ? (
        /* F59 · la CARA real del agente recortada en la ficha; sin arte (legado), el emblema de siempre. */
        <AgentFaceSvg agentId={agentId} r={r - 0.35 * U} fallback={
          <g style={{ pointerEvents: "none" }}>
            <AgentEmblemGlyph agentId={agentId} size={r * 1.72} />
          </g>
        } />
      ) : (
        <text
          textAnchor="middle" dominantBaseline="central"
          fill={color} fontSize={1.8 * U} fontWeight={700}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {td(label)}
        </text>
      )}
    </g>
  );
}

function Handle({
  cx, cy, r, color, onDown,
}: { cx: number; cy: number; r: number; color: string; onDown: (e: React.PointerEvent) => void }) {
  return (
    <circle
      cx={cx} cy={cy} r={r}
      fill={color} fillOpacity={0.85} stroke="#0b0f18" strokeWidth={r * 0.25}
      onPointerDown={onDown}
      style={{ cursor: "grab" }}
    />
  );
}

function Arrow({
  from, to, color, U, dashed = false,
}: { from: { px: number; py: number }; to: { px: number; py: number }; color: string; U: number; dashed?: boolean }) {
  const dx = to.px - from.px;
  const dy = to.py - from.py;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const cabeza = 1.6 * U;
  // La punta se retrae para que la flecha no se meta dentro del tirador.
  const ex = to.px - ux * cabeza * 0.7;
  const ey = to.py - uy * cabeza * 0.7;

  return (
    <g stroke={color} strokeWidth={0.34 * U} fill="none" strokeLinecap="round">
      <line
        x1={from.px} y1={from.py} x2={ex} y2={ey}
        strokeDasharray={dashed ? `${U} ${U}` : undefined}
        strokeOpacity={0.85}
      />
      <polygon
        points={[
          `${to.px},${to.py}`,
          `${to.px - ux * cabeza + -uy * cabeza * 0.5},${to.py - uy * cabeza + ux * cabeza * 0.5}`,
          `${to.px - ux * cabeza - -uy * cabeza * 0.5},${to.py - uy * cabeza - ux * cabeza * 0.5}`,
        ].join(" ")}
        fill={color}
        stroke="none"
        opacity={0.9}
      />
    </g>
  );
}

/** Una forma dibujada. Traduce sus puntos 0..100 a píxeles del mapa. */
function Shape({
  d, map, U, selected, preview = false, onDown,
}: {
  d: Drawing;
  map: TacticalMap;
  U: number;
  selected: boolean;
  preview?: boolean;
  onDown?: (e: React.PointerEvent) => void;
}) {
  const pts = d.points.map((p) => toPixels(map, p.x, p.y));
  if (pts.length < 2) return null;

  const comun = {
    stroke: d.color,
    strokeWidth: (selected ? 0.6 : 0.38) * U,
    strokeOpacity: preview ? 0.7 : 1,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
    onPointerDown: onDown,
    style: onDown ? { cursor: "pointer" } : undefined,
  };

  const a = pts[0];
  const b = pts[pts.length - 1];

  switch (d.kind) {
    case "arrow":
      return (
        <g {...comun}>
          <Arrow from={a} to={b} color={d.color} U={U} />
          {/* Zona de agarre invisible y gorda: una línea de 0,4 U es imposible de pulsar. */}
          <line x1={a.px} y1={a.py} x2={b.px} y2={b.py} stroke="transparent" strokeWidth={2.4 * U} />
        </g>
      );
    case "line":
      return (
        <g {...comun}>
          <line x1={a.px} y1={a.py} x2={b.px} y2={b.py} />
          <line x1={a.px} y1={a.py} x2={b.px} y2={b.py} stroke="transparent" strokeWidth={2.4 * U} />
        </g>
      );
    case "rect": {
      const x = Math.min(a.px, b.px), y = Math.min(a.py, b.py);
      return (
        <rect
          {...comun}
          x={x} y={y} width={Math.abs(b.px - a.px)} height={Math.abs(b.py - a.py)}
          fill={d.color} fillOpacity={0.1}
        />
      );
    }
    case "circle": {
      const r = Math.hypot(b.px - a.px, b.py - a.py);
      return <circle {...comun} cx={a.px} cy={a.py} r={r} fill={d.color} fillOpacity={0.1} />;
    }
    case "zone":
      return (
        <polygon
          {...comun}
          points={pts.map((p) => `${p.px},${p.py}`).join(" ")}
          fill={d.color} fillOpacity={0.14}
        />
      );
    case "free":
    default:
      return <polyline {...comun} points={pts.map((p) => `${p.px},${p.py}`).join(" ")} />;
  }
}
