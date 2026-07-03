"use client";

/**
 * ROSTER BUILDER — el entrenador crea MÚLTIPLES equipos con SUS cartas.
 * Colección → elegir 5 → guardar equipo → marcar activo → jugar. Todo persistente.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useGameStore } from "@/store/useGameStore";
import { useTeamStore, resolveCardRef } from "@/store/useTeamStore";
import { validateTeam, MAX_STARTERS } from "@/domain/teams/types";
import { cardViews, type CardView } from "@/lib/match/cardView";
import { cn } from "@/lib/format";

export default function EquiposPage() {
  const ownedCards = useGameStore((s) => s.ownedCards);
  const teams = useTeamStore((s) => s.teams);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const store = useTeamStore();

  const [editingId, setEditingId] = useState<string | null>(activeTeamId ?? teams[0]?.id ?? null);
  const [query, setQuery] = useState("");

  const cards = useMemo(() => cardViews(ownedCards), [ownedCards]);
  const byUid = useMemo(() => new Map(cards.map((c) => [c.uid, c])), [cards]);
  const editing = teams.find((t) => t.id === editingId) ?? null;

  const errors = editing ? validateTeam(editing, resolveCardRef) : [];
  const valid = editing != null && errors.length === 0;

  const starters = editing ? editing.starters.map((uid) => byUid.get(uid)).filter((c): c is CardView => !!c) : [];
  const starterPlayerIds = new Set(starters.map((c) => c.playerId));

  const createTeam = () => {
    const id = store.createTeam(`Equipo ${teams.length + 1}`);
    setEditingId(id);
  };

  const toggleStarter = (uid: string) => {
    if (!editing) return;
    const card = byUid.get(uid);
    if (!card) return;
    const isStarter = editing.starters.includes(uid);
    if (isStarter) {
      store.setStarters(editing.id, editing.starters.filter((u) => u !== uid));
      return;
    }
    if (editing.starters.length >= MAX_STARTERS) return;
    if (starterPlayerIds.has(card.playerId)) return; // mismo jugador no se repite
    store.setStarters(editing.id, [...editing.starters, uid]);
  };

  const filtered = query
    ? cards.filter((c) => c.nick.toLowerCase().includes(query.toLowerCase()) || c.team.toLowerCase().includes(query.toLowerCase()))
    : cards;

  return (
    <section className="animate-rise space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">Mis <span className="text-drl">Equipos</span></h1>
          <p className="mt-1 text-white/50">Construye tu plantilla con las cartas de tu colección.</p>
        </div>
        <Link href="/entrenador"
          className="rounded-lg border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/70 transition hover:bg-white/10">
          ← El Entrenador
        </Link>
      </header>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* Lista de equipos */}
        <aside className="space-y-2">
          <button onClick={createTeam}
            className="w-full rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-4 py-2.5 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
            + Nuevo equipo
          </button>
          {teams.length === 0 && <p className="px-1 py-4 text-sm text-white/40">Aún no tienes equipos.</p>}
          {teams.map((t) => {
            const tErrors = validateTeam(t, resolveCardRef);
            return (
              <button key={t.id} onClick={() => setEditingId(t.id)}
                className={cn("flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition",
                  editingId === t.id ? "border-drl/50 bg-drl/10" : "border-white/10 bg-base-800 hover:bg-white/5")}>
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-semibold text-white">
                    {t.logo ? `${t.logo} ` : ""}{t.name}
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-white/40">
                    {t.starters.length}/{MAX_STARTERS} · {tErrors.length === 0 ? "lista" : "incompleta"}
                  </p>
                </div>
                {activeTeamId === t.id && <span className="rounded bg-emerald-400/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">Activo</span>}
              </button>
            );
          })}
        </aside>

        {/* Editor del equipo */}
        {editing ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-base-700/40 p-4">
              <input value={editing.name} onChange={(e) => store.renameTeam(editing.id, e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-base-800 px-3 py-2 font-display text-sm text-white outline-none focus:border-drl/50"
                placeholder="Nombre del equipo" />
              <button onClick={() => store.setActiveTeam(editing.id)} disabled={!valid}
                className={cn("rounded-lg px-4 py-2 font-display text-xs font-bold uppercase tracking-wide transition",
                  activeTeamId === editing.id ? "bg-emerald-500/20 text-emerald-300"
                    : valid ? "bg-drl text-white hover:brightness-110" : "cursor-not-allowed bg-white/5 text-white/30")}>
                {activeTeamId === editing.id ? "✓ Activo" : "Marcar activo"}
              </button>
              <button onClick={() => { store.deleteTeam(editing.id); setEditingId(null); }}
                className="rounded-lg border border-rose-400/30 px-3 py-2 font-display text-xs uppercase tracking-wide text-rose-300/80 transition hover:bg-rose-400/10">
                Eliminar
              </button>
            </div>

            {/* Titulares (5 slots) */}
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-widest text-white/40">Titulares · {starters.length}/{MAX_STARTERS}</p>
              <div className="grid grid-cols-5 gap-2">
                {Array.from({ length: MAX_STARTERS }).map((_, i) => {
                  const c = starters[i];
                  return (
                    <div key={i}
                      onClick={() => c && toggleStarter(c.uid)}
                      className={cn("aspect-[3/4] rounded-xl border p-2 text-center transition",
                        c ? "cursor-pointer border-white/15 bg-base-800 hover:border-rose-400/40" : "border-dashed border-white/10 bg-base-800/40")}>
                      {c ? (
                        <div className="flex h-full flex-col items-center justify-center gap-1">
                          <span className="font-display text-sm font-bold text-white">{c.nick}</span>
                          <span className="text-[10px] text-white/50">{c.role}</span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: c.palette.primary, color: c.palette.text }}>{c.ovr}</span>
                          <span className="text-[9px] uppercase tracking-wide text-white/30">{c.variantLabel}</span>
                        </div>
                      ) : (
                        <div className="grid h-full place-items-center text-white/20">+</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Errores de validación */}
            {errors.length > 0 && (
              <ul className="space-y-1">
                {errors.map((e, i) => (
                  <li key={i} className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-1.5 text-xs text-rose-300/90">✕ {e.message}</li>
                ))}
              </ul>
            )}

            {/* Selector de cartas (colección) */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-widest text-white/40">Tu colección</p>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar jugador o equipo…"
                  className="w-56 rounded-lg border border-white/10 bg-base-800 px-3 py-1.5 text-xs text-white outline-none focus:border-drl/50" />
              </div>
              {cards.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-base-800 p-6 text-center text-sm text-white/40">
                  No tienes cartas todavía. Abre sobres en la <Link href="/tienda" className="text-drl underline">tienda</Link>.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {filtered.map((c) => {
                    const isStarter = editing.starters.includes(c.uid);
                    const dupePlayer = !isStarter && starterPlayerIds.has(c.playerId);
                    const full = !isStarter && editing.starters.length >= MAX_STARTERS;
                    const disabled = dupePlayer || full;
                    return (
                      <button key={c.uid} onClick={() => toggleStarter(c.uid)} disabled={disabled && !isStarter}
                        title={dupePlayer ? "Ya tienes a este jugador" : full ? "Quinteto completo" : ""}
                        className={cn("rounded-xl border p-2 text-left transition",
                          isStarter ? "border-emerald-400/50 bg-emerald-400/10"
                            : disabled ? "cursor-not-allowed border-white/5 bg-base-800/40 opacity-40"
                              : "border-white/10 bg-base-800 hover:border-drl/40")}>
                        <div className="flex items-center justify-between">
                          <span className="font-display text-sm font-bold text-white">{c.nick}</span>
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: c.palette.primary, color: c.palette.text }}>{c.ovr}</span>
                        </div>
                        <p className="mt-0.5 truncate text-[10px] text-white/40">{c.teamTag} · {c.role}</p>
                        <p className="truncate text-[9px] uppercase tracking-wide text-white/30">{c.variantLabel}{c.serial ? ` #${c.serial}` : ""}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid place-items-center rounded-2xl border border-dashed border-white/10 bg-base-800/30 p-12 text-center text-white/40">
            Crea o selecciona un equipo para empezar.
          </div>
        )}
      </div>
    </section>
  );
}
