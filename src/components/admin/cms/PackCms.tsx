"use client";

/**
 * F60 · SOBRES DEL PANEL — lista, alta y editor (/admin/packs, /admin/packs/new, /admin/packs/cms-…).
 *
 * Economía CONGELADA (F57.6): un sobre nuevo hereda precio, nº de cartas, pesos, garantías y tabla de clases de su
 * PLANTILLA; aquí no hay deslizadores de probabilidad ni de precio. El panel decide identidad, arte, ventana y el POOL
 * de elegibilidad. Se explica en pantalla la diferencia que dejó F58.1: POOL = qué cartas pueden salir; DISTRIBUCIÓN =
 * con qué probabilidad (la de la plantilla). Editar el pool no toca la distribución.
 *
 * Publicar = simulación de servidor (no guarda nada) + invariantes existentes + arte + pool ACTIVO. Vista previa con el
 * componente REAL de la tienda (`PackOfferCard`).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, DataTable, Empty, ErrorBox, Field, Input, KV, LevelBadge, LinkButton, Loading, Panel, Pill, Select, Textarea, SearchBox, type Col } from "@/components/admin/cc/ui";
import { adminPost, useAdminQuery, useDebounced, fmt, pct, dateTime } from "@/components/admin/cc/api";
import { ActivityList, type AuditItem } from "@/components/admin/cc/Activity";
import { AssetUploader, Checklist, DependencyList, DirtyBar, LifecycleBadge, Section, useUnsavedGuard, type UploadedAsset } from "./cms";
import { PackOfferCard } from "@/components/store/StoreProducts";
import { packDefFromCms, suggestPackId, validatePackDraft, type CmsPackRow, type CmsSimSummary } from "@/domain/cms/packs";
import type { ResolvedProduct } from "@/domain/store/types";
import { cn } from "@/lib/format";

interface ListRow { id: string; name: string; source: "code" | "cms"; lifecycle: string; price: number; cardCount: number; templateId: string | null; artUrl: string | null; inventoryUnits: number; editable: boolean; updatedAt: string | null }
type Templates = { id: string; name: string; price: number; cardCount: number }[];

/** Sección «Sobres del panel» de /admin/packs. */
export function CmsPacksPanel() {
  const router = useRouter();
  const q = useAdminQuery<{ rows: ListRow[] }>("/api/admin/cms/packs");
  const rows = (q.data?.rows ?? []).filter((r) => r.source === "cms");
  const cols: Col<ListRow>[] = [
    { key: "a", label: "", render: (r) => (r.artUrl ? <img src={r.artUrl} alt="" className="h-12 w-auto" loading="lazy" /> : <span className="text-ink-faint">sin arte</span>) },
    { key: "n", label: "Sobre", render: (r) => <span><b className="text-ink-primary">{r.name}</b><span className="block font-mono text-[11px] text-ink-faint">{r.id} · plantilla {r.templateId}</span></span>, sort: (r) => r.name },
    { key: "s", label: "Estado", render: (r) => <LifecycleBadge state={r.lifecycle} />, sort: (r) => r.lifecycle },
    { key: "p", label: "Precio", align: "right", render: (r) => fmt(r.price), sort: (r) => r.price },
    { key: "c", label: "Cartas", align: "right", render: (r) => r.cardCount },
    { key: "i", label: "En inventarios", align: "right", render: (r) => fmt(r.inventoryUnits), sort: (r) => r.inventoryUnits },
    { key: "u", label: "Modificado", render: (r) => dateTime(r.updatedAt), className: "hidden lg:table-cell" },
  ];
  return (
    <Panel title="Sobres del panel" subtitle="Creados desde /admin: heredan la economía de su plantilla y eligen cartas por su pool." actions={<LinkButton href="/admin/packs/new" variant="primary">+ Nuevo sobre</LinkButton>}>
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data ? <Loading rows={3} /> : rows.length === 0 ? (
        <Empty title="Todavía no hay sobres del panel">Crea uno a partir de un sobre existente: misma economía, otra identidad y otro pool.</Empty>
      ) : <DataTable caption="Sobres del panel" rows={rows} cols={cols} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/packs/${r.id}`)} />}
    </Panel>
  );
}

/** /admin/packs/new — alta en borrador. */
export function NewPackForm() {
  const router = useRouter();
  const q = useAdminQuery<{ templates: Templates }>("/api/admin/cms/packs");
  const [name, setName] = useState(""); const [id, setId] = useState(""); const [template, setTemplate] = useState(""); const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(!!(name || description) && !saving);
  const errs = validatePackDraft({ id, name, description, templatePackId: template || undefined }, { creating: true });
  const t = q.data?.templates.find((x) => x.id === template);
  const create = async () => {
    setSaving(true); setError(null);
    try {
      await adminPost("/api/admin/cms/packs", { action: "save", id, patch: { name, description, templatePackId: template }, reason: "alta de sobre desde el panel" });
      await adminPost("/api/admin/cms/packs", { action: "ensurePool", id });
      router.push(`/admin/packs/${id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear"); setSaving(false); }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Section title="Identidad y plantilla">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="pk-name" error={name ? errs.name : null}><Input id="pk-name" value={name} maxLength={60} onChange={(e) => { const v = e.target.value; setName(v); if (!id || id === suggestPackId(name)) setId(suggestPackId(v)); }} /></Field>
          <Field label="Id" htmlFor="pk-id" hint="«cms-…». Estable: lo usan inventarios e historial." error={id ? errs.id : null}><Input id="pk-id" value={id} maxLength={48} onChange={(e) => setId(e.target.value.toLowerCase())} /></Field>
          <Field label="Plantilla económica" htmlFor="pk-tpl" hint="Precio, nº de cartas, pesos, garantías y tabla de clases salen de aquí y no se editan." error={errs.templatePackId && template ? errs.templatePackId : null}>
            <Select id="pk-tpl" value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Elige un sobre existente…</option>
              {(q.data?.templates ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} · {fmt(x.price)} cr · {x.cardCount} cartas</option>)}
            </Select>
          </Field>
          <Field label="Descripción" htmlFor="pk-desc" error={errs.description}><Textarea id="pk-desc" value={description} maxLength={400} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        {error && <div className="mt-3"><ErrorBox error={error} /></div>}
        <div className="mt-4 flex justify-end"><Button onClick={create} disabled={saving || Object.keys(errs).length > 0}>{saving ? "Creando…" : "Crear borrador"}</Button></div>
      </Section>
      <Panel title="Economía heredada (sólo lectura)">
        {t ? <KV cols={1} items={[["Precio", `${fmt(t.price)} créditos`], ["Cartas por sobre", String(t.cardCount)], ["Probabilidades", "las de la plantilla (congeladas F57.3–F57.6)"]]} />
          : <p className="text-[13px] text-ink-muted">Elige una plantilla para ver lo que hereda.</p>}
      </Panel>
    </div>
  );
}

