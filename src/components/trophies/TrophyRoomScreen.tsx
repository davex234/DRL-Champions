"use client";

/**
 * COLECCIONES — pantalla (presentación pura sobre la foto del servidor). La monta la ruta `/coleccion/trofeos` y el
 * arnés de QA con los mismos props. Todo número que pinta viene calculado del servidor.
 *
 *   · Colecciones: una tarjeta por equipo con cartas en el catálogo. Completar un equipo = tener TODAS sus cartas.
 *     Se enseñan 3 al entrar y «Ver más equipos» añade 6 cada vez, hasta que no queda ninguno.
 *   · Insignias regionales: Americas, EMEA, Pacific y China. Cada una pide todos los equipos de su región y, una vez
 *     desbloqueada, es permanente y se puede destacar en el perfil.
 *
 * El bloque antiguo de insignias (las de cada set, Maestría y Prestigio) ya no se pinta aquí.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Meter } from "@/components/ui/Meter";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/format";
import { TEAM_COLLECTION_XP, visibleTeamCount, type TeamCollectionsView, type TeamTileView } from "@/domain/teamCollections/model";
import { TrophyBadge } from "./TrophyBadge";
import { RegionBadge } from "./RegionBadge";
import { REGION_TINT, TEAM_FILTER_LABEL, TEAM_SORT_LABEL, visibleTeams, type TeamFilter, type TeamSort } from "./teamCollectionsModel";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("trophies");

export const trophyHref = (teamId: string) => `/coleccion/trofeos/${encodeURIComponent(teamId)}`;

// El «✓» va fuera del texto: «✓ Completada» no es una clave de ningún idioma y `td` la dejaba en español.
const STATE_CHIP: Record<TeamTileView["state"], { text: string; cls: string }> = {
  COMPLETED: { text: "Completada", cls: "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/40" },
  IN_PROGRESS: { text: "En progreso", cls: "bg-white/[0.06] text-white/75 ring-1 ring-white/15" },
  LOCKED: { text: "Sin empezar", cls: "bg-white/[0.04] text-white/55 ring-1 ring-white/10" },
};

const TEAM_TINT = "#19e3ff";

/** Texto de lo que falta, para la tarjeta y el lector de pantalla. */
export function remainingCards(s: Pick<TeamTileView, "state" | "missing">): string {
  return s.state === "COMPLETED" ? tr("Completada") : tr("{n, plural, one {{n} carta restante} other {{n} cartas restantes}}", { n: s.missing });
}

/** El escudo de un equipo: su logo real o, si el producto no lo tiene, su etiqueta. */
export function TeamShield({ team, size, locked }: { team: Pick<TeamTileView, "id" | "title" | "tag" | "logo" | "region">; size: "md" | "lg"; locked: boolean }) {
  // Sin logo en el producto: la etiqueta del equipo con el acento de SU región. Mismo escudo, misma jerarquía.
  const color = team.logo || !team.region ? TEAM_TINT : REGION_TINT[team.region];
  return <TrophyBadge badge={{ id: team.id, label: team.title, logo: team.logo, color, kind: "TEAM", caption: "" }} size={size} locked={locked} monogram={team.logo ? undefined : team.tag} />;
}

/** En móvil, una línea por dato (rótulo a la izquierda, valor a la derecha); desde `sm`, la ficha de siempre. */
function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="nx-clip flex min-w-0 items-center justify-between gap-3 bg-white/[0.035] px-4 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] sm:block sm:py-3" data-testid={testId}>
      <p className="min-w-0 text-[11px] font-bold uppercase tracking-[0.2em] text-white/55">{label}</p>
      <p className="nx-readout shrink-0 font-display text-[22px] font-black leading-none text-white sm:mt-1 sm:text-[26px]">
        {value}{sub && <span className="ml-2 font-sans text-[12px] font-normal text-white/55 sm:hidden">{sub}</span>}
      </p>
      {sub && <p className="mt-1 hidden text-[12px] text-white/55 sm:block">{sub}</p>}
    </div>
  );
}

export function TeamTile({ s }: { s: TeamTileView }) {
  useLocale();
  const done = s.state === "COMPLETED";
  return (
    <Link href={trophyHref(s.id)} data-testid="set-tile" data-set={s.id} data-state={s.state}
      aria-label={tr("{title}: {owned} de {required}. {s}", { title: s.title, owned: s.owned, required: s.total, s: remainingCards(s) })}
      className={cn("nx-focus nx-clip group relative flex min-w-0 items-center gap-4 p-4 text-left transition",
        "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] hover:bg-white/[0.06] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
        done && "shadow-[inset_0_0_0_1px_rgba(52,211,153,0.45)]")}>
      <TeamShield team={s} size="md" locked={!done} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-display text-[17px] font-bold uppercase tracking-wide text-white">{s.title}</h3>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", STATE_CHIP[s.state].cls)}>{s.state === "COMPLETED" && "✓ "}{tdIn("trophies", STATE_CHIP[s.state].text)}</span>
        </div>
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/45">
          {tr("Equipo")}
          {s.region && <><span aria-hidden>·</span><span style={{ color: REGION_TINT[s.region] }}>{td(s.region)}</span></>}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Meter value={s.pct} tone={done ? "ok" : "info"} height={6} label={tr("Progreso de {title}", { title: s.title })} className="flex-1" />
          <span className="nx-readout shrink-0 text-[13px] font-bold text-white" data-testid="set-progress">{s.owned}/{s.total}</span>
        </div>
        <p className="mt-1 text-[12px] text-white/60">{remainingCards(s)}</p>
      </div>
    </Link>
  );
}

