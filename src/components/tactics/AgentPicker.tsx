"use client";
/**
 * AGENTE Y HABILIDAD — del roster REAL del juego (`src/domain/tactics/roster.ts`), y de ningún otro sitio.
 *
 * ────────────────────────── DE DÓNDE SALEN ──────────────────────────
 *
 * **Agentes:** los del juego real, con su ROL real (duelista, iniciador, controlador, centinela).
 * El entrenador prepara partidas de verdad: sus fichas son los agentes con los que se juegan.
 *
 * **Habilidades:** las cuatro de cada agente, con su tecla por defecto (C, Q, E, X), tal como las
 * da la fuente del roster. Ni una inventada, ni una derivada.
 *
 * ────────────────────────── LA MARCA LA DECIDE EL ENTRENADOR ──────────────────────────
 *
 * La pizarra dibuja INTENCIONES (humo, destello, muro, información…). Los datos reales dicen cómo
 * se llama cada habilidad, no a qué intención de pizarra corresponde, y deducirlo sería un mapeo
 * inventado. Así que al elegir una habilidad el entrenador elige también cómo marcarla, y por
 * defecto es un «marcador» neutro con el nombre de la habilidad. El dato es real; la intención es suya.
 *
 * ────────────────────────── EL MODELO ANTERIOR ──────────────────────────
 *
 * Una ficha de una jugada antigua puede llevar un agente propio (Veil, Haze…). Se enseña como
 * «modelo anterior», se puede quitar o sustituir por uno real, y nunca se ofrece para elegir.
 */
import { useMemo, useState } from "react";
import {
  TACTICAL_ROLES, getTacticalAgent, getLegacyAgent, searchAgents,
  type TacticalAbility, type TacticalRole,
} from "@/domain/tactics/roster";
import { type UtilityKind, UTILITY_COLOR, UTILITY_LABEL } from "@/domain/tactics";
import { UtilityGlyph } from "./UtilityGlyph";
import { AGENT_CLASS_COLOR, AGENT_CLASS_LABEL } from "./AgentEmblem";
import { AgentPortrait } from "@/components/agents/AgentArt";
import { useRosterVersion } from "@/lib/tactics/useRosterVersion";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("tactics");

/**
 * Marcas de la pizarra que puede llevar una habilidad. `spike` y `waypoint` no son habilidades de
 * nadie: se colocan desde el rail como siempre.
 */
export const ABILITY_MARKS: readonly UtilityKind[] = ["marker", "smoke", "flash", "molly", "stun", "wall", "recon"];

export interface AgentPickerProps {
  /** Agente elegido ahora mismo, o `null`. */
  value: string | null;
  onChange: (agentId: string | null) => void;
  /** Etiqueta de la ficha a la que se le asigna. Solo para el texto de ayuda. */
  para?: string;
}

