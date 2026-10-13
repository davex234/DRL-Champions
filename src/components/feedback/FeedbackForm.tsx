"use client";

/**
 * F86.2 · FORMULARIO DE FEEDBACK de la Closed Alpha (presentación + envío).
 *
 * Una sola pantalla, sin modal y sin interrumpir partidas: se llega desde «Dar feedback» (menú) o desde la invitación
 * al terminar un torneo. Todas las preguntas son opcionales, pero hace falta responder al menos una. El borrador se
 * guarda en ESTE navegador para ESTA cuenta (un F5 no lo pierde; otra cuenta no lo ve) y se borra al enviarlo.
 * Enviar es idempotente: la clave de envío se fija al abrir el formulario, así que un doble clic o un reintento sin red
 * nunca crean dos respuestas. Nada de correo, adjuntos ni capturas: solo texto.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";
import {
  FEEDBACK_QUESTIONS, FEEDBACK_ERROR_LABEL, FEEDBACK_ERROR_DETAIL_LABEL, FEEDBACK_RETURN_LABEL, FEEDBACK_COMMENT_LABEL,
  FEEDBACK_TEXT_MAX, isEmptyFeedback, type FeedbackSource,
} from "@/domain/feedback/alpha";
import { sendFeedback, newSubmissionId, FeedbackError } from "@/lib/feedback/client";

interface Draft {
  hardToUnderstand: string; lostMoment: string; likedMost: string; likedLeast: string;
  hadError: boolean | null; errorDetail: string; wouldReturn: number | null; comment: string;
}
const EMPTY: Draft = { hardToUnderstand: "", lostMoment: "", likedMost: "", likedLeast: "", hadError: null, errorDetail: "", wouldReturn: null, comment: "" };

const draftKey = (userId: string) => `nexus:alpha-feedback:${userId}`;
function readDraft(userId: string): { draft: Draft; id: string | null } {
  try {
    const raw = window.localStorage.getItem(draftKey(userId));
    if (!raw) return { draft: EMPTY, id: null };
    const j = JSON.parse(raw) as { draft?: Partial<Draft>; id?: string };
    return { draft: { ...EMPTY, ...(j.draft ?? {}) }, id: typeof j.id === "string" ? j.id : null };
  } catch { return { draft: EMPTY, id: null }; }
}
function writeDraft(userId: string, draft: Draft, id: string) {
  try { window.localStorage.setItem(draftKey(userId), JSON.stringify({ draft, id })); } catch { /* sin almacenamiento: no pasa nada */ }
}
function clearDraft(userId: string) {
  try { window.localStorage.removeItem(draftKey(userId)); } catch { /* idem */ }
}

