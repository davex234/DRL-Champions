"use client";

/**
 * F58 · PRIMITIVAS DEL CONTROL CENTER. Oscuro, denso y legible: el panel es una herramienta, no un escaparate.
 *
 * Accesibilidad: todo campo con `<label>`, foco visible (`nx-focus`), estados sin depender SOLO del color (cada estado
 * lleva icono + texto), diálogos con `role="dialog"`, `aria-modal`, Escape para cerrar y foco devuelto al origen.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";

/* ───────── Contenedores ───────── */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-drl-cyan/80">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide text-ink-primary md:text-[34px]">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-[14px] leading-relaxed text-ink-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, subtitle, actions, children, className, dense, tone }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; dense?: boolean; tone?: "danger" | "gold" | "cyan" }) {
  return (
    <section className={cn("relative overflow-hidden rounded-panel border bg-surface-raised/80 shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)]",
      tone === "danger" ? "border-bad/40" : tone === "gold" ? "border-drl-gold/25" : tone === "cyan" ? "border-drl-cyan/25" : "border-white/[0.07]", className)}>
      {(title || actions) && (
        <header className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06]", dense ? "px-4 py-2.5" : "px-5 py-3.5")}>
          <div className="min-w-0">
            {title && <h2 className="font-display text-[15px] font-bold uppercase tracking-[0.12em] text-ink-primary">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12px] text-ink-faint">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={dense ? "p-4" : "p-5"}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, accent = "default", href }: { label: string; value: ReactNode; hint?: ReactNode; accent?: "default" | "cyan" | "gold" | "drl" | "ok" | "warn" | "bad"; href?: string }) {
  const bar = { default: "bg-white/20", cyan: "bg-drl-cyan", gold: "bg-drl-gold", drl: "bg-drl", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" }[accent];
  const body = (
    <div className="group relative h-full overflow-hidden rounded-card border border-white/[0.07] bg-gradient-to-b from-surface-elevated/70 to-surface-raised/70 px-4 py-3.5 transition hover:border-white/15">
      <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r", bar)} />
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">{label}</p>
      <p className="mt-1 font-display text-[28px] font-bold leading-none tabular-nums text-ink-primary">{value}</p>
      {hint && <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="nx-focus block rounded-card">{body}</Link> : body;
}

export type Level = "HEALTHY" | "WARNING" | "CRITICAL" | "INFO";
const LEVEL: Record<Level, { icon: string; text: string; cls: string }> = {
  HEALTHY: { icon: "●", text: "OK", cls: "border-ok/40 bg-ok/10 text-ok" },
  WARNING: { icon: "▲", text: "Aviso", cls: "border-warn/40 bg-warn/10 text-warn" },
  CRITICAL: { icon: "■", text: "Crítico", cls: "border-bad/50 bg-bad/10 text-bad" },
  INFO: { icon: "◆", text: "Info", cls: "border-drl-cyan/40 bg-drl-cyan/10 text-drl-cyan" },
};
export function LevelBadge({ level, label }: { level: Level; label?: string }) {
  const l = LEVEL[level];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-chip border px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-wider", l.cls)}><span aria-hidden>{l.icon}</span>{label ?? l.text}</span>;
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "cyan" | "gold" | "drl" | "ok" | "warn" | "bad" }) {
  const cls = { default: "border-white/15 bg-white/[0.04] text-ink-secondary", cyan: "border-drl-cyan/35 bg-drl-cyan/10 text-drl-cyan", gold: "border-drl-gold/35 bg-drl-gold/10 text-drl-gold", drl: "border-drl/40 bg-drl/10 text-drl-glow", ok: "border-ok/35 bg-ok/10 text-ok", warn: "border-warn/35 bg-warn/10 text-warn", bad: "border-bad/40 bg-bad/10 text-bad" }[tone];
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-chip border px-2 py-0.5 text-[11px] font-semibold", cls)}>{children}</span>;
}

export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols === 3 ? "sm:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "")}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{k}</dt>
          <dd className="mt-0.5 break-words text-[14px] text-ink-primary">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ───────── Estados ───────── */
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-9 animate-pulse rounded-control bg-white/[0.04]" />)}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-white/10 px-5 py-8 text-center">
      <p className="font-display text-sm font-bold uppercase tracking-widest text-ink-muted">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-[13px] text-ink-faint">{children}</div>}
    </div>
  );
}
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-bad/40 bg-bad/[0.07] px-4 py-3 text-[13px] text-ink-secondary">
      <span><span aria-hidden className="mr-2 text-bad">■</span>{error}</span>
      {onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

/* ───────── Controles ───────── */
type BtnVariant = "primary" | "ghost" | "danger" | "gold" | "cyan";
export function Button({ children, variant = "primary", size = "md", className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const v = { primary: "border-drl/60 bg-drl text-white hover:bg-drl-glow", ghost: "border-white/12 bg-white/[0.04] text-ink-secondary hover:bg-white/[0.08] hover:text-ink-primary", danger: "border-bad/60 bg-bad/15 text-bad hover:bg-bad/25", gold: "border-drl-gold/50 bg-drl-gold/15 text-drl-gold hover:bg-drl-gold/25", cyan: "border-drl-cyan/45 bg-drl-cyan/10 text-drl-cyan hover:bg-drl-cyan/20" }[variant];
  return (
    <button type="button" {...rest} className={cn("nx-focus inline-flex items-center justify-center gap-2 rounded-control border font-display font-bold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40",
      size === "sm" ? "min-h-[32px] px-3 text-[11px]" : "min-h-[40px] px-4 text-[13px]", v, className)}>{children}</button>
  );
}

export function LinkButton({ href, children, variant = "ghost" }: { href: string; children: ReactNode; variant?: BtnVariant }) {
  const v = { primary: "border-drl/60 bg-drl text-white hover:bg-drl-glow", ghost: "border-white/12 bg-white/[0.04] text-ink-secondary hover:bg-white/[0.08] hover:text-ink-primary", danger: "border-bad/60 bg-bad/15 text-bad", gold: "border-drl-gold/50 bg-drl-gold/15 text-drl-gold", cyan: "border-drl-cyan/45 bg-drl-cyan/10 text-drl-cyan hover:bg-drl-cyan/20" }[variant];
  return <Link href={href} className={cn("nx-focus inline-flex min-h-[40px] items-center gap-2 rounded-control border px-4 font-display text-[13px] font-bold uppercase tracking-wider transition", v)}>{children}</Link>;
}

const inputCls = "nx-focus w-full rounded-control border border-white/10 bg-surface-base px-3 py-2 text-[14px] text-ink-primary placeholder:text-ink-faint focus:border-drl-cyan/50 disabled:opacity-50";
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1 block font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-[12px] text-ink-faint">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-[12px] text-bad">▲ {error}</p>}
    </div>
  );
}
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(inputCls, p.className)} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cn(inputCls, "pr-8", p.className)} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cn(inputCls, "min-h-[84px]", p.className)} />;

