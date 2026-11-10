"use client";

/**
 * POST-PARTIDO TELEVISIVO — scoreboard comparado, jugador/coach del partido, mejor
 * execute/retake, mayor clutch, highlights y la cabina de comentaristas con el resumen
 * narrativo. Consume `PostMatch` + `CasterLine[]` (datos puros). Solo muestra.
 */
import type { PostMatch, CasterLine } from "@/broadcast";
import { LiveStatsPanel } from "./LiveStatsPanel";
import { CasterFeed } from "./CasterFeed";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("broadcast");

function Award({ label, value, sub }: { label: string; value: string; sub?: string }) {
  useLocale();
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 p-3">
      <p className="text-[9px] uppercase tracking-widest text-white/40">{td(label)}</p>
      <p className="font-display text-sm font-bold text-white">{td(value)}</p>
      {sub && <p className="text-[10px] text-white/45">{td(sub)}</p>}
    </div>
  );
}

export function PostMatchShow({ post, casters }: { post: PostMatch; casters: CasterLine[] }) {
  useLocale();
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
        <p className="font-display text-[11px] uppercase tracking-[0.3em] text-drl">{tr("Resumen televisivo ·")} {td(post.shape)}</p>
        <h3 className="mt-0.5 font-display text-2xl font-bold uppercase text-white">{td(post.headline)}</h3>
        <ul className="mt-2 space-y-0.5">
          {post.beats.slice(0, 4).map((b, i) => <li key={i} className="flex gap-1.5 text-[12px] text-white/65"><span className="text-drl">›</span>{td(b)}</li>)}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {post.playerOfMatch && <Award label={tr("Jugador del partido")} value={post.playerOfMatch.name} sub={td(post.playerOfMatch.reason)} />}
        <Award label={tr("Coach del partido")} value={tr("Nota {grade}", { grade: td(post.coachOfMatch.grade) })} sub={td(post.coachOfMatch.label)} />
        {post.bestExecute && <Award label={tr("Mejor execute")} value={tr("Ronda {round}", { round: post.bestExecute.round })} sub={td(post.bestExecute.detail)} />}
        {post.bestRetake && <Award label={tr("Mejor retake")} value={tr("Ronda {round}", { round: post.bestRetake.round })} sub={td(post.bestRetake.detail)} />}
        {post.biggestClutch && <Award label={tr("Mayor clutch")} value={post.biggestClutch.name ?? tr("Ronda {round}", { round: post.biggestClutch.round })} sub={td(post.biggestClutch.detail)} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <LiveStatsPanel stats={post.scoreboard} />
        <div className="space-y-3">
          <CasterFeed lines={casters} max={6} />
          <div className="rounded-2xl border border-white/10 bg-base-800/60 p-3">
            <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.3em] text-drl">{tr("Highlights · replay")}</p>
            <ul className="space-y-1">
              {post.highlights.slice(0, 6).map((h) => (
                <li key={h.id} className="flex items-center gap-2 text-[11px]">
                  <span className="rounded bg-drl/15 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-wide text-drl">{h.kind.replace(/_/g, " ")}</span>
                  <span className="text-white/75">{td(h.label)}</span>
                  {h.name && <span className="text-white/45">· {h.name}</span>}
                  {h.round > 0 && <span className="ml-auto text-[9px] text-white/30">R{h.round}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Timeline del partido */}
      {post.timeline.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-base-800/60 p-3">
          <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.3em] text-drl">{tr("Timeline")}</p>
          <ol className="space-y-0.5">
            {post.timeline.slice(0, 8).map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px]">
                <span className="w-8 text-right font-display tabular-nums text-white/35">R{t.round}</span>
                <span className="text-white/70">{td(t.text)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
