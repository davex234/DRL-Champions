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
import { Plate, Piece, Recessed } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { formatCredits, plural, cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("pickems");

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
  useLocale();
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
      aria-label={tr("Resultado de tus predicciones")}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-3 backdrop-blur-sm sm:p-4"
      onClick={close}
    >
      {/*
        Alto acotado al viewport y cuerpo con su propio desplazamiento: en un móvil
        apaisado, o con muchas preguntas corregidas, la cabecera y los botones tienen
        que seguir siendo alcanzables sin que el diálogo se salga de la pantalla.
      */}
      <div
        className="nx-clip animate-rise flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden border border-ok/30 bg-base-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">
              {tr("Resultado de tus predicciones")}
            </p>
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
              {td(data.eventName)}
            </h2>
          </div>
          {/*
            FASE 9 · El cierre era el glifo «✕» dentro de un `rounded-lg` de 26 px de alto:
            geometría prestada y por debajo del objetivo táctil. Ahora es la pieza de icono
            del sistema, con su chaflán y sus 44 px, y la marca está DIBUJADA.
          */}
          <NxButton variant="icon" size="md" aria-label={tr("Cerrar")} onClick={close} className="shrink-0">
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3l8 8" /><path d="M11 3l-8 8" />
            </svg>
          </NxButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <PickemResultBody data={data} />
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <NxButton variant="secondary" size="md" href="/recompensas" onClick={close}>
            {tr("Ver recompensas")}
          </NxButton>
          <NxButton variant="secondary" size="md" href="/ranking" onClick={close}>
            {tr("Ver clasificación")}
          </NxButton>
          <NxButton variant="primary" size="md" onClick={close}>
            {tr("Entendido")}
          </NxButton>
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
  useLocale();
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
      <Piece tone="success" className="flex flex-wrap items-end gap-x-8 gap-y-3 px-5 py-4">
        <Readout size="lg" label={tr("Puntos conseguidos")} value={`+${earned}`} tone="var(--nx-gold)" />
        <Readout size="sm" label={tr("Aciertos")} value={`${hits.length} / ${mine.length}`} tone="var(--nx-ok)" />
        <Readout
          size="sm"
          label={tr("Acierto")}
          value={mine.length > 0 ? `${Math.round((hits.length / mine.length) * 100)}%` : "—"}
        />
      </Piece>

      {/* ── Qué predije y qué salió ── */}
      <div>
        <SectionTitle as="h3">{tr("Tus predicciones corregidas")}</SectionTitle>
        {resolved.length === 0 ? (
          <p className="text-sm text-white/45">{tr("Todavía no se ha corregido ninguna pregunta.")}</p>
        ) : (
          <div className="space-y-2">
            {resolved.map((q) => {
              const answer = data.answers[q.id] ?? null;
              const hit = !!answer && answer === q.correct_option;
              return (
                <Plate
                  key={q.id}
                  tone={hit ? "success" : answer ? "primary" : "neutral"}
                  className="px-4 py-3"
                >
                  <p className="font-display text-xs uppercase tracking-wide text-white/70">
                    {td(q.prompt)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span className="text-white/45">
                      {tr("Predijiste:")}{" "}
                      <span className={cn("font-display", answer ? "text-white" : "text-white/35")}>
                        {answer ? label(q, answer) : tr("no participaste")}
                      </span>
                    </span>
                    <span className="text-white/45">
                      {tr("Resultado:")}{" "}
                      <span className="font-display text-white">{label(q, q.correct_option)}</span>
                    </span>
                    <span
                      className={cn(
                        "ml-auto font-display text-sm",
                        hit ? "text-emerald-300" : answer ? "text-drl" : "text-white/35",
                      )}
                    >
                      {hit ? tr("Acertaste · +{points}", { points: plural(q.points, "punto", "puntos") }) : answer ? tr("Fallaste · 0 puntos") : tr("No participaste · 0 puntos")}
                    </span>
                  </div>
                </Plate>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Recompensa concedida ── */}
      <div>
        <SectionTitle as="h3">{tr("Recompensa obtenida")}</SectionTitle>
        {paid && paidTier ? (
          <Piece tone="gold" className="p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-lg font-bold uppercase tracking-wide text-drl-gold">
                {td(paidTier.label)}
              </p>
              <span className="text-[10px] uppercase tracking-widest text-white/40">
                {tr("escalón alcanzado con {n, plural, one {# punto} other {# puntos}}", { n: earned })}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Prize label={tr("Créditos")} value={tr("{v} créditos", { v: formatCredits(data.reward?.delta ?? paidTier.reward.credits ?? 0) })} />
              <Prize label={tr("XP")} value={tr("{v} XP", { v: paidTier.reward.xp ?? 0 })} />
              <Prize
                label={tr("Sobres")}
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
                  {tr("Tu carta está dentro del sobre: ábrelo para verla y añadirla a la colección.")}
                </span>
                <Link href="/inventario" className="text-drl hover:underline">
                  {tr("Abrir mi sobre →")}
                </Link>
              </p>
            ) : (
              <p className="mt-3 text-xs text-white/45">
                {tr("Este escalón no incluye sobre, así que todavía no hay carta.")}{" "}
                {nextTier ? (
                  tr("Con {n} puntos llegarías a {escalon}, que sí lleva sobre.", { n: nextTier.minPoints, escalon: td(nextTier.label) })
                ) : null}
              </p>
            )}
            <p className="nx-label mt-2">
              {tr("Saldo tras la recompensa: {n} créditos", { n: formatCredits(data.reward?.balance_after ?? 0) })}
            </p>
          </Piece>
        ) : tier ? (
          <Recessed depth="sm" className="px-4 py-3 text-body text-ink-muted">
            {fill(tr("Has alcanzado el escalón {escalon}. La recompensa se abona al corregirse el torneo.", slots("escalon")), { escalon: <span className="text-white">{td(tier.label)}</span> })}
          </Recessed>
        ) : (
          <Recessed depth="sm" className="px-4 py-3 text-body text-ink-muted">
            {tr("Todavía no has alcanzado ningún escalón de recompensa.")}
            {nextTier ? tr(" Te faltan {v} puntos para {label}.", { v: nextTier.minPoints - earned, label: td(nextTier.label) }) : ""}
          </Recessed>
        )}
      </div>

      {/* ── Rango ── */}
      <div>
        <SectionTitle as="h3">{tr("Tu rango")}</SectionTitle>
        <Plate
          className="p-4"
          style={{ borderColor: `${after.tier.color}55`, background: `${after.tier.color}0d` }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-display text-sm uppercase tracking-wide" style={{ color: before.color }}>
              {td(before.label)}
            </span>
            <span className="text-white/35" aria-hidden>→</span>
            <span
              className="font-display text-lg font-bold uppercase tracking-wide"
              style={{ color: after.tier.color }}
            >
              {td(after.tier.label)}
            </span>
            {promoted && <Badge tone="ok" dot>{tr("¡Has subido de rango!")}</Badge>}
            <span className="ml-auto font-display text-sm tabular-nums text-white/70">
              {after.points} {tr("pts")}
            </span>
          </div>

          <Recessed
            depth="sm"
            className="mt-3 h-2 overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(after.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={after.next ? tr("Progreso hacia {label}", { label: td(after.next.label) }) : tr("Rango máximo alcanzado")}
          >
            <span
              className="block h-full transition-[width] duration-normal motion-reduce:transition-none"
              style={{ width: `${Math.round(after.progress * 100)}%`, background: after.tier.color }}
            />
          </Recessed>

          <p className="mt-1.5 text-[11px] uppercase tracking-widest text-white/40">
            {after.next ? (
              fill(tr("{hecho} / {total} · faltan {n} para {rango}", { hecho: after.points - after.tier.min, total: after.next.min - after.tier.min, n: after.toNext, ...slots("rango") }), {
                rango: <span style={{ color: after.next.color }}>{td(after.next.label)}</span>,
              })
            ) : (
              tr("Rango máximo alcanzado")
            )}
          </p>
        </Plate>
      </div>
    </div>
  );
}

function Prize({ label, value }: { label: string; value: string }) {
  useLocale();
  return (
    <Recessed depth="sm" className="px-3 py-2">
      <p className="nx-label">{td(label)}</p>
      <p className="mt-0.5 font-display text-[14px] font-bold text-white">{td(value)}</p>
    </Recessed>
  );
}
