"use client";

/**
 * SELECTOR DE TORNEO (Fase 24.2) — activos, próximos y finalizados, solo con los reales.
 *
 * Una tira de botones agrupada por fase. Cada botón es un `<button aria-pressed>`: se recorre
 * con Tab y se elige con Enter. La fase sale de los datos reales (`eventPhaseCoarse`), no de
 * la apariencia. Cambiar de torneo no pierde nada: el estado de cada uno vive en la caché
 * de `usePickem`.
 */
import { Badge } from "@/components/ui/Badge";
import { DemoBadge } from "@/components/ui/States";
import { cn } from "@/lib/format";
import { PHASE_LABEL, type EventPhase } from "@/domain/pickems/progress";

export interface SwitcherEvent {
  id: string;
  name: string;
  phase: EventPhase;
  isDemo?: boolean;
}

const ORDER: EventPhase[] = ["activo", "proximo", "finalizado"];
const GROUP_LABEL: Record<EventPhase, string> = { activo: "Activos", proximo: "Próximos", finalizado: "Finalizados" };

export function EventSwitcher({
  events, selected, onSelect, className,
}: {
  events: SwitcherEvent[];
  selected: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const groups = ORDER
    .map((phase) => ({ phase, items: events.filter((e) => e.phase === phase) }))
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;

  return (
    <nav className={cn("space-y-2", className)} aria-label="Torneos con Pick'ems">
      {groups.map(({ phase, items }) => (
        <div key={phase} className="flex flex-wrap items-center gap-2">
          <span className="nx-label w-[88px] shrink-0">{GROUP_LABEL[phase]}</span>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map((e) => {
              const on = e.id === selected;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e.id)}
                  aria-pressed={on}
                  className={cn(
                    "nx-clip-sm nx-focus flex min-h-[44px] shrink-0 items-center gap-2 px-3.5 py-2 text-left transition duration-fast motion-reduce:transition-none",
                    on ? "bg-drl/15 text-white" : "bg-white/[0.04] text-ink-secondary hover:bg-white/[0.08]",
                  )}
                  style={{
                    boxShadow: on
                      ? "inset 0 0 0 1.5px var(--nx-accent)"
                      : "inset 0 0 0 1px rgba(255,255,255,0.12)",
                  }}
                >
                  <span className="max-w-[46vw] truncate font-display text-[13px] font-bold uppercase tracking-wide sm:max-w-[260px]">
                    {e.name}
                  </span>
                  {e.isDemo && <DemoBadge />}
                  {on && <Badge tone="key" solid>Viendo</Badge>}
                  <span className="sr-only">· {PHASE_LABEL[e.phase]}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