export function FeedbackForm({ userId, source }: { userId: string; source: FeedbackSource }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [id, setId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const loaded = useRef(false);

  // Borrador de ESTA cuenta (y su clave de envío, para que un reintento tras F5 siga siendo el mismo envío).
  useEffect(() => {
    const d = readDraft(userId);
    setDraft(d.draft);
    setId(d.id ?? newSubmissionId());
    loaded.current = true;
  }, [userId]);
  useEffect(() => { if (loaded.current && id && !sent) writeDraft(userId, draft, id); }, [draft, id, userId, sent]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const empty = isEmptyFeedback({
    hardToUnderstand: draft.hardToUnderstand.trim() || null, lostMoment: draft.lostMoment.trim() || null, likedMost: draft.likedMost.trim() || null,
    likedLeast: draft.likedLeast.trim() || null, errorDetail: draft.errorDetail.trim() || null, comment: draft.comment.trim() || null,
    hadError: draft.hadError, wouldReturn: draft.wouldReturn,
  });

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || inFlight.current || !id) return;
    if (empty) { setError("Responde al menos una pregunta antes de enviar."); return; }
    inFlight.current = true;
    setBusy(true); setError(null);
    try {
      await sendFeedback({
        id, source,
        hardToUnderstand: draft.hardToUnderstand, lostMoment: draft.lostMoment, likedMost: draft.likedMost, likedLeast: draft.likedLeast,
        hadError: draft.hadError, errorDetail: draft.hadError ? draft.errorDetail : "", wouldReturn: draft.wouldReturn, comment: draft.comment,
      });
      clearDraft(userId);
      setSent(true);
    } catch (err) {
      setError(err instanceof FeedbackError ? err.message : "No se pudo enviar. Vuelve a intentarlo.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  function another() {
    clearDraft(userId);
    setDraft(EMPTY); setId(newSubmissionId()); setSent(false); setError(null);
  }

  if (sent) {
    return (
      <section className="nx-clip-sm mx-auto max-w-2xl border border-drl-cyan/30 bg-drl-cyan/[0.06] p-6 text-center" role="status" data-testid="feedback-sent">
        <p className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-drl-cyan">Recibido</p>
        <h2 className="mt-2 font-display text-[26px] font-extrabold uppercase text-white">¡Gracias!</h2>
        <p className="mt-2 text-[14px] text-white/70">Lo leeremos con calma. Precisamente buscamos dónde falla la experiencia.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <NxButton variant="primary" href="/">Volver al inicio</NxButton>
          <NxButton variant="secondary" onClick={another} data-testid="feedback-another">Enviar otra respuesta</NxButton>
        </div>
      </section>
    );
  }

  const area = (k: "hardToUnderstand" | "lostMoment" | "likedMost" | "likedLeast" | "errorDetail" | "comment", label: string, hint = "") => (
    <label key={k} className="block">
      <span className="block font-display text-[14px] font-bold text-white">{label}</span>
      {hint && <span className="mt-0.5 block text-[12px] text-white/45">{hint}</span>}
      <textarea className="nx-field mt-1.5 min-h-[88px] resize-y" maxLength={FEEDBACK_TEXT_MAX} value={draft[k]} onChange={(e) => set(k, e.target.value)} data-testid={`feedback-${k}`} />
    </label>
  );

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5" data-testid="feedback-form" aria-describedby="feedback-intro">
      <p id="feedback-intro" className="text-[14px] text-white/65">Todas las preguntas son opcionales. Sé sincero: nos ayuda mucho más saber qué falla que qué funciona. Solo lo lee el equipo de Valorosters.</p>
      {FEEDBACK_QUESTIONS.map((q) => area(q.field, q.label, q.hint))}

      <fieldset>
        <legend className="font-display text-[14px] font-bold text-white">{FEEDBACK_ERROR_LABEL}</legend>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label={FEEDBACK_ERROR_LABEL}>
          {([[true, "Sí"], [false, "No"]] as const).map(([v, l]) => (
            <button key={l} type="button" role="radio" aria-checked={draft.hadError === v} onClick={() => set("hadError", draft.hadError === v ? null : v)}
              data-testid={`feedback-error-${v ? "yes" : "no"}`}
              className={cn("nx-clip-sm nx-press min-h-[44px] min-w-[72px] px-4 font-display text-[13px] font-bold uppercase", draft.hadError === v ? "bg-drl text-white" : "bg-white/[0.06] text-white/70 hover:text-white")}>{l}</button>
          ))}
        </div>
        {draft.hadError && <div className="mt-3">{area("errorDetail", FEEDBACK_ERROR_DETAIL_LABEL)}</div>}
      </fieldset>

      <fieldset>
        <legend className="font-display text-[14px] font-bold text-white">{FEEDBACK_RETURN_LABEL}</legend>
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={FEEDBACK_RETURN_LABEL}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={draft.wouldReturn === n} onClick={() => set("wouldReturn", draft.wouldReturn === n ? null : n)}
              data-testid={`feedback-return-${n}`}
              className={cn("nx-clip-sm nx-press h-11 w-11 font-display text-[15px] font-bold", draft.wouldReturn === n ? "bg-drl-cyan text-black" : "bg-white/[0.06] text-white/75 hover:text-white")}>{n}</button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-white/40">1 = no volvería · 10 = volvería seguro</p>
      </fieldset>

      {area("comment", FEEDBACK_COMMENT_LABEL)}

      {error && <p role="alert" className="text-[14px] text-drl-glow" data-testid="feedback-error">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <NxButton type="submit" variant="primary" size="lg" disabled={busy || !id} aria-busy={busy} data-testid="feedback-submit">{busy ? "Enviando…" : "Enviar"}</NxButton>
        <Link href="/" className="nx-focus text-[13px] text-white/55 underline-offset-4 hover:text-white hover:underline">Ahora no</Link>
      </div>
    </form>
  );
}
