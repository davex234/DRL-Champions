"use client";

/**
 * Panel Admin > Assets — gestión profesional de medios del juego.
 *
 * Subir / reemplazar (versiones) / aprobar / fijar prioridad / licencia /
 * eliminar / deduplicar, y búsqueda por jugador / equipo / torneo / tipo / estado.
 * Las lecturas van por la ruta admin (service_role) para ver también pendientes.
 * Requiere Supabase + sesión admin; en local muestra el aviso estándar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ADMIN_ENABLED } from "@/config/admin";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { allPlayers } from "@/data/catalog";
import { TEAMS } from "@/data/teams";
import {
  ASSET_KINDS, ASSET_SOURCES, ASSET_STATUSES, kindLabel, subjectTypeForKind,
} from "@/domain/assets/types";
import type { Asset, AssetKind, AssetStatus, SubjectType } from "@/domain/assets/types";
import { toAsset, publicUrl } from "@/lib/assets/repos";
import { sha256Hex, imageDimensions } from "@/lib/assets/storage";
import type { AssetRow, AssetDuplicateRow } from "@/lib/supabase/assets.types";
import { cn } from "@/lib/format";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-base-800 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-drl focus:outline-none";

export default function AssetsPage() {
  if (!ADMIN_ENABLED) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-center">
        <p className="max-w-sm text-white/60">
          El panel requiere <code className="text-drl">NEXT_PUBLIC_ADMIN=1</code>.
        </p>
      </div>
    );
  }
  return (
    <HydrationGate>
      <Assets />
    </HydrationGate>
  );
}

// --- llamadas a la ruta admin ------------------------------------------------
async function authHeader(): Promise<Record<string, string> | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : null;
}

async function callAdmin(action: string, payload: Record<string, unknown> = {}) {
  const h = await authHeader();
  if (!h) return { error: "Inicia sesión como administrador" };
  const res = await fetch("/api/admin/assets", {
    method: "POST",
    headers: { "content-type": "application/json", ...h },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

async function callAdminForm(action: string, fields: Record<string, string | undefined>, file?: File | null) {
  const h = await authHeader();
  if (!h) return { error: "Inicia sesión como administrador" };
  const fd = new FormData();
  fd.append("action", action);
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== "") fd.append(k, v);
  if (file) fd.append("file", file);
  const res = await fetch("/api/admin/assets", { method: "POST", headers: h, body: fd });
  return res.json();
}

function previewUrl(a: Asset): string | undefined {
  return a.url ?? publicUrl(a.storagePath, a.url);
}

const SUBJECT_LABEL: Record<SubjectType, string> = {
  player: "Jugador", team: "Equipo", league: "Liga", tournament: "Torneo",
  country: "País (ISO)", role: "Rol", variant: "Variante", none: "—",
};

function Assets() {
  const { toast, notify } = useToast();
  const online = isSupabaseConfigured();

  const [tab, setTab] = useState<"upload" | "library" | "duplicates">("library");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [dups, setDups] = useState<AssetDuplicateRow[]>([]);
  const [versionsOf, setVersionsOf] = useState<{ groupId: string; name: string } | null>(null);

  // Filtros de la biblioteca.
  const [fKind, setFKind] = useState<AssetKind | "">("");
  const [fStatus, setFStatus] = useState<AssetStatus | "">("");
  const [fQuery, setFQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const players = useMemo(() => allPlayers(), []);
  const teamNames = useMemo(() => Object.keys(TEAMS), []);

  const search = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    const r = await callAdmin("search", {
      kind: fKind || undefined, status: fStatus || undefined, query: fQuery || undefined, limit: 120,
    });
    setLoading(false);
    if (r.error) { notify(r.error, false); return; }
    setAssets(((r.assets as AssetRow[]) ?? []).map(toAsset));
  }, [online, fKind, fStatus, fQuery, notify]);

  const loadDups = useCallback(async () => {
    const r = await callAdmin("duplicates");
    if (!r.error) setDups((r.duplicates as AssetDuplicateRow[]) ?? []);
  }, []);

  useEffect(() => { if (online) search(); }, [online, search]);
  useEffect(() => { if (online && tab === "duplicates") loadDups(); }, [online, tab, loadDups]);

  async function act(action: string, payload: Record<string, unknown>, okMsg: string) {
    const r = await callAdmin(action, payload);
    if (r.error) { notify(r.error, false); return; }
    notify(okMsg, true);
    await search();
    if (tab === "duplicates") await loadDups();
  }

  if (!online) {
    return (
      <section className="animate-rise space-y-4">
        <Header />
        <div className="rounded-2xl border border-white/10 bg-base-700/40 p-6 text-white/60">
          El Asset Manager requiere Supabase configurado y sesión de administrador. En modo local el
          juego sigue resolviendo imágenes desde <code className="text-drl">/public</code> con fallbacks.
        </div>
      </section>
    );
  }

  return (
    <section className="animate-rise space-y-6">
      <Header />

      <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-base-800 p-1">
        {([["library", "Biblioteca"], ["upload", "Subir"], ["duplicates", "Duplicados"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn("rounded-lg px-4 py-2 font-display text-sm uppercase tracking-wide transition",
              tab === k ? "bg-drl text-white shadow-glow" : "text-white/55 hover:text-white")}>
            {l}
          </button>
        ))}
      </div>

      {tab === "upload" && (
        <UploadForm players={players} teamNames={teamNames} notify={notify}
          onDone={() => { setTab("library"); search(); }} />
      )}

      {tab === "library" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Tipo</span>
              <select className={inputCls} value={fKind} onChange={(e) => setFKind(e.target.value as AssetKind | "")}>
                <option value="">Todos</option>
                {ASSET_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Estado</span>
              <select className={inputCls} value={fStatus} onChange={(e) => setFStatus(e.target.value as AssetStatus | "")}>
                <option value="">Todos</option>
                {ASSET_STATUSES.map((s) => <option key={s.status} value={s.status}>{s.label}</option>)}
              </select>
            </label>
            <label className="col-span-2 block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">
                Buscar (jugador / equipo / torneo / nombre)
              </span>
              <input className={inputCls} value={fQuery} onChange={(e) => setFQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()} placeholder="aspas, Fnatic, masters-toronto…" />
            </label>
          </div>

          <p className="text-xs text-white/40">
            {loading ? "Buscando…" : `${assets.length} assets`}
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} onAct={act}
                onVersions={() => setVersionsOf({ groupId: a.groupId, name: a.name })}
                onReplaced={search} notify={notify} />
            ))}
          </div>
        </>
      )}

      {tab === "duplicates" && (
        <Duplicates dups={dups} onDedupe={(checksum) =>
          act("dedupe", { checksum }, "Duplicados eliminados (conservado el mejor)")} />
      )}

      <AnimatePresence>
        {versionsOf && (
          <VersionsModal groupId={versionsOf.groupId} name={versionsOf.name}
            onClose={() => setVersionsOf(null)} />
        )}
      </AnimatePresence>

      <Toast toast={toast} />
    </section>
  );
}

function Header() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
          Asset <span className="text-drl">Manager</span>
        </h1>
        <p className="mt-1 text-white/50">
          Fotos, logos, banderas, plantillas, fondos, animaciones y efectos — con versiones,
          aprobación, deduplicado y resolución automática del mejor medio.
        </p>
      </div>
      <a href="/admin" className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 font-display text-sm uppercase tracking-wide text-white/70 transition hover:bg-white/10">
        ← Admin
      </a>
    </header>
  );
}

// --- Subida ------------------------------------------------------------------
function UploadForm({
  players, teamNames, notify, onDone,
}: {
  players: ReturnType<typeof allPlayers>;
  teamNames: string[];
  notify: (m: string, ok?: boolean) => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<AssetKind>("player_photo");
  const [subjectId, setSubjectId] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("upload");
  const [quality, setQuality] = useState("70");
  const [priority, setPriority] = useState("0");
  const [license, setLicense] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const subjectType = subjectTypeForKind(kind);

  async function submit() {
    if (!file) { notify("Selecciona un fichero", false); return; }
    setBusy(true);
    try {
      const checksum = await sha256Hex(file);
      const dims = await imageDimensions(file);
      const r = await callAdminForm("upload", {
        kind, subjectType, subjectId: subjectId || undefined, name: name || file.name,
        source, quality, priority, license: license || undefined, checksum,
        width: dims?.width != null ? String(dims.width) : undefined,
        height: dims?.height != null ? String(dims.height) : undefined,
      }, file);
      if (r.error) { notify(r.error, false); return; }
      notify(r.duplicate ? "Subido (¡ojo! checksum duplicado)" : "Asset subido (pendiente de aprobar)", true);
      setFile(null); setName(""); setSubjectId("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-base-700/40 p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Tipo de asset</span>
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            {ASSET_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">
            {SUBJECT_LABEL[subjectType]}{subjectType !== "none" ? " (id)" : ""}
          </span>
          <input className={inputCls} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
            list="asset-subjects" disabled={subjectType === "none"}
            placeholder={subjectType === "player" ? "id del jugador" : subjectType === "team" ? "nombre del equipo" : subjectType === "country" ? "ES, BR…" : "id"} />
          <datalist id="asset-subjects">
            {subjectType === "player" && players.map((p) => <option key={p.id} value={p.id}>{p.nick}</option>)}
            {subjectType === "team" && teamNames.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Nombre</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="(auto del fichero)" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Fuente</span>
          <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
            {ASSET_SOURCES.map((s) => <option key={s.source} value={s.source}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Calidad (0-100)</span>
          <input className={inputCls} type="number" min={0} max={100} value={quality} onChange={(e) => setQuality(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Prioridad</span>
          <input className={inputCls} type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </label>
        <label className="col-span-2 block sm:col-span-3">
          <span className="mb-0.5 block text-[10px] uppercase tracking-widest text-white/40">Licencia</span>
          <input className={inputCls} value={license} onChange={(e) => setLicense(e.target.value)}
            placeholder="© Riot Games / CC-BY / propietaria…" />
        </label>
      </div>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-base-800/60 px-4 py-8 text-center transition hover:border-drl/50">
        <span className="text-sm text-white/60">
          {file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : "Pulsa para elegir imagen/medio (PNG, WEBP, MP4, WEBM, JSON…)"}
        </span>
        <input type="file" className="hidden"
          accept="image/*,video/mp4,video/webm,application/json,.lottie"
          onChange={(e) => { const fl = e.target.files?.[0]; if (fl) { setFile(fl); if (!name) setName(fl.name); } }} />
      </label>

      <div className="mt-4">
        <button onClick={submit} disabled={busy || !file}
          className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-6 py-3 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110 disabled:opacity-40">
          {busy ? "Subiendo…" : "Subir asset"}
        </button>
        <p className="mt-2 text-xs text-white/40">
          Checksum (sha-256) y resolución se calculan en el navegador antes de subir.
        </p>
      </div>
    </div>
  );
}

// --- Tarjeta de asset --------------------------------------------------------
const STATUS_STYLE: Record<AssetStatus, string> = {
  pending: "bg-amber-400/15 text-amber-300",
  approved: "bg-emerald-400/15 text-emerald-300",
  rejected: "bg-rose-400/15 text-rose-300",
  archived: "bg-white/10 text-white/40",
};

function AssetCard({
  asset, onAct, onVersions, onReplaced, notify,
}: {
  asset: Asset;
  onAct: (action: string, payload: Record<string, unknown>, okMsg: string) => void;
  onVersions: () => void;
  onReplaced: () => Promise<void>;
  notify: (m: string, ok?: boolean) => void;
}) {
  const url = previewUrl(asset);
  const isImg = !asset.format || /^(png|jpg|jpeg|webp|gif|avif|svg)$/i.test(asset.format);

  async function replace(file: File) {
    const checksum = await sha256Hex(file);
    const dims = await imageDimensions(file);
    const r = await callAdminForm("replace", {
      groupId: asset.groupId, checksum,
      width: dims?.width != null ? String(dims.width) : undefined,
      height: dims?.height != null ? String(dims.height) : undefined,
    }, file);
    if (r.error) { notify(r.error, false); return; }
    notify(`Nueva versión v${r.version}`, true);
    await onReplaced();
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-base-700/40">
      <div className="relative grid aspect-square place-items-center bg-base-900/60">
        {url && isImg
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt={asset.name} className="h-full w-full object-contain" />
          : <span className="px-2 text-center text-xs text-white/40">{asset.format?.toUpperCase() ?? "?"}</span>}
        <span className={cn("absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] uppercase", STATUS_STYLE[asset.status])}>
          {asset.status}
        </span>
        <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white/70">v{asset.version}</span>
      </div>

      <div className="space-y-1.5 p-3">
        <p className="truncate font-display text-sm font-bold text-white" title={asset.name}>{asset.name}</p>
        <p className="text-[11px] text-white/45">
          {kindLabel(asset.kind)}{asset.subjectId ? ` · ${asset.subjectId}` : ""}
        </p>
        <p className="text-[11px] text-white/40">
          {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}Q{asset.quality} · P{asset.priority} · {asset.source}
        </p>
        {asset.license && <p className="truncate text-[10px] text-white/30" title={asset.license}>{asset.license}</p>}

        <div className="flex flex-wrap gap-1 pt-1">
          {asset.status !== "approved" &&
            <Mini onClick={() => onAct("approve", { id: asset.id }, "Aprobado")}>Aprobar</Mini>}
          {asset.status !== "rejected" &&
            <Mini onClick={() => onAct("reject", { id: asset.id }, "Rechazado")}>Rechazar</Mini>}
          <Mini onClick={() => {
            const v = prompt("Prioridad", String(asset.priority));
            if (v != null) onAct("set_priority", { id: asset.id, priority: Number(v) }, "Prioridad actualizada");
          }}>Prioridad</Mini>
          <label className="cursor-pointer rounded-md border border-white/15 px-2 py-1 font-display text-[11px] uppercase tracking-wide text-white/70 transition hover:bg-white/10">
            Reemplazar
            <input type="file" className="hidden" accept="image/*,video/mp4,video/webm,application/json,.lottie"
              onChange={(e) => e.target.files?.[0] && replace(e.target.files[0])} />
          </label>
          <Mini onClick={onVersions}>Versiones</Mini>
          <Mini danger onClick={() => confirm(`¿Eliminar "${asset.name}"?`) &&
            onAct("delete", { id: asset.id }, "Asset eliminado")}>Eliminar</Mini>
        </div>
      </div>
    </div>
  );
}

function Mini({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={cn("rounded-md px-2 py-1 font-display text-[11px] uppercase tracking-wide transition",
        danger ? "border border-drl/40 text-drl hover:bg-drl/10" : "border border-white/15 text-white/70 hover:bg-white/10 hover:text-white")}>
      {children}
    </button>
  );
}

// --- Duplicados --------------------------------------------------------------
function Duplicates({ dups, onDedupe }: { dups: AssetDuplicateRow[]; onDedupe: (checksum: string) => void }) {
  if (!dups.length) {
    return <div className="rounded-2xl border border-white/10 bg-base-700/40 p-6 text-white/50">No hay duplicados (por checksum).</div>;
  }
  return (
    <div className="space-y-2">
      {dups.map((d) => (
        <div key={d.checksum} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-base-700/40 p-4">
          <div>
            <p className="font-display text-sm text-white">{d.kind} · {d.copies} copias</p>
            <p className="font-mono text-[11px] text-white/35">{d.checksum.slice(0, 24)}…</p>
          </div>
          <button onClick={() => onDedupe(d.checksum)}
            className="rounded-lg border border-drl/40 bg-drl/10 px-4 py-2 font-display text-xs uppercase tracking-wide text-drl transition hover:bg-drl/20">
            Conservar el mejor · eliminar {d.copies - 1}
          </button>
        </div>
      ))}
    </div>
  );
}

// --- Modal de versiones ------------------------------------------------------
function VersionsModal({ groupId, name, onClose }: { groupId: string; name: string; onClose: () => void }) {
  const [versions, setVersions] = useState<Asset[]>([]);
  useEffect(() => {
    callAdmin("versions", { groupId }).then((r) => {
      if (!r.error) setVersions(((r.assets as AssetRow[]) ?? []).map(toAsset));
    });
  }, [groupId]);

  return (
    <motion.div className="fixed inset-0 z-[75] grid place-items-center bg-black/80 p-4 backdrop-blur"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-base-800 p-6"
        initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94 }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold uppercase text-white">Versiones · {name}</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white">✕</button>
        </div>
        <div className="space-y-2">
          {versions.map((v) => {
            const url = previewUrl(v);
            return (
              <div key={v.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-base-700/40 p-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-base-900/60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url ? <img src={url} alt={v.name} className="h-full w-full object-contain" /> : <span className="text-[10px] text-white/40">{v.format}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm text-white">v{v.version}{v.isCurrent ? " · vigente" : ""}</p>
                  <p className="text-[11px] text-white/40">
                    {v.status} · {v.width && v.height ? `${v.width}×${v.height} · ` : ""}{new Date(v.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
