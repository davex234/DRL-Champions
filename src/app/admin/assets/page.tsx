"use client";

/**
 * F60 · /admin/assets — ASSET MANAGER del CMS. Assets en Supabase Storage (persisten a reinicios, builds y despliegues)
 * con su fila en `public.assets`. Por tipo: cara/cuerpo de agente, arte de carta, de sobre, de evento, de mapa, foto de
 * jugador y logo de equipo. Enseña uso REAL y marca los HUÉRFANOS; no borra nada solo: la limpieza es explícita,
 * con confirmación crítica, y el servidor se niega si alguien lo usa. El gestor anterior sigue en /admin/assets/legacy.
 */
import { useEffect, useState } from "react";
import { PageHeader, Panel, Tabs, SearchBox, Loading, ErrorBox, Empty, Pager, Button, ConfirmDialog, Field, Textarea, Select, KV, LinkButton } from "@/components/admin/cc/ui";
import { useAdminQuery, adminPost, dateTime, useDebounced } from "@/components/admin/cc/api";
import { AssetUploader, LifecycleBadge, Section } from "@/components/admin/cms/cms";
import { ASSET_RULES, CMS_ASSET_KINDS, type CmsAssetKind } from "@/domain/cms/uploads";
import { cn } from "@/lib/format";

interface Item {
  id: string; kind: string; name: string; format: string | null; width: number | null; height: number | null; bytes: number | null;
  status: string; url: string | null; smallUrl: string | null; runtimeUrl: string | null; alpha: boolean | null; version: number;
  isCurrent: boolean; createdAt: string; usage: { type: string; id: string }[]; orphan: boolean;
}
interface ListRes { rows: Item[]; total: number; page: number; pageSize: number; kinds: string[]; orphans: number }

const USE_HREF: Record<string, (id: string) => string> = {
  agent: (id) => `/admin/agents/${id}`, pack: (id) => `/admin/packs/${id}`, card: (id) => `/admin/cards/${encodeURIComponent(id)}`,
  player: (id) => `/admin/players/${id}`, event: (id) => `/admin/events/${id}`,
};

