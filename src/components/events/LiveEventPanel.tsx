"use client";

/**
 * EL EVENTO EN VIVO (Fase 12).
 *
 * ────────────────────────── QUÉ RESPONDE ──────────────────────────
 *
 * Las cuatro preguntas del encargo, en este orden y en un solo bloque:
 *
 *   QUÉ EVENTO HAY  →  QUÉ PUEDO HACER  →  QUÉ PUEDO GANAR  →  CUÁNDO TERMINA
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * **1. Nada se calcula aquí.** La fase, el progreso y si un desafío se puede cobrar los
 * decide el servidor. Este componente solo pinta lo que le llega y vuelve a preguntar
 * después de cobrar. Es exactamente lo contrario de `useEventsStore`, que decidía en el
 * navegador y por eso tuvo que apagarse con sesión iniciada.
 *
 * **2. Un desafío completo se distingue de lejos.** Es lo único de este panel que exige una
 * acción del jugador; el resto es información. Si todo tuviera el mismo peso visual, el
 * botón que hay que pulsar se perdería entre las barras de progreso.
 *
 * **3. Los bloqueados NO desaparecen.** Un desafío de predicciones en un evento sin Pick'em
 * se queda a cero y se ve. Esconderlo dejaría al jugador preguntándose por qué su lista es
 * más corta que la de otro.
 *
 * **4. Si no hay evento, no hay panel.** Un recuadro que dice «no hay ningún evento» ocupa
 * el mejor sitio del vestíbulo para no decir nada. Es la misma regla que la tira del ciclo.
 */
import { useState } from "react";
import Link from "next/link";
import type { EventView } from "@/lib/game/events";
import { claimChallenge } from "@/lib/game/events";
import { formatCredits, cn } from "@/lib/format";

/** Tono por fase. Tabla, no `switch`: una fase nueva sale con el tono neutro, no rota. */
const PHASE: Record<string, { tint: string; urgent: boolean }> = {
  upcoming: { tint: "150,160,180", urgent: false },
  live: { tint: "25,227,255", urgent: false },
  ending: { tint: "255,46,99", urgent: true },
  completed: { tint: "255,211,92", urgent: false },
  archived: { tint: "110,118,132", urgent: false },
};

