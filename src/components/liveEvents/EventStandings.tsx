"use client";

/**
 * CLASIFICACIÓN (Fase 30). Solo si el backend tiene filas de `standings` para el evento. El
 * estado (clasificado / eliminado) solo se enseña cuando la fila lo dice; la deuda conocida
 * («qualified» nunca se calcula) no se disimula con una tabla inventada.
 */
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { StandingView } from "@/server/services/liveEvents";

export function EventStandings({ standings, stages }: { standings: StandingView[]; stages: { id: string; name: string }[] }) {
  if (standings.length === 0) return null;
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const groups = new Map<string, StandingView[]>();
  for (const s of standings) { const k = `${s.stageId ?? "-"}|${s.group ?? ""}`; groups.set(k, [...(groups.get(k) ?? []), s]); }
  return (
    <section id="clasificacion" aria-label="Clasificación" data-testid="event-standings" data-rows={standings.length}>
      <SectionTitle>Clasificación</SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        {[...groups.entries()].map(([k, rows]) => {
          const [sid, group] = k.split("|");
          const title = [sid !== "-" ? stageName.get(sid) : null, group ? `Grupo ${group}` : null].filter(Boolean).join(" · ") || "General";
          return (
            <Plate key={k} className="overflow-x-auto p-3">
              <p className="nx-label mb-2">{title}</p>
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-[10px] uppercase tracking-wide text-white/40"><th className="pr-2">#</th><th>Equipo</th><th className="text-right">V–D</th><th className="hidden text-right sm:table-cell">Mapas</th><th className="text-right">Pts</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${k}:${r.teamId}`} className="border-t border-white/[0.06]" data-team={r.teamId} data-standing-status={r.status ?? "active"}>
                      <td className="py-1.5 pr-2 tabular-nums text-white/60">{r.position ?? "—"}</td>
                      <td className="py-1.5 text-white">{r.teamName}{r.status && <Badge tone={r.status === "qualified" ? "ok" : "muted"} className="ml-2">{r.status === "qualified" ? "Clasificado" : "Eliminado"}</Badge>}</td>
                      <td className="py-1.5 text-right tabular-nums text-white/80">{r.wins}–{r.losses}{r.ties ? `–${r.ties}` : ""}</td>
                      <td className="hidden py-1.5 text-right tabular-nums text-white/60 sm:table-cell">{r.mapDiff === null ? "—" : r.mapDiff > 0 ? `+${r.mapDiff}` : r.mapDiff}</td>
                      <td className="py-1.5 text-right tabular-nums text-drl-gold">{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Plate>
          );
        })}
      </div>
    </section>
  );
}
