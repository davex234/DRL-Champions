"use client";

/**
 * COLLECTION ROOM · FILTROS (Fase 37). Solo filtros que existen en los datos: estado, rareza, rol, región, edición,
 * equipo (identidad verificada o nombre tal cual), OVR, duplicadas y favoritas (si el servidor las tiene).
 *
 * En escritorio es un panel bajo la barra; en móvil, una hoja (diálogo) con Escape, foco inicial y «Ver N cartas».
 */
import { useEffect, useRef } from "react";
import type { CollectionQuery, OwnershipFilter } from "@/domain/collection/query";
import { OWNERSHIP_LABEL, activeFilterCount, toggleIn, DEFAULT_QUERY } from "@/domain/collection/query";
import { BUCKET_LABEL, BUCKET_ORDER, EDITION_LABEL, EDITION_ORDER, REGION_ORDER, ROLE_ORDER } from "@/domain/collection/room";
import { Chip } from "@/components/ui/Chip";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("collectionRoom");

export interface TeamOption { key: string; label: string; total: number }

export function CollectionFilters({ query, onChange, teams, favoritesAvailable, matched, variant, onClose }: {
  query: CollectionQuery;
  onChange: (q: CollectionQuery) => void;
  teams: TeamOption[];
  favoritesAvailable: boolean;
  matched: number;
  variant: "panel" | "sheet";
  onClose?: () => void;
}) {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (variant !== "sheet") return;
    ref.current?.querySelector<HTMLElement>("button, input, select")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, onClose]);

  const body = (
    <div className="space-y-3.5" data-testid="collection-filters">
      <Group label={tr("Estado")}>
        {(["all", "owned", "missing"] as OwnershipFilter[]).map((o) => (
          <Chip key={o} active={query.own === o} onClick={() => onChange({ ...query, own: o })}>{td(OWNERSHIP_LABEL[o])}</Chip>
        ))}
      </Group>
      <Group label={tr("Rareza")}>
        {BUCKET_ORDER.map((b) => <Chip key={b} active={query.rarity.includes(b)} onClick={() => onChange(toggleIn(query, "rarity", b))}>{td(BUCKET_LABEL[b])}</Chip>)}
      </Group>
      <Group label={tr("Rol")}>
        {ROLE_ORDER.map((r) => <Chip key={r} active={query.role.includes(r)} onClick={() => onChange(toggleIn(query, "role", r))}>{td(r)}</Chip>)}
      </Group>
      <Group label={tr("Región")}>
        {REGION_ORDER.map((r) => <Chip key={r} active={query.region.includes(r)} onClick={() => onChange(toggleIn(query, "region", r))}>{td(r)}</Chip>)}
      </Group>
      <Group label={tr("Edición")}>
        {EDITION_ORDER.map((g) => <Chip key={g} active={query.edition.includes(g)} onClick={() => onChange(toggleIn(query, "edition", g))}>{td(EDITION_LABEL[g])}</Chip>)}
      </Group>
      <Group label={tr("Equipo")}>
        <label className="flex min-h-[44px] items-center gap-2">
          <span className="sr-only">{tr("Añadir un equipo al filtro")}</span>
          <select
            value=""
            onChange={(e) => { if (e.target.value) onChange(toggleIn(query, "team", e.target.value)); }}
            className="nx-focus min-h-[44px] max-w-[260px] rounded-none border border-white/15 bg-black/40 px-2 text-[14px] text-white"
          >
            <option value="">{tr("Elegir equipo…")}</option>
            {teams.filter((t) => !query.team.includes(t.key)).map((t) => <option key={t.key} value={t.key}>{td(t.label)} ({t.total})</option>)}
          </select>
        </label>
        {query.team.map((k) => (
          <Chip key={k} active onClick={() => onChange(toggleIn(query, "team", k))}>{td(teams.find((t) => t.key === k)?.label) ?? k.replace(/^raw:/, "")} ✕</Chip>
        ))}
      </Group>
      <Group label={tr("OVR")}>
        <OvrInput label={tr("OVR mínimo")} placeholder={tr("mín")} value={query.minOvr} onChange={(v) => onChange({ ...query, minOvr: v })} />
        <span aria-hidden className="text-white/40">—</span>
        <OvrInput label={tr("OVR máximo")} placeholder={tr("máx")} value={query.maxOvr} onChange={(v) => onChange({ ...query, maxOvr: v })} />
      </Group>
      <Group label={tr("Copias")}>
        <Chip active={query.dup} onClick={() => onChange({ ...query, dup: !query.dup })}>{tr("Solo duplicadas")}</Chip>
        <Chip active={query.fav} onClick={() => favoritesAvailable && onChange({ ...query, fav: !query.fav })}>{favoritesAvailable ? tr("Solo favoritas") : tr("Favoritas (no disponibles)")}</Chip>
      </Group>
    </div>
  );

  if (variant === "panel") return <div className="mt-3 border-t border-edge pt-3">{body}</div>;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={tr("Filtros de la colección")} onClick={(e) => e.stopPropagation()}
        className="nx-clip max-h-[85vh] w-full overflow-y-auto border-t border-white/15 bg-[rgba(10,12,20,0.98)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-[18px] font-bold uppercase text-white">{tr("Filtros")}</h2>
          <button type="button" onClick={onClose} aria-label={tr("Cerrar filtros")} className="nx-focus grid h-11 w-11 place-items-center text-white/70 hover:text-white">✕</button>
        </div>
        {body}
        <div className="sticky bottom-0 mt-4 flex gap-3 bg-[rgba(10,12,20,0.98)] pt-3">
          <NxButton variant="secondary" size="md" className="flex-1" onClick={() => onChange({ ...DEFAULT_QUERY, q: query.q, sort: query.sort })} disabled={activeFilterCount(query) === 0}>{tr("Limpiar")}</NxButton>
          <NxButton variant="primary" size="md" className="flex-1" onClick={onClose}>{tr("{n, plural, one {Ver {n} carta} other {Ver {n} cartas}}", { n: matched })}</NxButton>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  useLocale();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label={td(label)}>
      <span className="w-[68px] shrink-0 font-display text-label uppercase tracking-wide2 text-ink-faint">{td(label)}</span>
      <div className={cn("flex flex-wrap items-center gap-1.5")}>{children}</div>
    </div>
  );
}

/** `label` y `placeholder` llegan YA traducidos: decidir «mín/máx» mirando el texto del rótulo fallaba fuera del español. */
function OvrInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: number | null; onChange: (v: number | null) => void }) {
  useLocale();
  return (
    <label className="flex min-h-[44px] items-center">
      <span className="sr-only">{label}</span>
      <input type="number" inputMode="numeric" min={0} max={99} value={value ?? ""} placeholder={placeholder}
        onChange={(e) => { const n = e.target.value === "" ? null : Math.max(0, Math.min(99, Math.trunc(Number(e.target.value)))); onChange(Number.isFinite(n as number) || n === null ? n : null); }}
        className="nx-focus min-h-[44px] w-20 border border-white/15 bg-black/40 px-2 text-[14px] text-white" />
    </label>
  );
}
