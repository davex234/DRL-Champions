"use client";

/**
 * F82 · SALA DE TROFEOS — pantalla (presentación pura sobre la foto del servidor). La monta la ruta `/coleccion/trofeos`
 * y el arnés de QA con los mismos props. Todo número que pinta viene calculado del servidor.
 */
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Meter } from "@/components/ui/Meter";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/format";
import type { SetView, TrophyRoomView } from "@/domain/collectionSets/view";
import { TrophyBadge } from "./TrophyBadge";
import { FILTER_LABEL, KIND_LABEL, SORT_LABEL, remainingText, visibleSets, type TrophyFilter, type TrophyKind, type TrophySort } from "./trophyModel";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("trophies");

export const trophyHref = (setId: string) => `/coleccion/trofeos/${encodeURIComponent(setId)}`;

const STATE_CHIP: Record<SetView["state"], { text: string; cls: string }> = {
  CLAIMABLE: { text: "Reclamar", cls: "bg-[#ffce4f] text-black" },
  COMPLETED: { text: "✓ Completada", cls: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/40" },
  IN_PROGRESS: { text: "En progreso", cls: "bg-white/[0.06] text-white/75 ring-1 ring-white/15" },
  LOCKED: { text: "Sin empezar", cls: "bg-white/[0.04] text-white/55 ring-1 ring-white/10" },
};

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  useLocale();
  return (
    <div className="nx-clip min-w-0 bg-white/[0.035] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" data-testid={testId}>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/55">{td(label)}</p>
      <p className="nx-readout mt-1 font-display text-[26px] font-black leading-none text-white">{td(value)}</p>
      {sub && <p className="mt-1 text-[12px] text-white/55">{td(sub)}</p>}
    </div>
  );
}

export function SetTile({ s }: { s: SetView }) {
  useLocale();
  const done = s.state === "COMPLETED";
  return (
    <Link href={trophyHref(s.id)} data-testid="set-tile" data-set={s.id} data-state={s.state}
      aria-label={tr("{title}: {owned} de {required}. {s}", { title: td(s.title), owned: s.owned, required: s.required, s: remainingText(s) })}
      className={cn("nx-focus nx-clip group relative flex min-w-0 items-center gap-4 p-4 text-left transition",
        "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] hover:bg-white/[0.06] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
        s.state === "CLAIMABLE" && "shadow-[inset_0_0_0_1px_rgba(255,206,79,0.55)]")}>
      {s.badge ? <TrophyBadge badge={s.badge} size="md" locked={!done} /> : <span className="h-[80px] w-[72px]" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-display text-[17px] font-bold uppercase tracking-wide text-white">{td(s.title)}</h3>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", STATE_CHIP[s.state].cls)}>{td(STATE_CHIP[s.state].text)}</span>
        </div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{s.kind === "TEAM" ? tr("Equipo") : tr("Edición")}{s.version > 1 ? ` · v${s.version}` : ""}{s.retired ? (" " + tr("· Retirada")) : ""}</p>
        <div className="mt-2 flex items-center gap-2">
          <Meter value={done ? 100 : s.pct} tone={done ? "ok" : s.state === "CLAIMABLE" ? "gold" : "info"} height={6} label={tr("Progreso de {title}", { title: td(s.title) })} className="flex-1" />
          <span className="nx-readout shrink-0 text-[13px] font-bold text-white">{s.owned}/{s.required}</span>
        </div>
        <p className={cn("mt-1 text-[12px]", s.state === "CLAIMABLE" ? "font-bold text-[#ffce4f]" : "text-white/60")}>{remainingText(s)}</p>
      </div>
    </Link>
  );
}

/**
 * `children`: piezas EXISTENTES de insignias que viven en esta sala (Maestría F13 y Prestigio F14, que hasta la limpieza
 * de /coleccion del 2026-10-07 se pintaban bajo el álbum de cartas). Se montan al final, dentro del mismo contenedor.
 */
