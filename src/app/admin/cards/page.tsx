"use client";

/**
 * F58 · /admin/cards — CATÁLOGO PROFESIONAL.
 *
 * Reutiliza el backend existente (`/api/admin/cards`, acciones `list`/`facets`/`lifecycle`/`create`): filtros y paginación
 * en la base de datos (content_cards). Cada fila se enriquece con la definición del catálogo (arte REAL con `CardThumb`,
 * rol, clase F57.3 y `marketValue`). Acciones masivas seguras: exportar (CSV/JSON) y cambiar estado con confirmación
 * fuerte. Sin borrado: las cartas se RETIRAN/ARCHIVAN (el ciclo de vida existente), nunca se eliminan.
 * Importación: DRY RUN obligatorio (validación en servidor) → confirmar crea BORRADORES.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminPost, useDebounced, fmt, dateOnly } from "@/components/admin/cc/api";
import { PageHeader, Panel, SearchBox, Select, Field, DataTable, Pager, ErrorBox, Loading, Pill, Button, ConfirmDialog, Textarea, LinkButton } from "@/components/admin/cc/ui";
import { CardThumb } from "@/components/cards/CardThumb";
import { getCard } from "@/data/catalog";
import { marketValue } from "@/domain/economy/pricing";
import { PACK_CLASS_LABEL, packCardClass } from "@/domain/packs/packClass";
import { useEffect } from "react";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("admin");

interface Row { cardId: string; playerId: string; nick: string; team: string; variantId: string; variantLabel: string; rarityBucket: string; ovr: number; lifecycle: string; definitionVersion: number; origin: string; pools: number; createdAt: string; publishedAt: string | null }
interface ListRes { rows: Row[]; total: number; page: number; pageSize: number }
const LIFECYCLE_TONE: Record<string, "ok" | "gold" | "cyan" | "default" | "bad"> = { PUBLISHED: "ok", DRAFT: "gold", REVIEW: "cyan", APPROVED: "cyan", RETIRED: "default", ARCHIVED: "default", REJECTED: "bad" };
const BULK_STATES = ["REVIEW", "APPROVED", "PUBLISHED", "RETIRED", "ARCHIVED"] as const;

function useCardList(filters: Record<string, unknown>) {
  useLocale();
  const key = JSON.stringify(filters);
  const dkey = useDebounced(key, 300);
  const [state, setState] = useState<{ data: ListRes | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    adminPost<ListRes>("/api/admin/cards", { action: "list", ...JSON.parse(dkey) })
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e) => alive && setState({ data: null, error: e instanceof Error ? e.message : tr("Error"), loading: false }));
    return () => { alive = false; };
  }, [dkey, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export default function AdminCards() {
  useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [variant, setVariant] = useState("");
  const [bucket, setBucket] = useState("");
  const [cls, setCls] = useState("");
  const [role, setRole] = useState("");
  const [minOvr, setMinOvr] = useState("");
  const [sort, setSort] = useState("ovr");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "state">(null);
  const [importOpen, setImportOpen] = useState(false);
  const list = useCardList({ q: q.trim() || undefined, lifecycle: lifecycle || undefined, variant: variant || undefined, bucket: bucket || undefined, sort, dir: "desc", page, pageSize: 50 });

  const rows = useMemo(() => (list.data?.rows ?? []).map((r) => {
    const def = getCard(r.cardId);
    return { ...r, def, cls: def ? packCardClass(def) : null, value: def ? marketValue(def) : null, role: def?.role ?? null };
  }).filter((r) => (!cls || r.cls === cls) && (!role || r.role === role) && (!minOvr || r.ovr >= Number(minOvr))), [list.data, cls, role, minOvr]);

  const exportRows = (fmtType: "csv" | "json") => {
    const src = rows.filter((r) => selected.size === 0 || selected.has(r.cardId)).map((r) => ({ cardId: r.cardId, playerId: r.playerId, nick: r.nick, team: r.team, edition: r.variantId, packClass: r.cls, ovr: r.ovr, role: r.role, lifecycle: r.lifecycle, version: r.definitionVersion, marketValue: r.value, pools: r.pools }));
    const text = fmtType === "json" ? JSON.stringify(src, null, 2)
      : [Object.keys(src[0] ?? { cardId: "" }).join(","), ...src.map((o) => Object.values(o).map((v) => { const s = String(v ?? ""); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; }).join(","))].join("\n");
    const blob = new Blob([text], { type: fmtType === "json" ? "application/json" : "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = tr("cartas-{v}.{fmtType}", { v: new Date().toISOString().slice(0, 10), fmtType }); a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader eyebrow={tr("Contenido")} title={tr("Cartas")} description={tr("Catálogo persistido (content_cards). El arte es el asset real de la carta; el valor, el `marketValue` canónico (F57.5B).")}
        actions={<><Button variant="ghost" onClick={() => setImportOpen(true)}>{tr("Importar…")}</Button><LinkButton href="/admin/cartas/nueva">{tr("Alta derivada (avanzado)")}</LinkButton><LinkButton href="/admin/cards/new" variant="primary">{tr("+ Nueva carta")}</LinkButton></>} />
      <Panel>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <div className="sm:col-span-2"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={tr("cardId o jugador…")} label={tr("Buscar cartas")} /></div>
          <Field label={tr("Estado")} htmlFor="c-l"><Select id="c-l" value={lifecycle} onChange={(e) => { setLifecycle(e.target.value); setPage(1); }}><option value="">{tr("Todos")}</option>{["DRAFT", "REVIEW", "APPROVED", "PUBLISHED", "RETIRED", "ARCHIVED", "REJECTED"].map((s) => <option key={s}>{td(s)}</option>)}</Select></Field>
          <Field label={tr("Edición")} htmlFor="c-v"><Select id="c-v" value={variant} onChange={(e) => { setVariant(e.target.value); setPage(1); }}><option value="">{tr("Todas")}</option>{["base", "masters-l", "masters-sdc", "future-star", "champions-s", "record-breaker", "moments"].map((s) => <option key={s}>{td(s)}</option>)}</Select></Field>
          <Field label={tr("Rareza")} htmlFor="c-b"><Select id="c-b" value={bucket} onChange={(e) => { setBucket(e.target.value); setPage(1); }}><option value="">{tr("Todas")}</option>{["common", "uncommon", "rare", "epic", "legendary"].map((s) => <option key={s}>{td(s)}</option>)}</Select></Field>
          <Field label={tr("Clase (página)")} htmlFor="c-c"><Select id="c-c" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">{tr("Todas")}</option>{Object.entries(PACK_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{td(v)}</option>)}</Select></Field>
          <Field label={tr("Rol (página)")} htmlFor="c-r"><Select id="c-r" value={role} onChange={(e) => setRole(e.target.value)}><option value="">{tr("Todos")}</option>{["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"].map((s) => <option key={s}>{td(s)}</option>)}</Select></Field>
          <Field label={tr("Orden")} htmlFor="c-s"><Select id="c-s" value={sort} onChange={(e) => setSort(e.target.value)}><option value="ovr">{tr("OVR")}</option><option value="card_id">{tr("cardId")}</option><option value="created_at">{tr("Creación")}</option><option value="updated_at">{tr("Edición")}</option></Select></Field>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-ink-faint">{selected.size ? tr("{size} seleccionadas", { size: selected.size }) : tr("Selección: ninguna (acciones sobre la página)")}</span>
          <Button size="sm" variant="ghost" onClick={() => exportRows("csv")} disabled={!rows.length}>{tr("Exportar CSV")}</Button>
          <Button size="sm" variant="ghost" onClick={() => exportRows("json")} disabled={!rows.length}>{tr("Exportar JSON")}</Button>
          <Button size="sm" variant="danger" onClick={() => setBulk("state")} disabled={!selected.size}>{tr("Cambiar estado…")}</Button>
          <label htmlFor="c-min" className="ml-auto text-ink-faint">{tr("OVR mínimo")}</label><input id="c-min" value={minOvr} onChange={(e) => setMinOvr(e.target.value.replace(/\D/g, "").slice(0, 2))} className="nx-focus w-14 rounded-control border border-white/10 bg-surface-base px-2 py-1 text-ink-primary" />
        </div>
        {list.error && <ErrorBox error={td(list.error)} onRetry={list.reload} />}
        {!list.data && !list.error && <Loading rows={8} />}
        {list.data && (
          <>
            <DataTable caption={tr("Cartas")} rows={rows} rowKey={(r) => r.cardId} selectable selected={selected} onSelect={setSelected} onRowClick={(r) => router.push(`/admin/cards/${encodeURIComponent(r.cardId)}`)} empty={tr("Ninguna carta con estos filtros")}
              cols={[
                { key: "a", label: tr("Arte"), render: (r) => r.def ? <CardThumb card={r.def} width={40} /> : <span className="text-ink-faint">—</span> },
                { key: "p", label: tr("Jugador"), render: (r) => <span><span className="font-semibold text-ink-primary">{r.nick}</span><span className="block text-[11px] text-ink-faint">{r.team}</span></span>, sort: (r) => r.nick.toLowerCase() },
                { key: "v", label: tr("Edición"), render: (r) => <span className="text-ink-muted">{td(r.variantLabel)}</span> },
                { key: "k", label: tr("Clase"), render: (r) => r.cls ? <Pill tone={r.cls === "icon" ? "gold" : r.cls === "prime" ? "cyan" : r.cls === "champions" ? "drl" : "default"}>{td(PACK_CLASS_LABEL[r.cls])}</Pill> : "—" },
                { key: "o", label: "OVR", align: "right", render: (r) => <span className="font-display text-[15px] font-bold text-ink-primary">{r.ovr}</span>, sort: (r) => r.ovr },
                { key: "r", label: tr("Rol"), render: (r) => r.role ?? "—" },
                { key: "s", label: tr("Estado"), render: (r) => <Pill tone={LIFECYCLE_TONE[r.lifecycle] ?? "default"}>{td(r.lifecycle)}</Pill> },
                { key: "m", label: tr("Valor"), align: "right", render: (r) => fmt(r.value), sort: (r) => r.value ?? 0 },
                { key: "id", label: tr("Id · versión"), render: (r) => <span className="text-[11px] text-ink-faint">{r.cardId}<span className="block">v{r.definitionVersion} · {dateOnly(r.createdAt)}</span></span> },
              ]} />
            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(p) => { setPage(p); setSelected(new Set()); }} />
          </>
        )}
      </Panel>
      {bulk === "state" && <BulkState ids={[...selected]} onClose={() => setBulk(null)} onDone={() => { setBulk(null); setSelected(new Set()); list.reload(); }} />}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); list.reload(); }} />}
    </>
  );
}

function BulkState({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  useLocale();
  const [state, setState] = useState<(typeof BULK_STATES)[number]>("REVIEW");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const run = async () => {
    setBusy(true); setError(null); const out: string[] = [];
    for (const cardId of ids) {
      try { await adminPost("/api/admin/cards", { action: "lifecycle", cardId, state, reason }); out.push(`✔ ${cardId}`); }
      catch (e) { out.push(`✖ ${cardId}: ${e instanceof Error ? e.message : "error"}`); }
      setLog([...out]);
    }
    setBusy(false);
    if (out.every((l) => l.startsWith("✔"))) onDone(); else setError(tr("Algunas cartas no cambiaron (ver detalle). Las transiciones inválidas las rechaza el servidor."));
  };
  return (
    <ConfirmDialog open risk="CRITICAL" title={tr("Cambiar el estado de {length} carta(s)", { length: ids.length })} confirmLabel={tr("Aplicar a todas")} busy={busy} error={td(error)} typeToConfirm={`${ids.length} cartas`} canConfirm={reason.trim().length >= 8} onClose={onClose} onConfirm={run}>
      <p>{fill(tr("Pasa por la RPC del ciclo de vida ({rpc}) carta a carta, con su validación de transiciones y su auditoría. {nada}: RETIRED/ARCHIVED sacan la carta de los sobres pero conservan colecciones y referencias.", slots("rpc", "nada")), { rpc: <code>app_content_set_lifecycle</code>, nada: <b>{tr("No borra nada")}</b> })}</p>
      <Field label={tr("Nuevo estado")} htmlFor="b-s"><Select id="b-s" value={state} onChange={(e) => setState(e.target.value as typeof state)}>{BULK_STATES.map((s) => <option key={s}>{td(s)}</option>)}</Select></Field>
      <Field label={tr("Motivo")} htmlFor="b-r" hint={tr("Mínimo 8 caracteres; queda en la auditoría de cada carta")}><Textarea id="b-r" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      {log.length > 0 && <pre className="max-h-40 overflow-auto rounded bg-black/40 p-2 text-[11px]">{log.join("\n")}</pre>}
    </ConfirmDialog>
  );
}

interface Verdict { line: number; playerId: string; variantId: string; cardId: string; status: "valid" | "warning" | "error" | "duplicate"; messages: string[] }
function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  useLocale();
  const [text, setText] = useState("");
  const [dry, setDry] = useState<{ rows: Verdict[]; summary: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const parse = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^playerId\s*,/i.test(l)).map((l) => { const [playerId, variantId, ...rest] = l.split(","); return { playerId: (playerId ?? "").trim(), variantId: (variantId ?? "").trim(), reason: rest.join(",").trim() }; });
  const runDry = async () => {
    setBusy(true); setError(null); setDry(null);
    try { setDry(await adminPost("/api/admin/catalog", { action: "import_dry_run", rows: parse(text) })); } catch (e) { setError(e instanceof Error ? e.message : tr("Error")); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!dry) return;
    setBusy(true); const out: string[] = [];
    const src = parse(text);
    for (const v of dry.rows.filter((r) => r.status === "valid" || r.status === "warning")) {
      try { await adminPost("/api/admin/cards", { action: "create", playerId: v.playerId, variantId: v.variantId, reason: src[v.line - 1].reason }); out.push(tr("✔ {cardId} (borrador)", { cardId: v.cardId })); }
      catch (e) { out.push(`✖ ${v.cardId}: ${e instanceof Error ? e.message : "error"}`); }
      setLog([...out]);
    }
    setBusy(false);
    if (out.every((l) => l.startsWith("✔"))) onDone();
  };
  const creatable = dry ? dry.rows.filter((r) => r.status === "valid" || r.status === "warning").length : 0;
  return (
    <ConfirmDialog open risk="HIGH" title={tr("Importar cartas")} confirmLabel={dry ? tr("Crear {creatable} borrador(es)", { creatable }) : tr("Validar primero")} busy={busy} error={td(error)} canConfirm={!!dry && creatable > 0} onClose={onClose} onConfirm={commit}>
      <p>{fill(tr("Una fila por carta: {formato}. Primero se valida en el servidor ({dry}, no escribe nada); al confirmar se crean {borradores} con la acción de alta existente, que vuelve a validar cada uno.", slots("formato", "dry", "borradores")), { formato: <code>playerId,variantId,motivo</code>, dry: <b>{tr("dry run")}</b>, borradores: <b>{tr("borradores")}</b> })}</p>
      <Field label={tr("Filas CSV")} htmlFor="imp-t" hint={tr("Máximo 200 filas")}><Textarea id="imp-t" value={text} onChange={(e) => { setText(e.target.value); setDry(null); }} className="min-h-[120px] font-mono text-[12px]" placeholder={tr("aspas__champions-s,Alta de prueba desde CSV") + "\n"} /></Field>
      <Button size="sm" variant="cyan" onClick={runDry} disabled={busy || !text.trim()}>{tr("Validar (dry run)")}</Button>
      {dry && (
        <div>
          <p className="text-[13px]">{fill(tr("Válidas {validas} · avisos {avisos} · errores {errores} · duplicadas {duplicadas}", slots("validas", "avisos", "errores", "duplicadas")), { validas: <b className="text-ok">{dry.summary.valid}</b>, avisos: <b className="text-warn">{td(dry.summary.warning)}</b>, errores: <b className="text-bad">{td(dry.summary.error)}</b>, duplicadas: <b className="text-ink-primary">{dry.summary.duplicate}</b> })}</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-[12px]">{dry.rows.map((r) => <li key={r.line}><span className={r.status === "valid" ? "text-ok" : r.status === "warning" ? "text-warn" : "text-bad"}>L{r.line} {r.status.toUpperCase()}</span> {r.cardId} {r.messages.length ? `· ${r.messages.join(" · ")}` : ""}</li>)}</ul>
        </div>
      )}
      {log.length > 0 && <pre className="max-h-40 overflow-auto rounded bg-black/40 p-2 text-[11px]">{log.join("\n")}</pre>}
    </ConfirmDialog>
  );
}
