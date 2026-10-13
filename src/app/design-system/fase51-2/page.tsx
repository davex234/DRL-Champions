"use client";

/**
 * ARNÉS QA · FASE 51.2 — `/design-system/fase51-2?map=<id>&scene=<path|wall|debug>` (solo revisión y capturas).
 *
 * Herramienta interna, fuera de la navegación del producto (como el resto de `/design-system/*`):
 *   · path  — una ruta significativa del mapa (spawn atacante → heaven, cruzando el sitio): INICIO → RUTA → DESTINO.
 *   · wall  — el par de nodos más cercano en línea recta cuya recta atraviesa geometría (medido sobre el
 *             grafo generado): se dibuja la recta prohibida (discontinua roja) y la ruta real que la rodea.
 *   · debug — el grafo entero: nodos con su id, aristas con sus waypoints.
 *
 * Todo sale del dominio (`getNavPath`, `NAV_GRAPHS`); aquí solo se dibuja. Nada se envía ni se escribe.
 */
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { mapImageSrc } from "@/lib/assets";
import { getNavPath, isMatchMapId, matchMaps, navGraph, requireMatchMap } from "@/domain/tactics/matchMap";
import type { NavPoint } from "@/domain/tactics/navigation/types";
import { WALL_CASES } from "./wallCases";

export default function Fase512Harness() {
  return <Suspense fallback={null}><Harness /></Suspense>;
}

function Harness() {
  const params = useSearchParams();
  const mapId = isMatchMapId(params.get("map")) ? (params.get("map") as string) : "ascent";
  const scene = (params.get("scene") ?? "path") as "path" | "wall" | "debug";
  const map = requireMatchMap(mapId);
  const g = navGraph(mapId);
  const P = (p: NavPoint) => `${(p[0] * map.width).toFixed(1)},${(p[1] * map.height).toFixed(1)}`;
  const pos = useMemo(() => new Map(g.nodes.map((n) => [n.id, [n.x, n.y] as NavPoint])), [g]);

  const par = scene === "wall" ? (WALL_CASES[mapId] ?? ["atk_spawn", "heaven"]) : ["atk_spawn", "heaven"];
  const ruta = getNavPath(mapId, par[0], par[1]);
  const U = map.width / 90;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-[#04070d] text-white" data-testid="nav-harness" data-map={mapId} data-scene={scene}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-2 text-[12px]">
        <b className="font-display text-[15px] uppercase tracking-[0.2em] text-[#2fe0ff]">Navegación · {map.name}</b>
        <span className="text-white/60">{scene === "debug" ? `${g.nodes.length} nodos · ${g.edges.length} aristas · ${g.edges.reduce((s, e) => s + e.waypoints.length, 0)} waypoints`
          : ruta.ok ? `${par[0]} → ${par[1]} · ${ruta.nodes.length} nodos · ${ruta.points.length - ruta.nodes.length} waypoints` : `sin ruta (${ruta.reason})`}</span>
        <nav className="ml-auto flex flex-wrap gap-1">
          {matchMaps().map((m) => <a key={m.id} href={`?map=${m.id}&scene=${scene}`} className={m.id === mapId ? "text-[#2fe0ff]" : "text-white/40"}>{m.name}</a>)}
        </nav>
      </header>
      <svg viewBox={`0 0 ${map.width} ${map.height}`} preserveAspectRatio="xMidYMid meet" className="min-h-0 flex-1">
        <image href={mapImageSrc(map.asset)} x={0} y={0} width={map.width} height={map.height} />
        {scene === "debug" && g.edges.map((e) => {
          const pts = [pos.get(e.from)!, ...e.waypoints, pos.get(e.to)!];
          return (
            <g key={`${e.from}-${e.to}`}>
              <polyline points={pts.map(P).join(" ")} fill="none" stroke="#2fe0ff" strokeOpacity={0.8} strokeWidth={U * 0.25} />
              {e.waypoints.map((w, i) => <circle key={i} cx={w[0] * map.width} cy={w[1] * map.height} r={U * 0.35} fill="#ffce4f" />)}
            </g>
          );
        })}
        {scene === "wall" && ruta.ok && (
          <line x1={pos.get(par[0])![0] * map.width} y1={pos.get(par[0])![1] * map.height} x2={pos.get(par[1])![0] * map.width} y2={pos.get(par[1])![1] * map.height}
            stroke="#ff3b5c" strokeWidth={U * 0.3} strokeDasharray={`${U} ${U * 0.7}`} data-testid="forbidden-straight" />
        )}
        {scene !== "debug" && ruta.ok && (
          <g data-testid="nav-route">
            <polyline points={ruta.points.map(P).join(" ")} fill="none" stroke="#2fe0ff" strokeWidth={U * 0.5} strokeLinejoin="round" strokeLinecap="round" />
            {ruta.points.slice(1, -1).map((w, i) => <circle key={i} cx={w[0] * map.width} cy={w[1] * map.height} r={U * 0.45} fill="#ffce4f" />)}
            {[["INICIO", ruta.points[0], "#3fd696"], ["DESTINO", ruta.points[ruta.points.length - 1], "#ff2e8c"]].map(([t, p, c]) => (
              <g key={t as string}>
                <circle cx={(p as NavPoint)[0] * map.width} cy={(p as NavPoint)[1] * map.height} r={U * 1.3} fill={c as string} stroke="#000" strokeWidth={U * 0.2} />
                <text x={(p as NavPoint)[0] * map.width} y={(p as NavPoint)[1] * map.height - U * 2} textAnchor="middle" fontSize={U * 1.6} fontWeight={800} fill="#fff" stroke="#000" strokeWidth={U * 0.35} paintOrder="stroke">{t as string}</text>
              </g>
            ))}
          </g>
        )}
        {g.nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x * map.width} cy={n.y * map.height} r={U * 0.7} fill="#ff2e8c" stroke="#000" strokeWidth={U * 0.15} />
            {scene === "debug" && <text x={n.x * map.width + U} y={n.y * map.height + U * 0.4} fontSize={U * 1.1} fill="#fff" stroke="#000" strokeWidth={U * 0.25} paintOrder="stroke">{n.id}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