export function TrophyRoomScreen({ room, children }: { room: TrophyRoomView; children?: ReactNode }) {
  useLocale();
  const [filter, setFilter] = useState<TrophyFilter>("ALL");
  const [kind, setKind] = useState<TrophyKind>("ALL");
  const [sort, setSort] = useState<TrophySort>("closest");
  const [query, setQuery] = useState("");
  const list = useMemo(() => visibleSets(room.sets, { filter, kind, query, sort }), [room.sets, filter, kind, query, sort]);
  const hasEditions = room.sets.some((s) => s.kind === "EDITION");
  const t = room.totals;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8" data-testid="trophy-room">
      <nav className="mb-3 text-[13px]"><Link href="/coleccion" className="nx-focus text-white/60 hover:text-white">{tr("← Colección")}</Link></nav>
      <header className="relative mb-6 overflow-hidden">
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.35em] text-[#ffce4f]">{tr("Valorosters")}</p>
        <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-wide text-white md:text-[48px]">{tr("Sala de Trofeos")}</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-white/70">{tr("Completa plantillas y ediciones con al menos una carta de cada requisito. Cada colección completada es una insignia permanente: no se gasta, no se vende y no desaparece.")}</p>
      </header>

      <section aria-label={tr("Resumen de tu colección")} className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat testId="stat-teams" label={tr("Equipos completados")} value={`${t.teamsCompleted}/${t.teamSets}`} />
        <Stat testId="stat-sets" label={tr("Colecciones")} value={`${t.setsCompleted}/${t.sets}`} sub={t.claimable ? tr("{n, plural, one {# lista para reclamar} other {# listas para reclamar}}", { n: t.claimable }) : undefined} />
        <Stat testId="stat-badges" label={tr("Insignias")} value={String(t.badgesUnlocked)} sub={t.collectionBadges ? tr("{collectionBadges} de colección", { collectionBadges: t.collectionBadges }) : undefined} />
        <Stat testId="stat-collection" label={tr("Catálogo")} value={`${t.collectionPct} %`} sub={tr("{owned}/{total} cartas distintas", { owned: t.ownedDistinct, total: t.catalogCards })} />
      </section>

      {t.claimable > 0 && (
        <button type="button" onClick={() => { setFilter("IN_PROGRESS"); setSort("closest"); }} data-testid="claimable-banner"
          className="nx-focus nx-clip mt-4 flex w-full items-center justify-between gap-3 bg-[#ffce4f]/10 px-4 py-3 text-left shadow-[inset_0_0_0_1px_rgba(255,206,79,0.5)]">
          <span className="font-display text-[15px] font-bold uppercase tracking-wide text-[#ffce4f]">{t.claimable === 1 ? tr("Tienes 1 colección lista para reclamar") : tr("Tienes {claimable} colecciones listas para reclamar", { claimable: t.claimable })}</span>
          <span aria-hidden className="text-[#ffce4f]">→</span>
        </button>
      )}

      <section aria-labelledby="sets-title" className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="sets-title" className="font-display text-[22px] font-black uppercase tracking-wide text-white">{tr("Colecciones")}</h2>
          <label className="flex min-w-0 items-center gap-2 text-[12px] text-white/60">
            {tr("Ordenar")}
            <select value={sort} onChange={(e) => setSort(e.target.value as TrophySort)} data-testid="trophy-sort"
              className="nx-focus rounded-md bg-white/[0.06] px-2 py-1.5 text-[13px] text-white ring-1 ring-white/15">
              {(Object.keys(SORT_LABEL) as TrophySort[]).map((k) => <option key={k} value={k} className="bg-[#0b0d14]">{td(SORT_LABEL[k])}</option>)}
            </select>
          </label>
        </div>
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Buscar equipo o jugador…")} aria-label={tr("Buscar equipo o jugador")}
            data-testid="trophy-search" className="nx-focus min-w-0 flex-1 rounded-md bg-white/[0.05] px-3 py-2 text-[14px] text-white ring-1 ring-white/15 placeholder:text-white/40" />
          <div className="max-w-full overflow-x-auto"><Segmented label={tr("Estado")} value={filter} onChange={setFilter} options={(Object.keys(FILTER_LABEL) as TrophyFilter[]).map((k) => ({ value: k, label: FILTER_LABEL[k] }))} /></div>
          {hasEditions && <div className="max-w-full overflow-x-auto"><Segmented label={tr("Tipo")} value={kind} onChange={setKind} options={(Object.keys(KIND_LABEL) as TrophyKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></div>}
        </div>
        {list.length === 0 ? (
          <p className="nx-clip bg-white/[0.03] px-4 py-6 text-center text-[14px] text-white/60" data-testid="trophy-empty">
            {room.sets.length === 0 ? tr("Todavía no hay colecciones publicadas. Vuelve pronto.") : tr("Ninguna colección coincide con el filtro.")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="set-grid">
            {list.map((s) => <SetTile key={s.id} s={s} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="badges-title" className="mt-10">
        <h2 id="badges-title" className="mb-1 font-display text-[22px] font-black uppercase tracking-wide text-white">{tr("Insignias")}</h2>
        <p className="mb-4 text-[13px] text-white/60">{fill(tr("Destaca hasta 3 en tu perfil desde {enlace}.", slots("enlace")), { enlace: <Link href="/jugador/me?editar=insignias" className="nx-focus text-[#19e3ff] underline-offset-2 hover:underline">{tr("editar perfil")}</Link> })}</p>
        {room.badges.unlocked.length === 0 ? (
          <p className="text-[13px] text-white/50" data-testid="badges-empty">{tr("Aún no tienes insignias: completa tu primera colección.")}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6" data-testid="badges-unlocked">
            {room.badges.unlocked.map((b) => <li key={b.id} className="flex justify-center"><TrophyBadge badge={b} size="md" showLabel /></li>)}
          </ul>
        )}
        {room.badges.locked.length > 0 && (
          <details className="mt-5">
            <summary className="nx-focus cursor-pointer text-[13px] font-bold uppercase tracking-wider text-white/60">{tr("Por desbloquear (")}{room.badges.locked.length})</summary>
            <ul className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6" data-testid="badges-locked">
              {room.badges.locked.map((b) => <li key={b.id} className="flex justify-center"><TrophyBadge badge={b} size="sm" locked showLabel /></li>)}
            </ul>
          </details>
        )}
      </section>

      {room.recent.length > 0 && (
        <section aria-labelledby="recent-title" className="mt-10">
          <h2 id="recent-title" className="mb-3 font-display text-[22px] font-black uppercase tracking-wide text-white">{tr("Completadas recientemente")}</h2>
          <ol className="flex flex-col gap-2" data-testid="recent-completions">
            {room.recent.map((r) => (
              <li key={r.setId}>
                <Link href={trophyHref(r.setId)} className="nx-focus nx-clip flex items-center gap-3 bg-white/[0.03] px-3 py-2 hover:bg-white/[0.06]">
                  {r.badge && <TrophyBadge badge={r.badge} size="sm" />}
                  <span className="min-w-0 flex-1 truncate font-display text-[15px] font-bold uppercase text-white">{td(r.title)}</span>
                  <time dateTime={r.completedAt} className="shrink-0 text-[12px] text-white/55">{new Date(r.completedAt).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "short", year: "numeric" })}</time>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {children}
    </div>
  );
}
