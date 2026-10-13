"use client";

/**
 * F60 · JUGADORES — alta (/admin/players/new) y edición en la ficha. Sólo los campos que el modelo REAL tiene. Sin
 * borrado: un jugador con cartas se marca inactivo. Cambiar su equipo ACTUAL no toca el equipo IMPRESO de sus cartas.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorBox, Field, Input, Select, Panel } from "@/components/admin/cc/ui";
import { adminPost, useAdminQuery } from "@/components/admin/cc/api";
import { AssetUploader, DirtyBar, useUnsavedGuard, type UploadedAsset } from "./cms";

const REGIONS = ["EMEA", "Americas", "Pacific", "China"];
const ROLES = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const STATS = ["dmg", "scr", "com", "hs", "ast", "clu"] as const;

export interface PlayerFormValue { nick: string; fullName: string; team: string; teamTag: string; region: string; role: string; country: string; status: string; stats: Record<string, string> }
const empty: PlayerFormValue = { nick: "", fullName: "", team: "", teamTag: "", region: "EMEA", role: "Duelista", country: "", status: "active", stats: Object.fromEntries(STATS.map((k) => [k, ""])) };

function Fields({ v, set, idPrefix }: { v: PlayerFormValue; set: (p: Partial<PlayerFormValue>) => void; idPrefix: string }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Nick" htmlFor={`${idPrefix}-nick`}><Input id={`${idPrefix}-nick`} value={v.nick} maxLength={24} onChange={(e) => set({ nick: e.target.value })} /></Field>
        <Field label="Nombre completo" htmlFor={`${idPrefix}-fn`}><Input id={`${idPrefix}-fn`} value={v.fullName} maxLength={80} onChange={(e) => set({ fullName: e.target.value })} /></Field>
        <Field label="Equipo actual" htmlFor={`${idPrefix}-team`} hint="No cambia el equipo impreso de sus cartas."><Input id={`${idPrefix}-team`} value={v.team} maxLength={40} onChange={(e) => set({ team: e.target.value })} /></Field>
        <Field label="Tag de equipo" htmlFor={`${idPrefix}-tag`}><Input id={`${idPrefix}-tag`} value={v.teamTag} maxLength={6} onChange={(e) => set({ teamTag: e.target.value })} /></Field>
        <Field label="Región" htmlFor={`${idPrefix}-reg`}><Select id={`${idPrefix}-reg`} value={v.region} onChange={(e) => set({ region: e.target.value })}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Rol del jugador" htmlFor={`${idPrefix}-role`}><Select id={`${idPrefix}-role`} value={v.role} onChange={(e) => set({ role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="País (ISO)" htmlFor={`${idPrefix}-cty`}><Input id={`${idPrefix}-cty`} value={v.country} maxLength={2} onChange={(e) => set({ country: e.target.value.toUpperCase() })} /></Field>
        <Field label="Estado" htmlFor={`${idPrefix}-st`}><Select id={`${idPrefix}-st`} value={v.status} onChange={(e) => set({ status: e.target.value })}><option value="active">Activo</option><option value="inactive">Inactivo / retirado</option></Select></Field>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {STATS.map((k) => <Field key={k} label={k.toUpperCase()} htmlFor={`${idPrefix}-${k}`}><Input id={`${idPrefix}-${k}`} inputMode="numeric" value={v.stats[k]} onChange={(e) => set({ stats: { ...v.stats, [k]: e.target.value.replace(/\D/g, "").slice(0, 2) } })} /></Field>)}
      </div>
      <p className="text-[11px] text-ink-faint">Las seis estadísticas heredadas del jugador (1–99). Las de la CARTA se imprimen en cada carta.</p>
    </div>
  );
}

const toPatch = (v: PlayerFormValue) => ({
  nick: v.nick.trim(), fullName: v.fullName.trim(), team: v.team.trim(), teamTag: v.teamTag.trim(), region: v.region, role: v.role, country: v.country, status: v.status,
  stats: Object.fromEntries(STATS.map((k) => [k, Number(v.stats[k])])),
});

export function NewPlayerForm() {
  const router = useRouter();
  const [id, setId] = useState(""); const [v, setV] = useState<PlayerFormValue>(empty);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(!!v.nick && !busy);
  const create = async () => {
    setBusy(true); setError(null);
    try { await adminPost("/api/admin/cms/players", { action: "save", id, patch: toPatch(v), reason: "alta desde el panel" }); router.push(`/admin/players/${encodeURIComponent(id)}`); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear"); setBusy(false); }
  };
  return (
    <Panel title="Nuevo jugador">
      <Field label="Id" htmlFor="np-id" hint="Minúsculas, cifras, _ o -. Es la mitad izquierda del id de sus cartas."><Input id="np-id" value={id} maxLength={40} onChange={(e) => setId(e.target.value.toLowerCase())} /></Field>
      <div className="mt-3"><Fields v={v} set={(p) => setV({ ...v, ...p })} idPrefix="np" /></div>
      {error && <div className="mt-3"><ErrorBox error={error} /></div>}
      <div className="mt-4 flex justify-end"><Button onClick={create} disabled={busy || !id || !v.nick}>{busy ? "Creando…" : "Crear jugador"}</Button></div>
    </Panel>
  );
}

export function PlayerEditPanel({ id, player, onSaved }: { id: string; player: { nick: string; full_name: string | null; team: string | null; team_tag: string | null; region: string | null; role: string | null; country: string | null; status: string | null; stats: Record<string, number> | null }; onSaved: () => void }) {
  const rel = useAdminQuery<{ version: number | null }>(`/api/admin/cms/players?id=${encodeURIComponent(id)}`);
  const initial: PlayerFormValue = {
    nick: player.nick, fullName: player.full_name ?? "", team: player.team ?? "", teamTag: player.team_tag ?? "", region: player.region ?? "EMEA", role: player.role ?? "Duelista",
    country: player.country ?? "", status: player.status ?? "active", stats: Object.fromEntries(STATS.map((k) => [k, String(Math.round(player.stats?.[k] ?? 0) || "")])),
  };
  const [v, setV] = useState<PlayerFormValue>(initial);
  const [photo, setPhoto] = useState<UploadedAsset | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial) || !!photo;
  useUnsavedGuard(dirty);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await adminPost("/api/admin/cms/players", { action: "save", id, expectedVersion: rel.data?.version, reason: "edición desde el panel", patch: { ...toPatch(v), ...(photo ? { photoAssetId: photo.id } : {}) } });
      setPhoto(null); rel.reload(); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar"); } finally { setBusy(false); }
  };
  return (
    <Panel title="Editar jugador" subtitle="Cambios auditados, con control de concurrencia. Estado «inactivo» en lugar de borrar.">
      <Fields v={v} set={(p) => setV({ ...v, ...p })} idPrefix="pe" />
      <div className="mt-3"><AssetUploader kind="player_photo" subjectId={id} onUploaded={setPhoto} label="Foto del jugador (opcional)" /></div>
      {error && <div className="mt-3"><ErrorBox error={error} /></div>}
      <DirtyBar dirty={dirty} saving={busy} onSave={save} onReset={() => { setV(initial); setPhoto(null); }} label="Guardar cambios" disabled={rel.data?.version == null} />
    </Panel>
  );
}
