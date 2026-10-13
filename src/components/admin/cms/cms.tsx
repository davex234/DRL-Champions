"use client";

/**
 * F60 · PIEZAS COMPARTIDAS DEL CMS — subida de assets, estado de ciclo de vida, inspector de dependencias, lista de
 * comprobación y aviso de cambios sin guardar. Todo sobre las primitivas del Control Center (F58): mismos botones,
 * paneles, diálogos de riesgo y errores saneados.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { adminFetch } from "@/lib/supabase/adminClient";
import { AdminApiError } from "@/components/admin/cc/api";
import { Button, ErrorBox, Pill } from "@/components/admin/cc/ui";
import { ASSET_RULES, type CmsAssetKind } from "@/domain/cms/uploads";
import { cn } from "@/lib/format";

export interface UploadedAsset {
  id: string; kind: string; name: string; format: string | null; width: number | null; height: number | null; bytes: number | null;
  checksum: string | null; status: string; url: string | null; smallUrl: string | null; runtimeUrl: string | null; alpha: boolean | null;
  version: number; groupId: string; isCurrent: boolean;
}

/** Subida multipart con el Bearer de la sesión. El servidor valida TODO (firma, decodificación, reglas): esto sólo envía. */
export async function uploadAsset(kind: CmsAssetKind, file: File, opts: { subjectId?: string; replaceOf?: string } = {}): Promise<{ asset: UploadedAsset; deduplicated: boolean }> {
  const form = new FormData();
  form.set("action", "upload"); form.set("kind", kind); form.set("file", file);
  if (opts.subjectId) form.set("subjectId", opts.subjectId);
  if (opts.replaceOf) form.set("replaceOf", opts.replaceOf);
  const res = await adminFetch("/api/admin/cms/assets", { method: "POST", body: form });
  const data = (await res.json().catch(() => ({}))) as { error?: string; asset?: UploadedAsset; deduplicated?: boolean };
  if (!res.ok || !data.asset) throw new AdminApiError(data.error ?? `Error ${res.status}`, res.status);
  return { asset: data.asset, deduplicated: !!data.deduplicated };
}

const ACCEPT: Record<string, string> = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg", avif: "image/avif" };

/**
 * Zona de subida: vista previa LOCAL inmediata (antes de subir), reglas del tipo a la vista, y el resultado del
 * servidor (formato detectado, dimensiones, transparencia). Doble clic ⇒ el servidor devuelve el mismo asset (sha-256).
 */
