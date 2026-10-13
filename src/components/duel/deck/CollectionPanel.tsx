"use client";

/**
 * PANEL DE COLECCIÓN DEL CONSTRUCTOR (Fase 32). Solo cartas que el SERVIDOR dice que son tuyas.
 *
 * El filtro es el de Collection 2.0 (`applyFilter`, vía `filterPool`): buscar, rol, OVR mínima; más
 * equipo, rareza y «solo repetidas». Orden: OVR, nombre, rareza, más recientes. Se pintan 36 cartas y
 * «Ver más»: nunca cien cartas ricas a la vez.
 *
 * Pulsar una carta hace lo que dice su etiqueta, calculada con `actionForCard`:
 *   + AÑADIR       → entra en el primer hueco libre de su rol;
 *   ⇄ SUSTITUIR    → se elige y se iluminan los huecos donde puede sustituir (mismo jugador, rol lleno);
 *   ✓ EN EL EQUIPO → lleva a su hueco;
 *   NO COMPATIBLE  → no es un botón; debajo se lee por qué.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { DUEL_ROLES } from "@/domain/cardgame";
import { BUCKET_LABEL } from "@/domain/packs/types";
import {
  actionForCard, type Board, type BuilderCard, type CardAction, type DraftCheck, type Pool,
} from "@/domain/deckBuilder/builder";
import {
  copiesByCard, filterPool, isFiltered, teamsOf, EMPTY_FILTER, RARITIES, SORTS, type PoolFilter, type PoolSort,
} from "@/domain/deckBuilder/pool";
import { DuelCard } from "../DuelCard";

const PAGE = 36;
const OVR_STEPS = [0, 70, 75, 80, 85];

export interface CollectionPanelProps {
  cards: BuilderCard[];
  uids: readonly string[];
  pool: Pool;
  board: Board;
  check: DraftCheck;
  filter: PoolFilter;
  sort: PoolSort;
  onFilter: (f: PoolFilter) => void;
  onSort: (s: PoolSort) => void;
  selectedUid: string | null;
  onCard: (card: BuilderCard, action: CardAction) => void;
  unopenedPacks?: number;
}

export function CollectionPanel(p: CollectionPanelProps) {
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => filterPool(p.cards, p.filter, p.sort), [p.cards, p.filter, p.sort]);
  const teams = useMemo(() => teamsOf(p.cards), [p.cards]);
  const copies = useMemo(() => copiesByCard(p.cards), [p.cards]);
  const visible = useMemo(() => list.slice(0, shown), [list, shown]);
  const actions = useMemo(
    () => new Map(visible.map((c) => [c.uid, actionForCard(c, p.uids, p.pool, p.board, p.check)])),
    [visible, p.uids, p.pool, p.board, p.check],
  );
  const set = (patch: Partial<PoolFilter>) => { setShown(PAGE); p.onFilter({ ...p.filter, ...patch }); };
  const missing = p.check.validation.missingByRole;

  return (
    <div data-testid="collection-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-h3 font-bold uppercase tracking-wide text-white">Tu colección</h2>
        <span className="text-caption text-ink-faint" aria-live="polite">
          <span className="nx-readout text-ink-secondary">{list.length}</span> de {p.cards.length}
        </span>
      </div>

      <label className="mt-2 block">
        <span className="sr-only">Buscar carta</span>
        <input
          type="search"
          value={p.filter.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Buscar jugador, equipo o variante…"
          aria-label="Buscar carta"
          className="nx-focus min-h-[44px] w-full rounded-control border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-drl/60"
        />
      </label>

      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por rol">
        <Chip active={!p.filter.role} onClick={() => set({ role: "" })}>Todos</Chip>
        {DUEL_ROLES.map((r) => (
          <Chip key={r} active={p.filter.role === r} onClick={() => set({ role: r })} need={missing[r] > 0}>
            {r}
            {missing[r] > 0 && <span className="ml-1 text-drl-gold">·{missing[r]}</span>}
          </Chip>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Select label="Equipo" value={p.filter.team} onChange={(v) => set({ team: v })} options={[["", "Todos los equipos"], ...teams.map((t) => [t, t] as [string, string])]} />
        <Select label="Rareza" value={p.filter.rarity} onChange={(v) => set({ rarity: v as PoolFilter["rarity"] })} options={[["", "Cualquier rareza"], ...RARITIES.map((r) => [r, BUCKET_LABEL[r]] as [string, string])]} />
        <Select label="OVR mínima" value={String(p.filter.minOvr)} onChange={(v) => set({ minOvr: Number(v) })} options={OVR_STEPS.map((n) => [String(n), n ? `OVR ${n}+` : "Cualquier OVR"] as [string, string])} />
        <label className="flex min-h-[44px] items-center gap-2 rounded-control border border-white/10 bg-white/[0.03] px-3 text-[12px] text-ink-secondary">
          <input type="checkbox" checked={p.filter.duplicates} onChange={(e) => set({ duplicates: e.target.checked })} className="h-4 w-4 accent-[var(--nx-key)]" />
          Solo repetidas
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="Ordenar por">
        <span className="nx-label mr-1">Orden</span>
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={p.sort === s.id}
            onClick={() => p.onSort(s.id)}
            className={cn(
              "nx-focus min-h-[36px] rounded-chip px-2.5 font-display text-[11px] font-bold uppercase tracking-wide transition",
              p.sort === s.id ? "bg-drl text-white" : "bg-white/5 text-white/55 hover:bg-white/10",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {p.cards.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/15 px-4 py-8 text-center" data-empty="no-cards">
          <p className="font-display text-body font-bold uppercase text-white">Todavía no tienes cartas</p>
          <p className="mt-1 text-caption text-ink-muted">Un equipo son diez cartas tuyas. Consíguelas abriendo sobres.</p>
          <Link href={(p.unopenedPacks ?? 0) > 0 ? "/inventario" : "/tienda"} className="nx-action mt-2 inline-flex min-h-[44px] items-center">
            {(p.unopenedPacks ?? 0) > 0 ? "Abrir mis sobres →" : "Conseguir un sobre →"}
          </Link>
        </div>
      ) : list.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/15 px-4 py-8 text-center" data-empty="no-match">
          <p className="text-sm text-white">Ninguna carta coincide con los filtros.</p>
          {isFiltered(p.filter) && (
            <button type="button" onClick={() => set(EMPTY_FILTER)} className="nx-action mt-2 inline-flex min-h-[44px] items-center">Quitar filtros</button>
          )}
        </div>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-3" aria-label="Cartas de tu colección">
            {visible.map((c) => {
              const a = actions.get(c.uid)!;
              const n = copies.get(c.cardId) ?? 1;
              const chosen = p.selectedUid === c.uid;
              return (
                <li key={c.uid} className="min-w-0" data-card={c.uid} data-action={a.kind}>
                  <div className="relative" style={chosen ? { filter: "drop-shadow(0 0 7px #ffd35c) drop-shadow(0 0 2px #ffd35c)" } : undefined} data-chosen={chosen ? "true" : undefined}>
                    <DuelCard
                      card={c}
                      size="sm"
                      className="!w-full"
                      selected={a.kind === "in_deck"}
                      disabled={a.kind === "blocked"}
                      onClick={a.kind === "blocked" ? undefined : () => p.onCard(c, a)}
                    />
                    {n > 1 && (
                      <span className="pointer-events-none absolute right-1 top-[38%] rounded bg-black/75 px-1 text-[9px] font-bold text-white">×{n}</span>
                    )}
                  </div>
                  <ActionLabel action={a} />
                </li>
              );
            })}
          </ul>
          {list.length > shown && (
            <button
              type="button"
              onClick={() => setShown((s) => s + PAGE)}
              className="nx-focus mt-3 min-h-[44px] w-full rounded-control border border-white/12 font-display text-[12px] font-bold uppercase tracking-wide text-white/70 hover:bg-white/5"
            >
              Ver más ({list.length - shown})
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ActionLabel({ action }: { action: CardAction }) {
  switch (action.kind) {
    case "add": return <p className="mt-1 truncate text-center text-[10px] font-bold uppercase tracking-wide text-drl-cyan">+ Añadir</p>;
    case "replace": return <p className="mt-1 truncate text-center text-[10px] font-bold uppercase tracking-wide text-drl-gold" title={action.reason}>⇄ Sustituir</p>;
    case "in_deck": return <p className="mt-1 truncate text-center text-[10px] font-bold uppercase tracking-wide text-ok">✓ En el equipo</p>;
    default: return <p className="mt-1 line-clamp-2 text-center text-[9.5px] leading-tight text-ink-faint">{action.reason}</p>;
  }
}

function Chip({ active, need, onClick, children }: { active: boolean; need?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "nx-focus min-h-[36px] rounded-full border px-3 text-[11px] font-semibold transition",
        active ? "border-drl bg-drl/15 text-white" : need ? "border-drl-gold/40 bg-drl-gold/5 text-white/70 hover:bg-drl-gold/10" : "border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.07]",
      )}
    >
      {children}
    </button>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="nx-focus min-h-[44px] w-full rounded-control border border-white/10 bg-base-900 px-2 text-[12px] text-white"
      >
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}
