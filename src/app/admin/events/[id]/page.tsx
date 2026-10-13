"use client";

/**
 * F58 · /admin/events/[id] — ficha del evento (borrador del panel o evento canónico).
 * Borrador: editar (con control de versión), cancelar (motivo) o PUBLICAR (confirmación fuerte).
 * Canónico: estado por fechas, desafíos y analítica REAL (reclamos en `user_achievements`); sin edición.
 */
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminQuery, adminPost, dateTime, fmt } from "@/components/admin/cc/api";
import { PageHeader, Panel, KV, Pill, Loading, ErrorBox, Button, ConfirmDialog, Field, Textarea, Stat, Empty } from "@/components/admin/cc/ui";
import { ActivityList, type AuditItem } from "@/components/admin/cc/Activity";
import { EventDateFields, EventInfoFields, isoToLocal, toPayload, type EventFormState } from "@/components/admin/cc/EventForm";
import { AssetUploader } from "@/components/admin/cms/cms";
import { DiffTable } from "@/components/admin/cc/DiffTable";

type State = "DRAFT" | "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";
interface Draft { id: string; name: string; description: string | null; image_url: string | null; type: string; region: string | null; starts_at: string; ends_at: string; status: string; event_id: string | null; updated_at: string; created_at: string; published_at: string | null }
interface Detail {
  draft: Draft | null;
  canonical: { id: string; name: string; type: string | null; region: string | null; status: string | null; start_date: string | null; end_date: string | null; source: string } | null;
  state: State;
  rewards: { label: string; challenges: { id: string; label: string; description: string; goal: number; reward: { credits?: number; xp?: number; packId?: string; packCount?: number } }[] };
  analytics: { claims: number; claimants: number; byChallenge: Record<string, number> } | null;
  activity: AuditItem[];
}
const LABEL: Record<State, string> = { DRAFT: "Borrador", SCHEDULED: "Programado", ACTIVE: "Activo", ENDED: "Terminado", CANCELLED: "Cancelado" };