export function TrophyRoomScreen({ room }: { room: TeamCollectionsView }) {
  useLocale();
  const [filter, setFilter] = useState<TeamFilter>("ALL");
  const [sort, setSort] = useState<TeamSort>("closest");
  const [query, setQuery] = useState("");
  const [clicks, setClicks] = useState(0); // pulsaciones de «Ver más equipos»
  const list = useMemo(() => visibleTeams(room.teams, { filter, query, sort }), [room.teams, filter, query, sort]);
  // Cambiar qué se busca o cómo se ordena vuelve a empezar por los tres primeros.
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setClicks(0); };
  const visible = list.slice(0, visibleTeamCount(list.length, clicks));
  const t = room.totals;
  const pct = t.cards ? Math.floor((t.owned / t.cards) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8" data-testid="trophy-room">
      <nav className="mb-3 text-[13px]"><Link href="/coleccion" className="nx-focus text-white/60 hover:text-white">{tr("← Colección")}</Link></nav>
      <header className="relative mb-6 overflow-hidden">
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.35em] text-[#ffce4f]">{tr("Valorosters")}</p>
        <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-wide text-white md:text-[48px]">{tr("Colecciones")}</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-white/70">{tr("Completa la colección de un equipo consiguiendo todas sus cartas: cada edición cuenta por separado y las repetidas no sustituyen a las que faltan. La primera vez que completas un equipo ganas {xp} XP de temporada. Completa todos los equipos de una región para desbloquear su insignia.", { xp: TEAM_COLLECTION_XP })}</p>
      </header>

      <section aria-label={tr("Resumen de tu colección")} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Stat testId="stat-teams" label={tr("Equipos completados")} value={`${t.teamsCompleted}/${t.teams}`} />
        <Stat testId="stat-collection" label={tr("Cartas de equipo")} value={`${t.owned}/${t.cards}`} sub={`${pct} %`} />
        <Stat testId="stat-badges" label={tr("Insignias regionales")} value={`${t.badgesUnlocked}/${room.regions.length}`} />
      </section>

      <section aria-labelledby="sets-title" className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="sets-title" className="font-display text-[22px] font-black uppercase tracking-wide text-white">{tr("Equipos")}</h2>
          <label className="flex min-w-0 items-center gap-2 text-[12px] text-white/60">
            {tr("Ordenar")}
            <select value={sort} onChange={(e) => reset(setSort)(e.target.value as TeamSort)} data-testid="trophy-sort"
              className="nx-focus rounded-md bg-white/[0.06] px-2 py-1.5 text-[13px] text-white ring-1 ring-white/15">
              {(Object.keys(TEAM_SORT_LABEL) as TeamSort[]).map((k) => <option key={k} value={k} className="bg-[#0b0d14]">{td(TEAM_SORT_LABEL[k])}</option>)}
            </select>
          </label>
        </div>
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
          <input type="search" value={query} onChange={(e) => reset(setQuery)(e.target.value)} placeholder={tr("Buscar equipo o jugador…")} aria-label={tr("Buscar equipo o jugador")}
            data-testid="trophy-search" className="nx-focus min-w-0 flex-1 rounded-md bg-white/[0.05] px-3 py-2 text-[14px] text-white ring-1 ring-white/15 placeholder:text-white/40" />
          <div className="max-w-full overflow-x-auto"><Segmented label={tr("Estado")} value={filter} onChange={reset(setFilter)} options={(Object.keys(TEAM_FILTER_LABEL) as TeamFilter[]).map((k) => ({ value: k, label: TEAM_FILTER_LABEL[k] }))} /></div>
        </div>
        {list.length === 0 ? (
          <p className="nx-clip bg-white/[0.03] px-4 py-6 text-center text-[14px] text-white/60" data-testid="trophy-empty">
            {room.teams.length === 0 ? tr("Todavía no hay equipos con cartas en el catálogo.") : tr("Ningún equipo coincide con el filtro.")}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="set-grid" data-shown={visible.length} data-total={list.length}>
              {visible.map((s) => <TeamTile key={s.id} s={s} />)}
            </div>
            {visible.length < list.length && (
              <div className="mt-4 flex flex-col items-center gap-1.5">
                <button type="button" onClick={() => setClicks((n) => n + 1)} data-testid="more-teams"
                  className="nx-focus nx-clip-sm min-h-[44px] border border-white/15 px-6 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white/80 transition duration-fast hover:bg-white/[0.07]">
                  {tr("Ver más equipos")}
                </button>
                <span className="nx-label" data-testid="teams-count">{tr("{n} de {total}", { n: visible.length, total: list.length })}</span>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="regions-title" className="mt-10">
        <h2 id="regions-title" className="mb-1 font-display text-[22px] font-black uppercase tracking-wide text-white">{tr("Insignias regionales")}</h2>
        <p className="mb-4 max-w-2xl text-[13px] text-white/60">
          {tr("Consigue todas las cartas de todos los equipos de una región para desbloquear su insignia. Una vez desbloqueada es tuya para siempre.")}
          {room.regions.some((b) => b.permanent) && <> {fill(tr("Destácalas en tu perfil desde {enlace}.", slots("enlace")), { enlace: <Link href="/jugador/me?editar=insignias" data-testid="feature-badges-link" className="nx-focus text-[#19e3ff] underline-offset-2 hover:underline">{tr("editar perfil")}</Link> })}</>}
        </p>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="region-badges">
          {room.regions.map((b) => <RegionBadge key={b.region} badge={b} />)}
        </ul>
      </section>
    </div>
  );
}
