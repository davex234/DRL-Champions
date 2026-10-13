"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { allPlayers, getPlayer } from "@/data/catalog";
import { useRosterStore } from "@/store/useRosterStore";
import {
  listTournaments, listTournamentPlayers, listRarityRules, listGenerations,
  listPlayerCards, listSpecialCards,
} from "@/lib/tournaments/repos";
import type { Tournament, TournamentPlayer, RarityRule } from "@/domain/tournaments/types";
import type { CardGenerationRow, PlayerCardRow, SpecialCardRow } from "@/lib/supabase/tournaments.types";
import type { AccoladeId } from "@/domain/cards/types";
import { cn } from "@/lib/format";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("admin");

const inputCls =
  "w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none";

export default function TorneosPage() {
  return (
    <HydrationGate>
      <Torneos />
    </HydrationGate>
  );
}

/** POST a la ruta admin con el token de sesión del usuario. */
async function callAdmin(action: string, payload: Record<string, unknown> = {}) {
  const sb = getSupabase();
  if (!sb) return { error: tr("Supabase no configurado") };
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: tr("Inicia sesión como administrador") };
  const res = await fetch("/api/admin/tournaments", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

function Torneos() {
  useLocale();
  const { toast, notify } = useToast();
  const upsertWithAccolades = useRosterStore((s) => s.upsertWithAccolades);
  const online = isSupabaseConfigured();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [sel, setSel] = useState<string>("");
  const [players, setPlayers] = useState<TournamentPlayer[]>([]);
  const [rules, setRules] = useState<RarityRule[]>([]);
  const [gens, setGens] = useState<CardGenerationRow[]>([]);
  const [cards, setCards] = useState<PlayerCardRow[]>([]);
  const [specials, setSpecials] = useState<SpecialCardRow[]>([]);

  // Form crear torneo.
  const [form, setForm] = useState({ id: "", name: "", region: "EMEA", tier: "vct-international" });
  // Form añadir jugador.
  const [addPid, setAddPid] = useState("");
  const [addRating, setAddRating] = useState("1.10");

  const refreshList = useCallback(async () => {
    setTournaments(await listTournaments());
    setRules(await listRarityRules());
  }, []);

  const refreshSel = useCallback(async (id: string) => {
    if (!id) return;
    setPlayers(await listTournamentPlayers(id));
    setGens(await listGenerations(id));
    setCards(await listPlayerCards(id));
    setSpecials(await listSpecialCards(id));
  }, []);

  useEffect(() => { if (online) refreshList(); }, [online, refreshList]);
  useEffect(() => { if (sel) refreshSel(sel); }, [sel, refreshSel]);

  const current = tournaments.find((t) => t.id === sel);
  const teams = useMemo(() => {
    const set = new Map<string, string>();
    for (const p of players) if (p.teamId) set.set(p.teamId, p.teamId);
    return [...set.keys()];
  }, [players]);
  // SANEAMIENTO POST F47 · arriba del `return` de «sin Supabase»: si no, este Hook solo se ejecuta
  // en algunos renders (`react-hooks/rules-of-hooks`) y el orden de Hooks deja de ser estable.
  const rosterOptions = useMemo(() => allPlayers().sort((a, b) => a.nick.localeCompare(b.nick)), []);

  if (!online) {
    return (
      <section className="animate-rise">
        <Header />
        <p className="rounded-2xl border border-dashed border-white/15 bg-base-700/30 p-8 text-center text-white/50">
          {tr("El módulo de Torneos requiere Supabase configurado y una sesión de administrador (")}<code className="text-drl">profiles.is_admin = true</code>).
        </p>
        <Toast toast={toast} />
      </section>
    );
  }

  async function createTournament() {
    if (!form.id || !form.name) return notify(tr("Id y nombre requeridos"), false);
    const r = await callAdmin("create_tournament", { ...form, status: "live" });
    if (r.error) return notify(r.error, false);
    notify(tr("Torneo creado"), true);
    await refreshList();
    setSel(form.id);
    setForm({ id: "", name: "", region: "EMEA", tier: "vct-international" });
  }

  async function addPlayer() {
    const gp = getPlayer(addPid);
    if (!gp) return notify(tr("Selecciona un jugador del catálogo"), false);
    const r = await callAdmin("add_player", {
      tournamentId: sel, teamId: gp.team, playerId: gp.id, nick: gp.nick, rating: Number(addRating),
    });
    if (r.error) return notify(r.error, false);
    notify(tr("{nick} añadido", { nick: gp.nick }), true);
    refreshSel(sel);
  }

  async function setRating(p: TournamentPlayer, rating: number, isMvp?: boolean) {
    const gp = getPlayer(p.playerId);
    const r = await callAdmin("add_player", {
      tournamentId: sel, teamId: p.teamId, playerId: p.playerId, nick: p.nick ?? gp?.nick,
      rating, isMvp: isMvp ?? p.isMvp,
    });
    if (r.error) return notify(r.error, false);
    refreshSel(sel);
  }

  async function setWinner(teamId: string) {
    const r = await callAdmin("update_tournament", { ...current, id: sel, winnerTeamId: teamId, name: current?.name, status: current?.status });
    if (r.error) return notify(r.error, false);
    notify(tr("Ganador: {teamId}", { teamId: td(teamId) }), true);
    refreshList();
  }

  /** Aplica las accolades generadas al roster local (cartas jugables). */
  function applySpecs(specs: { playerId: string; accolade: string }[]) {
    let applied = 0;
    for (const s of specs) {
      if (!s.accolade) continue;
      const gp = getPlayer(s.playerId);
      if (!gp) continue;
      upsertWithAccolades(gp, [s.accolade as AccoladeId]);
      applied++;
    }
    return applied;
  }

  async function finish() {
    if (!confirm(tr("¿Finalizar el torneo y generar todas las cartas?"))) return;
    const r = await callAdmin("finish_tournament", { tournamentId: sel });
    if (r.error) return notify(r.error, false);
    const applied = applySpecs(r.result?.specs ?? []);
    notify(tr("Generadas {v} cartas · {applied} aplicadas al catálogo", { v: r.result?.specs?.length ?? 0, applied }), true);
    refreshList(); refreshSel(sel);
  }

  async function eliminate(teamId: string) {
    if (!confirm(tr("¿Generar cartas para el roster eliminado de {teamId}?", { teamId: td(teamId) }))) return;
    const r = await callAdmin("eliminate_team", { tournamentId: sel, teamId });
    if (r.error) return notify(r.error, false);
    const applied = applySpecs(r.result?.specs ?? []);
    notify(tr("Equipo eliminado · {v} cartas ({applied} aplicadas)", { v: r.result?.specs?.length ?? 0, applied }), true);
    refreshSel(sel);
  }

  async function toggleRule(rule: RarityRule) {
    const r = await callAdmin("set_rule", { ...rule, active: !rule.active });
    if (r.error) return notify(r.error, false);
    setRules(await listRarityRules());
  }
  async function editRuleRating(rule: RarityRule, minRating: number) {
    const r = await callAdmin("set_rule", { ...rule, minRating });
    if (r.error) return notify(r.error, false);
    setRules(await listRarityRules());
  }

  return (
    <section className="animate-rise space-y-6">
      <Header />

      {/* Crear torneo */}
      <Panel title={tr("Crear torneo")}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <input className={inputCls} placeholder={tr("id (slug)")} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
          <input className={inputCls} placeholder={tr("Nombre")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputCls} placeholder={tr("Región")} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
          <input className={inputCls} placeholder={tr("Tier")} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} />
        </div>
        <button onClick={createTournament} className="mt-3 rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase text-white shadow-glow transition hover:brightness-110">
          {tr("Crear")}
        </button>
      </Panel>

      {/* Selector de torneo */}
      <Panel title={tr("Torneos ({length})", { length: tournaments.length })}>
        <select className={inputCls} value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">{tr("Elige un torneo…")}</option>
          {tournaments.map((t) => (
            <option key={t.id} value={t.id}>{t.name} · {t.status}{t.winnerTeamId ? ` · 🏆 ${t.winnerTeamId}` : ""}</option>
          ))}
        </select>
      </Panel>

      {current && (
        <>
          {/* Gestión de participantes */}
          <Panel title={tr("Participantes · {name}", { name: current.name })}>
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <select className={cn(inputCls, "max-w-xs")} value={addPid} onChange={(e) => setAddPid(e.target.value)}>
                <option value="">{tr("Añadir jugador del catálogo…")}</option>
                {rosterOptions.map((p) => <option key={p.id} value={p.id}>{p.nick} · {p.team}</option>)}
              </select>
              <input className={cn(inputCls, "w-28")} type="number" step="0.01" value={addRating} onChange={(e) => setAddRating(e.target.value)} placeholder={tr("rating")} />
              <button onClick={addPlayer} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm uppercase text-white hover:bg-white/10">{tr("Añadir")}</button>
            </div>
            <div className="space-y-1.5">
              {players.length === 0 && <p className="text-sm text-white/40">{tr("Sin participantes todavía.")}</p>}
              {players.map((p) => (
                <div key={p.playerId} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-base-700/50 px-3 py-2 text-sm">
                  <span className="min-w-[120px] font-display font-bold uppercase text-white">{p.nick ?? p.playerId}</span>
                  <span className="text-white/40">{p.teamId}</span>
                  <input className={cn(inputCls, "ml-auto w-24")} type="number" step="0.01" defaultValue={p.rating ?? 1}
                    onBlur={(e) => setRating(p, Number(e.target.value))} />
                  <label className="flex items-center gap-1 text-xs text-white/60">
                    <input type="checkbox" checked={p.isMvp} onChange={(e) => setRating(p, p.rating ?? 1, e.target.checked)} /> {tr("MVP")}
                  </label>
                </div>
              ))}
            </div>

            {teams.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-widest text-white/40">{tr("Equipo ganador:")}</span>
                {teams.map((t) => (
                  <button key={t} onClick={() => setWinner(t)}
                    className={cn("rounded-lg border px-3 py-1.5 text-xs uppercase",
                      current.winnerTeamId === t ? "border-drl-gold bg-drl-gold/15 text-drl-gold" : "border-white/15 bg-white/5 text-white hover:bg-white/10")}>
                    {td(t)}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
              <button onClick={finish} className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2.5 font-display text-sm font-bold uppercase text-white shadow-glow hover:brightness-110">
                {tr("Finalizar torneo → generar cartas")}
              </button>
              {teams.map((t) => (
                <button key={t} onClick={() => eliminate(t)} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-xs uppercase text-white hover:bg-white/10">
                  {tr("Equipo eliminado:")} {td(t)}
                </button>
              ))}
            </div>
          </Panel>

          {/* Cartas generadas */}
          <Panel title={tr("Cartas generadas ({length} + {length2} especiales)", { length: cards.length, length2: specials.length })}>
            {specials.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {specials.map((s) => (
                  <span key={s.id} className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold uppercase",
                    s.kind === "mvp" ? "bg-[#ff2e63]/20 text-[#ff9ab6]" : "bg-drl-gold/20 text-drl-gold")}>
                    {s.kind === "mvp" ? tr("MYTHIC") : tr("CHAMPION")} · {s.player_id}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {cards.map((c) => (
                <span key={c.id} className="rounded-md border border-white/10 bg-base-700/50 px-2 py-1 text-[11px] text-white/70">
                  {c.player_id} · <span className="text-white/40">{td(c.rarity_tier)}</span> · {c.variant_id}
                </span>
              ))}
              {cards.length === 0 && <p className="text-sm text-white/40">{tr("Aún no se han generado cartas.")}</p>}
            </div>
          </Panel>

          {/* Historial */}
          <Panel title={tr("Historial de generaciones ({length})", { length: gens.length })}>
            <div className="space-y-1.5">
              {gens.map((g) => (
                <div key={g.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-base-700/50 px-3 py-2 text-sm">
                  <span className="text-white">{g.trigger === "finish" ? tr("Finalización") : tr("Eliminado {team_id}", { team_id: g.team_id })}</span>
                  <span className="text-white/50">{tr("{cartas} cartas · {especiales} especiales", { cartas: g.cards_generated, especiales: g.special_generated })}</span>
                  <span className="text-[11px] text-white/30">{new Date(g.created_at).toLocaleString(getIntlLocale())}</span>
                </div>
              ))}
              {gens.length === 0 && <p className="text-sm text-white/40">{tr("Sin generaciones todavía.")}</p>}
            </div>
          </Panel>
        </>
      )}

      {/* Motor de rareza editable */}
      <Panel title={tr("Motor de rareza (editable)")}>
        <div className="space-y-1.5">
          {rules.map((r) => (
            <div key={r.tier} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-base-700/50 px-3 py-2 text-sm">
              <span className="min-w-[120px] font-display font-bold uppercase" style={{ color: r.color ?? "#fff" }}>{td(r.label)}</span>
              <span className="text-[11px] uppercase text-white/40">{r.kind}</span>
              {r.kind === "rating" && (
                <label className="flex items-center gap-1 text-xs text-white/60">
                  {tr("rating ≥")}
                  <input className={cn(inputCls, "w-24")} type="number" step="0.01" defaultValue={r.minRating ?? 0}
                    onBlur={(e) => editRuleRating(r, Number(e.target.value))} />
                </label>
              )}
              <span className="text-white/40">→ {td(r.accolade) || tr("carta base")}</span>
              <button onClick={() => toggleRule(r)} className={cn("ml-auto rounded px-2 py-1 text-[11px] uppercase",
                r.active ? "bg-drl-cyan/15 text-drl-cyan" : "bg-white/5 text-white/40")}>
                {r.active ? tr("activa") : tr("inactiva")}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-white/40">
          {tr("El tier (por rating) decide la variante/accolade que recibe el jugador. MVP→MYTHIC y Champion→CHAMPION son cartas especiales.")}
        </p>
      </Panel>

      <Toast toast={toast} />
    </section>
  );
}

function Header() {
  useLocale();
  return (
    <header className="mb-2">
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">{tr("Admin · Torneos")}</h1>
      <p className="mt-1 text-white/50">{tr("Crea torneos, gestiona participantes y genera cartas automáticamente.")}</p>
    </header>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
      <h2 className="mb-3 font-display text-lg font-bold uppercase tracking-wide text-white">{td(title)}</h2>
      {children}
    </div>
  );
}
