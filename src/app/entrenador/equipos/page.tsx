"use client";

/**
 * PLANTILLA — el entrenador crea MÚLTIPLES equipos con SUS cartas.
 * Colección → elegir 5 → equipo listo → marcarlo activo → jugar.
 *
 * FASE 51 · la presentación de la sala táctica. Los equipos siguen en `useTeamStore`
 * (localStorage de este dispositivo), sin migrar.
 *
 * FASE 51.1 · LOS JUGADORES SE VEN COMO SUS CARTAS. Titulares y colección eran cajas de texto
 * (nick, rol, OVR, edición). Ahora son las cartas EXACTAS del equipo —el `cardId` de cada
 * titular— pintadas con `CardArt`. El editor es el mismo que usa el asistente JUGAR.
 */
import { useState } from "react";
import Link from "next/link";
import { useTeamStore, resolveCardRef } from "@/store/useTeamStore";
import { validateTeam, MAX_STARTERS } from "@/domain/teams/types";
import { CoachHeader } from "@/components/coach/tc/CoachFrame";
import { TeamRosterEditor, TeamCardStrip } from "@/components/coach/roster/TeamRosterEditor";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { cn } from "@/lib/format";

export default function EquiposPage() {
  return (
    <HydrationGate>
      <Plantilla />
    </HydrationGate>
  );
}

function Plantilla() {
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const store = useTeamStore();

  const [editingId, setEditingId] = useState<string | null>(activeTeamId ?? teams[0]?.id ?? null);
  const editing = teams.find((t) => t.id === editingId) ?? null;
  const valid = editing != null && validateTeam(editing, resolveCardRef).length === 0;

  const createTeam = () => setEditingId(store.createTeam(`Equipo ${teams.length + 1}`));

  return (
    <section className="space-y-6">
      <CoachHeader
        className="!mb-0"
        kicker="Plantilla · tus cinco jugadores/cartas"
        title={<>Mis <span className="text-[#2fe0ff]">Equipos</span></>}
        line="Cada titular es una carta concreta de tu colección. Se guarda en este dispositivo."
        actions={<Link href="/entrenador/jugar" className="nx-coach-btn">Jugar →</Link>}
      />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* Lista de equipos: cada uno con sus cinco cartas en miniatura. */}
        <aside className="space-y-2">
          <button onClick={createTeam} className="nx-coach-btn w-full" data-testid="new-team">+ Nuevo equipo</button>
          {teams.length === 0 && <p className="px-1 py-4 text-sm text-white/50">Aún no tienes equipos.</p>}
          {teams.map((t) => {
            const ok = validateTeam(t, resolveCardRef).length === 0;
            return (
              <button
                key={t.id}
                onClick={() => setEditingId(t.id)}
                aria-pressed={editingId === t.id}
                className="nx-coach-tool w-full !flex-col !items-stretch !justify-start gap-2 !p-3 text-left normal-case tracking-normal"
              >
                <span className="flex items-center justify-between gap-2">
                  <b className="truncate font-display text-sm text-white">{t.logo ? `${t.logo} ` : ""}{t.name}</b>
                  {activeTeamId === t.id && <span className="nx-label !text-[rgb(63,214,150)]">Activo</span>}
                </span>
                <TeamCardStrip starters={t.starters} size={38} />
                <span className={cn("nx-label", ok ? "!text-white/45" : "!text-[#ffd35c]")}>
                  {t.starters.length}/{MAX_STARTERS} · {ok ? "listo" : "incompleto"}
                </span>
              </button>
            );
          })}
        </aside>

        {editing ? (
          <div className="nx-coach-panel space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => store.setActiveTeam(editing.id)}
                disabled={!valid}
                className="nx-coach-btn"
                data-variant={activeTeamId === editing.id ? "ghost" : undefined}
              >
                {activeTeamId === editing.id ? "✓ Activo" : "Marcar activo"}
              </button>
              <button onClick={() => { store.deleteTeam(editing.id); setEditingId(null); }} className="nx-coach-btn" data-variant="mag">
                Eliminar
              </button>
            </div>
            <TeamRosterEditor teamId={editing.id} />
          </div>
        ) : (
          <div className="nx-coach-panel-flat grid place-items-center p-12 text-center text-white/55">
            Crea o selecciona un equipo para empezar.
          </div>
        )}
      </div>
    </section>
  );
}
