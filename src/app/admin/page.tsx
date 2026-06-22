"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ADMIN_ENABLED } from "@/config/admin";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useRosterStore, effectiveRoster, isSeedPlayer } from "@/store/useRosterStore";
import { cardsForPlayer } from "@/data/catalog";
import { computeOvr } from "@/domain/cards/ovr";
import { normalizeRawPlayer } from "@/data/sources/normalize";
import { parseJsonPlayers, parseCsv } from "@/data/sources/import";
import { regionCollections } from "@/domain/collections";
import { TEAMS } from "@/data/teams";
import { countryName } from "@/data/countries";
import type { Player, AccoladeId, Region, RoleId } from "@/domain/cards/types";
import type { RawPlayer } from "@/data/sources/types";
import { cn } from "@/lib/format";

const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];
const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const ACCOLADES: [AccoladeId, string][] = [
  ["masters-winner", "Masters Winner"],
  ["masters-mvp", "Masters MVP"],
  ["champions-winner", "Champions Winner"],
  ["champions-mvp", "Champions MVP"],
  ["ewc-winner", "EWC Winner"],
  ["ewc-mvp", "EWC MVP"],
  ["regional-winner", "Regional Winner"],
  ["regional-mvp", "Regional MVP"],
  ["prime", "Prime"],
  ["game-changers", "Game Changers"],
  ["icon", "Icon"],
  ["hall-of-fame", "Hall Of Fame"],
];

interface FormState {
  id: string;
  nick: string;
  fullName: string;
  team: string;
  region: Region;
  role: RoleId;
  country: string;
  status: "active" | "inactive";
  image: string;
  acs: string;
  kills: string;
  deaths: string;
  assists: string;
  hsPct: string;
  clutches: string;
  kast: string;
  dmg: string;
  scr: string;
  com: string;
  hs: string;
  ast: string;
  clu: string;
  accolades: AccoladeId[];
}

const EMPTY: FormState = {
  id: "", nick: "", fullName: "", team: "", region: "EMEA", role: "Flex", country: "",
  status: "active", image: "", acs: "", kills: "", deaths: "", assists: "", hsPct: "",
  clutches: "", kast: "", dmg: "", scr: "", com: "", hs: "", ast: "", clu: "", accolades: [],
};

export default function AdminPage() {
  if (!ADMIN_ENABLED) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-center">
        <div>
          <p className="font-display text-2xl font-bold uppercase text-white">Acceso restringido</p>
          <p className="mt-2 max-w-sm text-white/50">
            El panel de administración requiere la configuración <code className="text-drl">NEXT_PUBLIC_ADMIN=1</code>.
          </p>
        </div>
      </div>
    );
  }
  return (
    <HydrationGate>
      <Admin />
    </HydrationGate>
  );
}

function num(v: string): number | undefined {
  return v.trim() === "" ? undefined : Number(v);
}

function formToRaw(f: FormState): RawPlayer {
  const hasMetrics = [f.acs, f.kills, f.deaths, f.assists, f.hsPct, f.clutches, f.kast].some((x) => x.trim() !== "");
  const hasStats = [f.dmg, f.scr, f.com, f.hs, f.ast, f.clu].some((x) => x.trim() !== "");
  return {
    id: f.id.trim() || undefined,
    nick: f.nick,
    fullName: f.fullName,
    team: f.team,
    region: f.region,
    role: f.role,
    country: f.country,
    status: f.status,
    image: f.image,
    accolades: f.accolades,
    metrics: hasMetrics
      ? { acs: num(f.acs), kills: num(f.kills), deaths: num(f.deaths), assists: num(f.assists), hsPct: num(f.hsPct), clutches: num(f.clutches), kast: num(f.kast) }
      : undefined,
    stats: hasStats && !hasMetrics
      ? { dmg: num(f.dmg), scr: num(f.scr), com: num(f.com), hs: num(f.hs), ast: num(f.ast), clu: num(f.clu) }
      : undefined,
  };
}