export function AgentPicker({ value, onChange, para }: AgentPickerProps) {
  useLocale();
  const [rol, setRol] = useState<TacticalRole | "all">("all");
  const [q, setQ] = useState("");
  const rosterV = useRosterVersion();
  // `rosterV` es la clave de invalidación: el roster se actualiza EN SITIO al llegar el catálogo real.
  const lista = useMemo(() => { void rosterV; return searchAgents(q, rol); }, [q, rol, rosterV]);
  const legado = getLegacyAgent(value);

  return (
    <div className="space-y-2">
      <p className="nx-label">{t("Agente")}{para ? ` · ${para}` : ""}</p>
      {legado && (
        <div className="border-l-2 border-white/25 pl-2.5 text-caption text-ink-muted" data-testid="legacy-agent-note">
          {fill(t("{agente} es del modelo anterior de NEXUS. Se conserva en esta jugada; elige un agente real para sustituirlo o {quitar}.", slots("agente", "quitar")), {
            agente: <b className="text-white/80">{legado.name}</b>,
            quitar: <button type="button" className="nx-focus underline" onClick={() => onChange(null)}>{t("quítalo")}</button>,
          })}
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("Buscar agente")}
        aria-label={t("Buscar agente")}
        data-testid="picker-search"
        /* Mismo estilo que el buscador del constructor de composiciones. */
        className="nx-focus w-full rounded-md border border-white/12 bg-black/30 px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-white/30"
      />
      {/* Filtro por rol. Los cuatro roles reales, más «todas». */}
      <div className="flex flex-wrap gap-1">
        <Pastilla activa={rol === "all"} onClick={() => setRol("all")}>{t("Todas")}</Pastilla>
        {TACTICAL_ROLES.map((r) => (
          <Pastilla key={r} activa={rol === r} onClick={() => setRol(r)} color={AGENT_CLASS_COLOR[r]}>
            {td(AGENT_CLASS_LABEL[r])}
          </Pastilla>
        ))}
      </div>
      <div className="grid max-h-[320px] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
        {lista.map((a) => (
          <button
            key={a.id}
            type="button"
            data-testid={`pick-agent-${a.id}`}
            onClick={() => onChange(value === a.id ? null : a.id)}
            aria-pressed={value === a.id}
            className={cn(
              "nx-focus nx-clip-sm flex min-h-[44px] items-center gap-2 px-2 py-1.5 text-left transition",
              value === a.id
                ? "bg-white/12 text-white"
                : "border border-white/10 bg-white/4 text-white/70 hover:bg-white/8",
            )}
            style={value === a.id ? { boxShadow: `inset 0 0 0 1px ${AGENT_CLASS_COLOR[a.role]}88` } : undefined}
          >
            <AgentPortrait agentId={a.id} size={30} decorative state={value === a.id ? "selected" : "normal"} />
            <span className="min-w-0">
              <b className="block truncate font-display text-[12px] font-bold uppercase tracking-wide">{a.name}</b>
              <span className="block truncate text-[10px] text-ink-faint">{td(AGENT_CLASS_LABEL[a.role])}</span>
            </span>
          </button>
        ))}
        {lista.length === 0 && <p className="col-span-2 text-caption text-ink-faint">{t("Ningún agente con ese nombre.")}</p>}
      </div>
    </div>
  );
}

export interface AbilityPickerProps {
  /** Agente cuyas habilidades se ofrecen. Sin agente real no hay habilidades que ofrecer. */
  agentId: string | null;
  /** Habilidad elegida. */
  value: string | null;
  /** Devuelve la habilidad y la marca de pizarra con la que se colocará. */
  onChange: (ability: TacticalAbility | null, kind: UtilityKind | null) => void;
}

export function AbilityPicker({ agentId, value, onChange }: AbilityPickerProps) {
  useLocale();
  const agent = getTacticalAgent(agentId);
  const [marca, setMarca] = useState<UtilityKind>("marker");
  /*
   * La pantalla puede no controlar la selección (`value={null}`): la habilidad ARMADA se recuerda
   * aquí, para poder elegir su marca antes de pulsar el mapa.
   */
  const [armada, setArmada] = useState<string | null>(null);
  const sel = value ?? armada;
  const elegida = agent?.abilities.find((a) => a.id === sel) ?? null;

  if (!agent) {
    return (
      <div className="space-y-1.5">
        <p className="nx-label">{t("Habilidades")}</p>
        <p className="text-caption text-ink-faint">
          {t("Elige un agente real para ver sus cuatro habilidades.")}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="nx-label">{t("Habilidades de {agente}", { agente: td(agent.name) })}</p>
      <div className="grid gap-1.5">
        {agent.abilities.map((ab) => {
          const activa = sel === ab.id;
          return (
            <button
              key={ab.id}
              type="button"
              data-testid={`pick-ability-${ab.id}`}
              onClick={() => { setArmada(activa ? null : ab.id); onChange(activa ? null : ab, activa ? null : marca); }}
              aria-pressed={activa}
              className={cn(
                "nx-focus nx-clip-sm flex min-h-[44px] items-center gap-2.5 px-2.5 py-1.5 text-left transition",
                activa ? "bg-white/12 text-white" : "border border-white/10 bg-white/4 text-white/75 hover:bg-white/8",
              )}
              style={activa ? { boxShadow: `inset 0 0 0 1px ${AGENT_CLASS_COLOR[agent.role]}99` } : undefined}
            >
              <span
                className="grid h-7 w-7 shrink-0 place-items-center font-display text-[12px] font-extrabold"
                style={{ color: AGENT_CLASS_COLOR[agent.role], background: `${AGENT_CLASS_COLOR[agent.role]}1c` }}
                aria-label={t("Tecla {slot}", { slot: ab.slot })}
              >
                {ab.slot}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate font-display text-[12px] font-bold uppercase tracking-wide">{ab.name}</b>
                <span className="block truncate text-[10px] text-ink-faint">{ab.ultimate ? t("Definitiva") : t("Habilidad")}</span>
              </span>
            </button>
          );
        })}
      </div>
      {elegida && (
        <div className="space-y-1" data-testid="ability-mark">
          <p className="text-[10px] uppercase tracking-wide text-ink-faint">{t("Marcar {habilidad} en el mapa como", { habilidad: elegida.name })}</p>
          <div className="flex flex-wrap gap-1">
            {ABILITY_MARKS.map((k) => (
              <Pastilla
                key={k}
                activa={marca === k}
                color={UTILITY_COLOR[k]}
                onClick={() => { setMarca(k); onChange(elegida, k); }}
              >
                <span className="inline-flex items-center gap-1">
                  <svg viewBox="-9 -9 18 18" className="h-3 w-3" aria-hidden style={{ color: UTILITY_COLOR[k] }}>
                    <UtilityGlyph kind={k} />
                  </svg>
                  {td(UTILITY_LABEL[k])}
                </span>
              </Pastilla>
            ))}
          </div>
        </div>
      )}
      <p className="text-[10px] leading-snug text-ink-faint">
        {t("Nombres y teclas del juego real. La marca del mapa la eliges tú: la habilidad no la decide.")}
      </p>
    </div>
  );
}

function Pastilla({
  activa, onClick, color, children,
}: {
  activa: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        "nx-focus nx-clip-sm min-h-[32px] px-2.5 font-display text-[10px] font-bold uppercase tracking-[0.12em] transition",
        activa ? "bg-white/14 text-white" : "border border-white/10 text-white/55 hover:text-white",
      )}
      style={activa && color ? { boxShadow: `inset 0 0 0 1px ${color}99`, color } : undefined}
    >
      {children}
    </button>
  );
}
