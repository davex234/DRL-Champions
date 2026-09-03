"use client";

/**
 * RESULTADO DE UN PICK'EM — el momento en que se ve lo que has ganado.
 *
 * Reúne en una sola pantalla lo que hasta ahora estaba repartido entre tres:
 * qué predije, qué salió, cuánto sumé, qué recompensa me pagaron y cómo me ha
 * movido el rango. Sin ese momento, el usuario acababa el recorrido de la demo
 * sin llegar a ver el premio.
 *
 * FUENTE ÚNICA. No se guarda nada nuevo ni se recalcula nada por cuenta propia:
 *   · lo que predije .............. `pickem_answers` (vía `fetchMyAnswers`)
 *   · lo que salió ................ `pickem_questions_public.correct_option`
 *   · los puntos .................. `pickem_scores` (los escribe el corrector)
 *   · la recompensa ............... el asiento real de `credit_transactions`
 *   · el rango .................... `profiles.points`, función pura `rankProgress`
 *
 * El RANGO ANTERIOR se deriva restando a los puntos totales los de este torneo, en
 * vez de guardarse en ninguna parte: así no aparece una segunda copia del rango que
 * pudiera contradecir a la del servidor.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { rankProgress, rankFromPoints } from "@/domain/progression/rank";
import { describeLedger, packLabel } from "@/domain/pickems/ledger";
import { tierForPoints, REWARD_TIERS } from "@/domain/pickems/rewards";
import type { PickemQuestion, MyScore, LedgerRow } from "@/lib/game/client";
import { formatCredits, plural, cn } from "@/lib/format";

export interface PickemResultData {
  eventName: string;
  questions: PickemQuestion[];
  answers: Record<string, string>;
  score: MyScore | null;
  /** Asiento de la recompensa concedida por este Pick'em, si ya se pagó. */
  reward: LedgerRow | null;
  /** Puntos TOTALES del perfil (los de todos los torneos). */
  totalPoints: number;
}

/**
 * ¿Hay ya algo que enseñar?
 *
 * No basta con que existan preguntas corregidas: hace falta que el usuario haya
 * PARTICIPADO en alguna de ellas. Sin ese filtro, a quien acaba de registrarse le
 * saltaría un resumen de un torneo que no ha jugado, con cero en todo.
 */
export function hasResult(d: PickemResultData): boolean {
  return d.questions.some((q) => q.locked && q.correct_option && d.answers[q.id]);
}

/**
 * Clave de «ya lo he visto» para un resultado concreto.
 *
 * Incluye los puntos, así que corregir otro partido genera una clave nueva y el
 * aviso vuelve a salir. Es una comodidad de presentación por navegador: si se
 * pierde, lo único que pasa es que el resumen se muestra otra vez.
 */
const seenKey = (d: PickemResultData, pickemEventId: string) =>
  `drl.pickem-result.${pickemEventId}.${d.score?.points ?? 0}.${d.reward?.id ?? "none"}`;