interface PoolInfo { id: string; exists: boolean; lifecycle: string | null; mode: string | null; revision: number | null; entries: { cardId: string; weight: number; mode: string }[]; bound: boolean }
interface Detail {
  pack: CmsPackRow; template: { id: string; name: string; price: number; cardCount: number; drawMode: string } | null;
  art: { id: string; url: string | null; runtimeUrl: string | null } | null; pool: PoolInfo; references: Record<string, number>;
  gate: { ok: boolean; blockers: string[]; warnings: string[] }; band: { lo: number; hi: number; median: number }; history: AuditItem[];
}

/** /admin/packs/cms-… */
export function CmsPackEditor({ id }: { id: string }) {
  const q = useAdminQuery<Detail>(`/api/admin/cms/packs?id=${encodeURIComponent(id)}`);
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading rows={8} />;
  return <PackEditorBody key={`${q.data.pack.version}:${q.data.pool.revision}`} d={q.data} reload={q.reload} />;
}

function PackEditorBody({ d, reload }: { d: Detail; reload: () => void }) {
  const router = useRouter();
  const p = d.pack;
  const draft = p.lifecycle === "DRAFT";
  const initial = { name: p.name, description: p.description, accent: p.accent ?? "", availableFrom: p.available_from?.slice(0, 16) ?? "", availableTo: p.available_to?.slice(0, 16) ?? "" };
  const [form, setForm] = useState(initial);
  const [art, setArt] = useState<{ id: string; url: string | null; runtimeUrl: string | null } | UploadedAsset | null>(d.art);
  const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const [sim, setSim] = useState<{ summary: CmsSimSummary; gate: Detail["gate"] } | null>(null); const [simBusy, setSimBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "publish" | "retire" | "republish" | "delete">(null);
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [dlgErr, setDlgErr] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || (art?.id ?? null) !== (d.art?.id ?? null);
  useUnsavedGuard(dirty);
  const errs = validatePackDraft({ name: form.name, description: form.description, accent: form.accent || null, availableFrom: form.availableFrom || null, availableTo: form.availableTo || null }, { creating: false });
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  const save = async () => {
    setSaving(true); setError(null);
    try {
      await adminPost("/api/admin/cms/packs", { action: "save", id: p.id, expectedVersion: p.version, reason: "edición desde el panel", patch: {
        name: form.name, description: form.description, accent: form.accent || null, availableFrom: iso(form.availableFrom), availableTo: iso(form.availableTo),
        ...((art?.id ?? null) !== (d.art?.id ?? null) ? { artAssetId: art?.id ?? null } : {}),
      } });
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar"); } finally { setSaving(false); }
  };
  const simulate = async () => {
    setSimBusy(true); setError(null);
    try { setSim(await adminPost("/api/admin/cms/packs", { action: "simulate", id: p.id, n: 3000 })); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo simular"); } finally { setSimBusy(false); }
  };
  const act = async () => {
    setBusy(true); setDlgErr(null);
    try {
      const action = dialog === "delete" ? "deleteDraft" : dialog === "retire" ? "retire" : "publish";
      await adminPost("/api/admin/cms/packs", { action, id: p.id, expectedVersion: p.version, reason, confirm: p.id });
      if (dialog === "delete") { router.push("/admin/packs"); return; }
      setDialog(null); setReason(""); reload();
    } catch (e) { setDlgErr(e instanceof Error ? e.message : "No se pudo completar"); } finally { setBusy(false); }
  };

  // Vista previa con el componente REAL de la tienda.
  const artUrl = (art as { runtimeUrl?: string | null; url?: string | null } | null)?.runtimeUrl ?? (art as { url?: string | null } | null)?.url ?? null;
  const previewDef = packDefFromCms({ ...p, name: form.name || p.name, description: form.description, accent: form.accent || null, lifecycle: "ACTIVE" }, artUrl);
  const product: ResolvedProduct | null = previewDef ? {
    productId: `pack:${p.id}`, kind: "PACK", name: previewDef.name, sortOrder: 0, badge: "NEW", status: "AVAILABLE", packId: p.id, previewPack: previewDef,
    options: [{ method: "GAME_CURRENCY", status: "AVAILABLE", price: previewDef.price }],
    grant: { packs: [{ packId: p.id, count: 1 }], cardIds: [], credits: 0 },
  } : null;
  const shownGate = sim?.gate ?? d.gate;
  const checklist = [
    { key: "art", label: "Arte subido", ok: !!d.art },
    { key: "pool", label: "Pool de elegibilidad con cartas", ok: d.pool.exists && d.pool.entries.some((e) => e.mode === "INCLUDE") },
    { key: "poolActive", label: "Pool publicado (ACTIVE)", ok: d.pool.lifecycle === "ACTIVE" },
    { key: "gate", label: "Simulación dentro de los invariantes económicos", ok: shownGate.ok },
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Section title="Identidad" aside={<LifecycleBadge state={p.lifecycle} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" htmlFor="pe-name" error={errs.name}><Input id="pe-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Acento" htmlFor="pe-acc" hint="#rrggbb (vacío = el de la plantilla)" error={errs.accent}><Input id="pe-acc" value={form.accent} maxLength={7} onChange={(e) => setForm({ ...form, accent: e.target.value })} /></Field>
            <Field label="Descripción" htmlFor="pe-desc" error={errs.description}><Textarea id="pe-desc" value={form.description} maxLength={400} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid gap-3">
              <Field label="A la venta desde" htmlFor="pe-from" error={errs.availableFrom}><Input id="pe-from" type="datetime-local" value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} /></Field>
              <Field label="Hasta" htmlFor="pe-to" error={errs.availableTo}><Input id="pe-to" type="datetime-local" value={form.availableTo} onChange={(e) => setForm({ ...form, availableTo: e.target.value })} /></Field>
            </div>
          </div>
        </Section>
        <Section title="Arte del sobre">
          <AssetUploader kind="pack_art" subjectId={p.id} current={art ? { url: artUrl } : null} onUploaded={setArt} />
        </Section>
        {error && <ErrorBox error={error} />}
        <DirtyBar dirty={dirty} saving={saving} onSave={save} onReset={() => { setForm(initial); setArt(d.art); }} disabled={Object.keys(errs).length > 0} />

        <PoolEditor packId={p.id} pool={d.pool} onChanged={reload} />

        <Section title="Simulación (servidor · no guarda nada)" aside={<Button onClick={simulate} disabled={simBusy}>{simBusy ? "Simulando…" : "Simular 3.000 aperturas"}</Button>}>
          {sim ? (
            <div data-testid="sim-result">
              <KV cols={3} items={[
                ["EV", `${fmt(sim.summary.ev)} cr`], ["EV / precio", `${sim.summary.evOverPrice.toFixed(2)}×`], ["Desguace / precio", pct(sim.summary.salvageOverPrice)],
                ["Prime / carta", pct(sim.summary.primePct)], ["Icon / carta", pct(sim.summary.iconPct)], ["OVR p10–p50–p90", `${sim.summary.ovr.p10}–${sim.summary.ovr.p50}–${sim.summary.ovr.p90}`],
                ["Cartas elegibles", fmt(sim.summary.eligibleCards)], ["Aperturas", fmt(sim.summary.n)], ["Banda línea principal", `${d.band.lo.toFixed(2)}–${d.band.hi.toFixed(2)}×`],
              ]} />
              <p className="mt-2 text-[12px] text-ink-muted">Clases observadas: {Object.entries(sim.summary.classes).map(([k, v]) => `${k} ${pct(v)}`).join(" · ") || "—"}</p>
            </div>
          ) : <p className="text-[13px] text-ink-muted">{p.sim_summary ? `Última simulación guardada al publicar: EV/precio ${p.sim_summary.evOverPrice.toFixed(2)}×.` : "Sin simulación todavía. Simular no escribe nada."}</p>}
          {(shownGate.blockers.length > 0 || shownGate.warnings.length > 0) && (
            <ul className="mt-3 space-y-1 text-[13px]">
              {shownGate.blockers.map((b) => <li key={b} className="text-bad">✕ {b}</li>)}
              {shownGate.warnings.map((w) => <li key={w} className="text-warn">! {w}</li>)}
            </ul>
          )}
        </Section>

        <Section title="Usado por"><DependencyList refs={d.references} labels={{ inventories: "Inventarios", inventoryUnits: "Sobres sin abrir", purchases: "Compras", opens: "Aperturas", poolBindings: "Pools enlazados" }} /></Section>
        <Section title="Historial"><ActivityList items={d.history} empty="Sin cambios registrados" /></Section>
      </div>

      <aside className="space-y-5">
        <Panel title="Vista previa (tarjeta real de la tienda)">
          <div className="grid justify-center" data-testid="pack-preview">{product && <div className="w-[240px]"><PackOfferCard product={product} owned={0} index={0} onSelect={() => undefined} /></div>}</div>
        </Panel>
        <Panel title="Economía (heredada, congelada)">
          <KV cols={1} items={[["Plantilla", d.template ? `${d.template.name} (${d.template.id})` : "—"], ["Precio", `${fmt(p.price)} cr`], ["Cartas", String(p.card_count)], ["Probabilidad", d.template?.drawMode === "clase" ? "tabla por clase F57.3 de la plantilla" : "pesos por rareza de la plantilla"]]} />
          <p className="mt-2 text-[12px] text-ink-faint">POOL = qué cartas pueden salir (lo editas abajo). DISTRIBUCIÓN = con qué probabilidad (la de la plantilla). Cambiar el pool no toca la distribución.</p>
        </Panel>
        <Panel title="Publicación">
          <Checklist items={checklist} />
          <div className="mt-3 flex flex-wrap gap-2">
            {draft && <Button onClick={() => setDialog("publish")} disabled={dirty || !checklist.every((c) => c.ok)}>Publicar</Button>}
            {p.lifecycle === "ACTIVE" && <Button variant="danger" onClick={() => setDialog("retire")}>Retirar</Button>}
            {p.lifecycle === "RETIRED" && <Button onClick={() => setDialog("republish")}>Volver a publicar</Button>}
            {draft && <Button variant="danger" onClick={() => setDialog("delete")}>Borrar borrador</Button>}
          </div>
          {!shownGate.ok && draft && <p className="mt-2 text-[12px] text-warn">Publicar vuelve a simular en el servidor; si no cumple, no se publica.</p>}
        </Panel>
      </aside>

      <ConfirmDialog open={dialog !== null} onClose={() => { if (!busy) { setDialog(null); setDlgErr(null); } }} onConfirm={act} busy={busy} error={dlgErr}
        risk={dialog === "delete" || dialog === "publish" || dialog === "republish" ? "CRITICAL" : "HIGH"}
        title={dialog === "publish" || dialog === "republish" ? "Publicar sobre" : dialog === "retire" ? "Retirar sobre" : "Borrar borrador"}
        confirmLabel={dialog === "delete" ? "Borrar definitivamente" : dialog === "retire" ? "Retirar" : "Publicar"} typeToConfirm={p.id} canConfirm={reason.trim().length >= 4}>
        <p>{dialog === "retire" ? "Deja de venderse. Los sobres ya comprados siguen en los inventarios y se pueden abrir; el historial se conserva."
          : dialog === "delete" ? "Borrado DURO del borrador y de su pool dedicado. Sólo es posible sin compras, aperturas ni inventarios."
            : "Impacto económico: aparecerá a la venta (créditos) con la economía de su plantilla. El servidor vuelve a simular y lo impide si no cumple los invariantes."}</p>
        <Field label="Motivo (auditoría)" htmlFor="pe-reason"><Textarea id="pe-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}

interface CardRow { cardId: string; nick: string; team: string; variantLabel: string; ovr: number; lifecycle: string }

/** Editor del pool de elegibilidad `pack-<id>`: añadir/quitar con selección múltiple; concurrencia por revisión. */
function PoolEditor({ packId, pool, onChanged }: { packId: string; pool: PoolInfo; onChanged: () => void }) {
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim(), 300);
  const [found, setFound] = useState<CardRow[]>([]); const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<Set<string>>(new Set()); const [drop, setDrop] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const members = useMemo(() => new Set(pool.entries.filter((e) => e.mode === "INCLUDE").map((e) => e.cardId)), [pool]);
  const search = async () => {
    setLoading(true); setError(null);
    try { const r = await adminPost<{ rows: CardRow[] }>("/api/admin/cards", { action: "list", q: dq || undefined, lifecycle: "PUBLISHED", page: 1, pageSize: 40, sort: "ovr", dir: "desc" }); setFound(r.rows ?? []); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo buscar"); } finally { setLoading(false); }
  };
  const run = async (op: "add" | "remove" | "publish", ids: string[] = []) => {
    setBusy(true); setError(null);
    try {
      await adminPost("/api/admin/cms/packs", { action: "pool", id: packId, op, cardIds: ids, expectedRevision: pool.revision, reason: `editor de pool: ${op}` });
      setPick(new Set()); setDrop(new Set()); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cambiar el pool"); } finally { setBusy(false); }
  };
  const toggle = (s: Set<string>, id: string, set: (x: Set<string>) => void) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); set(n); };
  return (
    <Section title={`Pool de elegibilidad · ${pool.id}`} aside={<span className="flex items-center gap-2">{pool.lifecycle && <LifecycleBadge state={pool.lifecycle} />}<Pill>r{pool.revision ?? 0}</Pill></span>}>
      <p className="mb-3 text-[12px] text-ink-muted">Modo EXPLICIT: sólo pueden salir estas cartas (y sólo las PUBLICADAS). La probabilidad la pone la plantilla.</p>
      {!pool.exists && <Button disabled={busy} onClick={() => { setBusy(true); adminPost("/api/admin/cms/packs", { action: "ensurePool", id: packId }).then(onChanged, (e) => setError(e instanceof Error ? e.message : "No se pudo crear el pool")).finally(() => setBusy(false)); }}>Crear el pool del sobre</Button>}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 font-display text-[11px] font-bold uppercase tracking-wider text-ink-secondary">En el pool ({members.size})</p>
          <ul className="max-h-[260px] space-y-1 overflow-y-auto pr-1 text-[12px]" data-testid="pool-members">
            {[...members].sort().map((id) => (
              <li key={id}><label className="flex items-center gap-2"><input type="checkbox" checked={drop.has(id)} onChange={() => toggle(drop, id, setDrop)} /><span className="font-mono">{id}</span></label></li>
            ))}
            {!members.size && <li className="text-ink-faint">Vacío: el sobre no se puede publicar así.</li>}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" size="sm" disabled={busy || !drop.size} onClick={() => void run("remove", [...drop])}>Quitar {drop.size || ""}</Button>
            <Button size="sm" disabled={busy || !members.size || pool.lifecycle === "ACTIVE"} onClick={() => void run("publish")}>Publicar pool</Button>
          </div>
        </div>
        <div>
          <div className="flex gap-2"><div className="flex-1"><SearchBox value={q} onChange={setQ} placeholder="Jugador o id de carta" /></div><Button size="sm" onClick={() => void search()} disabled={loading}>Buscar</Button></div>
          <ul className="mt-2 max-h-[260px] space-y-1 overflow-y-auto pr-1 text-[12px]" data-testid="pool-candidates">
            {found.map((c) => (
              <li key={c.cardId} className={cn(members.has(c.cardId) && "opacity-40")}>
                <label className="flex items-center gap-2"><input type="checkbox" disabled={members.has(c.cardId)} checked={pick.has(c.cardId)} onChange={() => toggle(pick, c.cardId, setPick)} />
                  <span><b>{c.nick}</b> · {c.variantLabel} · OVR {c.ovr} <span className="text-ink-faint">{c.team}</span></span></label>
              </li>
            ))}
            {!found.length && <li className="text-ink-faint">{loading ? "Buscando…" : "Busca cartas publicadas para añadirlas."}</li>}
          </ul>
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy || !pick.size} onClick={() => void run("add", [...pick])}>Añadir {pick.size || ""}</Button>
            <Button size="sm" variant="ghost" disabled={!found.length} onClick={() => setPick(new Set(found.filter((c) => !members.has(c.cardId)).map((c) => c.cardId)))}>Seleccionar todo</Button>
          </div>
        </div>
      </div>
      {error && <div className="mt-3"><ErrorBox error={error} /></div>}
      <p className="mt-2 text-[11px] text-ink-faint"><LevelBadge level="INFO" label="Concurrencia" /> Si otro admin cambió el pool, el servidor rechaza el cambio y hay que recargar.</p>
    </Section>
  );
}
