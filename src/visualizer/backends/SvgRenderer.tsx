"use client";

/**
 * DRL VISUALIZER — backend SVG (el renderizador ACTUAL).
 *
 * Cumple el contrato `RendererProps`: dibuja un `RenderFrame` y nada más. No conoce
 * la simulación ni el broadcast: solo el frame agnóstico. Estética de "mesa táctica"
 * de retransmisión (rejilla, viñeta, marcadores con glow). Sustituirlo por un backend
 * 3D = otro componente que reciba el mismo `RenderFrame`.
 */
import type { RendererProps } from "../renderer";
import type { RenderEntity, RenderEffect } from "../types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("visualizer");

const ATK = "#ff3b5c";
const DEF = "#19e3ff";
const ROLE_TAG: Record<string, string> = { entry: "E", igl: "★", lurk: "L", anchor: "A", support: "S" };
const teamHex = (t?: string) => (t === "ATK" ? ATK : DEF);
const has = (e: RenderEntity, kind: string) => e.effects.some((f) => f.kind === kind);

export function SvgRenderer({ frame, className }: RendererProps) {
  useLocale();
  const { camera, world, entities, effects } = frame;
  const vb = `${camera.viewBox.x} ${camera.viewBox.y} ${camera.viewBox.w} ${camera.viewBox.h}`;
  const rot = camera.rotation
    ? `rotate(${((camera.rotation * 180) / Math.PI).toFixed(3)} ${camera.center.x} ${camera.center.y})`
    : "";

  return (
    <svg viewBox={vb} className={className ?? "h-full w-full bg-[#070b11]"} preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="#1a2738" strokeWidth="0.6" />
        </pattern>
        <radialGradient id="floor" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stopColor="#101826" />
          <stop offset="100%" stopColor="#070b11" />
        </radialGradient>
      </defs>

      <g transform={rot}>
        {/* Suelo + rejilla táctica */}
        <rect x={0} y={0} width={world.bounds.w} height={world.bounds.h} fill="url(#floor)" />
        <rect x={0} y={0} width={world.bounds.w} height={world.bounds.h} fill="url(#grid)" opacity={0.5} />

        {/* Zonas */}
        {world.zones.map((z) => (
          <text key={z.id} x={z.position.x} y={z.position.y - 18} textAnchor="middle" className="fill-white/15" fontSize={12} fontWeight={600}>{td(z.label)}</text>
        ))}
        {/* Muros */}
        {world.walls.map((w, i) => (
          <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} stroke="#33425a" strokeWidth={6} strokeLinecap="round" />
        ))}
        {/* Zona de plant */}
        <circle cx={world.plant.position.x} cy={world.plant.position.y} r={world.plant.radius} fill="#ffce4f0a" stroke="#ffce4f33" strokeDasharray="6 6" />
        <text x={world.plant.position.x} y={world.plant.position.y + 4} textAnchor="middle" fontSize={10} className="fill-amber-300/30" fontWeight={700}>{tr("SITE")}</text>

        {/* Efectos de escena */}
        {effects.map((e, i) => <Effect key={i} e={e} />)}
        {/* Entidades */}
        {entities.map((e) => <Entity key={e.id} e={e} />)}
      </g>
    </svg>
  );
}

function Effect({ e }: { e: RenderEffect }) {
  if (e.kind === "engagement" && e.from && e.to) {
    return <line x1={e.from.x} y1={e.from.y} x2={e.to.x} y2={e.to.y} stroke="#ffffff18" strokeWidth={1.5} strokeDasharray="2 3" />;
  }
  if (e.kind === "plant" && e.at) {
    return <circle cx={e.at.x} cy={e.at.y} r={16} fill="none" stroke={ATK} strokeWidth={3}
      strokeDasharray={`${(e.progress ?? 0) * 100} 100`} pathLength={100} />;
  }
  if (e.kind === "defuse" && e.at) {
    return <circle cx={e.at.x} cy={e.at.y} r={16} fill="none" stroke={DEF} strokeWidth={3}
      strokeDasharray={`${(e.progress ?? 0) * 100} 100`} pathLength={100} />;
  }
  return null;
}

function Entity({ e }: { e: RenderEntity }) {
  useLocale();
  if (e.type === "spike") {
    const p = e.transform.position;
    return (
      <g>
        <circle cx={p.x} cy={p.y} r={13} fill="#ffce4f22">
          <animate attributeName="r" values="11;16;11" dur="1.1s" repeatCount="indefinite" />
        </circle>
        <rect x={p.x - 7} y={p.y - 7} width={14} height={14} rx={2} fill="#ffce4f" stroke="#000" strokeWidth={1} />
      </g>
    );
  }
  if (e.type !== "player") return null;

  const p = e.transform.position;
  const color = teamHex(e.team);
  if (e.state === "dead") {
    return (
      <g opacity={0.34}>
        <circle cx={p.x} cy={p.y} r={7} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2 2" />
        <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fill={color}>✕</text>
        <text x={p.x} y={p.y + 17} textAnchor="middle" fontSize={7.5} className="fill-white/30">{td(e.label)}</text>
      </g>
    );
  }

  const fx = p.x + Math.cos(e.transform.rotation) * 18;
  const fy = p.y + Math.sin(e.transform.rotation) * 18;
  const focus = has(e, "focus");
  return (
    <g>
      {/* glow de bando */}
      <circle cx={p.x} cy={p.y} r={focus ? 16 : 12} fill={color} opacity={focus ? 0.22 : 0.12} />
      {/* línea de orientación */}
      <line x1={p.x} y1={p.y} x2={fx} y2={fy} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      {has(e, "coached") && <circle cx={p.x} cy={p.y} r={13} fill="none" stroke="#ffce4f" strokeWidth={2} />}
      {focus && <circle cx={p.x} cy={p.y} r={15} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="3 3" />}
      {/* cuerpo */}
      <circle cx={p.x} cy={p.y} r={8} fill={color} stroke="#05080d" strokeWidth={1.5} />
      {has(e, "flash") && <circle cx={p.x} cy={p.y} r={11} fill="#ffffffcc" />}
      <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={9} fontWeight={800} fill="#05080d">{td(ROLE_TAG[e.role ?? ""]) ?? "?"}</text>
      {/* placa de nombre */}
      <text x={p.x} y={p.y - 13} textAnchor="middle" fontSize={8} fontWeight={focus ? 700 : 500}
        className={focus ? "fill-white" : "fill-white/55"}>{td(e.label)}</text>
    </g>
  );
}
