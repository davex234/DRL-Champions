"use client";

/**
 * EL TABLERO DEL PARTIDO SOBRE EL MAPA REAL (Fase 51.1) — CON NAVEGACIÓN REAL (Fase 51.2).
 *
 * Pinta un `RenderFrame` del visualizador encima de UNO de los doce assets canónicos (el mismo
 * `<image>` que la pizarra, «Mapas» y el teatro). Toda la geometría sale del dominio
 * (`domain/tactics/matchMap.ts` + `navigation/`): aquí no se calcula ninguna ruta, solo se dibuja.
 *
 *   · POSICIONES: un `NavTracker` por jugador (dominio) — la ficha está SOBRE la trayectoria válida de
 *     su tramo y, si el tramo del motor cambia, llega hasta él POR EL GRAFO con velocidad acotada: ni
 *     saltos entre pasillos ni rectas a través de las paredes.
 *   · RUTAS: `plannedRoute` — la polilínea por los waypoints hasta el destino que ha fijado el motor,
 *     solo para tu equipo (discreta) y más marcada para el jugador en foco. Sin ruta → no se dibuja.
 *   · ENFRENTAMIENTOS: una mira sobre el rival al que se dispara. Ya NO una recta tirador→objetivo,
 *     que cruzaba el mapa por encima de las paredes.
 *
 * No depende del movimiento reducido: con `prefers-reduced-motion` la geometría es la MISMA (las
 * fichas saltan de fotograma en fotograma del motor igual que antes, siempre sobre la ruta).
 * `mapId` fuera del catálogo → `requireMatchMap` lanza. Nunca un mapa genérico.
 */
import { useRef } from "react";
import { mapImageSrc } from "@/lib/assets";
import { NavTracker } from "@/domain/tactics/navigation/tracker";
import {
  requireMatchMap, projectSimPoint, toMapPixels, matchViewBox, plannedRoute, nodePoint, type Pt,
} from "@/domain/tactics/matchMap";
import type { RenderFrame, RenderEntity } from "@/visualizer";
import type { RoundState } from "@/sim";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("coach");

const ATK = "#ff3b5c";
const DEF = "#19e3ff";
const ROLE_TAG: Record<string, string> = { entry: "E", igl: "★", lurk: "L", anchor: "A", support: "S" };

export function MapMatchBoard({ frame, mapId, snap, className }: {
  frame: RenderFrame;
  mapId: string;
  /** El estado de la ronda: con él se dibujan las rutas previstas (destino que fijó el motor). */
  snap?: RoundState | null;
  className?: string;
}) {
  useLocale();
  const map = requireMatchMap(mapId);
  const vb = matchViewBox(map);
  /* Una unidad de dibujo proporcional al encuadre: las fichas miden lo mismo en los doce mapas. */
  const U = vb.w / 44;
  const px = (p: Pt) => toMapPixels(map, projectSimPoint(map.id, p));
  /* Un tracker por jugador y mapa; el tick del motor manda (ronda nueva = tick menor → se recolocan). */
  const trackers = useRef(new Map<string, NavTracker>());
  const tick = snap?.tick ?? 0;
  const ficha = (id: string, sim: Pt): Pt => {
    const k = `${map.id}:${id}`;
    let tr = trackers.current.get(k);
    if (!tr) { tr = new NavTracker(map.id); trackers.current.set(k, tr); }
    return toMapPixels(map, tr.update(sim, tick));
  };
  /* Primero se avanzan los trackers (posición visual de cada ficha viva); luego se dibujan las rutas desde ahí. */
  const posiciones = new Map<string, Pt>();
  for (const e of frame.entities) if (e.type === "player" && e.state !== "dead") posiciones.set(e.id, ficha(e.id, e.transform.position));
  const plantC = toMapPixels(map, nodePoint(map.id, "plant"));
  const focusId = frame.entities.find((e) => e.effects.some((f) => f.kind === "focus"))?.id ?? null;

  /* Objetivos de disparo (quién apunta a quién): se marca al rival, sin cruzar el mapa con una recta. */
  const apuntados = new Set<string>();
  for (const p of snap?.players ?? []) if (p.alive && p.targetEnemyId) apuntados.add(p.targetEnemyId);

  const rutas = (snap?.players ?? [])
    .filter((p) => p.alive && p.side === snap?.coachSide)
    .map((p) => ({ id: p.id, r: plannedRoute(map.id, p.pos, p.targetZone, trackers.current.get(`${map.id}:${p.id}`)?.segment()), foco: p.id === focusId }))
    .filter((x) => x.r.ok);

  return (
    <svg
      data-testid="match-map"
      data-map-id={map.id}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={className ?? "h-full w-full"}
      role="img"
      aria-label={t("Partido en {name}", { name: td(map.name) })}
    >
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#05080f" />
      {/* EL MAPA: el asset canónico, entero y sin escalar de forma permanente. */}
      <image href={mapImageSrc(map.asset)} x={0} y={0} width={map.width} height={map.height} preserveAspectRatio="none" />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#04070d" opacity={0.18} />

      {/* Zona de plant: el nodo real del sitio en juego. */}
      <circle cx={plantC.x} cy={plantC.y} r={U * 2.2} fill="#ffce4f10" stroke="#ffce4f66" strokeWidth={U * 0.12} strokeDasharray={`${U * 0.5} ${U * 0.4}`} />

      {/* RUTAS PREVISTAS: la polilínea por los waypoints del grafo, nunca inicio → destino en recta. */}
      <g data-layer="routes" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {rutas.map(({ id, r, foco }) => r.ok && (
          <polyline
            key={id}
            data-route={id}
            points={r.points.map((q) => { const m = toMapPixels(map, { x: q[0], y: q[1] }); return `${m.x.toFixed(1)},${m.y.toFixed(1)}`; }).join(" ")}
            stroke={foco ? "#ffce4f" : "#2fe0ff"}
            strokeOpacity={foco ? 0.9 : 0.35}
            strokeWidth={U * (foco ? 0.22 : 0.12)}
            strokeDasharray={foco ? undefined : `${U * 0.45} ${U * 0.35}`}
          />
        ))}
      </g>

      {frame.effects.map((e, i) => {
        if ((e.kind === "plant" || e.kind === "defuse") && e.at) {
          const c = px(e.at);
          return <circle key={i} cx={c.x} cy={c.y} r={U * 1.3} fill="none" stroke={e.kind === "plant" ? ATK : DEF} strokeWidth={U * 0.28}
            strokeDasharray={`${(e.progress ?? 0) * 100} 100`} pathLength={100} />;
        }
        return null;
      })}

      {frame.entities.map((e) => (
        <Entity key={e.id} e={e} U={U} px={px} at={posiciones.get(e.id) ?? null} apuntado={apuntados.has(e.id)} />
      ))}
    </svg>
  );
}

