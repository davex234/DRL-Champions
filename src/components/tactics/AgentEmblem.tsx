"use client";

/**
 * EMBLEMAS DE AGENTE — cómo se ve un agente en el entrenador, del hueco de la composición a la ficha del mapa.
 *
 * ────────────────────────── AGENTES REALES, SIN ARTWORK DE RIOT ──────────────────────────
 *
 * El entrenador trabaja con el roster REAL del juego (`src/domain/tactics/roster.ts`). De ese
 * roster se usan los DATOS —nombre, rol, habilidades—, no el artwork: el proyecto no tiene
 * licencia para los retratos ni los iconos de Riot (criterio de la Fase 16), así que no se
 * descargan, no se enlazan y no se incrustan.
 *
 * El respaldo es limpio y legible a 20 px sobre un mapa: un anillo con el COLOR DEL ROL —un
 * vistazo dice la composición— y el CÓDIGO de tres letras del agente, que sale de su nombre por
 * regla. No es un retrato ni finge serlo. Encima del mapa gana la legibilidad.
 *
 * ────────────────────────── EL MODELO ANTERIOR ──────────────────────────
 *
 * Los diez agentes propios de F47/F48 (Veil, Haze…) ya no se ofrecen, pero una composición o una
 * jugada antigua puede llevarlos. Se pintan con SU sigilo de siempre dentro de un anillo
 * DISCONTINUO y gris, y se anuncian como «modelo anterior»: se reconocen, no se confunden con un
 * agente real y no se traducen a ninguno.
 */
import { AGENTS } from "@/agents/catalog";
import type { AgentClass } from "@/agents/types";
import { getTacticalAgent, getLegacyAgent } from "@/domain/tactics/roster";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("tactics");

/** Color por clase. El mismo vocabulario cromático que el resto de la pizarra. */
export const AGENT_CLASS_COLOR: Record<AgentClass, string> = {
  controller: "#a78bfa",
  initiator: "#19e3ff",
  duelist: "#ff2e63",
  sentinel: "#3fc07a",
  flex: "#ffd35c",
};

export const AGENT_CLASS_LABEL: Record<AgentClass, string> = {
  controller: "Controlador",
  initiator: "Iniciador",
  duelist: "Duelista",
  sentinel: "Centinela",
  flex: "Flexible",
};

/** Lo que una pantalla necesita saber de cualquier id guardado: real, legado o nada. */
export interface EmblemAgent {
  id: string;
  name: string;
  /** Rol real (agentes reales) o clase del modelo anterior (legado). */
  class: AgentClass;
  /** Código de tres letras. Sólo los reales. */
  code?: string;
  legacy: boolean;
}

/** Color de un agente del modelo anterior: gris, para que nunca pase por uno real. */
export const LEGACY_COLOR = "#8a93ab";

const LEGACY_CLASS = new Map(AGENTS.map((a) => [a.id, a.class]));

export function agentById(id: string | undefined | null): EmblemAgent | null {
  if (!id) return null;
  const real = getTacticalAgent(id);
  if (real) return { id, name: real.name, class: real.role, code: real.code, legacy: false };
  const old = getLegacyAgent(id);
  if (old) return { id, name: old.name, class: LEGACY_CLASS.get(id) ?? "flex", legacy: true };
  return null;
}

/** Color con el que se pinta un agente: el de su rol, o gris si es del modelo anterior. */
export const agentColor = (a: EmblemAgent | null): string => (!a ? "#9aa4bf" : a.legacy ? LEGACY_COLOR : AGENT_CLASS_COLOR[a.class]);

/** Rótulo de rol: el real, o «Modelo anterior». */
export const agentRoleLabel = (a: EmblemAgent | null): string => (!a ? "" : a.legacy ? t("Modelo anterior") : td(AGENT_CLASS_LABEL[a.class]));

/** El código del agente real, centrado en el `viewBox` de 32. */
function Code({ code }: { code: string }) {
  return (
    <text x="16" y="16.6" textAnchor="middle" dominantBaseline="central" fill="currentColor"
      style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, fontFamily: "var(--font-display, inherit)" }}>
      {code}
    </text>
  );
}

