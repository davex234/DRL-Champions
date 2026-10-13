"use client";

/**
 * TOURNAMENT CONTROL CENTER (/admin/tournament-control) — punto único de control del ciclo de
 * vida de un torneo (Tournament Automation · Fase 5/5). Solo ORQUESTACIÓN VISUAL: cada vista
 * es una proyección pura de `src/tournament-control/` y cada acción delega en los motores
 * existentes (Editorial F4 · Publisher). Aquí no se calcula ni una carta.
 */
import { useMemo, useEffect, useState } from "react";
import { allPlayers } from "@/data/catalog";
import {
  buildDashboard, applyDashboardFilter, sortDashboardRows, searchControl, buildHistory,
  buildMetrics, buildReport, generationDetail, compareGenerations, reviewRows, currentRuntimeInfo,
  RECORD_STATUSES,
  type DashboardRow, type DashboardSortKey, type RecordStatus, type ControlActionMeta,
} from "@/tournament-control";
import { useControlStore } from "@/tournament-control/store";
import type { EditorialAction } from "@/editorial";
import { cn } from "@/lib/format";

const STATE_COLOR: Record<string, string> = {
  generated: "border-white/20 text-white/60",
  "in-review": "border-sky-400/40 text-sky-300",
  approved: "border-emerald-400/40 text-emerald-300",
  published: "border-drl/60 text-drl",
  "rolled-back": "border-orange-400/40 text-orange-300",
  archived: "border-white/15 text-white/35",
  // estados editoriales por carta
  draft: "border-white/20 text-white/50",
  review: "border-sky-400/40 text-sky-300",
  rejected: "border-red-400/40 text-red-300",
  hidden: "border-white/25 text-white/40",
  blocked: "border-orange-400/40 text-orange-300",
};

const ACTION_LABEL: Partial<Record<EditorialAction, string>> = {
  approve: "✓", reject: "✗", hide: "◌", block: "⛔", to_review: "↩", archive: "🗄",
};

const SORTS: { key: DashboardSortKey; label: string }[] = [
  { key: "date", label: "Fecha" },
  { key: "tournament", label: "Torneo" },
  { key: "cards", label: "Cartas" },
  { key: "approved", label: "Aprobadas" },
  { key: "published", label: "Publicadas" },
  { key: "status", label: "Estado" },
];

