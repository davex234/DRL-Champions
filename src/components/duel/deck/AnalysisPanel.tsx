"use client";

/**
 * ANÁLISIS DEL EQUIPO (Fase 32). Tres bloques, todos derivados de datos que YA existen:
 *
 *   1. ESTADO     — «6 / 10 CARTAS», qué falta, qué sobra, qué choca (validador canónico en frases), y
 *                   EQUIPO LISTO cuando lo es. Sin «poder de equipo»: no existe esa fórmula.
 *   2. MEDIAS     — OVR, Stronghold, Gamesense y Entryfrag medios de las cartas presentes; OVR medio por rol.
 *   3. LECTURA    — media más alta y más baja del trío, y el rol con menor OVR media: comparación de
 *                   números, dicha como tal. No predice resultados ni recomienda estrategias.
 *
 * Y la ayuda opcional AUTOCOMPLETAR, que usa la búsqueda con retroceso del dominio.
 */
import { motion } from "framer-motion";
import { cn } from "@/lib/format";
import { DUEL_DECK_SIZE } from "@/domain/cardgame";
import {
  countLabel, READY_TEXT, type AutoResult, type DraftCheck, type Issue, type TeamReading, type TeamStats,
} from "@/domain/deckBuilder/builder";
import { STAT_INFO } from "@/lib/duel/types";
import { NxButton } from "@/components/ui/NxButton";
import { StatBar } from "./bits";

export interface AnalysisPanelProps {
  check: DraftCheck;
  issues: Issue[];
  stats: TeamStats;
  reading: TeamReading;
  /** Cartas que el autocompletado respetará. */
  keptCount: number;
  auto: AutoResult | null;
  onAutocomplete: () => void;
  /** Llevar el foco al hueco de una carta con problema. */
  onIssue?: (uid: string) => void;
  /** El borrador coincide con lo guardado. */
  saved: boolean;
  /** Fase 43 · laboratorio de equipo: sustituye a «Medias» y «Fortaleza y punto bajo» (misma información, ampliada). */
  strategy?: React.ReactNode;
  /** Fase 43 · plantilla por objetivo, debajo de Autocompletar. */
  extra?: React.ReactNode;
}

const ICON: Record<Issue["kind"], string> = { missing: "○", excess: "▲", conflict: "✕", lost: "⚠" };

