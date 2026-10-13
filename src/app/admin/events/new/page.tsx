"use client";

/**
 * F58 · /admin/events/new — asistente en 5 pasos: Información → Fechas → Contenido/recompensas → Vista previa → Confirmar.
 * Crear deja el evento en BORRADOR: no se publica nada en este gesto.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminPost, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, Button, ErrorBox, KV, Pill, LevelBadge } from "@/components/admin/cc/ui";
import { EMPTY_EVENT, EventDateFields, EventInfoFields, toPayload, type EventFormState } from "@/components/admin/cc/EventForm";
import { EVENT_TYPE_LABEL, type AdminEventType } from "@/domain/admin/events";
import { cn } from "@/lib/format";

const STEPS = ["Información", "Fechas", "Contenido y recompensas", "Vista previa", "Confirmación"] as const;
interface Preview { draft: { name: string; type: string; region: string | null; startsAt: string; endsAt: string }; rewards: { setId: string; label: string; challenges: { id: string; label: string; description: string; goal: number; reward: { credits?: number; xp?: number; packId?: string; packCount?: number } }[] } }

export default function NewEvent() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [s, setS] = useState<EventFormState>(EMPTY_EVENT);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<EventFormState>) => { setS((x) => ({ ...x, ...p })); setPreview(null); };

  const validateOnServer = async () => {
    setBusy(true); setError(null);
    try { setPreview(await adminPost<Preview>("/api/admin/events", { action: "preview", ...toPayload(s) })); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); return false; }
    finally { setBusy(false); }
  };
  const next = async () => {
    if (step === 0 && s.name.trim().length < 3) { setError("El nombre es obligatorio (3–80 caracteres)"); return; }
    if (step === 1 && (!s.startsAt || !s.endsAt)) { setError("Indica inicio y fin"); return; }
    if (step === 1 || step === 2) { if (!(await validateOnServer())) return; }
    setError(null); setStep((x) => Math.min(STEPS.length - 1, x + 1));
  };
  const create = async () => {
    setBusy(true); setError(null);
    try { const d = await adminPost<{ id: string }>("/api/admin/events", { action: "create", ...toPayload(s) }); router.push(`/admin/events/${d.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); setBusy(false); }
  };

  return (
    <>
      <PageHeader eyebrow="Eventos" title="Nuevo evento" description="Se crea como BORRADOR. Publicarlo es una decisión aparte, desde su ficha, con confirmación." />
      <ol className="mb-6 grid grid-cols-5 gap-2" aria-label="Pasos">
        {STEPS.map((t, i) => (
          <li key={t} aria-current={i === step ? "step" : undefined} className={cn("rounded-control border px-2 py-2 text-center font-display text-[11px] font-bold uppercase tracking-wider",
            i === step ? "border-drl/60 bg-drl/15 text-ink-primary" : i < step ? "border-ok/30 text-ok" : "border-white/10 text-ink-faint")}>
            <span className="block text-[10px] opacity-70">Paso {i + 1}</span><span className="hidden sm:inline">{t}</span>
          </li>
        ))}
      </ol>
      <Panel title={STEPS[step]}>
        {step === 0 && <EventInfoFields s={s} set={set} />}
        {step === 1 && <EventDateFields s={s} set={set} />}
        {step === 2 && preview && (
          <div>
            <p className="text-[14px] text-ink-secondary">Un evento de tipo <b>{EVENT_TYPE_LABEL[s.type as AdminEventType]}</b> recibe el conjunto de desafíos <Pill tone="cyan">{preview.rewards.label}</Pill>. Las recompensas las paga el motor de siempre (<code>award()</code>): el panel no inventa un segundo sistema.</p>
            <ul className="mt-4 grid gap-2 md:grid-cols-2">
              {preview.rewards.challenges.map((c) => (
                <li key={c.id} className="rounded-card border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[14px] font-semibold text-ink-primary">{c.label}</p>
                  <p className="text-[12px] text-ink-muted">{c.description}</p>
                  <p className="mt-1 text-[12px] text-drl-gold">{[c.reward.credits ? `${c.reward.credits.toLocaleString("es-ES")} créditos` : null, c.reward.xp ? `${c.reward.xp} XP` : null, c.reward.packId ? `${c.reward.packCount ?? 1}× sobre ${c.reward.packId}` : null].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-ink-faint">Sobres de evento asociados: los sobres de evento viven en código con su propio id de evento; un evento creado aquí no tiene sobre propio.</p>
          </div>
        )}
        {step === 3 && preview && (
          <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
            <div className="relative overflow-hidden rounded-panel border border-drl-cyan/25 bg-gradient-to-br from-drl-cyan/10 via-surface-elevated to-drl/10 p-5">
              <LevelBadge level="INFO" label="Borrador" />
              <p className="mt-3 font-display text-2xl font-bold uppercase text-ink-primary">{s.name}</p>
              <p className="text-[13px] text-ink-muted">{EVENT_TYPE_LABEL[s.type as AdminEventType]}{s.region ? ` · ${s.region}` : " · Global"}</p>
              {s.description && <p className="mt-3 text-[13px] text-ink-secondary">{s.description}</p>}
            </div>
            <KV items={[["Inicio", dateTime(preview.draft.startsAt)], ["Fin", dateTime(preview.draft.endsAt)], ["Desafíos", `${preview.rewards.challenges.length} (${preview.rewards.label})`], ["Visibilidad", "Ninguna hasta publicar"]]} />
          </div>
        )}
        {step === 4 && (
          <div className="space-y-3 text-[14px] text-ink-secondary">
            <p>Se creará el borrador <b className="text-ink-primary">{s.name}</b>. No lo verá ningún jugador y no reparte nada hasta que lo publiques desde su ficha.</p>
          </div>
        )}
        {error && <div className="mt-4"><ErrorBox error={error} /></div>}
        <div className="mt-6 flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={() => (step === 0 ? router.push("/admin/events") : setStep(step - 1))} disabled={busy}>{step === 0 ? "Cancelar" : "‹ Atrás"}</Button>
          {step < 4 ? <Button onClick={next} disabled={busy}>{busy ? "Validando…" : "Siguiente ›"}</Button> : <Button onClick={create} disabled={busy}>{busy ? "Creando…" : "Crear borrador"}</Button>}
        </div>
      </Panel>
    </>
  );
}