function playerToForm(p: Player): FormState {
  return {
    ...EMPTY,
    id: p.id, nick: p.nick, fullName: p.fullName ?? "", team: p.team, region: p.region,
    role: p.role, country: p.country, status: p.status ?? "active", image: p.image ?? "",
    acs: p.metrics?.acs?.toString() ?? "", kills: p.metrics?.kills?.toString() ?? "",
    deaths: p.metrics?.deaths?.toString() ?? "", assists: p.metrics?.assists?.toString() ?? "",
    hsPct: p.metrics?.hsPct?.toString() ?? "", clutches: p.metrics?.clutches?.toString() ?? "",
    kast: p.metrics?.kast?.toString() ?? "",
    dmg: String(p.stats.dmg), scr: String(p.stats.scr), com: String(p.stats.com),
    hs: String(p.stats.hs), ast: String(p.stats.ast), clu: String(p.stats.clu),
    accolades: p.accolades,
  };
}

function Admin() {
  const { toast, notify } = useToast();
  const version = useRosterStore((s) => s.version);
  const store = useRosterStore();
  const roster = useMemo(() => effectiveRoster(store).sort((a, b) => a.nick.localeCompare(b.nick)), [store, version]);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const draft = useMemo(() => {
    try {
      return normalizeRawPlayer(formToRaw(form));
    } catch {
      return null;
    }
  }, [form]);
  const draftOvr = draft ? computeOvr(draft.stats) : 0;
  const draftCardCount = draft ? cardsForPlayer(draft).length : 0;

  const collections = useMemo(() => regionCollections(), [version]);
  const totalCards = useMemo(() => roster.reduce((n, p) => n + cardsForPlayer(p).length, 0), [roster]);

  function save() {
    if (!form.nick.trim() || !form.team.trim()) {
      notify("Nick y equipo son obligatorios", false);
      return;
    }
    const player = normalizeRawPlayer(formToRaw(form));
    store.addPlayers([player]);
    notify(`${player.nick} guardado · ${cardsForPlayer(player).length} cartas`, true);
    setForm(EMPTY);
    setEditing(false);
  }

  return (
    <section className="animate-rise space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            Panel de <span className="text-drl">Administración</span>
          </h1>
          <p className="mt-1 text-white/50">Importa jugadores reales y genera sus cartas automáticamente.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-center">
          <Stat label="Jugadores" value={roster.length} />
          <Stat label="Importados" value={store.customPlayers.filter((p) => !store.removed.includes(p.id)).length} />
          <Stat label="Cartas" value={totalCards} />
          <a href="/admin/data-engine" className="rounded-xl border border-drl/40 bg-drl/10 px-4 py-3 font-display text-sm uppercase tracking-wide text-drl transition hover:bg-drl/20">
            ⚙ Data Engine
          </a>
        </div>
      </header>

      {/* Formulario añadir/editar */}
      <div className="rounded-2xl border border-white/10 bg-base-700/40 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold uppercase tracking-wide text-white">
            {editing ? `Editar: ${form.nick}` : "Añadir jugador"}
          </h2>
          {editing && (
            <button onClick={() => { setForm(EMPTY); setEditing(false); }} className="text-xs text-white/50 hover:text-white">
              Cancelar edición
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Nick *"><input className={inputCls} value={form.nick} onChange={(e) => set("nick", e.target.value)} /></Field>
          <Field label="Nombre completo"><input className={inputCls} value={form.fullName} onChange={(e) => set("fullName", e.target.value)} /></Field>
          <Field label="Equipo *">
            <input className={inputCls} list="teams" value={form.team} onChange={(e) => set("team", e.target.value)} />
            <datalist id="teams">{Object.keys(TEAMS).map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="País (ISO o nombre)"><input className={inputCls} value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="ES, Reino Unido…" /></Field>
          <Field label="Región">
            <select className={inputCls} value={form.region} onChange={(e) => set("region", e.target.value as Region)}>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Rol">
            <select className={inputCls} value={form.role} onChange={(e) => set("role", e.target.value as RoleId)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Estado">
            <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value as "active" | "inactive")}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </select>
          </Field>
          <Field label="Imagen (ruta/URL)"><input className={inputCls} value={form.image} onChange={(e) => set("image", e.target.value)} placeholder="/players/id.png" /></Field>
        </div>

        <p className="mt-4 mb-1 text-[10px] uppercase tracking-widest text-white/40">Métricas reales (generan las stats)</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {(["acs", "kills", "deaths", "assists", "hsPct", "clutches", "kast"] as const).map((k) => (
            <Field key={k} label={k === "hsPct" ? "HS%" : k.toUpperCase()}>
              <input className={inputCls} type="number" value={form[k]} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>

        <p className="mt-4 mb-1 text-[10px] uppercase tracking-widest text-white/40">…o stats directas (si no hay métricas)</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(["dmg", "scr", "com", "hs", "ast", "clu"] as const).map((k) => (
            <Field key={k} label={k.toUpperCase()}>
              <input className={inputCls} type="number" value={form[k]} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>

        <p className="mt-4 mb-1 text-[10px] uppercase tracking-widest text-white/40">Palmarés (variantes especiales)</p>
        <div className="flex flex-wrap gap-1.5">
          {ACCOLADES.map(([id, label]) => {
            const on = form.accolades.includes(id);
            return (
              <button
                key={id}
                onClick={() => set("accolades", on ? form.accolades.filter((a) => a !== id) : [...form.accolades, id])}
                className={cn("rounded-full px-3 py-1 font-display text-xs uppercase tracking-wide transition", on ? "bg-drl text-white shadow-glow" : "border border-white/10 bg-white/5 text-white/55 hover:text-white")}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={save} className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110">
            {editing ? "Guardar cambios" : "Añadir y generar cartas"}
          </button>
          <p className="text-sm text-white/50">
            OVR previsto: <span className="font-display font-bold text-drl-gold">{draftOvr || "—"}</span> ·{" "}
            <span className="text-white/70">{draftCardCount}</span> cartas se generarán
          </p>
        </div>
      </div>

      <BulkImport notify={notify} />

      {/* Roster */}
      <div>
        <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
          Roster <span className="text-white/40">({roster.length})</span>
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-base-700/60 text-left text-[10px] uppercase tracking-widest text-white/40">
              <tr>
                <th className="px-3 py-2">Jugador</th>
                <th className="px-3 py-2">Equipo</th>
                <th className="px-3 py-2">Región</th>
                <th className="px-3 py-2">OVR</th>
                <th className="px-3 py-2">Cartas</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((p) => (
                <tr key={p.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2">
                    <div className="font-display font-bold text-white">{p.nick}</div>
                    <div className="text-[11px] text-white/40">
                      {countryName(p.country)} · {p.role}
                      {p.status === "inactive" && <span className="ml-1 text-white/30">(inactivo)</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-white/70">{p.team}</td>
                  <td className="px-3 py-2 text-white/70">{p.region}</td>
                  <td className="px-3 py-2 font-display font-bold text-drl-gold">{computeOvr(p.stats)}</td>
                  <td className="px-3 py-2 text-white/70">{cardsForPlayer(p).length}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] uppercase", isSeedPlayer(p.id) ? "bg-white/10 text-white/50" : "bg-drl-cyan/15 text-drl-cyan")}>
                      {isSeedPlayer(p.id) ? "Semilla" : "Importado"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Action onClick={() => { setForm(playerToForm(p)); setEditing(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Editar</Action>
                      <Action onClick={() => setPreview(p.id)}>Cartas</Action>
                      <Action onClick={() => { store.regenerateStats(p.id); notify(`Stats de ${p.nick} regeneradas`, true); }}>Regenerar</Action>
                      <Action danger onClick={() => { store.deletePlayer(p.id); notify(`${p.nick} eliminado`, true); }}>Eliminar</Action>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Colecciones auto-generadas */}
      <div>
        <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-wide text-white">
          Colecciones (auto-generadas)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {collections.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-base-700/50 p-4">
              <p className="font-display text-sm font-bold uppercase text-white">{c.name}</p>
              <p className="mt-1 font-display text-2xl font-bold text-drl-cyan">{c.cardIds.length}</p>
              <p className="text-xs text-white/40">cartas</p>
            </div>
          ))}
        </div>
      </div>

      {/* Zona peligrosa */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-drl/20 bg-drl/5 p-4">
        <p className="text-sm text-white/60">Restablecer todos los jugadores importados y ediciones:</p>
        <button
          onClick={() => { store.resetRoster(); notify("Roster restablecido a los datos semilla", true); }}
          className="rounded-xl border border-drl/40 bg-drl/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-drl transition hover:bg-drl/20"
        >
          Restablecer roster
        </button>
      </div>

      <AnimatePresence>
        {preview && <CardPreview playerId={preview} onClose={() => setPreview(null)} />}
      </AnimatePresence>

      <Toast toast={toast} />
    </section>
  );
}

const inputCls = "w-full rounded-lg border border-white/10 bg-base-800 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">{label}</span>
      {children}
    </label>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-700/60 px-4 py-2">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="font-display text-xl font-bold text-white">{value}</p>
    </div>
  );
}
function Action({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn("rounded-md px-2 py-1 font-display text-[11px] uppercase tracking-wide transition", danger ? "border border-drl/40 text-drl hover:bg-drl/10" : "border border-white/15 text-white/70 hover:bg-white/10 hover:text-white")}
    >
      {children}
    </button>
  );
}

function BulkImport({ notify }: { notify: (m: string, ok?: boolean) => void }) {
  const addPlayers = useRosterStore((s) => s.addPlayers);
  const [mode, setMode] = useState<"json" | "csv">("json");
  const [text, setText] = useState("");

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  }
  function doImport() {
    const res = mode === "json" ? parseJsonPlayers(text) : parseCsv(text);
    if (res.players.length) addPlayers(res.players);
    const errs = res.errors.length ? ` · ${res.errors.length} errores` : "";
    notify(res.players.length ? `Importados ${res.players.length} jugadores${errs}` : `Sin jugadores válidos${errs}`, res.players.length > 0);
  }

  const example = mode === "json"
    ? `[\n  {"nick":"f0rsakeN","team":"Paper Rex","region":"Pacific","role":"Duelista","country":"ID",\n   "metrics":{"acs":265,"kd":1.25,"hsPct":28,"assists":4,"clutches":7}, "accolades":["regional-mvp"]}\n]`
    : `nick,team,region,role,country,acs,kd,hspct,assists,clutches,accolades\nf0rsakeN,Paper Rex,Pacific,Duelista,ID,265,1.25,28,4,7,regional-mvp`;

  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-white">Importación masiva</h2>
        <div className="flex gap-1 rounded-lg border border-white/10 bg-base-800 p-0.5">
          {(["json", "csv"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1 font-display text-xs uppercase", mode === m ? "bg-drl text-white" : "text-white/50")}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={example}
        rows={6}
        className="w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2 font-mono text-xs text-white placeholder:text-white/25 focus:border-drl focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={doImport} className="rounded-xl bg-gradient-to-r from-drl-cyan to-[#0f8aa0] px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-[#021b22] transition hover:brightness-110">
          Importar {mode.toUpperCase()}
        </button>
        <label className="cursor-pointer rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-sm uppercase tracking-wide text-white transition hover:bg-white/10">
          Cargar archivo
          <input type="file" accept=".json,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
        </label>
        <button onClick={() => setText(example)} className="text-xs text-white/45 hover:text-white">Cargar ejemplo</button>
      </div>
    </div>
  );
}

function CardPreview({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const cards = useMemo(() => {
    const p = effectiveRoster(useRosterStore.getState()).find((x) => x.id === playerId);
    return p ? cardsForPlayer(p).sort((a, b) => b.ovr - a.ovr) : [];
  }, [playerId]);

  return (
    <motion.div className="fixed inset-0 z-[75] grid place-items-center bg-black/80 p-4 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-base-800 p-6" initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94 }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-xl font-bold uppercase text-white">Cartas generadas ({cards.length})</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white">✕</button>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          {cards.map((c) => <PlayerCard key={c.id} card={c} size="sm" interactive={false} />)}
        </div>
      </motion.div>
    </motion.div>
  );
}