/** Cuenta atrás legible. Sin segundos: un panel que parpadea cada segundo distrae. */
function humanize(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} ${d === 1 ? "día" : "días"}`;
  if (h >= 1) return `${h} h`;
  return `${min} min`;
}

/** Resumen de una recompensa en una línea. Solo lo que trae: nada de ceros de relleno. */
function rewardLine(r: EventView["totalReward"]): string {
  const parts: string[] = [];
  if (r.credits) parts.push(`🪙 ${formatCredits(r.credits)}`);
  if (r.xp) parts.push(`${r.xp} XP`);
  if (r.packId && r.packCount) parts.push(`${r.packCount} ${r.packCount === 1 ? "sobre" : "sobres"}`);
  return parts.join(" · ");
}

export function LiveEventPanel({
  view, onChanged, notify,
}: {
  view: EventView;
  onChanged: () => void;
  notify?: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const p = PHASE[view.event.phase] ?? PHASE.live;
  const countdown = humanize(view.event.msUntilNextPhase);

  /*
   * Qué está contando el reloj cambia con la fase, y decirlo importa: «3 días» sin más
   * puede querer decir tres cosas distintas, y dos de ellas son urgentes.
   */
  const countdownLabel =
    view.event.phase === "upcoming" ? "Empieza en"
    : view.event.phase === "completed" ? "Puedes reclamar durante"
    : "Termina en";

  async function claim(challengeId: string) {
    setBusy(challengeId);
    try {
      const r = await claimChallenge(view.event.id, challengeId);
      notify?.(r.applied
        ? `Recompensa reclamada · 🪙 ${formatCredits(r.credits)}`
        : "Esa recompensa ya estaba reclamada");
      onChanged();
    } catch (e) {
      notify?.(e instanceof Error ? e.message : "No se pudo reclamar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Evento en vivo" className="nx-stage nx-clip relative overflow-hidden p-5 sm:p-6">
      <span
        aria-hidden
        className="nx-bloom -right-16 -top-20 h-64 w-64"
        style={{ background: `rgb(${p.tint})`, opacity: p.urgent ? 0.4 : 0.22 }}
      />

      {/* ── QUÉ EVENTO HAY, Y CUÁNDO TERMINA ── */}
      <header className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="nx-clip-sm px-2 py-1 font-display text-[9px] font-bold uppercase tracking-[0.16em]"
              style={{ background: `rgb(${p.tint} / 0.16)`, color: `rgb(${p.tint})` }}
            >
              {view.event.phaseLabel}
            </span>
            {view.event.isDemo && (
              <span className="font-display text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                · datos de demostración
              </span>
            )}
          </div>
          <h2 className="mt-2 font-display text-[22px] font-black uppercase leading-none tracking-[0.02em] text-white sm:text-[26px]">
            {view.event.name}
          </h2>
          <p className="mt-1.5 text-[12.5px] text-white/55">
            {view.setLabel} · {view.claimedCount} de {view.challenges.length} desafíos reclamados
          </p>
        </div>

        {countdown && (
          <div className="nx-plate nx-clip-sm shrink-0 px-3.5 py-2 text-right">
            <div className="nx-label text-[9px]">{countdownLabel}</div>
            <div className="nx-readout mt-0.5 text-[19px]" style={{ color: `rgb(${p.tint})` }}>
              {countdown}
            </div>
          </div>
        )}
      </header>

      {/* ── QUÉ PUEDO GANAR ── */}
      <div className="relative mt-4 flex flex-wrap items-center gap-2 border-y border-white/10 py-2.5">
        <span className="nx-label text-[9px]">Se reparte en total</span>
        <span className="nx-readout text-[13px] text-white/80">{rewardLine(view.totalReward)}</span>
      </div>

      {/* ── QUÉ PUEDO HACER ── */}
      <ul className="relative mt-4 grid gap-2 sm:grid-cols-2">
        {view.challenges.map((c) => {
          const pctDone = Math.min(100, Math.round((c.progress / Math.max(1, c.goal)) * 100));
          return (
            <li
              key={c.id}
              className={cn(
                "nx-clip-sm relative border p-3.5 transition duration-fast",
                c.claimable ? "border-white/25" : "border-white/10",
              )}
              style={c.claimable ? { background: `rgb(${p.tint} / 0.10)` } : undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={cn(
                    "font-display text-[13px] font-bold uppercase tracking-[0.05em]",
                    c.claimed ? "text-white/40" : "text-white",
                  )}>
                    {c.label}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-snug text-white/50">{c.description}</p>
                </div>

                {c.claimed ? (
                  <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-white/35">
                    Reclamado
                  </span>
                ) : c.claimable ? (
                  <button
                    type="button"
                    onClick={() => void claim(c.id)}
                    disabled={busy !== null}
                    className="nx-clip-sm shrink-0 px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-black transition duration-fast disabled:opacity-50"
                    style={{ background: `rgb(${p.tint})` }}
                  >
                    {busy === c.id ? "…" : "Reclamar"}
                  </button>
                ) : (
                  <span className="nx-readout shrink-0 text-[12px] text-white/45">
                    {c.progress}/{c.goal}
                  </span>
                )}
              </div>

              {/* La barra solo aparece si hay algo que enseñar y todavía no está cobrado. */}
              {!c.claimed && !c.claimable && (
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-[width] duration-slow"
                    style={{ width: `${pctDone}%`, background: `rgb(${p.tint} / 0.8)` }}
                  />
                </div>
              )}

              <div className="mt-2 text-[11px] text-white/40">{rewardLine(c.reward)}</div>
            </li>
          );
        })}
      </ul>

      {/* ── LA ACTIVIDAD PRINCIPAL ── */}
      {view.pickem && (
        <Link
          href={`/torneos/${view.event.id}`}
          className="nx-clip-sm relative mt-4 flex items-center justify-between gap-3 border border-white/12 px-4 py-3 transition duration-fast hover:border-white/25"
        >
          <span className="text-[12.5px] text-white/70">
            {view.pickem.openQuestions > 0
              ? `${view.pickem.openQuestions} ${view.pickem.openQuestions === 1 ? "predicción abierta" : "predicciones abiertas"} · has enviado ${view.pickem.answered}`
              : `Predicciones cerradas · enviaste ${view.pickem.answered}`}
          </span>
          <span aria-hidden className="text-[15px]" style={{ color: `rgb(${p.tint})` }}>◈</span>
        </Link>
      )}
    </section>
  );
}
