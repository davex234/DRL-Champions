"use client";

/**
 * F60 · EDITOR DE AGENTE — alta y edición (/admin/agents/new, /admin/agents/[id]).
 *
 * Borrador primero: guardar nunca publica. La vista previa usa los componentes del JUEGO (`AgentPortrait`,
 * `AgentFullBody`, `AgentFaceSvg` dentro de una ficha de mapa, `AgentLineup` de presentación): lo que se ve es lo que
 * verá el jugador. Concurrencia: cada guardado lleva la versión que se abrió; si otro admin la cambió, el servidor
 * responde «Este contenido ha cambiado» y no se pisa nada.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, ErrorBox, Field, Input, Select, Textarea, Panel, KV } from "@/components/admin/cc/ui";
import { adminPost } from "@/components/admin/cc/api";
import { ActivityList, type AuditItem } from "@/components/admin/cc/Activity";
import { AgentFaceSvg, AgentFullBody, AgentPortrait, type AgentArtPreview } from "@/components/agents/AgentArt";
import { AGENT_CLASS_COLOR, AGENT_CLASS_LABEL } from "@/components/tactics/AgentEmblem";
import { AGENT_ROLES, ABILITY_SLOTS, defaultAgentCode, suggestAgentId, validateAgentDraft, agentPublishChecklist, type AgentRecord } from "@/domain/cms/agents";
import { AssetUploader, Checklist, DependencyList, DirtyBar, LifecycleBadge, Section, useUnsavedGuard, type UploadedAsset } from "./cms";
import type { AgentArtAsset } from "@/domain/tactics/agentArt";

interface ArtInfo { id: string; runtimeUrl: string | null; smallUrl: string | null; url: string | null; width: number | null; height: number | null; alpha: boolean | null; checksum: string | null }
export interface AgentDetailData {
  agent: AgentRecord & { createdAt: string; updatedAt: string; publishedAt: string | null; retiredAt: string | null };
  face: ArtInfo | null; full: ArtInfo | null; references: Record<string, number>; checklist: { key: string; label: string; ok: boolean }[];
  inSnapshot: boolean; history: AuditItem[];
}

type Form = { id: string; name: string; role: string; code: string; abilities: { slot: string; name: string }[] };
const emptyForm = (): Form => ({ id: "", name: "", role: "initiator", code: "", abilities: ABILITY_SLOTS.map((slot) => ({ slot, name: "" })) });
const fromDetail = (d: AgentDetailData): Form => ({
  id: d.agent.id, name: d.agent.name, role: d.agent.role, code: d.agent.code ?? "",
  abilities: ABILITY_SLOTS.map((slot, i) => ({ slot, name: d.agent.abilities[i]?.name ?? "" })),
});

const toArt = (a: ArtInfo | UploadedAsset | null | undefined, kind: "face" | "full"): AgentArtAsset | null => {
  if (!a || !(a.runtimeUrl ?? a.url) || !a.width || !a.height) return null;
  const maxW = kind === "face" ? 256 : 704;
  const w = Math.min(a.width, maxW);
  return { src: (a.runtimeUrl ?? a.url)!, width: w, height: Math.round(a.height * (w / a.width)), alpha: a.alpha ?? true, source: `storage:${a.id}`, sourceSha: (a.checksum ?? "").slice(0, 16),
    ...(kind === "face" && a.smallUrl ? { small: { src: a.smallUrl, width: Math.min(a.width, 96), height: Math.round(a.height * (Math.min(a.width, 96) / a.width)) } } : {}) };
};

export function AgentEditor({ detail, onSaved }: { detail: AgentDetailData | null; onSaved: () => void }) {
  const router = useRouter();
  const creating = !detail;
  const initial = useMemo(() => (detail ? fromDetail(detail) : emptyForm()), [detail]);
  const [form, setForm] = useState<Form>(initial);
  const [face, setFace] = useState<UploadedAsset | ArtInfo | null>(detail?.face ?? null);
  const [full, setFull] = useState<UploadedAsset | ArtInfo | null>(detail?.full ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "publish" | "retire" | "republish" | "delete">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [dlgError, setDlgError] = useState<string | null>(null);

  const artChanged = (face?.id ?? null) !== (detail?.face?.id ?? null) || (full?.id ?? null) !== (detail?.full?.id ?? null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || artChanged;
  useUnsavedGuard(dirty);
  const errors = validateAgentDraft({ ...form, code: form.code || undefined }, { creating });
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const preview: AgentArtPreview = { name: form.name || "Nuevo agente", role: form.role, face: toArt(face, "face"), full: toArt(full, "full") };
  const previewId = form.id || "nuevo";

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const patch: Record<string, unknown> = { name: form.name, role: form.role, code: form.code || defaultAgentCode(form.name), abilities: form.abilities };
      if (face?.id !== (detail?.face?.id ?? undefined)) patch.faceAssetId = face?.id ?? null;
      if (full?.id !== (detail?.full?.id ?? undefined)) patch.fullAssetId = full?.id ?? null;
      await adminPost("/api/admin/cms/agents", { action: "save", id: form.id, patch, expectedVersion: creating ? null : detail!.agent.version, reason: creating ? "alta desde el panel" : "edición desde el panel" });
      if (creating) router.push(`/admin/agents/${form.id}`); else onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar"); } finally { setSaving(false); }
  };

  const act = async () => {
    if (!detail) return;
    setBusy(true); setDlgError(null);
    try {
      if (dialog === "delete") {
        await adminPost("/api/admin/cms/agents", { action: "deleteDraft", id: detail.agent.id, expectedVersion: detail.agent.version, reason, confirm: detail.agent.id });
        router.push("/admin/agents"); return;
      }
      await adminPost("/api/admin/cms/agents", { action: "lifecycle", id: detail.agent.id, to: dialog === "retire" ? "RETIRED" : "PUBLISHED", expectedVersion: detail.agent.version, reason });
      setDialog(null); setReason(""); onSaved();
    } catch (e) { setDlgError(e instanceof Error ? e.message : "No se pudo completar"); } finally { setBusy(false); }
  };

  const checklist = detail ? agentPublishChecklist({ ...detail.agent, faceAssetId: face?.id ?? null, fullAssetId: full?.id ?? null }) : [];
  const ready = checklist.every((c) => c.ok) && !dirty;
  const color = (AGENT_CLASS_COLOR as Record<string, string>)[form.role] ?? "#19e3ff";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <Section title="Identidad" aside={detail ? <LifecycleBadge state={detail.agent.lifecycle} /> : <LifecycleBadge state="DRAFT" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre" htmlFor="ag-name" error={form.name ? errors.name : null}>
              <Input id="ag-name" value={form.name} maxLength={24} onChange={(e) => set({ name: e.target.value, ...(creating && (!form.id || form.id === suggestAgentId(form.name)) ? { id: suggestAgentId(e.target.value) } : {}) })} />
            </Field>
            <Field label="Id / slug canónico" htmlFor="ag-id" hint={creating ? "Estable: no se puede cambiar tras crear (lo usan stats y composiciones)." : "Inmutable."} error={creating && form.id ? errors.id : null}>
              <Input id="ag-id" value={form.id} disabled={!creating} maxLength={24} onChange={(e) => set({ id: e.target.value.toLowerCase() })} />
            </Field>
            <Field label="Rol" htmlFor="ag-role" error={errors.role}>
              <Select id="ag-role" value={form.role} onChange={(e) => set({ role: e.target.value })}>
                {AGENT_ROLES.map((r) => <option key={r} value={r}>{(AGENT_CLASS_LABEL as Record<string, string>)[r]}</option>)}
              </Select>
            </Field>
            <Field label="Código de ficha" htmlFor="ag-code" hint={`Por defecto: ${defaultAgentCode(form.name || "Agente")}`} error={errors.code}>
              <Input id="ag-code" value={form.code} maxLength={4} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder={defaultAgentCode(form.name || "Agente")} />
            </Field>
          </div>
        </Section>

        <Section title="Habilidades (C · Q · E · X)">
          <div className="grid gap-3 sm:grid-cols-2">
            {form.abilities.map((a, i) => (
              <Field key={a.slot} label={`Tecla ${a.slot}${a.slot === "X" ? " · definitiva" : ""}`} htmlFor={`ag-ab-${a.slot}`}>
                <Input id={`ag-ab-${a.slot}`} value={a.name} maxLength={48}
                  onChange={(e) => set({ abilities: form.abilities.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </Field>
            ))}
          </div>
          {errors.abilities && form.abilities.some((a) => a.name) && <p className="mt-2 text-[12px] text-warn">{errors.abilities}</p>}
        </Section>

        {detail ? (
          <Section title="Arte">
            <div className="grid gap-3 md:grid-cols-2">
              <AssetUploader kind="agent_face" subjectId={detail.agent.id} current={face ? { url: face.runtimeUrl ?? face.url } : null} onUploaded={setFace} label="Cara (retrato)" />
              <AssetUploader kind="agent_full" subjectId={detail.agent.id} current={full ? { url: full.runtimeUrl ?? full.url } : null} onUploaded={setFull} label="Cuerpo entero" />
            </div>
            <p className="mt-2 text-[12px] text-ink-faint">Subir no publica: el arte se aplica al guardar. El original se guarda tal cual en Storage; el juego usa derivados WEBP (caras 256/96 px, cuerpo 704 px).
              {detail.agent.origin === "seed" && !detail.face && " Este agente usa hoy el arte estático de F59; subir aquí lo sustituye."}</p>
          </Section>
        ) : (
          <p className="rounded-control border border-white/10 p-3 text-[13px] text-ink-muted">Guarda el borrador para subir la cara y el cuerpo entero.</p>
        )}

        {error && <ErrorBox error={error} />}
        {creating && <div className="flex justify-end"><Button onClick={save} disabled={saving || Object.keys(errors).length > 0}>{saving ? "Creando…" : "Crear borrador"}</Button></div>}
        {!creating && <DirtyBar dirty={dirty} saving={saving} onSave={save} onReset={() => { setForm(initial); setFace(detail?.face ?? null); setFull(detail?.full ?? null); }} disabled={Object.keys(errors).length > 0} />}

        {detail && (
          <>
            <Section title="Usado por"><DependencyList refs={detail.references} labels={{ mapPlayerStats: "Stats por mapa", playerStats: "Stats de jugador", compositions: "Composiciones", strats: "Jugadas" }} /></Section>
            <Section title="Historial"><ActivityList items={detail.history} empty="Sin cambios registrados" /></Section>
          </>
        )}
      </div>

      <aside className="space-y-5">
        <Panel title="Vista previa (componentes del juego)">
          <div className="grid grid-cols-[1fr_120px] items-end gap-4" data-testid="agent-preview">
            <AgentFullBody agentId={previewId} preview={preview} showName />
            <div className="space-y-3">
              <div className="flex items-center gap-2"><AgentPortrait agentId={previewId} preview={preview} size={48} /><span className="text-[11px] text-ink-faint">retrato</span></div>
              <div className="flex items-center gap-2"><AgentPortrait agentId={previewId} preview={preview} size={28} state="selected" /><span className="text-[11px] text-ink-faint">chip</span></div>
              <svg viewBox="-20 -20 40 40" width={56} height={56} aria-label="Ficha del mapa">
                <circle r={16} fill="#07101f" stroke={color} strokeWidth={2} />
                <AgentFaceSvg agentId={previewId} r={14.5} fallback={<text textAnchor="middle" dominantBaseline="central" fill={color} fontSize={9} fontWeight={800}>{form.code || defaultAgentCode(form.name || "Agente")}</text>} />
              </svg>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-ink-faint">Sin arte, el juego pinta el emblema (anillo del rol + código); nunca una imagen rota.</p>
        </Panel>

        {detail && (
          <Panel title="Publicación">
            <Checklist items={checklist} />
            <KV cols={1} items={[["Versión", `v${detail.agent.version}`], ["En la instantánea del código", detail.inSnapshot ? "sí" : "no (el juego la recibe de la BD)"]]} />
            <div className="mt-3 flex flex-wrap gap-2">
              {detail.agent.lifecycle === "DRAFT" && <Button onClick={() => setDialog("publish")} disabled={!ready} title={dirty ? "Guarda antes de publicar" : undefined}>Publicar</Button>}
              {detail.agent.lifecycle === "PUBLISHED" && <Button variant="danger" onClick={() => setDialog("retire")}>Retirar</Button>}
              {detail.agent.lifecycle === "RETIRED" && <Button onClick={() => setDialog("republish")}>Volver a publicar</Button>}
              {detail.agent.lifecycle === "DRAFT" && <Button variant="danger" onClick={() => setDialog("delete")}>Borrar borrador</Button>}
            </div>
          </Panel>
        )}
      </aside>

      {detail && (
        <ConfirmDialog open={dialog !== null} onClose={() => { if (!busy) { setDialog(null); setDlgError(null); } }} onConfirm={act} busy={busy} error={dlgError}
          risk={dialog === "delete" ? "CRITICAL" : "HIGH"}
          title={dialog === "publish" ? "Publicar agente" : dialog === "retire" ? "Retirar agente" : dialog === "republish" ? "Volver a publicar" : "Borrar borrador"}
          confirmLabel={dialog === "delete" ? "Borrar definitivamente" : dialog === "retire" ? "Retirar" : "Publicar"}
          typeToConfirm={detail.agent.id} canConfirm={reason.trim().length >= 4}>
          <p>{dialog === "publish" || dialog === "republish" ? "Aparecerá en el roster del entrenador y en el juego en unos segundos, sin reiniciar."
            : dialog === "retire" ? "Deja de ofrecerse para composiciones nuevas. Lo guardado (composiciones, jugadas, estadísticas) se conserva y se sigue pintando."
              : "Borrado DURO del borrador. Sólo es posible porque no tiene ninguna referencia."}</p>
          <Field label="Motivo (auditoría)" htmlFor="ag-reason"><Textarea id="ag-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></Field>
        </ConfirmDialog>
      )}
    </div>
  );
}
