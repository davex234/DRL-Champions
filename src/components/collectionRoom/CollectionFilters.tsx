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
      <Group label="Estado">
        {(["all", "owned", "missing"] as OwnershipFilter[]).map((o) => (
          <Chip key={o} active={query.own === o} onClick={() => onChange({ ...query, own: o })}>{OWNERSHIP_LABEL[o]}</Chip>
        ))}
      </Group>
      <Group label="Rareza">
        {BUCKET_ORDER.map((b) => <Chip key={b} active={query.rarity.includes(b)} onClick={() => onChange(toggleIn(query, "rarity", b))}>{BUCKET_LABEL[b]}</Chip>)}
      </Group>
      <Group label="Rol">
        {ROLE_ORDER.map((r) => <Chip key={r} active={query.role.includes(r)} onClick={() => onChange(toggleIn(query, "role", r))}>{r}</Chip>)}
      </Group>
      <Group label="Región">
        {REGION_ORDER.map((r) => <Chip key={r} active={query.region.includes(r)} onClick={() => onChange(toggleIn(query, "region", r))}>{r}</Chip>)}
      </Group>
      <Group label="Edición">
        {EDITION_ORDER.map((g) => <Chip key={g} active={query.edition.includes(g)} onClick={() => onChange(toggleIn(query, "edition", g))}>{EDITION_LABEL[g]}</Chip>)}
      </Group>
      <Group label="Equipo">
        <label className="flex min-h-[44px] items-center gap-2">
          <span className="sr-only">Añadir un equipo al filtro</span>
          <select
            value=""
            onChange={(e) => { if (e.target.value) onChange(toggleIn(query, "team", e.target.value)); }}
            className="nx-focus min-h-[44px] max-w-[260px] rounded-none border border-white/15 bg-black/40 px-2 text-[14px] text-white"
          >
            <option value="">Elegir equipo…</option>
            {teams.filter((t) => !query.team.includes(t.key)).map((t) => <option key={t.key} value={t.key}>{t.label} ({t.total})</option>)}
          </select>
        </label>
        {query.team.map((k) => (
          <Chip key={k} active onClick={() => onChange(toggleIn(query, "team", k))}>{teams.find((t) => t.key === k)?.label ?? k.replace(/^raw:/, "")} ✕</Chip>
        ))}
      </Group>
      <Group label="OVR">
        <OvrInput label="OVR mínimo" value={query.minOvr} onChange={(v) => onChange({ ...query, minOvr: v })} />
        <span aria-hidden className="text-white/40">—</span>
        <OvrInput label="OVR máximo" value={query.maxOvr} onChange={(v) => onChange({ ...query, maxOvr: v })} />
      </Group>
      <Group label="Copias">
        <Chip active={query.dup} onClick={() => onChange({ ...query, dup: !query.dup })}>Solo duplicadas</Chip>
        <Chip active={query.fav} onClick={() => favoritesAvailable && onChange({ ...query, fav: !query.fav })}>{favoritesAvailable ? "Solo favoritas" : "Favoritas (no disponibles)"}</Chip>
      </Group>
    </div>
  );

  if (variant === "panel") return <div className="mt-3 border-t border-edge pt-3">{body}</div>;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Filtros de la colección" onClick={(e) => e.stopPropagation()}
        className="nx-clip max-h-[85vh] w-full overflow-y-auto border-t border-white/15 bg-[rgba(10,12,20,0.98)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-[18px] font-bold uppercase text-white">Filtros</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar filtros" className="nx-focus grid h-11 w-11 place-items-center text-white/70 hover:text-white">✕</button>
        </div>
        {body}
        <div className="sticky bottom-0 mt-4 flex gap-3 bg-[rgba(10,12,20,0.98)] pt-3">
          <NxButton variant="secondary" size="md" className="flex-1" onClick={() => onChange({ ...DEFAULT_QUERY, q: query.q, sort: query.sort })} disabled={activeFilterCount(query) === 0}>Limpiar</NxButton>
          <NxButton variant="primary" size="md" className="flex-1" onClick={onClose}>Ver {matched} {matched === 1 ? "carta" : "cartas"}</NxButton>
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label={label}>
      <span className="w-[68px] shrink-0 font-display text-label uppercase tracking-wide2 text-ink-faint">{label}</span>
      <div className={cn("flex flex-wrap items-center gap-1.5")}>{children}</div>
    </div>
  );
}

function OvrInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <label className="flex min-h-[44px] items-center">
      <span className="sr-only">{label}</span>
      <input type="number" inputMode="numeric" min={0} max={99} value={value ?? ""} placeholder={label.endsWith("mínimo") ? "mín" : "máx"}
        onChange={(e) => { const n = e.target.value === "" ? null : Math.max(0, Math.min(99, Math.trunc(Number(e.target.value)))); onChange(Number.isFinite(n as number) || n === null ? n : null); }}
        className="nx-focus min-h-[44px] w-20 border border-white/15 bg-black/40 px-2 text-[14px] text-white" />
    </label>
  );
}