export default function EventPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const q = useAdminQuery<Detail>(`/api/admin/events?id=${encodeURIComponent(id)}`);
  const [edit, setEdit] = useState<EventFormState | null>(null);
  const [dialog, setDialog] = useState<null | "publish" | "cancel" | "save">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const d = q.data;
  const draft = d?.draft;
  const run = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true); setErr(null);
    try { await adminPost("/api/admin/events", body); setDialog(null); setEdit(null); setFlash(ok); q.reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Error"); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader eyebrow="Evento" title={draft?.name ?? d?.canonical?.name ?? "Evento"}
        description={d && <span className="flex flex-wrap items-center gap-2"><Pill tone={d.state === "DRAFT" ? "gold" : d.state === "ACTIVE" ? "ok" : d.state === "SCHEDULED" ? "cyan" : "default"}>{LABEL[d.state]}</Pill>{d.canonical && <code className="text-[12px] text-ink-faint">{d.canonical.id}</code>}{d.canonical?.source === "vlr" && <Pill>VLR (sincronización)</Pill>}</span>}
        actions={<Link href="/admin/events" className="nx-focus text-[13px] text-ink-muted hover:text-ink-primary">← Eventos</Link>} />
      {flash && <div role="status" className="mb-4 rounded-card border border-ok/35 bg-ok/[0.07] px-4 py-2.5 text-[13px]">✔ {flash}</div>}
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={6} />}
      {d && (
        <div className="space-y-6">
          {draft && d.state === "DRAFT" && (
            <Panel title="Borrador" tone="gold" subtitle="No visible para los jugadores"
              actions={!edit && <div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => setEdit({ name: draft.name, description: draft.description ?? "", imageUrl: draft.image_url ?? "", type: draft.type, region: draft.region ?? "", startsAt: isoToLocal(draft.starts_at), endsAt: isoToLocal(draft.ends_at) })}>Editar</Button><Button size="sm" variant="ghost" onClick={() => { setReason(""); setErr(null); setDialog("cancel"); }}>Cancelar borrador</Button><Button size="sm" variant="primary" onClick={() => { setErr(null); setDialog("publish"); }}>Publicar…</Button></div>}>
              {edit ? (
                <div className="space-y-5">
                  <EventInfoFields s={edit} set={(p) => setEdit({ ...edit, ...p })} />
                  <EventDateFields s={edit} set={(p) => setEdit({ ...edit, ...p })} />
                  {err && !dialog && <ErrorBox error={err} />}
                  <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)} disabled={busy}>Descartar</Button><Button onClick={() => { setErr(null); setDialog("save"); }} disabled={busy}>Guardar cambios</Button></div>
                </div>
              ) : (
                <KV cols={3} items={[["Tipo", draft.type], ["Región", draft.region ?? "Global"], ["Imagen", draft.image_url ?? "—"], ["Inicio", dateTime(draft.starts_at)], ["Fin", dateTime(draft.ends_at)], ["Última edición", dateTime(draft.updated_at)], ["Descripción", draft.description ?? "—"]]} />
              )}
              {/* F60 · imagen del evento como asset de Storage: al publicar llega a `public.events.logo` junto a la descripción. */}
              {!edit && (
                <div className="mt-4 max-w-md">
                  <AssetUploader kind="event_art" subjectId={draft.id.replace(/-/g, "")} label="Imagen del evento (llega al juego al publicar)"
                    onUploaded={(a) => void run({ action: "setImage", id: draft.id, imageAssetId: a.id, expectedUpdatedAt: draft.updated_at }, "Imagen asignada al borrador.")} />
                </div>
              )}
            </Panel>
          )}
          {d.canonical && (
            <Panel title="Evento en el juego" subtitle={draft ? `Publicado ${dateTime(draft.published_at)}` : "Evento canónico (public.events)"}>
              <KV cols={3} items={[["Estado almacenado", d.canonical.status], ["Tipo", d.canonical.type], ["Región", d.canonical.region ?? "Global"], ["Inicio", dateTime(d.canonical.start_date)], ["Fin", dateTime(d.canonical.end_date)], ["Origen", d.canonical.source]]} />
              <p className="mt-3 text-[12px] text-ink-faint">Un evento publicado no se edita ni se despublica desde el panel: los jugadores ya han podido verlo y reclamar. Su estado avanza solo por fechas.</p>
            </Panel>
          )}
          {d.analytics && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Reclamos" value={fmt(d.analytics.claims)} accent="gold" />
              <Stat label="Jugadores que reclamaron" value={fmt(d.analytics.claimants)} accent="cyan" />
            </div>
          )}
          <Panel title="Desafíos y recompensas" subtitle={`Conjunto «${d.rewards.label}» (asignado por tipo/región)`}>
            <ul className="grid gap-2 md:grid-cols-2">
              {d.rewards.challenges.map((c) => (
                <li key={c.id} className="rounded-card border border-white/[0.07] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2"><p className="text-[14px] font-semibold text-ink-primary">{c.label}</p>{d.analytics && <Pill tone="cyan">{fmt(d.analytics.byChallenge[c.id] ?? 0)} reclamos</Pill>}</div>
                  <p className="text-[12px] text-ink-muted">{c.description}</p>
                  <p className="mt-1 text-[12px] text-drl-gold">{[c.reward.credits ? `${fmt(c.reward.credits)} créditos` : null, c.reward.xp ? `${c.reward.xp} XP` : null, c.reward.packId ? `${c.reward.packCount ?? 1}× ${c.reward.packId}` : null].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
            {!d.analytics && <p className="mt-3 text-[12px] text-ink-faint">Sin analítica: el evento aún no existe en el juego.</p>}
          </Panel>
          <Panel title="Historial administrativo">{draft ? <ActivityList items={d.activity} empty="Sin actividad" /> : <Empty title="Evento de la sincronización">Los eventos VLR los escribe el worker, no el panel.</Empty>}</Panel>
        </div>
      )}
      {draft && dialog === "publish" && (
        <ConfirmDialog open risk="HIGH" title={`Publicar «${draft.name}»`} confirmLabel="Publicar en el juego" busy={busy} error={err} typeToConfirm={draft.name} onClose={() => setDialog(null)}
          onConfirm={() => run({ action: "publish", id: draft.id, expectedUpdatedAt: draft.updated_at }, "Evento publicado.")}>
          <p>Se creará el evento en el juego (<code>public.events</code>, origen «admin»). Los jugadores lo verán en Torneos y podrán reclamar sus desafíos durante la ventana:</p>
          <p className="text-ink-primary">{dateTime(draft.starts_at)} → {dateTime(draft.ends_at)}</p>
          <p className="text-[12px] text-warn">▲ Una vez publicado no se despublica desde el panel.</p>
        </ConfirmDialog>
      )}
      {draft && dialog === "cancel" && (
        <ConfirmDialog open risk="MEDIUM" title="Cancelar borrador" confirmLabel="Cancelar borrador" busy={busy} error={err} canConfirm={reason.trim().length >= 8} onClose={() => setDialog(null)}
          onConfirm={() => run({ action: "cancel", id: draft.id, reason }, "Borrador cancelado.")}>
          <p>El borrador queda como «cancelado» (no se borra: sigue en el historial).</p>
          <Field label="Motivo" htmlFor="ev-cancel" hint="Mínimo 8 caracteres"><Textarea id="ev-cancel" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
        </ConfirmDialog>
      )}
      {draft && edit && dialog === "save" && (
        <ConfirmDialog open risk="MEDIUM" title="Guardar cambios del borrador" confirmLabel="Guardar" busy={busy} error={err} onClose={() => setDialog(null)}
          onConfirm={() => run({ action: "update", id: draft.id, expectedUpdatedAt: draft.updated_at, ...toPayload(edit) }, "Borrador guardado.")}>
          <DiffTable rows={[
            ["Nombre", draft.name, edit.name], ["Tipo", draft.type, edit.type], ["Región", draft.region ?? "Global", edit.region || "Global"],
            ["Inicio", dateTime(draft.starts_at), dateTime(toPayload(edit).startsAt)], ["Fin", dateTime(draft.ends_at), dateTime(toPayload(edit).endsAt)],
            ["Descripción", draft.description ?? "—", edit.description || "—"], ["Imagen", draft.image_url ?? "—", edit.imageUrl || "—"],
          ]} />
        </ConfirmDialog>
      )}
    </>
  );
}
