"use client";

/**
 * F86.2 · /admin/alpha — CLOSED ALPHA. Dos cosas, solo lectura:
 *   · FEEDBACK: lo que han escrito las personas que prueban (nombre + #TAG, fecha, respuestas). Sin correos.
 *   · EMBUDO: de las cuentas creadas desde una fecha, cuántas tienen cada paso del recorrido EN LOS DATOS (sobres,
 *     equipo, partida rápida, ranked, social, torneo, feedback). Son hechos medidos, no opiniones.
 */
import { useState } from "react";
import { useAdminQuery, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, Pill, Loading, ErrorBox, Empty, Button } from "@/components/admin/cc/ui";
import { FEEDBACK_QUESTIONS, FEEDBACK_COMMENT_LABEL, FEEDBACK_ERROR_DETAIL_LABEL, FEEDBACK_RETURN_LABEL, FUNNEL_STEPS } from "@/domain/feedback/alpha";

interface FeedbackRow {
  id: string; createdAt: string; source: string; username: string; tag: string | null;
  hardToUnderstand: string | null; lostMoment: string | null; likedMost: string | null; likedLeast: string | null;
  hadError: boolean | null; errorDetail: string | null; wouldReturn: number | null; comment: string | null; appVersion: string | null;
}
interface FunnelPlayer { username: string; tag: string | null; createdAt: string; lastSignInAt: string | null; [k: string]: unknown }
interface Funnel { since: string; includeTest: boolean; accounts: number; steps: Record<string, number>; players: FunnelPlayer[] }

const PLAYER_KEYS: [string, string][] = [
  ["packOpened", "Sobre"], ["deckSaved", "Equipo"], ["quickStarted", "Rápida"], ["quickCompleted", "Rápida ✓"], ["rankedTouched", "Ranked"],
  ["socialUsed", "Social"], ["friendAdded", "Amigo"], ["cupRegistered", "Torneo"], ["cupPlayed", "Cruce"], ["cupFinal", "Final"], ["feedbackSent", "Feedback"],
];