export function SearchBox({ value, onChange, placeholder, label = "Buscar" }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  const id = useId();
  return (
    <div className="relative min-w-[220px] flex-1">
      <label htmlFor={id} className="sr-only">{label}</label>
      <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">⌕</span>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value.slice(0, 80))} placeholder={placeholder} className={cn(inputCls, "pl-8")} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 rounded-control border border-white/[0.07] bg-surface-base/60 p-1">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} type="button" onClick={() => onChange(it.id)}
          className={cn("nx-focus rounded-[6px] px-3 py-1.5 font-display text-[12px] font-bold uppercase tracking-wider transition",
            value === it.id ? "bg-white/[0.09] text-ink-primary" : "text-ink-faint hover:text-ink-secondary")}>
          {it.label}{it.count != null && <span className="ml-1.5 tabular-nums text-ink-faint">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ───────── Tabla ───────── */
export interface Col<T> { key: string; label: string; render: (row: T) => ReactNode; sort?: (row: T) => number | string; align?: "right" | "left"; className?: string }

export function DataTable<T>({ rows, cols, rowKey, onRowClick, empty = "Sin resultados", initialSort, selectable, selected, onSelect, caption }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; onRowClick?: (r: T) => void; empty?: string; initialSort?: { key: string; dir: "asc" | "desc" };
  selectable?: boolean; selected?: Set<string>; onSelect?: (keys: Set<string>) => void; caption: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const col = sort ? cols.find((c) => c.key === sort.key) : null;
  const sorted = col?.sort ? [...rows].sort((a, b) => { const x = col.sort!(a), y = col.sort!(b); return (x < y ? -1 : x > y ? 1 : 0) * (sort!.dir === "asc" ? 1 : -1); }) : rows;
  const allKeys = rows.map(rowKey);
  const allOn = selectable && allKeys.length > 0 && allKeys.every((k) => selected?.has(k));
  if (rows.length === 0) return <Empty title={empty} />;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {selectable && (
              <th className="w-9 border-b border-white/[0.07] px-2 py-2 text-left">
                <input type="checkbox" aria-label="Seleccionar todo" checked={!!allOn} onChange={() => onSelect?.(allOn ? new Set() : new Set(allKeys))} className="nx-focus accent-[#19e3ff]" />
              </th>
            )}
            {cols.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                className={cn("whitespace-nowrap border-b border-white/[0.07] px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint", c.align === "right" ? "text-right" : "text-left")}>
                {c.sort ? (
                  <button type="button" className="nx-focus inline-flex items-center gap-1 uppercase hover:text-ink-secondary" onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === "desc" ? "asc" : "desc" }))}>
                    {c.label}<span aria-hidden>{sort?.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("group", onRowClick && "cursor-pointer")}>
                {selectable && (
                  <td className="border-b border-white/[0.04] px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Seleccionar ${k}`} checked={!!selected?.has(k)} onChange={() => { const n = new Set(selected); if (n.has(k)) n.delete(k); else n.add(k); onSelect?.(n); }} className="nx-focus accent-[#19e3ff]" />
                  </td>
                )}
                {cols.map((c) => (
                  <td key={c.key} className={cn("border-b border-white/[0.04] px-3 py-2 align-middle text-ink-secondary transition group-hover:bg-white/[0.025]", c.align === "right" && "text-right tabular-nums", c.className)}>{c.render(r)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Paginación" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-faint">
      <span className="tabular-nums">{total === 0 ? "0 resultados" : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} de ${total.toLocaleString("es-ES")}`}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">‹ Anterior</Button>
        <span className="tabular-nums">{page} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Página siguiente">Siguiente ›</Button>
      </div>
    </nav>
  );
}

/* ───────── Barras (distribuciones): datos reales, sin decoración ───────── */
export function Bars({ data, format = (n) => n.toLocaleString("es-ES"), accent = "cyan", label }: { data: { label: string; value: number; sub?: string }[]; format?: (n: number) => string; accent?: "cyan" | "gold" | "drl"; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fill = { cyan: "from-drl-cyan/70 to-drl-cyan/30", gold: "from-drl-gold/70 to-drl-gold/30", drl: "from-drl/70 to-drl/30" }[accent];
  if (!data.length) return <Empty title="Sin datos" />;
  return (
    <ul aria-label={label} className="space-y-1.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(84px,140px)_1fr_auto] items-center gap-3 text-[12px]">
          <span className="truncate text-ink-muted" title={d.label}>{d.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]"><span className={cn("block h-full rounded-full bg-gradient-to-r", fill)} style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="tabular-nums text-ink-secondary">{format(d.value)}{d.sub && <span className="ml-1 text-ink-faint">{d.sub}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/* ───────── Diálogo de confirmación por nivel de riesgo ───────── */
export type Risk = "MEDIUM" | "HIGH" | "CRITICAL";
export function ConfirmDialog({ open, onClose, onConfirm, title, risk, children, confirmLabel, busy, error, typeToConfirm, canConfirm = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; risk: Risk; children: ReactNode; confirmLabel: string;
  busy?: boolean; error?: string | null; typeToConfirm?: string; canConfirm?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId(), inputId = useId();
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement;
    setTyped("");
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input, textarea, select, button[data-cancel]")?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); (back.current as HTMLElement | null)?.focus?.(); };
  }, [open, busy, onClose]);
  if (!open) return null;
  const typedOk = !typeToConfirm || typed.trim() === typeToConfirm;
  const tone = risk === "CRITICAL" ? "border-bad/60" : risk === "HIGH" ? "border-warn/50" : "border-white/15";
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-panel border bg-surface-elevated p-5 shadow-2xl", tone)}>
        <div className="mb-3 flex items-center gap-2">
          <LevelBadge level={risk === "CRITICAL" ? "CRITICAL" : risk === "HIGH" ? "WARNING" : "INFO"} label={`Riesgo ${risk === "CRITICAL" ? "crítico" : risk === "HIGH" ? "alto" : "medio"}`} />
        </div>
        <h2 id={titleId} className="font-display text-xl font-bold uppercase tracking-wide text-ink-primary">{title}</h2>
        <div className="mt-3 space-y-3 text-[14px] text-ink-secondary">{children}</div>
        {typeToConfirm && (
          <div className="mt-4">
            <label htmlFor={inputId} className="block text-[12px] text-ink-muted">Escribe <code className="rounded bg-white/10 px-1 text-ink-primary">{typeToConfirm}</code> para confirmar</label>
            <Input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        {error && <div className="mt-4"><ErrorBox error={error} /></div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" data-cancel onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant={risk === "MEDIUM" ? "primary" : "danger"} onClick={onConfirm} disabled={busy || !typedOk || !canConfirm}>{busy ? "Procesando…" : confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