function readSeen(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
function markSeen(key: string): void {
  try { window.localStorage.setItem(key, "1"); } catch { /* modo privado: se repetirá */ }
}

/* ────────────────────────────── Aviso automático ────────────────────────────── */

/**
 * Muestra el resumen en cuanto hay un resultado que el usuario no ha visto todavía.
 * No pide datos por su cuenta: los recibe ya cargados del panel que los usa.
 */
export function PickemResultModal({
  pickemEventId,
  data,
}: {
  pickemEventId: string;
  data: PickemResultData;
}) {
  const [open, setOpen] = useState(false);
  const key = seenKey(data, pickemEventId);
  const ready = hasResult(data);

  useEffect(() => {
    if (ready && !readSeen(key)) setOpen(true);
  }, [ready, key]);

  function close() {
    markSeen(key);
    setOpen(false);
  }

  // Cerrar con Escape: un modal que solo se cierra con el ratón se atasca en una demo.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  if (!open || !ready) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resultado de tus predicciones"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-3 backdrop-blur-sm sm:p-4"
      onClick={close}
    >
      {/*
        Alto acotado al viewport y cuerpo con su propio desplazamiento: en un móvil
        apaisado, o con muchas preguntas corregidas, la cabecera y los botones tienen
        que seguir siendo alcanzables sin que el diálogo se salga de la pantalla.
      */}
      <div
        className="animate-rise flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-emerald-400/30 bg-base-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">
              Resultado de tus predicciones
            </p>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
              {data.eventName}
            </h2>
          </div>
          <button
            onClick={close}
            aria-label="Cerrar"
            className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1 text-sm text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <PickemResultBody data={data} />
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <Link
            href="/recompensas"
            onClick={close}
            className="rounded-xl border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/75 transition hover:bg-white/10"
          >
            Ver recompensas
          </Link>
          <Link
            href="/ranking"
            onClick={close}
            className="rounded-xl border border-white/15 px-4 py-2 font-display text-xs uppercase tracking-wide text-white/75 transition hover:bg-white/10"
          >
            Ver clasificación
          </Link>
          <button
            onClick={close}
            className="rounded-xl bg-drl px-4 py-2 font-display text-xs font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── Cuerpo reusable ─────────────────────────────── */

/**
 * El desglose en sí. Se usa dentro del aviso y también empotrado en
 * `/recompensas`, para que las dos superficies cuenten exactamente lo mismo.
 */
export function PickemResultBody({ data }: { data: PickemResultData }) {
  const earned = data.score?.points ?? 0;
  const resolved = data.questions.filter((q) => q.locked && q.correct_option);
  const mine = resolved.filter((q) => data.answers[q.id]);
  const hits = mine.filter((q) => data.answers[q.id] === q.correct_option);

  // Rango: el de antes se obtiene quitando los puntos de ESTE torneo al total.
  const after = rankProgress(data.totalPoints);
  const before = rankFromPoints(Math.max(0, data.totalPoints - earned));
  const promoted = before.id !== after.tier.id;

  const tier = tierForPoints(earned);
  const nextTier = REWARD_TIERS.find((t) => t.minPoints > earned) ?? null;
  const paid = data.reward ? describeLedger(data.reward.reason, data.reward.ref) : null;
  // El detalle de la recompensa sale del escalón que nombra el propio asiento, no
  // de recalcularlo: si algún día cambian los escalones, el recibo antiguo sigue
  // contando lo que de verdad se pagó.
  const paidTier = paid?.tier ?? null;

  const label = (q: PickemQuestion, key: string | null) =>
    q.options.find((o) => o.key === key)?.label ?? key ?? "—";

  return (
    <div className="space-y-5">
      {/* ── Titular: puntos conseguidos ── */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/5 px-5 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40">Puntos conseguidos</p>
          <p className="font-display text-3xl font-bold text-drl-gold">+{earned}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40">Aciertos</p>
          <p className="font-display text-xl">
            <span className="text-emerald-300">{hits.length}</span>
            <span className="text-white/30"> / {mine.length}</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/40">Acierto</p>
          <p className="font-display text-xl text-white">
            {mine.length > 0 ? `${Math.round((hits.length / mine.length) * 100)}%` : "—"}
          </p>
        </div>
      </div>

      {/* ── Qué predije y qué salió ── */}
      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-widest text-white/40">
          Tus predicciones corregidas
        </h3>
        {resolved.length === 0 ? (
          <p className="text-sm text-white/45">Todavía no se ha corregido ninguna pregunta.</p>
        ) : (
          <div className="space-y-2">
            {resolved.map((q) => {
              const answer = data.answers[q.id] ?? null;
              const hit = !!answer && answer === q.correct_option;
              return (
                <div
                  key={q.id}
                  className={cn(
                    "rounded-xl border px-4 py-3",
                    hit ? "border-emerald-400/30 bg-emerald-400/5"
                    : answer ? "border-drl/30 bg-drl/5"
                    : "border-white/10 bg-white/[0.02]",
                  )}
                >
                  <p className="font-display text-xs uppercase tracking-wide text-white/70">
                    {q.prompt}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span className="text-white/45">
                      Predijiste:{" "}
                      <span className={cn("font-display", answer ? "text-white" : "text-white/35")}>
                        {answer ? label(q, answer) : "no participaste"}
                      </span>
                    </span>
                    <span className="text-white/45">
                      Resultado:{" "}
                      <span className="font-display text-white">{label(q, q.correct_option)}</span>
                    </span>
                    <span
                      className={cn(
                        "ml-auto font-display text-sm",
                        hit ? "text-emerald-300" : answer ? "text-drl" : "text-white/35",
                      )}
                    >
                      {hit ? `✓ Acertaste · +${plural(q.points, "punto", "puntos")}` : answer ? "✕ Fallaste · 0 puntos" : "— · 0 puntos"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recompensa concedida ── */}
      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-widest text-white/40">
          Recompensa obtenida
        </h3>
        {paid && paidTier ? (
          <div className="rounded-2xl border border-drl-gold/25 bg-drl-gold/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-lg font-bold uppercase tracking-wide text-drl-gold">
                {paidTier.label}
              </p>
              <span className="text-[10px] uppercase tracking-widest text-white/40">
                escalón alcanzado con {plural(earned, "punto", "puntos")}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Prize label="Créditos" value={`🪙 ${formatCredits(data.reward?.delta ?? paidTier.reward.credits ?? 0)}`} />
              <Prize label="XP" value={`${paidTier.reward.xp ?? 0} XP`} />
              <Prize label="Tokens" value={`🎟️ ${paidTier.reward.tokens ?? 0}`} />
              <Prize
                label="Sobres"
                value={
                  paidTier.reward.packId
                    ? `${paidTier.reward.packCount ?? 1} × ${packLabel(paidTier.reward.packId)}`
                    : "—"
                }
              />
            </div>
            {paidTier.reward.packId ? (
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/55">
                <span>
                  Tu carta está dentro del sobre: ábrelo para verla y añadirla a la colección.
                </span>
                <Link href="/inventario" className="text-drl hover:underline">
                  Abrir mi sobre →
                </Link>
              </p>
            ) : (
              <p className="mt-3 text-xs text-white/45">
                Este escalón no incluye sobre, así que todavía no hay carta.{" "}
                {nextTier ? (
                  <>Con {nextTier.minPoints} puntos llegarías a {nextTier.label}, que sí lleva sobre.</>
                ) : null}
              </p>
            )}
            <p className="mt-2 text-[11px] text-white/30">
              Saldo tras la recompensa: 🪙 {formatCredits(data.reward?.balance_after ?? 0)}
            </p>
          </div>
        ) : tier ? (
          <p className="rounded-xl border border-white/10 bg-base-700/40 px-4 py-3 text-sm text-white/55">
            Has alcanzado el escalón <span className="text-white">{tier.label}</span>. La recompensa
            se abona al corregirse el torneo.
          </p>
        ) : (
          <p className="rounded-xl border border-white/10 bg-base-700/40 px-4 py-3 text-sm text-white/55">
            Todavía no has alcanzado ningún escalón de recompensa.
            {nextTier ? ` Te faltan ${nextTier.minPoints - earned} puntos para ${nextTier.label}.` : ""}
          </p>
        )}
      </div>

      {/* ── Rango ── */}
      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-widest text-white/40">Tu rango</h3>
        <div
          className="rounded-2xl border p-4"
          style={{ borderColor: `${after.tier.color}55`, background: `${after.tier.color}0d` }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-display text-sm uppercase tracking-wide" style={{ color: before.color }}>
              {before.label}
            </span>
            <span className="text-white/35" aria-hidden>→</span>
            <span
              className="font-display text-lg font-bold uppercase tracking-wide"
              style={{ color: after.tier.color }}
            >
              {after.tier.label}
            </span>
            {promoted && (
              <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                ¡Has subido de rango!
              </span>
            )}
            <span className="ml-auto font-display text-sm tabular-nums text-white/70">
              {after.points} pts
            </span>
          </div>

          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={Math.round(after.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={after.next ? `Progreso hacia ${after.next.label}` : "Rango máximo alcanzado"}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.round(after.progress * 100)}%`, background: after.tier.color }}
            />
          </div>

          <p className="mt-1.5 text-[11px] uppercase tracking-widest text-white/40">
            {after.next ? (
              <>
                {after.points - after.tier.min} / {after.next.min - after.tier.min} · faltan{" "}
                {after.toNext} para{" "}
                <span style={{ color: after.next.color }}>{after.next.label}</span>
              </>
            ) : (
              "Rango máximo alcanzado"
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function Prize({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-base-800/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-white/40">{label}</p>
      <p className="mt-0.5 font-display text-sm font-bold text-white">{value}</p>
    </div>
  );
}
