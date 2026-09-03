"use client";

/**
 * FIN DE CARRERA — la experiencia de CIERRE AAA (Career Fase 7/7, FINAL).
 *
 * Antes de retirarse: una llamada a la acción con la vista previa del legado. Tras retirarse:
 * el documental, el museo, el Hall of Fame, las estadísticas históricas, los récords, la rueda
 * de prensa y New Game+. SOLO pinta lo que prepara `@/endgame` (motor puro). No calcula nada.
 */
import { useMemo, useState } from "react";
import { useManagerStore } from "@/store/useManagerStore";
import { useWorldStore } from "@/store/useWorldStore";
import { previewEndgame } from "@/endgame";
import { formatCredits, cn } from "@/lib/format";

const ROLE_LABEL: Record<string, string> = { journalist: "Periodista", analyst: "Analista", fan: "Afición", ex_player: "Exjugador", coach: "Colega", legend: "Leyenda" };

export function CareerEndgame() {
  const career = useManagerStore((s) => s.career);
  const endgame = useManagerStore((s) => s.endgame);
  const world = useWorldStore((s) => s.world);
  const retire = useManagerStore((s) => s.retire);
  const newGamePlus = useManagerStore((s) => s.newGamePlus);
  const [confirm, setConfirm] = useState(false);

  const preview = useMemo(() => (!endgame && career && world ? previewEndgame(career, world) : null), [endgame, career, world]);
  const eg = endgame ?? preview;
  if (!eg || !career) return null;

  // ── Antes de retirarse: CTA ──
  if (!endgame) {
    return (
      <section className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-base-800/60 to-base-900/70 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-2xl">🎬</div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold text-white">Fin de carrera</h2>
            <p className="text-xs text-white/50">Si te retiraras ahora: {eg.stats.titles} títulos · impacto mundial {eg.impactScore} · {eg.induction.tier}</p>
          </div>
          {!confirm ? (
            <button onClick={() => setConfirm(true)} className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm font-bold text-amber-300 hover:bg-amber-400/20">Retirarme…</button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50">¿Cerrar tu carrera?</span>
              <button onClick={retire} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-base-900 hover:brightness-110">Confirmar retirada</button>
              <button onClick={() => setConfirm(false)} className="rounded-lg bg-white/8 px-3 py-2 text-sm text-white/60">Cancelar</button>
            </div>
          )}
        </div>
      </section>
    );
  }

  // ── Tras retirarse: la ceremonia de legado ──
  const doc = eg.documentary;
  return (
    <section className="space-y-5 rounded-2xl border border-amber-400/35 bg-gradient-to-br from-amber-500/10 via-base-900/70 to-base-900/80 p-5">
      <header className="text-center">
        <p className="text-[11px] uppercase tracking-[0.3em] text-amber-300/70">Fin de una era</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-white">{eg.headline}</h2>
        <p className="mt-1 text-sm text-white/55">{eg.coachName} · {eg.clubName} · T{eg.retiredSeason}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <Badge label="Impacto mundial" value={`${eg.impactScore}/100`} />
          <Badge label="Hall of Fame" value={eg.induction.tier} />
          <Badge label="Ranking histórico" value={`#${eg.induction.coachRank}`} />
        </div>
      </header>

      {/* Estadísticas históricas */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Temporadas" value={`${eg.stats.seasonsCoached}`} />
        <Stat label="Títulos" value={`${eg.stats.titles}`} />
        <Stat label="Partidos" value={`${eg.stats.matches}`} />
        <Stat label="Victorias" value={`${eg.stats.winRate}%`} />
        <Stat label="Jugadores" value={`${eg.stats.playersTrained}`} />
        <Stat label="Generado" value={formatCredits(eg.stats.moneyGenerated)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Documental */}
        <Panel title={doc.title}>
          <p className="mb-2 text-xs text-white/45">{doc.subtitle}</p>
          <ol className="space-y-2">
            {doc.chapters.map((c) => (
              <li key={c.id} className="border-l-2 border-amber-400/40 pl-3">
                <p className="text-[12px] font-bold uppercase tracking-wide text-amber-300/80">{c.title}{c.season ? ` · T${c.season}` : ""}</p>
                <p className="text-[13px] text-white/70">{c.narration}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-white/10 pt-2 text-[13px] italic text-white/55">{doc.epilogue}</p>
        </Panel>

        {/* Museo */}
        <Panel title={`Museo · ${eg.museum.clubName}`}>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <MuseumCol title="🏆 Trofeos" items={eg.museum.items.filter((i) => i.section === "trophies").slice(0, 4).map((i) => `${i.title} (T${i.season})`)} />
            <MuseumCol title="⭐ Jugadores" items={eg.museum.items.filter((i) => i.section === "players").slice(0, 4).map((i) => i.title)} />
            <MuseumCol title="👕 Camisetas retiradas" items={eg.museum.items.filter((i) => i.section === "jerseys").map((i) => i.title)} />
            <MuseumCol title="📅 Temporadas" items={eg.museum.items.filter((i) => i.section === "seasons").slice(0, 4).map((i) => i.title)} />
          </div>
        </Panel>

        {/* Récords */}
        <Panel title="Récords">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
            <RecCol title="Personales" lines={eg.records.personal} />
            <RecCol title="Del club" lines={eg.records.club} />
            <RecCol title="Mundiales" lines={eg.records.world} />
            <RecCol title="De carrera" lines={eg.records.career} />
          </div>
        </Panel>

        {/* Rueda de prensa */}
        <Panel title="Rueda de prensa final">
          <ul className="space-y-2">
            {eg.press.quotes.map((q, i) => (
              <li key={i} className="rounded-lg border border-white/8 bg-base-900/40 p-2">
                <p className="text-[13px] text-white/75">“{q.quote}”</p>
                <p className="mt-0.5 text-[11px] text-white/40">— {q.speaker} · {ROLE_LABEL[q.role]}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Hall of Fame + New Game+ */}
      <Panel title="Inducción al Hall of Fame">
        <p className="text-[13px] text-white/70">{eg.induction.citation}</p>
      </Panel>

      <section className="rounded-xl border border-drl-cyan/25 bg-drl-cyan/5 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-sm font-bold text-white">Nueva carrera+</h3>
            <p className="text-[12px] text-white/55">{eg.newGamePlus.worldMemoryNote}</p>
            <p className="mt-1 text-[11px] text-white/40">{eg.newGamePlus.legendsCarried} leyendas · {eg.newGamePlus.recordsCarried} récords permanecen · {eg.newGamePlus.reconversions.length} discípulos se reconvierten</p>
          </div>
          <button onClick={newGamePlus} className="rounded-lg bg-drl-cyan px-4 py-2 text-sm font-bold text-base-900 hover:brightness-110">Empezar nueva carrera</button>
        </div>
        {eg.newGamePlus.reconversions.length > 0 && (
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {eg.newGamePlus.reconversions.slice(0, 6).map((r) => (
              <li key={r.id} className="text-[12px] text-white/55">🎓 {r.nick} — {r.note}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  return <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200"><span className="text-amber-300/60">{label}:</span> {value}</span>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-base-900/50 p-2 text-center"><p className="font-display text-lg font-bold text-white">{value}</p><p className="text-[9px] uppercase tracking-wider text-white/40">{label}</p></div>;
}
function MuseumCol({ title, items }: { title: string; items: string[] }) {
  return <div><p className="mb-1 text-[11px] uppercase tracking-wider text-drl">{title}</p>{items.length === 0 ? <p className="text-white/30">—</p> : <ul className="space-y-0.5">{items.map((t, i) => <li key={i} className="truncate text-white/65">{t}</li>)}</ul>}</div>;
}
function RecCol({ title, lines }: { title: string; lines: { label: string; value: string; detail?: string }[] }) {
  return <div><p className="mb-1 text-[10px] uppercase tracking-wider text-drl">{title}</p><ul className="space-y-0.5">{lines.map((l, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate text-white/45">{l.label}</span><span className="shrink-0 text-white/75">{l.value}</span></li>)}</ul></div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-white/10 bg-base-800/40 p-4"><h3 className="mb-2.5 font-display text-xs uppercase tracking-wider text-white/70">{title}</h3>{children}</section>;
}
