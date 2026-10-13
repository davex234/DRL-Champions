"use client";

/**
 * FASE 51.3.1 · ELIGE 5 AGENTES — el creador de QUICK PLAY.
 *
 * NO es `CompositionBuilder`. El editor avanzado (mapa, nombre, notas, buscador, filtros, huecos,
 * reparto por clase, tope por mapa) sigue entero en `/entrenador/composiciones`, que es donde se
 * PREPARAN composiciones. Aquí se juega: los 29 agentes, tocar cinco y empezar. El mapa y el nombre
 * los pone el sistema; se renombra después si se quiere.
 *
 * Comparte el dominio —`TACTICAL_AGENTS`, `COMPOSITION_SIZE`, los colores de clase— y no duplica
 * ninguna regla: el servidor sigue validando lo que se guarda.
 */
import { useState } from "react";
import { TACTICAL_AGENTS } from "@/domain/tactics/roster";
import { COMPOSITION_SIZE } from "@/domain/tactics/composition";
import { AGENT_CLASS_COLOR, AGENT_CLASS_LABEL } from "./AgentEmblem";
import { AgentPortrait } from "@/components/agents/AgentArt";
import { useRosterVersion } from "@/lib/tactics/useRosterVersion";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("tactics");

export function QuickComposer({ onPlay, saving = false, error = null, cta = t("Guardar y jugar") }: {
  /** Los cinco agentes elegidos. El nombre y el mapa NO se piden aquí. */
  onPlay: (agentIds: string[]) => void;
  saving?: boolean;
  error?: string | null;
  cta?: string;
}) {
  useLocale();
  useRosterVersion(); // F60: un agente publicado desde el panel aparece sin recargar
  const [sel, setSel] = useState<string[]>([]);
  const lleno = sel.length >= COMPOSITION_SIZE;
  const alternar = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= COMPOSITION_SIZE ? s : [...s, id]));

  return (
    <section className="space-y-4" data-testid="quick-composer">
      {/* ═══ LA BARRA DE LO ELEGIDO: compacta, sin tarjetas gigantes ═══ */}
      <div className="nx-coach-panel flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#080d14] p-3" data-testid="quick-picked">
        <p className="nx-coach-kicker !m-0">{t("Tu composición")}</p>
        <ul className="flex flex-1 flex-wrap items-center gap-1.5">
          {Array.from({ length: COMPOSITION_SIZE }, (_, i) => {
            const id = sel[i];
            const a = id ? TACTICAL_AGENTS.find((x) => x.id === id) : null;
            return (
              <li key={i}>
                {a ? (
                  <button
                    type="button"
                    onClick={() => alternar(a.id)}
                    title={t("Quitar a {name}", { name: a.name })}
                    data-testid={`quick-picked-${a.id}`}
                    className="nx-focus flex min-h-[38px] items-center gap-1.5 px-2 py-1 transition hover:opacity-80"
                    style={{ boxShadow: `inset 0 0 0 1px ${AGENT_CLASS_COLOR[a.role]}` }}
                  >
                    <AgentPortrait agentId={a.id} size={28} decorative eager />
                    <span className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-white">{a.name}</span>
                  </button>
                ) : (
                  <span aria-hidden className="block h-[38px] w-[38px] bg-[rgba(4,8,16,0.55)] shadow-[inset_0_0_0_1px_rgba(47,224,255,0.14)]" />
                )}
              </li>
            );
          })}
        </ul>
        <b className={cn("font-display text-[13px] font-extrabold", lleno ? "text-[#2fe0ff]" : "text-white/45")} data-testid="quick-count">
          {sel.length}/{COMPOSITION_SIZE}
        </b>
        <button
          type="button"
          className="nx-play-cta !min-h-[46px] !text-[14px]"
          style={lleno && !saving ? undefined : { opacity: 0.4, filter: "none" }}
          disabled={!lleno || saving}
          onClick={() => onPlay(sel)}
          data-testid="quick-save-play"
        >
          {saving ? t("Empezando…") : td(cta)}
        </button>
      </div>

      {error && <p role="alert" className="nx-coach-conflict px-4 py-3 text-[13px] text-white" data-testid="quick-error">{td(error)}</p>}

      {/* ═══ LOS 29 AGENTES: token, nombre y su clase. Nada más ═══ */}
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6" data-testid="quick-roster">
        {TACTICAL_AGENTS.map((a) => {
          const on = sel.includes(a.id);
          return (
            <li key={a.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!on && lleno}
                onClick={() => alternar(a.id)}
                data-testid={`quick-agent-${a.id}`}
                className={cn(
                  "nx-focus flex min-h-[56px] w-full items-center gap-2.5 px-2.5 py-2 text-left transition duration-150",
                  on ? "bg-[rgba(47,224,255,0.12)]" : "bg-[rgba(4,8,16,0.55)] hover:bg-[rgba(47,224,255,0.07)]",
                  !on && lleno && "opacity-40",
                )}
                style={{ boxShadow: on ? `inset 0 0 0 1px ${AGENT_CLASS_COLOR[a.role]}, inset 3px 0 0 ${AGENT_CLASS_COLOR[a.role]}` : "inset 0 0 0 1px rgba(47,224,255,0.12)" }}
              >
                <AgentPortrait agentId={a.id} size={40} decorative state={on ? "selected" : "normal"} />
                <span className="min-w-0 flex-1 leading-tight">
                  <b className="block truncate font-display text-[12.5px] font-bold uppercase tracking-[0.08em] text-white">{a.name}</b>
                  <span className="block font-display text-[8px] font-bold uppercase tracking-[0.16em]" style={{ color: AGENT_CLASS_COLOR[a.role] }}>
                    {td(AGENT_CLASS_LABEL[a.role])}
                  </span>
                </span>
                {on && <span aria-hidden className="font-display text-[13px] font-bold text-[#2fe0ff]">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