/** `<input type="datetime-local">` ⇄ ISO (hora local del navegador del admin). */
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export default function AlphaPage() {
  const [tab, setTab] = useState<"feedback" | "funnel">("feedback");
  const [since, setSince] = useState<string>(() => toLocalInput(new Date(Date.now() - 14 * 86_400_000).toISOString()));
  const [includeTest, setIncludeTest] = useState(false);
  const sinceIso = (() => { const t = Date.parse(since); return Number.isFinite(t) ? new Date(t).toISOString() : ""; })();
  const fb = useAdminQuery<{ items: FeedbackRow[]; count: number; limit: number; hiddenTest: number }>(tab === "feedback" ? `/api/admin/alpha?view=feedback${includeTest ? "&test=1" : ""}` : null);
  const fn = useAdminQuery<Funnel>(tab === "funnel" && sinceIso ? `/api/admin/alpha?view=funnel&since=${encodeURIComponent(sinceIso)}${includeTest ? "&test=1" : ""}` : null);

  return (
    <div className="space-y-5" data-testid="admin-alpha">
      <PageHeader eyebrow="Jugadores" title="Closed Alpha"
        description="Feedback de las personas que prueban y el embudo medido sobre datos reales. Solo lectura; nunca se muestran correos." />
      <div className="flex gap-2" role="group" aria-label="Vista">
        <Button variant={tab === "feedback" ? "primary" : "ghost"} onClick={() => setTab("feedback")} data-testid="alpha-tab-feedback">Feedback</Button>
        <Button variant={tab === "funnel" ? "primary" : "ghost"} onClick={() => setTab("funnel")} data-testid="alpha-tab-funnel">Embudo</Button>
      </div>

      {tab === "feedback" && (
        <Panel title="Feedback recibido" subtitle={fb.data ? `${fb.data.count} envío(s)${fb.data.hiddenTest ? ` · ${fb.data.hiddenTest} de cuentas de prueba ocultos` : ""}` : undefined}
          actions={<Button size="sm" variant="ghost" onClick={fb.reload}>Actualizar</Button>}>
          <label className="mb-3 flex items-center gap-2 text-[13px] text-ink-muted"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} data-testid="alpha-include-test" /> Incluir cuentas de prueba</label>
          {fb.error && <ErrorBox error={fb.error} onRetry={fb.reload} />}
          {!fb.data && !fb.error && <Loading rows={3} />}
          {fb.data && fb.data.items.length === 0 && <Empty title="Todavía no hay feedback">Aparecerá aquí en cuanto alguien envíe el formulario de /feedback.</Empty>}
          {fb.data && fb.data.items.length > 0 && (
            <ol className="space-y-4" data-testid="alpha-feedback-list">
              {fb.data.items.map((r) => (
                <li key={r.id} className="rounded border border-white/10 bg-white/[0.02] p-4" data-testid="alpha-feedback-item">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <b className="text-ink-primary">{r.username}</b>
                    {r.tag && <code className="text-[12px] tracking-[0.08em] text-ink-faint">#{r.tag}</code>}
                    <span className="text-ink-faint">· {dateTime(r.createdAt)}</span>
                    <Pill>{r.source}</Pill>
                    {r.wouldReturn !== null && <Pill tone={r.wouldReturn >= 7 ? "ok" : r.wouldReturn >= 4 ? "warn" : "bad"}>Volvería: {r.wouldReturn}/10</Pill>}
                    {r.hadError === true && <Pill tone="bad">Encontró un error</Pill>}
                  </div>
                  <dl className="mt-3 grid gap-3 text-[13px] md:grid-cols-2">
                    {FEEDBACK_QUESTIONS.map((q) => r[q.field] ? (
                      <div key={q.field}><dt className="text-ink-faint">{q.label}</dt><dd className="mt-0.5 whitespace-pre-wrap text-ink-primary">{r[q.field]}</dd></div>
                    ) : null)}
                    {r.errorDetail && <div><dt className="text-ink-faint">{FEEDBACK_ERROR_DETAIL_LABEL}</dt><dd className="mt-0.5 whitespace-pre-wrap text-ink-primary">{r.errorDetail}</dd></div>}
                    {r.comment && <div><dt className="text-ink-faint">{FEEDBACK_COMMENT_LABEL}</dt><dd className="mt-0.5 whitespace-pre-wrap text-ink-primary">{r.comment}</dd></div>}
                    {r.wouldReturn !== null && <div><dt className="text-ink-faint">{FEEDBACK_RETURN_LABEL}</dt><dd className="mt-0.5 text-ink-primary">{r.wouldReturn}</dd></div>}
                  </dl>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      {tab === "funnel" && (
        <Panel title="Embudo de la alpha" subtitle="Cuentas creadas desde la fecha elegida. Sin administradores; sin cuentas de prueba salvo que lo marques."
          actions={<Button size="sm" variant="ghost" onClick={fn.reload}>Actualizar</Button>}>
          <div className="mb-4 flex flex-wrap items-end gap-4 text-[13px]">
            <label className="flex flex-col gap-1"><span className="text-ink-faint">Desde</span>
              <input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} className="rounded border border-white/15 bg-black/30 px-2 py-1.5 text-ink-primary" data-testid="alpha-since" />
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Incluir cuentas de prueba</label>
          </div>
          {fn.error && <ErrorBox error={fn.error} onRetry={fn.reload} />}
          {!fn.data && !fn.error && <Loading rows={4} />}
          {fn.data && (
            <>
              <p className="mb-3 text-[13px] text-ink-muted" data-testid="alpha-accounts">Cuentas en la cohorte: <b className="text-ink-primary">{fn.data.accounts}</b></p>
              <table className="w-full text-[13px]" data-testid="alpha-funnel">
                <tbody>
                  {FUNNEL_STEPS.map((s) => {
                    const n = fn.data!.steps[s.key] ?? 0;
                    const pct = fn.data!.accounts ? Math.round((n / fn.data!.accounts) * 100) : 0;
                    return (
                      <tr key={s.key} className="border-t border-white/[0.06]" data-step={s.key}>
                        <td className="py-1.5 pr-3 text-ink-muted">{s.label}</td>
                        <td className="w-20 py-1.5 text-right font-mono text-ink-primary">{n}</td>
                        <td className="w-48 py-1.5 pl-3"><span className="block h-2 rounded bg-white/[0.06]"><span className="block h-2 rounded bg-drl-cyan" style={{ width: `${pct}%` }} /></span></td>
                        <td className="w-12 py-1.5 text-right text-ink-faint">{pct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {fn.data.players.length === 0 ? <Empty title="Ninguna cuenta en la cohorte">Cuando las personas se registren después de la fecha elegida, aparecerán aquí.</Empty> : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-[12px]" data-testid="alpha-players">
                    <thead><tr className="text-left text-ink-faint"><th className="py-1 pr-2">Jugador</th><th className="pr-2">Alta</th><th className="pr-2">Última entrada</th>{PLAYER_KEYS.map(([, l]) => <th key={l} className="px-1 text-center">{l}</th>)}</tr></thead>
                    <tbody>
                      {fn.data.players.map((p, i) => (
                        <tr key={`${p.tag ?? p.username}-${i}`} className="border-t border-white/[0.06]">
                          <td className="py-1 pr-2 text-ink-primary">{p.username} {p.tag && <code className="text-ink-faint">#{p.tag}</code>}</td>
                          <td className="pr-2 text-ink-muted">{dateTime(p.createdAt)}</td>
                          <td className="pr-2 text-ink-muted">{p.lastSignInAt ? dateTime(p.lastSignInAt) : "—"}</td>
                          {PLAYER_KEYS.map(([k, l]) => <td key={l} className="px-1 text-center">{p[k] ? "✓" : <span className="text-ink-faint">·</span>}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