function Entity({ e, U, px, at, apuntado }: { e: RenderEntity; U: number; px: (p: Pt) => Pt; at: Pt | null; apuntado: boolean }) {
  useLocale();
  const p = at ?? px(e.transform.position);
  if (e.type === "spike") {
    return (
      <g data-entity="spike">
        <circle cx={p.x} cy={p.y} r={U * 1.2} fill="#ffce4f33" />
        <rect x={p.x - U * 0.55} y={p.y - U * 0.55} width={U * 1.1} height={U * 1.1} rx={U * 0.15} fill="#ffce4f" stroke="#000" strokeWidth={U * 0.08} />
      </g>
    );
  }
  if (e.type !== "player") return null;
  const color = e.team === "ATK" ? ATK : DEF;
  const has = (k: string) => e.effects.some((f) => f.kind === k);

  if (e.state === "dead") {
    return (
      <g opacity={0.45} data-entity="player-dead">
        <circle cx={p.x} cy={p.y} r={U * 0.6} fill="#05080f" stroke={color} strokeWidth={U * 0.08} strokeDasharray={`${U * 0.15} ${U * 0.15}`} />
        <text x={p.x} y={p.y + U * 0.3} textAnchor="middle" fontSize={U * 0.9} fill={color}>✕</text>
      </g>
    );
  }
  /* La orientación también se proyecta: punta = posición + 20 unidades de simulación hacia donde mira. */
  const base = px(e.transform.position);
  const tip = px({ x: e.transform.position.x + Math.cos(e.transform.rotation) * 20, y: e.transform.position.y + Math.sin(e.transform.rotation) * 20 });
  const ang = Math.atan2(tip.y - base.y, tip.x - base.x);
  const focus = has("focus");
  return (
    <g data-entity="player">
      <circle cx={p.x} cy={p.y} r={U * (focus ? 1.5 : 1.15)} fill={color} opacity={focus ? 0.3 : 0.18} />
      <line x1={p.x} y1={p.y} x2={p.x + Math.cos(ang) * U * 1.5} y2={p.y + Math.sin(ang) * U * 1.5} stroke={color} strokeWidth={U * 0.22} strokeLinecap="round" />
      {has("coached") && <circle cx={p.x} cy={p.y} r={U * 1.05} fill="none" stroke="#ffce4f" strokeWidth={U * 0.14} />}
      <circle cx={p.x} cy={p.y} r={U * 0.72} fill={color} stroke="#05080d" strokeWidth={U * 0.14} />
      {has("flash") && <circle cx={p.x} cy={p.y} r={U * 0.95} fill="#ffffffcc" />}
      {apuntado && (
        <g data-entity="targeted" stroke="#fff" strokeOpacity={0.85} strokeWidth={U * 0.1} fill="none">
          <circle cx={p.x} cy={p.y} r={U * 1.45} />
          <path d={`M${p.x - U * 1.9},${p.y}h${U * 0.6}M${p.x + U * 1.3},${p.y}h${U * 0.6}M${p.x},${p.y - U * 1.9}v${U * 0.6}M${p.x},${p.y + U * 1.3}v${U * 0.6}`} />
        </g>
      )}
      <text x={p.x} y={p.y + U * 0.28} textAnchor="middle" fontSize={U * 0.8} fontWeight={800} fill="#05080d">{td(ROLE_TAG[e.role ?? ""]) ?? "?"}</text>
      <text x={p.x} y={p.y - U * 1.25} textAnchor="middle" fontSize={U * 0.72} fontWeight={focus ? 800 : 600}
        fill="#fff" fillOpacity={focus ? 1 : 0.8} stroke="#05080d" strokeWidth={U * 0.2} paintOrder="stroke">{td(e.label)}</text>
    </g>
  );
}