/** El sigilo de cada agente. Trazo puro: se lee igual en blanco sobre negro que al revés. */
function Sigil({ id }: { id: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    /* ── CONTROLADORES · lo que hacen es TAPAR ── */
    case "veil": // cortina: tres velos que caen y ocultan lo de detrás
      return <g {...p}><path d="M5 9h22" /><path d="M9 9v14a3 3 0 006 0V9" /><path d="M17 9v14a3 3 0 006 0V9" /></g>;
    case "haze": // humo en movimiento: dos volutas que se desplazan
      return <g {...p}><path d="M5 12c4-4 8 4 12 0s8-4 10 0" /><path d="M5 19c4-4 8 4 12 0s8-4 10 0" /><path d="M11 25h12" /></g>;

    /* ── INICIADORES · lo que hacen es BARRER y ver ── */
    case "probe": // sonda: pulso que se abre en abanico desde un punto
      return <g {...p}><circle cx="16" cy="25" r="2.4" /><path d="M8 20a11 11 0 0116 0" /><path d="M4 15a17 17 0 0124 0" /></g>;
    case "pulse": // onda: latido que cruza y se propaga
      return <g {...p}><path d="M3 16h6l3-8 4 16 3-8h6" /><circle cx="16" cy="16" r="13" strokeOpacity={0.35} /></g>;

    /* ── DUELISTAS · lo que hacen es EMPUJAR ── */
    case "spear": // lanza: punta y astil, dirección clara
      return <g {...p}><path d="M6 26L26 6" /><path d="M20 6h6v6" /><path d="M12 14l6 6" /></g>;
    case "blitz": // rayo: entrada rápida y quebrada
      return <g {...p}><path d="M18 3L8 17h7l-3 12 12-15h-7z" /></g>;

    /* ── CENTINELAS · lo que hacen es CERRAR ── */
    case "warden": // escudo con cerrojo: el sitio queda guardado
      return <g {...p}><path d="M16 4l10 4v8c0 7-5 11-10 12-5-1-10-5-10-12V8z" /><path d="M13 16h6v5h-6z" /><path d="M14.5 16v-2a1.5 1.5 0 013 0v2" /></g>;
    case "tripwire": // cable tenso entre dos anclas
      return <g {...p}><circle cx="6" cy="8" r="2.4" /><circle cx="26" cy="24" r="2.4" /><path d="M8 10l16 12" /><path d="M13 13l-2.5 4M19 19l2.5-4" /></g>;

    /* ── FLEXIBLES · lo que hacen es DESDOBLARSE ── */
    case "specter": // silueta que se duplica: uno es señuelo
      return <g {...p}><path d="M12 28V14a5 5 0 1110 0v14" strokeOpacity={0.4} /><path d="M7 28V13a6 6 0 1112 0v15" /></g>;
    case "echo": // eco: la misma forma repetida a distinta distancia
      return <g {...p}><path d="M10 8v16" /><path d="M16 5v22" strokeOpacity={0.6} /><path d="M22 10v12" strokeOpacity={0.35} /><path d="M4 12v8" strokeOpacity={0.35} /><path d="M28 13v6" strokeOpacity={0.2} /></g>;

    default:
      // Agente que no conocemos: rombo neutro. Nunca una letra suelta.
      return <g {...p}><path d="M16 4l12 12-12 12L4 16z" /></g>;
  }
}

/**
 * El emblema completo: sigilo + anillo de clase. `plain` lo deja sin anillo, para cuando ya va
 * dentro de otra ficha que aporta el marco (por ejemplo el token del mapa).
 */
export function AgentEmblem({
  agentId, size = 28, plain = false, className,
}: {
  agentId: string;
  /**
   * Lado del emblema. Admite un número de píxeles o una medida CSS (`"62%"`), porque el
   * retrato de la Fase 48 lo mete en una caja fluida y necesita que escale con ella en vez
   * de calcular píxeles a mano en cada pantalla. El dibujo es el mismo: un `viewBox` de
   * 32 × 32 que no depende del tamaño.
   */
  size?: number | string;
  /** Sin anillo ni fondo: sólo la marca. */
  plain?: boolean;
  className?: string;
}) {
  useLocale();
  const agent = agentById(agentId);
  const color = agentColor(agent);
  const label = agent ? `${agent.name} · ${agentRoleLabel(agent)}` : agentId;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      style={{ color }}
      role="img"
      aria-label={td(label)}
      data-agent-kind={agent ? (agent.legacy ? "legacy" : "real") : "unknown"}
    >
      {!plain && (
        <>
          <circle cx="16" cy="16" r="15" fill="#070a12" fillOpacity={0.92} />
          <circle cx="16" cy="16" r="15" fill="none" stroke="currentColor" strokeWidth={1.6} strokeOpacity={0.85}
            strokeDasharray={agent?.legacy ? "3 2.4" : undefined} />
        </>
      )}
      {agent && !agent.legacy && agent.code ? (
        <Code code={agent.code} />
      ) : (
        <g transform={plain ? undefined : "translate(16 16) scale(0.62) translate(-16 -16)"}>
          <Sigil id={agentId} />
        </g>
      )}
    </svg>
  );
}

/** El mismo emblema dentro de un `<svg>` que ya existe (la capa del mapa). */
export function AgentEmblemGlyph({ agentId, size }: { agentId: string; size: number }) {
  const agent = agentById(agentId);
  const color = agentColor(agent);
  const k = size / 32;
  return (
    <g transform={`translate(${-size / 2} ${-size / 2}) scale(${k})`} style={{ color }}>
      {agent && !agent.legacy && agent.code ? <Code code={agent.code} /> : <Sigil id={agentId} />}
    </g>
  );
}