export function AnalysisPanel({ check, issues, stats, reading, keptCount, auto, onAutocomplete, onIssue, saved, strategy = null, extra = null }: AnalysisPanelProps) {
  const problems = issues.filter((i) => i.kind !== "missing");
  const missing = issues.find((i) => i.kind === "missing");
  const canAuto = !check.ready;

  return (
    <div className="space-y-3" data-testid="analysis-panel">
      {/* ── 1 · Estado ── */}
      <section aria-labelledby="deck-state-title" className="nx-clip border border-white/10 bg-white/[0.03] p-4">
        <h2 id="deck-state-title" className="nx-label">Estado del equipo</h2>
        <p className="mt-1 nx-readout text-[26px] tabular-nums text-white" data-testid="live-count">{countLabel(check.count)}</p>
        <div aria-hidden className="mt-2 grid grid-cols-10 gap-1">
          {Array.from({ length: DUEL_DECK_SIZE }, (_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full", i < check.count ? (check.ready ? "bg-ok" : "bg-drl-cyan") : "bg-white/10")} />
          ))}
        </div>

        {check.ready ? (
          <motion.div
            key="ready"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 22 }}
            className="nx-clip-sm mt-3 border border-ok/50 bg-ok/[0.1] px-3 py-3 shadow-[0_0_28px_rgba(79,190,120,0.25)]"
            role="status"
            data-testid="team-ready"
          >
            <p className="font-display text-[18px] font-bold uppercase tracking-[0.14em] text-ok">✓ {READY_TEXT}</p>
            <p className="mt-0.5 text-caption text-ink-secondary">
              {saved ? "Diez cartas, dos por rol y sin repetir jugador. Puedes jugar y marcarlo como activo." : "Cumple las reglas. Guárdalo para poder jugar con él."}
            </p>
          </motion.div>
        ) : (
          <div className="mt-3 space-y-2" role="status">
            {missing && <p className="text-body font-semibold text-drl-gold">{missing.message}</p>}
            {check.count === 0 && <p className="text-caption text-ink-muted">Pulsa un hueco o una carta de tu colección para empezar.</p>}
          </div>
        )}

        {problems.length > 0 && (
          <ul className="mt-3 space-y-1.5" aria-label="Problemas del equipo">
            {problems.map((i) => (
              <li key={`${i.kind}-${i.message}`} className="flex items-start gap-2 text-[12.5px] leading-snug">
                <span aria-hidden className={cn("mt-px font-bold", i.kind === "lost" ? "text-drl-gold" : "text-bad")}>{ICON[i.kind]}</span>
                <span className="min-w-0 flex-1 text-white/85">{i.message}</span>
                {onIssue && i.uids[0] && (
                  <button type="button" onClick={() => onIssue(i.uids[0])} className="nx-action shrink-0 min-h-[32px] text-[11px]">Ver</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {strategy}

      {/* ── 2 · Medias ── */}
      {!strategy && <section aria-labelledby="deck-stats-title" className="nx-clip border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="deck-stats-title" className="nx-label">Medias del equipo</h2>
          <span className="text-[11px] text-ink-faint">{stats.count ? `${stats.count} ${stats.count === 1 ? "carta" : "cartas"}` : "sin cartas"}</span>
        </div>
        {stats.count === 0 ? (
          <p className="mt-2 text-caption text-ink-muted">Añade cartas para ver sus medias de OVR, Stronghold, Gamesense y Entryfrag.</p>
        ) : (
          <>
            <div className="mt-2 flex items-end gap-2">
              <span className="nx-readout text-[34px] leading-none tabular-nums text-white" data-testid="avg-ovr">{stats.ovr}</span>
              <span className="pb-1 text-caption uppercase tracking-wide text-ink-muted">OVR medio</span>
            </div>
            <div className="mt-3 space-y-2.5">
              <StatBar label={STAT_INFO.stronghold.label} abbr={STAT_INFO.stronghold.abbr} value={stats.stronghold} color={STAT_INFO.stronghold.color} />
              <StatBar label={STAT_INFO.gamesense.label} abbr={STAT_INFO.gamesense.abbr} value={stats.gamesense} color={STAT_INFO.gamesense.color} />
              <StatBar label={STAT_INFO.entryfrag.label} abbr={STAT_INFO.entryfrag.abbr} value={stats.entryfrag} color={STAT_INFO.entryfrag.color} />
            </div>
            {!stats.complete && <p className="mt-2 text-[11px] text-ink-faint">Medias parciales: faltan {DUEL_DECK_SIZE - stats.count} cartas.</p>}
            <table className="mt-3 w-full text-left text-[12px]">
              <caption className="sr-only">OVR medio por rol</caption>
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-ink-faint">
                  <th scope="col" className="py-1 font-semibold">Rol</th>
                  <th scope="col" className="py-1 text-right font-semibold">Cartas</th>
                  <th scope="col" className="py-1 text-right font-semibold">OVR medio</th>
                </tr>
              </thead>
              <tbody>
                {stats.byRole.map((r) => (
                  <tr key={r.role} className="border-t border-white/5">
                    <th scope="row" className="py-1 font-medium text-white/80">{r.role}</th>
                    <td className="py-1 text-right tabular-nums text-white/60">{r.count}</td>
                    <td className="py-1 text-right nx-readout tabular-nums text-white">{r.ovr ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>}

      {/* ── 3 · Lectura ── */}
      {!strategy && stats.count > 0 && (
        <section aria-labelledby="deck-read-title" className="nx-clip border border-white/10 bg-white/[0.03] p-4" data-testid="team-reading">
          <h2 id="deck-read-title" className="nx-label">Fortaleza y punto bajo</h2>
          {reading.even ? (
            <p className="mt-2 text-body text-white">Las tres medias son iguales.</p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-2">
              {reading.highest && (
                <div className="nx-clip-sm border border-ok/30 bg-ok/[0.06] px-3 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-ok">Media más alta</dt>
                  <dd className="mt-0.5 font-display text-[15px] font-bold uppercase text-white">{reading.highest.label} <span className="nx-readout">{reading.highest.value}</span></dd>
                </div>
              )}
              {reading.lowest && (
                <div className="nx-clip-sm border border-drl-gold/30 bg-drl-gold/[0.06] px-3 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-drl-gold">Media más baja</dt>
                  <dd className="mt-0.5 font-display text-[15px] font-bold uppercase text-white">{reading.lowest.label} <span className="nx-readout">{reading.lowest.value}</span></dd>
                </div>
              )}
            </dl>
          )}
          {reading.weakestRole && (
            <p className="mt-2 text-caption text-ink-secondary">
              Rol con menor OVR media: <b className="text-white">{reading.weakestRole.role}</b> ({reading.weakestRole.ovr}).
            </p>
          )}
          <p className="mt-2 text-[11px] text-ink-faint">Comparación matemática de las medias de tus cartas. No predice resultados.</p>
        </section>
      )}

      {/* ── Autocompletar ── */}
      <section aria-labelledby="deck-auto-title" className="nx-clip border border-white/10 bg-white/[0.03] p-4">
        <h2 id="deck-auto-title" className="nx-label">Autocompletar</h2>
        <p className="mt-1 text-caption text-ink-muted">
          Rellena los huecos con tus cartas de mayor OVR que cumplan las reglas: roles, jugador único y misma temporada.
          {keptCount > 0 && ` Se respetan las ${keptCount} cartas que ya tienes (salvo las marcadas como libres).`}
        </p>
        <NxButton variant="secondary" size="md" className="mt-2 w-full" onClick={onAutocomplete} disabled={!canAuto} data-testid="autocomplete">
          {canAuto ? "Autocompletar equipo" : "El equipo ya está completo"}
        </NxButton>
        {auto && (
          <div role="status" className={cn("mt-2 rounded-lg border px-3 py-2 text-[12.5px]", auto.ok ? "border-ok/40 bg-ok/[0.07] text-ok" : "border-bad/40 bg-bad/[0.07] text-white")} data-testid="autocomplete-result" data-ok={auto.ok}>
            {auto.ok ? (
              <p>
                Añadidas {auto.added.length} {auto.added.length === 1 ? "carta" : "cartas"}
                {auto.removed.length > 0 && ` · cambiadas ${auto.removed.length}`}. Revisa y guarda.
              </p>
            ) : (
              <>
                <p className="font-semibold">{auto.reason}</p>
                {auto.shortages.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11.5px] text-ink-secondary">
                    {auto.shortages.map((s) => (
                      <li key={s.role}>{s.role}: necesitas {s.need} y tienes {s.available} {s.available === 1 ? "jugador compatible" : "jugadores compatibles"}.</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </section>
      {extra}
    </div>
  );
}