export default function TournamentControlPage() {
  const ledger = useControlStore((s) => s.ledger);
  const lastError = useControlStore((s) => s.lastError);
  const store = useControlStore();
  const [mounted, setMounted] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RecordStatus | "">("");
  const [sort, setSort] = useState<DashboardSortKey>("date");
  const [panel, setPanel] = useState<"detalle" | "historial" | "metricas" | "comparador">("detalle");
  useEffect(() => setMounted(true), []);

  const rt = useMemo(() => (mounted ? currentRuntimeInfo() : { runtimeVersion: 0, generationId: "" }), [mounted, ledger]);
  const rows = useMemo(() => {
    let out = buildDashboard(ledger, rt);
    out = applyDashboardFilter(out, { status: status || undefined });
    return sortDashboardRows(out, sort, sort === "date" ? "desc" : "asc");
  }, [ledger, rt, status, sort]);
  const hits = useMemo(() => searchControl(ledger, search).slice(0, 40), [ledger, search]);
  const metrics = useMemo(() => buildMetrics(ledger), [ledger]);

  const rec = selected ? ledger.records[selected] : undefined;
  const other = compareWith ? ledger.records[compareWith] : undefined;
  const meta = (): ControlActionMeta => ({ actor: "admin", at: Date.now() });

  if (!mounted) return null;

  return (
    <section className="animate-rise space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            Tournament <span className="text-drl">Control</span>
          </h1>
          <p className="mt-1 text-white/50">Ciclo de vida completo: importar → generar → revisar → publicar → rollback.</p>
        </div>
        <div className="text-right text-[11px] text-white/45">
          <p>runtime v{rt.runtimeVersion} {rt.generationId && <span className="font-mono text-white/70">· {rt.generationId}</span>}</p>
          <p>{metrics.records} registro(s) · {metrics.tournaments} torneo(s) · {metrics.publications} publicación(es) · {metrics.rollbacks} rollback(s)</p>
        </div>
      </header>

      {lastError && (
        <p className="rounded-xl border border-red-400/40 bg-red-400/10 px-3 py-2 text-[12px] text-red-300">⚠ {lastError}</p>
      )}

      {ledger.order.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-base-700/40 p-10 text-center text-white/55">
          <p className="font-display text-lg font-bold text-white/80">Sin torneos registrados</p>
          <p className="mt-2 text-sm">
            Genera un torneo con <code className="rounded bg-white/10 px-1.5 py-0.5 text-drl-cyan">npm run tournament:generate &lt;url&gt;</code>.
            El panel registra generaciones vía <code className="text-drl-cyan">ingestRun</code> / <code className="text-drl-cyan">generateForReview</code> (F5 Watcher las alimentará automáticamente).
          </p>
        </div>
      ) : (
        <>
          {/* Búsqueda + filtros + orden */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-base-700/40 p-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar torneo / generación / carta…"
              className="w-64 rounded-lg border border-white/15 bg-base-800 px-2.5 py-1.5 text-[12px] text-white/80 outline-none placeholder:text-white/30" />
            <label className="flex items-center gap-1.5 text-[11px] text-white/50">
              <span className="uppercase tracking-widest text-white/40">Estado</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as RecordStatus | "")}
                className="rounded-lg border border-white/15 bg-base-800 px-2 py-1.5 text-white/80 outline-none">
                <option value="">Todos</option>
                {RECORD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[10px] uppercase tracking-widest text-white/40">Orden</span>
              {SORTS.map((s) => (
                <button key={s.key} onClick={() => setSort(s.key)}
                  className={cn("rounded-lg px-2.5 py-1.5 font-display text-[11px] uppercase tracking-wide",
                    sort === s.key ? "bg-drl text-white" : "text-white/50 hover:bg-white/10")}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {search.trim() && (
            <div className="max-h-44 overflow-y-auto rounded-2xl border border-white/10 bg-base-700/40 p-3 text-[11px] leading-5 text-white/60">
              {hits.length === 0 ? "Sin resultados." : hits.map((h, i) => (
                <button key={`${h.kind}-${h.ref}-${i}`} onClick={() => { setSelected(h.recordId); setSearch(""); }}
                  className="block w-full truncate rounded px-1 text-left hover:bg-white/10">
                  <span className="mr-2 rounded-full border border-white/15 px-1.5 font-display text-[9px] uppercase text-white/40">{h.kind}</span>
                  <span className="font-mono text-drl-cyan">{h.ref}</span> · {h.label}
                </button>
              ))}
            </div>
          )}

          {/* Dashboard */}
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-base-700/40">
            <table className="w-full text-left text-[11px] leading-5 text-white/65">
              <thead className="border-b border-white/10 font-display text-[10px] uppercase tracking-widest text-white/40">
                <tr>{["Torneo", "GenerationId", "Fecha", "Estado", "Cartas", "Aprob.", "Pend.", "Bloq.", "Rech.", "Publ.", "Runtime", "Catálogo"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => <Row key={r.recordId} r={r} selected={selected === r.recordId} onClick={() => setSelected(r.recordId)} />)}
              </tbody>
            </table>
          </div>

          {/* Detalle del registro seleccionado */}
          {rec && (
            <div className="space-y-3 rounded-2xl border border-drl/30 bg-base-700/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[12px] text-drl-cyan">{rec.recordId}</p>
                <span className="text-[11px] text-white/45">{rec.tournamentName} · S{rec.season} · {rec.source}{rec.revisionOf ? ` · revisión de ${rec.revisionOf}` : ""}</span>
                <div className="ml-auto flex items-center gap-1">
                  {(["detalle", "historial", "metricas", "comparador"] as const).map((p) => (
                    <button key={p} onClick={() => setPanel(p)}
                      className={cn("rounded-lg px-2.5 py-1.5 font-display text-[11px] uppercase tracking-wide",
                        panel === p ? "bg-drl text-white" : "text-white/50 hover:bg-white/10")}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Acciones */}
              <div className="flex flex-wrap items-center gap-2">
                {!rec.editorial && (
                  <Action color="sky" onClick={() => store.open(rec.recordId, meta())}>▶ Abrir revisión</Action>
                )}
                {rec.editorial && (
                  <>
                    <Action color="emerald" onClick={() => {
                      const inReview = reviewRows(rec).filter((r) => r.state === "review").slice(0, 25).map((r) => r.cardId);
                      if (inReview.length) store.decide(rec.recordId, inReview, "approve", meta());
                    }}>✓ Aprobar lote</Action>
                    <Action color="emerald" onClick={() => store.approveAll(rec.recordId, meta())}>✓✓ Aprobar generación</Action>
                    <Action color="drl" onClick={() => void store.publish(rec.recordId, { ...meta(), roster: allPlayers() })}>⤴ Publicar aprobadas</Action>
                    <Action color="white" onClick={() => store.reopen(rec.recordId, meta())}>↩ Reabrir revisión</Action>
                  </>
                )}
                <Action color="orange" onClick={() => store.rollback(rec.recordId, meta())}>⟲ Rollback</Action>
                <Action color="white" onClick={() => store.duplicate(rec.recordId, meta())}>⧉ Duplicar para revisión</Action>
                <Action color="white" onClick={() => {
                  const report = buildReport(ledger, rec.recordId, rt, Date.now());
                  if (!report) return;
                  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `informe-${rec.recordId}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}>⇩ Exportar informe</Action>
              </div>

              {panel === "detalle" && <DetailPanel rec={rec} onAct={(ids, a) => store.decide(rec.recordId, ids, a, meta())} />}
              {panel === "historial" && <HistoryPanel entries={buildHistory(ledger, rec.recordId)} />}
              {panel === "metricas" && <MetricsPanel rec={rec} />}
              {panel === "comparador" && (
                <ComparePanel ledger={ledger} rec={rec} other={compareWith} setOther={setCompareWith} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Row({ r, selected, onClick }: { r: DashboardRow; selected: boolean; onClick: () => void }) {
  return (
    <tr onClick={onClick} className={cn("cursor-pointer border-b border-white/5 hover:bg-white/5", selected && "bg-drl/10")}>
      <td className="px-3 py-2 text-white/80">{r.tournamentName}{r.revisionOf ? <span className="text-white/35"> · {r.recordId.split("~")[1]}</span> : ""}</td>
      <td className="px-3 py-2 font-mono text-[10px] text-drl-cyan">{r.generationId}</td>
      <td className="px-3 py-2">{new Date(r.date).toLocaleDateString()}</td>
      <td className="px-3 py-2">
        <span className={cn("rounded-full border px-2 py-0.5 font-display text-[9px] uppercase tracking-wide", STATE_COLOR[r.status])}>
          {r.status}{r.live ? " · live" : ""}
        </span>
      </td>
      <td className="px-3 py-2">{r.cards}</td>
      <td className="px-3 py-2 text-emerald-300">{r.approved}</td>
      <td className="px-3 py-2 text-sky-300">{r.pending}</td>
      <td className="px-3 py-2 text-orange-300">{r.blocked}</td>
      <td className="px-3 py-2 text-red-300">{r.rejected}</td>
      <td className="px-3 py-2 text-drl">{r.published}</td>
      <td className="px-3 py-2">v{r.runtimeVersion}</td>
      <td className="px-3 py-2 font-mono text-[10px]">{r.catalogVersion || "—"}</td>
    </tr>
  );
}

const ACTION_COLORS: Record<string, string> = {
  emerald: "border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10",
  sky: "border-sky-400/40 text-sky-300 hover:bg-sky-400/10",
  orange: "border-orange-400/40 text-orange-300 hover:bg-orange-400/10",
  drl: "border-drl/60 text-drl hover:bg-drl/10",
  white: "border-white/15 text-white/60 hover:bg-white/10",
};

function Action({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn("rounded-lg border px-3 py-1.5 font-display text-[11px] uppercase tracking-wide", ACTION_COLORS[color])}>
      {children}
    </button>
  );
}

function DetailPanel({ rec, onAct }: {
  rec: import("@/tournament-control").GenerationRecord;
  onAct: (ids: string[], a: EditorialAction) => void;
}) {
  const d = generationDetail(rec);
  const cards = reviewRows(rec);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[11px] text-white/55">
        <Chip label="Cartas" value={d.cards} />
        <Chip label="Jugadores" value={`${d.players.resolved}+${d.players.created} nuevos`} />
        <Chip label="Grants" value={d.grants} />
        <Chip label="Badges" value={d.badges} />
        <Chip label="Omitidas" value={d.omitted} />
        <Chip label="Valor est." value={d.estimatedValueTotal} />
        {Object.entries(d.byRarity).map(([k, v]) => <Chip key={k} label={k} value={v} />)}
      </div>
      <div className="grid max-h-80 gap-1 overflow-y-auto md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <div key={c.cardId} className="flex items-center gap-2 rounded-lg border border-white/5 bg-base-800/60 px-2 py-1 text-[11px] text-white/60">
            <span className="font-mono text-[10px] text-drl-cyan">{c.cardId}</span>
            <span>OVR {c.ovr}</span>
            {c.state && (
              <span className={cn("rounded-full border px-1.5 font-display text-[8px] uppercase", STATE_COLOR[c.state])}>{c.state}</span>
            )}
            <span className="ml-auto flex gap-1">
              {c.actions.filter((a) => a !== "publish").map((a) => (
                <button key={a} title={a} onClick={() => onAct([c.cardId], a)}
                  className="rounded border border-white/10 px-1 text-[10px] text-white/50 hover:bg-white/10">
                  {ACTION_LABEL[a] ?? a}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="rounded-full border border-white/10 px-2.5 py-1">
      <span className="uppercase tracking-widest text-white/35">{label}</span> <b className="text-white/75">{value}</b>
    </span>
  );
}

function HistoryPanel({ entries }: { entries: import("@/tournament-control").HistoryEntry[] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-base-800/60 p-3 text-[11px] leading-5 text-white/60">
      {entries.map((e, i) => (
        <p key={i} className="truncate border-b border-white/5 py-0.5 font-mono">
          {new Date(e.at).toLocaleString()} · <span className={e.source === "control" ? "text-drl-cyan" : "text-sky-300"}>{e.source}</span> · <b className="text-white/80">{e.kind}</b> · {e.actor}
          {e.cardId ? <> · <span className="text-drl-cyan">{e.cardId}</span></> : ""} {e.detail ? ` · ${e.detail}` : ""}
        </p>
      ))}
    </div>
  );
}

function MetricsPanel({ rec }: { rec: import("@/tournament-control").GenerationRecord }) {
  const m = rec.metrics;
  return (
    <div className="flex flex-wrap gap-2 text-[11px] text-white/55">
      <Chip label="Total" value={`${m.totalMs} ms`} />
      {m.stages.map((s) => <Chip key={s.stage} label={s.stage} value={`${s.ms} ms`} />)}
      <Chip label="Equipos" value={m.teams} />
      <Chip label="Jugadores" value={m.players} />
      <Chip label="Partidos" value={m.matches} />
      <Chip label="Mapas" value={m.maps} />
      <Chip label="Generadas" value={m.cardsGenerated} />
      <Chip label="Materializadas" value={m.cardsMaterialized} />
      <Chip label="Publicadas" value={m.cardsPublished} />
      <Chip label="Catálogo" value={m.catalogVersion || "—"} />
      <Chip label="Runtime" value={`v${m.runtimeVersion}`} />
    </div>
  );
}

function ComparePanel({ ledger, rec, other, setOther }: {
  ledger: import("@/tournament-control").ControlLedger;
  rec: import("@/tournament-control").GenerationRecord;
  other: string | null;
  setOther: (id: string | null) => void;
}) {
  const candidates = ledger.order.filter((id) => id !== rec.recordId);
  const b = other ? ledger.records[other] : undefined;
  const cmp = b ? compareGenerations(rec, b) : null;
  return (
    <div className="space-y-2 text-[11px] text-white/60">
      <label className="flex items-center gap-2">
        <span className="uppercase tracking-widest text-white/40">Comparar con</span>
        <select value={other ?? ""} onChange={(e) => setOther(e.target.value || null)}
          className="rounded-lg border border-white/15 bg-base-800 px-2 py-1.5 text-white/80 outline-none">
          <option value="">—</option>
          {candidates.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      {cmp && (
        <div className="grid gap-2 md:grid-cols-2">
          <DiffList title={`Nuevas en B (${cmp.addedCards.length})`} items={cmp.addedCards} />
          <DiffList title={`Eliminadas en B (${cmp.removedCards.length})`} items={cmp.removedCards} />
          <DiffList title={`OVR modificados (${cmp.ovrChanged.length})`} items={cmp.ovrChanged.map((c) => `${c.cardId}: ${c.from} → ${c.to}`)} />
          <DiffList title={`Rarezas modificadas (${cmp.rarityChanged.length})`} items={cmp.rarityChanged.map((c) => `${c.cardId}: ${c.from} → ${c.to}`)} />
          <DiffList title={`Badges (${cmp.badgesChanged.length})`} items={cmp.badgesChanged.map((c) => `${c.cardId}: +${c.added.length} −${c.removed.length}`)} />
          <DiffList title={`Colección (${cmp.collectionChanged.length})`} items={cmp.collectionChanged.map((c) => `${c.cardId}: ${c.inA ? "A" : "—"} / ${c.inB ? "B" : "—"}`)} />
          <DiffList title={`Editoriales (${cmp.editorialChanged.length})`} items={cmp.editorialChanged.map((c) => `${c.cardId}: ${c.from} → ${c.to}`)} />
          {cmp.identical && <p className="text-emerald-300">Las generaciones son idénticas.</p>}
        </div>
      )}
    </div>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 p-2">
      <p className="mb-1 font-display text-[10px] uppercase tracking-widest text-white/40">{title}</p>
      <div className="max-h-32 overflow-y-auto font-mono text-[10px] leading-4 text-white/55">
        {items.length === 0 ? "—" : items.map((it, i) => <p key={i} className="truncate">{it}</p>)}
      </div>
    </div>
  );
}