export function AssetUploader({ kind, subjectId, replaceOf, current, onUploaded, label }: {
  kind: CmsAssetKind; subjectId?: string; replaceOf?: string | null; current?: { url: string | null; name?: string } | null;
  onUploaded: (a: UploadedAsset) => void; label?: string;
}) {
  const rule = ASSET_RULES[kind];
  const inputId = useId();
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<UploadedAsset | null>(null);
  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);
  const onFile = async (f: File | undefined) => {
    if (!f || busy) return;
    setError(null);
    setLocal((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    setBusy(true);
    try {
      const r = await uploadAsset(kind, f, { subjectId, replaceOf: replaceOf ?? undefined });
      setLast(r.asset); onUploaded(r.asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir");
    } finally { setBusy(false); }
  };
  const shown = last?.runtimeUrl ?? last?.url ?? local ?? current?.url ?? null;
  return (
    <div className="rounded-control border border-white/10 bg-white/[0.02] p-3" data-testid={`uploader-${kind}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-24 w-20 shrink-0 place-items-center overflow-hidden rounded-[6px] border border-white/10 bg-[#0b1020]">
          {shown ? <img src={shown} alt="" className="h-full w-full object-contain" /> : <span className="text-[11px] text-ink-faint">Sin arte</span>}
        </div>
        <div className="min-w-0 flex-1 text-[12px] text-ink-muted">
          <p className="font-display text-[12px] font-bold uppercase tracking-wider text-ink-secondary">{label ?? rule.label}</p>
          <p className="mt-1">{rule.formats.map((f) => f.toUpperCase()).join(", ")} · máx. {rule.maxBytes / 1024 / 1024} MB · mín. {rule.minW}×{rule.minH}px</p>
          {last && <p className="mt-1 text-ink-secondary">{last.format?.toUpperCase()} · {last.width}×{last.height} · {Math.round((last.bytes ?? 0) / 1024)} KB · {last.alpha ? "con transparencia" : "opaco"} · v{last.version}</p>}
          <label htmlFor={inputId} className={cn("nx-focus mt-2 inline-flex cursor-pointer items-center rounded-control border border-drl-cyan/40 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-drl-cyan hover:bg-drl-cyan/10", busy && "pointer-events-none opacity-50")}>
            {busy ? "Validando y subiendo…" : current?.url || last ? "Reemplazar" : "Subir"}
          </label>
          <input id={inputId} type="file" className="sr-only" accept={rule.formats.map((f) => ACCEPT[f]).join(",")} disabled={busy}
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
      </div>
      {error && <div className="mt-2"><ErrorBox error={error} /></div>}
    </div>
  );
}

const LIFECYCLE_TONE: Record<string, "default" | "cyan" | "gold" | "ok" | "warn" | "bad"> = {
  DRAFT: "gold", REVIEW: "gold", APPROVED: "cyan", PUBLISHED: "ok", ACTIVE: "ok", RETIRED: "warn", ARCHIVED: "default", REJECTED: "bad",
};
const LIFECYCLE_LABEL: Record<string, string> = {
  DRAFT: "Borrador", REVIEW: "Revisión", APPROVED: "Aprobada", PUBLISHED: "Publicado", ACTIVE: "Publicado", RETIRED: "Retirado", ARCHIVED: "Archivado", REJECTED: "Rechazado",
};
export function LifecycleBadge({ state }: { state: string }) {
  return <Pill tone={LIFECYCLE_TONE[state] ?? "default"}>{LIFECYCLE_LABEL[state] ?? state}</Pill>;
}

/** «Usado por…» con los recuentos REALES que devuelve el servidor (RPC de referencias de 0057). */
export function DependencyList({ refs, labels }: { refs: Record<string, number> | null | undefined; labels: Record<string, string> }) {
  if (!refs) return null;
  const rows = Object.entries(labels).map(([k, l]) => [l, Number(refs[k] ?? 0)] as const);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  return (
    <div data-testid="dependencies">
      <p className="mb-2 text-[12px] text-ink-muted">{total === 0 ? "Sin referencias: se puede borrar si es un borrador." : "Tiene referencias reales: se RETIRA, no se borra."}</p>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {rows.map(([l, n]) => (
          <li key={l} className="rounded-control border border-white/10 px-2.5 py-1.5 text-[12px]">
            <span className="block text-ink-faint">{l}</span><b className="font-display text-[16px] text-ink-primary">{n.toLocaleString("es-ES")}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Checklist({ items }: { items: { key: string; label: string; ok: boolean }[] }) {
  return (
    <ul className="space-y-1" data-testid="checklist">
      {items.map((c) => (
        <li key={c.key} className="flex items-center gap-2 text-[13px]">
          <span aria-hidden className={c.ok ? "text-ok" : "text-warn"}>{c.ok ? "✓" : "○"}</span>
          <span className={c.ok ? "text-ink-secondary" : "text-ink-primary"}>{c.label}</span>
          <span className="sr-only">{c.ok ? "listo" : "pendiente"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Aviso de CAMBIOS SIN GUARDAR: al cerrar o recargar la pestaña (`beforeunload`) y al pulsar un enlace interno del
 * panel mientras hay cambios. No se pierden veinte campos por un clic.
 */
export function useUnsavedGuard(dirty: boolean, message = "Hay cambios sin guardar. ¿Salir igualmente?") {
  const ref = useRef(dirty);
  ref.current = dirty;
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (ref.current) { e.preventDefault(); e.returnValue = ""; } };
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => { window.removeEventListener("beforeunload", onUnload); document.removeEventListener("click", onClick, true); };
  }, [message]);
}

export function DirtyBar({ dirty, saving, onSave, onReset, label = "Guardar borrador", disabled }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; label?: string; disabled?: boolean }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-3 z-30 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-panel border border-drl-gold/40 bg-surface-elevated/95 p-3 shadow-xl backdrop-blur" role="status" data-testid="dirty-bar">
      <span className="text-[13px] text-drl-gold">Cambios sin guardar</span>
      <span className="flex gap-2">
        <Button variant="ghost" onClick={onReset} disabled={saving}>Descartar</Button>
        <Button onClick={onSave} disabled={saving || disabled}>{saving ? "Guardando…" : label}</Button>
      </span>
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-panel border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.18em] text-ink-secondary">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
