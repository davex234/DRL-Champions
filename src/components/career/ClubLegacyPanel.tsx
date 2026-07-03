"use client";

/**
 * LEGACY & ECOSISTEMA MUNDIAL — el panel de "dirigir una organización mundial" (Fase 6/7).
 *
 * SOLO pinta lo que prepara `legacyDashboard` (motor puro `@/legacy`): legado del club, Hall of
 * Fame, rivalidades, economía mundial, competiciones, medios, redes, marca y directivas. Todo
 * DERIVADO del `WorldState` que evoluciona cada temporada. La UI no calcula nada.
 */
import { useMemo } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { useWorldStore } from "@/store/useWorldStore";
import { legacyDashboard } from "@/legacy";
import { formatCredits, cn } from "@/lib/format";

const PHASE_COLOR: Record<string, string> = { boom: "text-emerald-400", stable: "text-drl-cyan", cooling: "text-amber-400", crisis: "text-rose-400" };
const OUTLET_ICON: Record<string, string> = { newspaper: "📰", analyst: "📊", podcast: "🎙️", influencer: "🔥", international: "🌍" };

export function ClubLegacyPanel() {
  const career = useManagerStore((s) => s.career)!;
  const world = useWorldStore((s) => s.world);
  const dash = useMemo(() => (career.clubId && world ? legacyDashboard(world, career.clubId) : null), [career.clubId, world]);
  if (!dash) return null;
  const lg = dash.clubLegacy;

  return (
    <section className="space-y-5 rounded-2xl border border-amber-400/25 bg-gradient-to-br from-base-800/60 to-base-900/70 p-5">
      <header className="flex flex-wrap items-center gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-2xl">🏆</div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-white">Legado & Ecosistema · {lg.name}</h2>
          <p className="text-xs text-white/50">{dash.brand.tier} · {dash.brand.identity} · {dash.brand.style}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <Kpi label="Valor mundial" value={formatCredits(dash.worldValue)} big />
          <Kpi label="Ranking" value={`#${dash.worldRankPos}/${dash.worldRankTotal}`} />
          <Kpi label="Trofeos" value={`${lg.trophies}`} />
          <Kpi label="Temporadas" value={`${lg.seasonsPlayed}`} />
        </div>
      </header>

      {/* Economía mundial */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-base-900/40 p-3 text-sm">
        <span className="text-[11px] uppercase tracking-wider text-white/40">Economía mundial:</span>
        <span className={cn("font-bold uppercase", PHASE_COLOR[dash.economy.phase])}>{dash.economy.phase}</span>
        <span className="text-white/55">{dash.economy.note}</span>
        <span className="ml-auto text-white/45">Inflación ×{dash.economy.inflation.toFixed(2)} · Mercado {dash.economy.marketTemperature}°</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Legado del club */}
        <Panel title="Historia del club">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Fact label="Fundado" value={`T${lg.foundedSeason}`} />
            <Fact label="Mejor temporada" value={lg.bestSeason ? `T${lg.bestSeason} (${lg.bestFinish}º)` : "—"} />
            <Fact label="Peor temporada" value={lg.worstSeason ? `T${lg.worstSeason}` : "—"} />
            <Fact label="Mayor racha" value={`${lg.longestTitleStreak} títulos`} />
            <Fact label="Mayor fichaje" value={lg.records.biggestTransfer ? `${lg.records.biggestTransfer.nick} (${formatCredits(lg.records.biggestTransfer.fee)})` : "—"} />
            <Fact label="Cantera" value={`${lg.records.academyGraduates} graduados`} />
          </div>
          {lg.dynasties.length > 0 && (
            <p className="mt-2 text-[12px] text-amber-300/80">👑 Dinastías: {lg.dynasties.map((d) => `${d.titles} (T${d.from}–${d.to})`).join(" · ")}</p>
          )}
          {lg.legends.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-drl">Leyendas del club</p>
              <ul className="space-y-1">
                {lg.legends.slice(0, 5).map((l) => (
                  <li key={l.id} className="flex items-center gap-2 text-[13px] text-white/70"><span>{l.kind === "coach" ? "🧑‍🏫" : "⭐"}</span>{l.name} <span className="text-white/40">· {l.note}</span></li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        {/* Hall of Fame */}
        <Panel title="Hall of Fame mundial">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            <HofCol title="Jugadores" items={dash.hallOfFame.players.slice(0, 4).map((e) => `${e.name} · ${e.detail}`)} />
            <HofCol title="Entrenadores" items={dash.hallOfFame.coaches.slice(0, 4).map((e) => `${e.name} · ${e.detail}`)} />
            <HofCol title="Dinastías" items={dash.hallOfFame.dynasties.slice(0, 3).map((e) => `${e.name} · ${e.detail}`)} />
            <HofCol title="Transferencias" items={dash.hallOfFame.transfers.slice(0, 3).map((e) => `${e.name} · ${e.detail}`)} />
          </div>
        </Panel>

        {/* Competiciones */}
        <Panel title="Circuito mundial (esta temporada)">
          <ul className="space-y-1.5">
            {dash.competitions.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-white/8 bg-base-900/40 p-2 text-sm">
                <span className="text-lg">{c.tier === "worlds" ? "🌍" : c.tier === "masters" ? "🏅" : "🎯"}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-white/80">{c.name}</p><p className="text-[11px] text-white/40">Campeón: {c.championName}</p></div>
                <span className="text-[11px] text-drl-cyan">{formatCredits(c.prizePool)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Rivalidades */}
        <Panel title="Rivalidades">
          {dash.rivalries.length === 0 ? <p className="text-sm text-white/40">Aún sin rivalidades marcadas.</p> : (
            <ul className="space-y-1.5">
              {dash.rivalries.map((r) => (
                <li key={r.b} className="rounded-lg border border-white/8 bg-base-900/40 p-2 text-sm">
                  <div className="flex items-center gap-2"><span className="font-semibold text-white">vs {r.bName}</span><span className="ml-auto text-rose-400">{r.intensity}°</span></div>
                  <p className="text-[11px] text-white/45">{r.note} · +{r.effects.motivation.toFixed(1)} motivación · +{r.effects.prestige.toFixed(1)} prestigio</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Directivas + marca */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Directiva — objetivos de temporada">
          <ul className="space-y-1.5">
            {dash.directives.map((d, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-white/70"><span className="grid h-5 w-5 place-items-center rounded-full bg-drl/15 text-[11px] text-drl">{i + 1}</span>{d.text}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Marca del club">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Fact label="Identidad" value={dash.brand.identity} />
            <Fact label="Estilo" value={dash.brand.style} />
            <Fact label="Popularidad" value={`${dash.brand.popularity}`} />
            <Fact label="Reconocimiento" value={`${dash.brand.recognition}`} />
            <Fact label="Valor comercial" value={formatCredits(dash.brand.commercialValue)} />
            <Fact label="Nivel" value={dash.brand.tier} />
          </div>
        </Panel>
      </div>

      {/* Medios + redes */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Medios">
          <ul className="space-y-1.5">
            {dash.media.slice(0, 5).map((m) => (
              <li key={m.id} className="flex items-start gap-2 text-[13px] text-white/60"><span>{OUTLET_ICON[m.outlet]}</span><span><span className="text-white/80">{m.headline}</span> — {m.body}</span></li>
            ))}
            {dash.media.length === 0 && <li className="text-sm text-white/40">Sin titulares aún.</li>}
          </ul>
        </Panel>
        <Panel title="Tendencia en redes">
          <ul className="space-y-1.5">
            {dash.social.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-[13px]"><span className={cn(t.sentiment >= 50 ? "text-emerald-400" : "text-rose-400")}>{t.sentiment >= 50 ? "▲" : "▼"}</span><span className="text-white/65">{t.note}</span><span className="ml-auto text-white/35">{t.reach}°</span></li>
            ))}
            {dash.social.length === 0 && <li className="text-sm text-white/40">Sin tendencias aún.</li>}
          </ul>
        </Panel>
      </div>
    </section>
  );
}

function HofCol({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-drl">{title}</p>
      {items.length === 0 ? <p className="text-white/30">—</p> : <ul className="space-y-0.5">{items.map((t, i) => <li key={i} className="truncate text-white/65">{t}</li>)}</ul>}
    </div>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/5 bg-base-900/40 p-2"><p className="truncate text-white/80">{value}</p><p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p></div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-white/10 bg-base-800/40 p-4"><h3 className="mb-2.5 font-display text-xs uppercase tracking-wider text-white/70">{title}</h3>{children}</section>;
}
function Kpi({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return <div className="rounded-lg border border-white/10 bg-base-900/50 px-3 py-1.5"><p className={cn("font-display font-bold text-white", big ? "text-base" : "text-sm")}>{value}</p><p className="text-[9px] uppercase tracking-wider text-white/40">{label}</p></div>;
}