export default function AssetManagerPage() {
  const [kind, setKind] = useState<string>("all");
  const [view, setView] = useState<"all" | "orphans">("all");
  const [text, setText] = useState("");
  const q2 = useDebounced(text, 300);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadKind, setUploadKind] = useState<CmsAssetKind>("pack_art");
  useEffect(() => { setPage(1); }, [kind, view, q2]);
  useEffect(() => { const id = new URLSearchParams(window.location.search).get("id"); if (id && /^[0-9a-f-]{36}$/.test(id)) setSelected(id); }, []);
  const qs = new URLSearchParams({ page: String(page), pageSize: "24", ...(kind !== "all" ? { kind } : {}), ...(view === "orphans" ? { orphan: "1" } : {}), ...(q2 ? { q: q2 } : {}) });
  const list = useAdminQuery<ListRes>(`/api/admin/cms/assets?${qs}`);
  const detail = useAdminQuery<{ asset: Item; history: Item[] }>(selected ? `/api/admin/cms/assets?id=${selected}` : null);
  const [dlg, setDlg] = useState(false); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const del = async () => {
    if (!selected) return;
    setBusy(true); setErr(null);
    try { await adminPost("/api/admin/cms/assets", { action: "deleteOrphan", id: selected, reason, confirm: selected }); setDlg(false); setSelected(null); setReason(""); list.reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "No se pudo borrar"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido" title="Assets" description="Medios del juego en Supabase Storage: validados por sus bytes, versionados y con uso real. Nada se borra solo."
        actions={<LinkButton href="/admin/assets/legacy">Gestor anterior</LinkButton>} />
      <Section title="Subir asset">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <Field label="Tipo" htmlFor="up-kind"><Select id="up-kind" value={uploadKind} onChange={(e) => setUploadKind(e.target.value as CmsAssetKind)}>
            {CMS_ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_RULES[k].label}</option>)}
          </Select></Field>
          <AssetUploader key={uploadKind} kind={uploadKind} onUploaded={(a) => { list.reload(); setSelected(a.id); }} />
        </div>
        <p className="mt-2 text-[12px] text-ink-faint">Se aceptan PNG, WEBP, JPEG o AVIF según el tipo (nunca SVG). Nombre y ruta los genera el servidor; un fichero idéntico devuelve el existente.</p>
      </Section>

      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Tabs label="Vista" value={view} onChange={setView} items={[{ id: "all", label: "Todos", count: list.data?.total }, { id: "orphans", label: "Huérfanos", count: list.data?.orphans }]} />
            <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto">
              <option value="all">Todos los tipos</option>
              {CMS_ASSET_KINDS.map((k) => <option key={k} value={k}>{ASSET_RULES[k].label}</option>)}
            </Select>
            <div className="min-w-[180px] flex-1"><SearchBox value={text} onChange={setText} placeholder="Nombre o id" /></div>
          </div>
          {list.loading && !list.data ? <Loading rows={6} /> : !list.data?.rows.length ? (
            <Empty title={view === "orphans" ? "Ningún asset huérfano" : "Sin assets todavía"}>{view === "orphans" ? "Todo lo subido está en uso." : "Sube el primero arriba."}</Empty>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="asset-grid">
                {list.data.rows.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => setSelected(a.id)} aria-pressed={selected === a.id}
                      className={cn("nx-focus block w-full overflow-hidden rounded-control border text-left transition", selected === a.id ? "border-drl-cyan" : "border-white/10 hover:border-white/25")}>
                      <span className="grid aspect-square place-items-center bg-[#0b1020]">
                        {a.smallUrl ?? a.runtimeUrl ?? a.url ? <img src={a.smallUrl ?? a.runtimeUrl ?? a.url!} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-[11px] text-ink-faint">sin vista</span>}
                      </span>
                      <span className="block p-2 text-[11px]">
                        <b className="block truncate text-ink-primary">{a.name}</b>
                        <span className="text-ink-faint">{ASSET_RULES[a.kind as CmsAssetKind]?.label ?? a.kind}</span>
                        <span className={cn("ml-1", a.orphan ? "text-warn" : "text-ok")}>{a.orphan ? "· HUÉRFANO" : `· ${a.usage.length} uso${a.usage.length === 1 ? "" : "s"}`}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3"><Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /></div>
            </>
          )}
        </Panel>

        <aside>
          <Panel title="Detalle">
            {!selected ? <Empty title="Selecciona un asset" /> : detail.loading && !detail.data ? <Loading rows={4} /> : detail.error ? <ErrorBox error={detail.error} /> : detail.data && (() => {
              const a = detail.data.asset;
              return (
                <div className="space-y-3" data-testid="asset-detail">
                  <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-control bg-[#0b1020]">
                    {a.url && <img src={a.runtimeUrl ?? a.url} alt={a.name} className="h-full w-full object-contain" />}
                  </div>
                  <KV cols={1} items={[
                    ["Nombre", a.name], ["Tipo", ASSET_RULES[a.kind as CmsAssetKind]?.label ?? a.kind], ["Formato", `${a.format?.toUpperCase() ?? "—"} · ${a.width}×${a.height}`],
                    ["Peso", `${Math.round((a.bytes ?? 0) / 1024)} KB`], ["Transparencia", a.alpha == null ? "—" : a.alpha ? "sí" : "no"],
                    ["Estado", <LifecycleBadge key="s" state={a.status === "approved" ? "PUBLISHED" : a.status.toUpperCase()} />], ["Versión", `v${a.version}${a.isCurrent ? " (vigente)" : ""}`], ["Subido", dateTime(a.createdAt)],
                  ]} />
                  <div>
                    <p className="mb-1 text-[12px] text-ink-muted">Usado por</p>
                    {a.usage.length ? (
                      <ul className="space-y-1 text-[13px]">{a.usage.map((u) => <li key={`${u.type}:${u.id}`}><a className="text-drl-cyan hover:underline" href={USE_HREF[u.type]?.(u.id) ?? "#"}>{u.type} · {u.id}</a></li>)}</ul>
                    ) : <p className="text-[13px] text-warn">Nadie: es un huérfano.</p>}
                  </div>
                  {detail.data.history.length > 1 && <p className="text-[12px] text-ink-faint">{detail.data.history.length} versiones en su grupo (historial conservado).</p>}
                  {a.orphan && <Button variant="danger" onClick={() => { setErr(null); setDlg(true); }}>Limpiar huérfano…</Button>}
                </div>
              );
            })()}
          </Panel>
        </aside>
      </div>

      <ConfirmDialog open={dlg} onClose={() => { if (!busy) setDlg(false); }} onConfirm={del} busy={busy} error={err} risk="CRITICAL" title="Borrar asset huérfano"
        confirmLabel="Borrar definitivamente" typeToConfirm={selected ?? ""} canConfirm={reason.trim().length >= 4}>
        <p>Se borran la fila y sus ficheros de Storage (original y derivados). Es irreversible. El servidor lo rechaza si algún contenido lo usa.</p>
        <Field label="Motivo (auditoría)" htmlFor="as-reason"><Textarea id="as-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}
