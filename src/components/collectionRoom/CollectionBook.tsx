"use client";

/**
 * COLLECTION ROOM · EL LIBRO (Fase 37). Sets DERIVADOS del catálogo (equipo con su identidad verificada, región, rol,
 * rareza, edición), con progreso real. Tocar un set aplica su filtro al álbum. Completar un set no concede nada.
 */
import { useState } from "react";
import type { CollectionSetKind, CollectionSetProgress, CollectionSnapshot } from "@/domain/collection/room";
import { Segmented } from "@/components/ui/Segmented";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";

const TABS: { value: CollectionSetKind; label: string }[] = [
  { value: "team", label: "Equipos" }, { value: "region", label: "Regiones" }, { value: "role", label: "Roles" },
  { value: "rarity", label: "Rarezas" }, { value: "edition", label: "Ediciones" },
];
const TEAM_PREVIEW = 12;

export function CollectionBook({ snap, onPick, initial = "team" }: { snap: CollectionSnapshot; onPick: (set: CollectionSetProgress) => void; initial?: CollectionSetKind }) {
  const [tab, setTab] = useState<CollectionSetKind>(initial);
  const [all, setAll] = useState(false);
  const list = snap.sets[tab];
  const shown = tab === "team" && !all ? list.slice(0, TEAM_PREVIEW) : list;
  return (
    <section aria-labelledby="collection-book-title" data-testid="collection-book" className="nx-clip-sm border border-white/10 bg-[linear-gradient(160deg,rgba(18,22,36,0.92),rgba(8,10,18,0.96))] p-4 sm:p-5">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">Libro de la colección</p>
          <h2 id="collection-book-title" className="font-display text-[20px] font-bold uppercase tracking-[0.04em] text-white">Completa tus sets</h2>
        </div>
        {/* En móvil las cinco pestañas no caben en 326 px: se desplazan dentro de su caja en vez de recortarse. */}
        <Segmented label="Tipo de set" value={tab} onChange={(v) => { setTab(v as CollectionSetKind); setAll(false); }} options={TABS} className="max-w-full overflow-x-auto" />
      </header>
      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-kind={tab}>
        {shown.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onPick(s)} data-set={s.id}
              aria-label={`${s.label}: ${s.owned} de ${s.total} cartas${s.complete ? ", completo" : s.near ? ", casi completo" : ""}. Ver en el álbum`}
              className={cn("nx-focus nx-clip-sm flex min-h-[64px] w-full flex-col gap-1.5 border px-3.5 py-2.5 text-left transition hover:border-white/30",
                s.complete ? "border-ok/40 bg-ok/[0.06]" : s.near ? "border-drl-gold/40 bg-drl-gold/[0.06]" : "border-white/10 bg-black/25")}>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[14px] font-semibold text-white">{s.label}</span>
                {s.complete ? <Badge tone="ok">Completo</Badge> : s.near ? <Badge tone="gold">Casi completo</Badge> : <span className="nx-readout text-[13px] text-white/70">{s.owned}/{s.total}</span>}
              </span>
              <Meter value={s.pct} tone={s.complete ? "ok" : s.near ? "gold" : "info"} height={5} label={`${s.label}: ${s.owned} de ${s.total}`} />
              {(s.complete || s.near) && <span className="nx-readout text-[12px] text-white/60">{s.owned}/{s.total}{s.near ? ` · faltan ${s.missing}` : ""}</span>}
            </button>
          </li>
        ))}
      </ul>
      {tab === "team" && list.length > TEAM_PREVIEW && (
        <div className="mt-3 flex justify-center">
          <NxButton variant="secondary" size="md" onClick={() => setAll((v) => !v)}>{all ? "Ver menos equipos" : `Ver los ${list.length} equipos`}</NxButton>
        </div>
      )}
    </section>
  );
}
