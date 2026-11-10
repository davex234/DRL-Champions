"use client";

/**
 * F73 · /admin/crafting — RECETAS DE CRAFTEO, MISIONES y PROYECTOS DE CARTA.
 *
 * Todo se valida en servidor (`server/cms/crafting.ts`): no se puede ACTIVAR una receta por debajo de su suelo
 * económico seguro, una misión sin condición/objetivo válidos, con recompensa inexistente o con dependencias
 * circulares, ni un proyecto sin carta REAL del catálogo o sin misiones activas. Cada guardado queda en Auditoría.
 * Aquí no se crea contenido (cartas, sobres, jugadores): se configura lo que ya existe.
 */
import { useMemo, useState } from "react";
import { PageHeader, Panel, Loading, ErrorBox, Pill, Button, Field, Input, Select, Textarea, Tabs, Empty } from "@/components/admin/cc/ui";
import { useAdminQuery, adminPost } from "@/components/admin/cc/api";
import { ForgeAdminPanel } from "@/components/admin/ForgeAdminPanel";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const tr = ns("admin");

type Status = "ACTIVE" | "DISABLED" | "RETIRED" | "DRAFT";
interface Recipe { id: string; kind: "PACK" | "CARD"; name: string; inputPackId: string | null; outputPackId: string | null; inputClass: string | null; outputClass: string | null; inputQty: number; status: Status; sortOrder: number; version: number; floor: { ratio: number; viable: boolean; lossCost: number; lossValue: number } | null; problems: { code: string; message: string }[] }
interface Mission { id: string; name: string; description: string; condition: Record<string, unknown> & { type: string }; target: number; dependsOn: string[]; reward: { credits?: number; xp?: number; packId?: string; packCount?: number }; projectId: string | null; status: Status; sortOrder: number; version: number }
interface Project { id: string; name: string; description: string; targetCardId: string; status: Status; sortOrder: number; version: number }
interface View { available: boolean; reason: string; recipes: Recipe[]; missions: Mission[]; projects: Project[]; conditionTypes: string[] }

const URL = "/api/admin/cms/crafting";
const CLASSES = ["base", "plata", "oro", "masters", "champions", "prime", "icon"];
const tone = (s: Status) => (s === "ACTIVE" ? "ok" : s === "RETIRED" ? "bad" : "default") as "ok" | "bad" | "default";

export default function CraftingAdminPage() {
  useLocale();
  const q = useAdminQuery<View>(URL);
  const [tab, setTab] = useState<"recipes" | "missions" | "projects" | "forge">("recipes");
  const [editing, setEditing] = useState<{ kind: "recipe" | "mission" | "project"; data: Record<string, unknown>; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!editing) return;
    setBusy(true); setError(null);
    const action = editing.kind === "recipe" ? "saveRecipe" : editing.kind === "mission" ? "saveMission" : "saveProject";
    const { id, ...patch } = editing.data;
    try { await adminPost(URL, { action, id, patch, expectedVersion: editing.version }); setEditing(null); q.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : tr("Error")); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={tr("Contenido · F73 · F79")} title={tr("Crafteo y misiones")} description={tr("Recetas de sobres e intercambio de cartas, misiones configurables, proyectos de carta y la progresión de NEXUS FORGE 2.0. El servidor valida todo antes de guardar.")} />
      {q.loading && <Loading />}
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {q.data && !q.data.available && (
        <Panel tone="gold" title={tr("Migración 0059 pendiente")}><p className="text-[14px] text-ink-secondary">{fill(tr("Las tablas de crafteo y misiones aún no existen en esta base de datos. El sistema está desactivado hasta que se autorice y aplique {fichero}.", slots("fichero")), { fichero: <code>0059_crafting_missions.sql</code> })}</p></Panel>
      )}
      {q.data?.available && (
        <>
          <Tabs value={tab} onChange={setTab} label={tr("Secciones")} items={[
            { id: "recipes", label: tr("Recetas"), count: q.data.recipes.length },
            { id: "missions", label: tr("Misiones"), count: q.data.missions.length },
            { id: "projects", label: tr("Proyectos"), count: q.data.projects.length },
            { id: "forge", label: tr("Forge 2.0") },
          ]} />
          {tab === "forge" && <ForgeAdminPanel />}
          {tab === "recipes" && (
            <Panel title={tr("Recetas")} actions={<>
              <Button size="sm" onClick={() => setEditing({ kind: "recipe", version: 0, data: { id: "", kind: "PACK", name: "", inputPackId: "", outputPackId: "", inputQty: 2, status: "DISABLED", sortOrder: 0 } })}>{tr("Nueva de sobres")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: "recipe", version: 0, data: { id: "", kind: "CARD", name: "", inputClass: "base", outputClass: "plata", inputQty: 2, status: "DISABLED", sortOrder: 0 } })}>{tr("Nueva de cartas")}</Button>
            </>}>
              <ul className="divide-y divide-white/5">
                {q.data.recipes.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                    <b className="min-w-[180px] text-ink-primary">{r.name}</b>
                    <span className="text-[13px] text-ink-muted">{r.kind === "PACK" ? `${r.inputQty} × ${r.inputPackId} → 1 × ${r.outputPackId}` : tr("{inputQty} × {inputClass} → 1 × {outputClass} (aleatoria)", { inputQty: r.inputQty, inputClass: r.inputClass, outputClass: r.outputClass })}</span>
                    <Pill tone={tone(r.status)}>{td(r.status)}</Pill>
                    {r.floor && <Pill tone={r.inputQty >= r.floor.ratio ? "cyan" : "warn"}>{tr("suelo seguro {ratio}", { ratio: r.floor.ratio })}</Pill>}
                    {r.problems.length > 0 && <Pill tone="bad">{td(r.problems[0].message)}</Pill>}
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ kind: "recipe", version: r.version, data: { id: r.id, name: r.name, inputQty: r.inputQty, status: r.status, sortOrder: r.sortOrder, ...(r.kind === "PACK" ? { inputPackId: r.inputPackId, outputPackId: r.outputPackId } : { inputClass: r.inputClass, outputClass: r.outputClass }) } })}>{tr("Editar")}</Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {tab === "missions" && (
            <Panel title={tr("Misiones")} actions={<Button size="sm" onClick={() => setEditing({ kind: "mission", version: 0, data: { id: "", name: "", description: "", condition: { type: "MATCH_WIN" }, target: 1, dependsOn: [], reward: {}, projectId: null, status: "DRAFT", sortOrder: 0 } })}>{tr("Nueva misión")}</Button>}>
              {q.data.missions.length === 0 ? <Empty title={tr("Sin misiones")}>{tr("Crea la primera. Empiezan en borrador.")}</Empty> : (
                <ul className="divide-y divide-white/5">
                  {q.data.missions.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                      <b className="min-w-[180px] text-ink-primary">{m.name}</b>
                      <span className="text-[13px] text-ink-muted">{td(m.condition.type)} × {m.target}{m.projectId ? tr(" · proyecto {projectId}", { projectId: m.projectId }) : ""}{m.dependsOn.length ? tr(" · tras {dependsOn}", { dependsOn: m.dependsOn.join(", ") }) : ""}</span>
                      <Pill tone={tone(m.status)}>{td(m.status)}</Pill>
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ kind: "mission", version: m.version, data: { id: m.id, name: m.name, description: m.description, condition: m.condition, target: m.target, dependsOn: m.dependsOn, reward: m.reward, projectId: m.projectId, status: m.status, sortOrder: m.sortOrder } })}>{tr("Editar")}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {tab === "projects" && (
            <Panel title={tr("Proyectos de carta")} actions={<Button size="sm" onClick={() => setEditing({ kind: "project", version: 0, data: { id: "", name: "", description: "", targetCardId: "", status: "DRAFT", sortOrder: 0 } })}>{tr("Nuevo proyecto")}</Button>}>
              {q.data.projects.length === 0 ? <Empty title={tr("Sin proyectos")}>{tr("Un proyecto entrega una carta REAL del catálogo al completar sus misiones.")}</Empty> : (
                <ul className="divide-y divide-white/5">
                  {q.data.projects.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                      <b className="min-w-[180px] text-ink-primary">{p.name}</b>
                      <span className="text-[13px] text-ink-muted">{tr("carta {carta} · {n} misiones", { carta: p.targetCardId, n: q.data!.missions.filter((m) => m.projectId === p.id).length })}</span>
                      <Pill tone={tone(p.status)}>{td(p.status)}</Pill>
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing({ kind: "project", version: p.version, data: { id: p.id, name: p.name, description: p.description, targetCardId: p.targetCardId, status: p.status, sortOrder: p.sortOrder } })}>{tr("Editar")}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {editing && <Editor editing={editing} setEditing={setEditing} view={q.data} onSave={save} busy={busy} error={td(error)} onCancel={() => { setEditing(null); setError(null); }} />}
        </>
      )}
    </div>
  );
}

function Editor({ editing, setEditing, view, onSave, onCancel, busy, error }: {
  editing: { kind: "recipe" | "mission" | "project"; data: Record<string, unknown>; version: number };
  setEditing: (e: { kind: "recipe" | "mission" | "project"; data: Record<string, unknown>; version: number }) => void;
  view: View; onSave: () => void; onCancel: () => void; busy: boolean; error: string | null;
}) {
  useLocale();
  const d = editing.data;
  const set = (k: string, v: unknown) => setEditing({ ...editing, data: { ...d, [k]: v } });
  const cond = (d.condition ?? {}) as Record<string, unknown>;
  const setCond = (k: string, v: unknown) => set("condition", { ...cond, [k]: v === "" ? undefined : v });
  const reward = (d.reward ?? {}) as Record<string, unknown>;
  const setReward = (k: string, v: unknown) => set("reward", { ...reward, [k]: v === "" ? undefined : v });
  const statuses = editing.kind === "recipe" ? ["ACTIVE", "DISABLED", "RETIRED"] : ["DRAFT", "ACTIVE", "RETIRED"];
  const isNew = editing.version === 0;
  const idOk = useMemo(() => /^[a-z0-9][a-z0-9-]{1,63}$/.test(String(d.id ?? "")), [d.id]);
  return (
    <Panel title={isNew
      ? (editing.kind === "recipe" ? tr("Nueva receta") : editing.kind === "mission" ? tr("Nueva misión") : tr("Nueva proyecto"))
      : (editing.kind === "recipe" ? tr("Editar receta") : editing.kind === "mission" ? tr("Editar misión") : tr("Editar proyecto"))} tone="cyan">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("Id")} htmlFor="f-id" error={isNew && d.id && !idOk ? tr("minúsculas, números y guiones") : null}><Input id="f-id" value={String(d.id ?? "")} disabled={!isNew} onChange={(e) => set("id", e.target.value)} /></Field>
        <Field label={tr("Nombre")} htmlFor="f-name"><Input id="f-name" value={String(d.name ?? "")} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={tr("Estado")} htmlFor="f-status"><Select id="f-status" value={String(d.status)} onChange={(e) => set("status", e.target.value)}>{statuses.map((s) => <option key={s}>{td(s)}</option>)}</Select></Field>
        <Field label={tr("Orden")} htmlFor="f-order"><Input id="f-order" type="number" value={Number(d.sortOrder ?? 0)} onChange={(e) => set("sortOrder", Number(e.target.value))} /></Field>
        {editing.kind === "recipe" && (d.kind === "PACK" || d.inputPackId !== undefined) && d.inputClass === undefined && (<>
          <Field label={tr("Sobre de entrada")} htmlFor="f-in"><Input id="f-in" value={String(d.inputPackId ?? "")} onChange={(e) => set("inputPackId", e.target.value)} /></Field>
          <Field label={tr("Sobre de salida")} htmlFor="f-out"><Input id="f-out" value={String(d.outputPackId ?? "")} onChange={(e) => set("outputPackId", e.target.value)} /></Field>
        </>)}
        {editing.kind === "recipe" && d.inputClass !== undefined && (<>
          <Field label={tr("Clase de entrada")} htmlFor="f-cin"><Select id="f-cin" value={String(d.inputClass)} onChange={(e) => set("inputClass", e.target.value)}>{CLASSES.map((c) => <option key={c}>{td(c)}</option>)}</Select></Field>
          <Field label={tr("Clase de salida")} htmlFor="f-cout"><Select id="f-cout" value={String(d.outputClass)} onChange={(e) => set("outputClass", e.target.value)}>{CLASSES.map((c) => <option key={c}>{td(c)}</option>)}</Select></Field>
        </>)}
        {editing.kind === "recipe" && <Field label={tr("Entradas (N)")} htmlFor="f-qty" hint={tr("El servidor exige el suelo seguro para ACTIVAR")}><Input id="f-qty" type="number" min={2} max={100} value={Number(d.inputQty ?? 2)} onChange={(e) => set("inputQty", Number(e.target.value))} /></Field>}
        {editing.kind !== "recipe" && <div className="sm:col-span-2"><Field label={tr("Descripción")} htmlFor="f-desc"><Textarea id="f-desc" value={String(d.description ?? "")} onChange={(e) => set("description", e.target.value)} /></Field></div>}
        {editing.kind === "project" && <Field label={tr("Carta objetivo (id REAL del catálogo)")} htmlFor="f-card"><Input id="f-card" value={String(d.targetCardId ?? "")} onChange={(e) => set("targetCardId", e.target.value)} /></Field>}
        {editing.kind === "mission" && (<>
          <Field label={tr("Condición")} htmlFor="f-type"><Select id="f-type" value={String(cond.type ?? "")} onChange={(e) => set("condition", { type: e.target.value })}>{view.conditionTypes.map((t) => <option key={t}>{td(t)}</option>)}</Select></Field>
          <Field label={tr("Objetivo")} htmlFor="f-target"><Input id="f-target" type="number" min={1} max={500} value={Number(d.target ?? 1)} onChange={(e) => set("target", Number(e.target.value))} /></Field>
          <Field label={tr("Carta (cardId)")} htmlFor="f-ccard"><Input id="f-ccard" value={String(cond.cardId ?? "")} onChange={(e) => setCond("cardId", e.target.value)} /></Field>
          <Field label={tr("Jugador (playerId)")} htmlFor="f-cplayer"><Input id="f-cplayer" value={String(cond.playerId ?? "")} onChange={(e) => setCond("playerId", e.target.value)} /></Field>
          <Field label={tr("Equipo (id canónico)")} htmlFor="f-cteam"><Input id="f-cteam" value={String(cond.team ?? "")} onChange={(e) => setCond("team", e.target.value)} /></Field>
          <Field label={tr("País (ISO-2)")} htmlFor="f-ccountry"><Input id="f-ccountry" value={String(cond.country ?? "")} onChange={(e) => setCond("country", e.target.value.toUpperCase())} /></Field>
          <Field label={tr("Rol")} htmlFor="f-crole"><Input id="f-crole" value={String(cond.role ?? "")} onChange={(e) => setCond("role", e.target.value)} /></Field>
          <Field label={tr("Mínimo (min)")} htmlFor="f-cmin"><Input id="f-cmin" type="number" value={cond.min === undefined ? "" : Number(cond.min)} onChange={(e) => setCond("min", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
          <Field label={tr("Modos (PVE,DRAFT,RANKED)")} htmlFor="f-cmodes"><Input id="f-cmodes" value={Array.isArray(cond.modes) ? (cond.modes as string[]).join(",") : ""} onChange={(e) => setCond("modes", e.target.value ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean) : "")} /></Field>
          <Field label={tr("Sobre (packId, abrir/craftear)")} htmlFor="f-cpack"><Input id="f-cpack" value={String(cond.packId ?? "")} onChange={(e) => setCond("packId", e.target.value)} /></Field>
          <Field label={tr("Depende de (ids, coma)")} htmlFor="f-deps"><Input id="f-deps" value={(d.dependsOn as string[] ?? []).join(",")} onChange={(e) => set("dependsOn", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} /></Field>
          <Field label={tr("Proyecto (id)")} htmlFor="f-proj"><Select id="f-proj" value={String(d.projectId ?? "")} onChange={(e) => set("projectId", e.target.value || null)}><option value="">—</option>{view.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label={tr("Recompensa · créditos")} htmlFor="f-rc"><Input id="f-rc" type="number" value={reward.credits === undefined ? "" : Number(reward.credits)} onChange={(e) => setReward("credits", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
          <Field label={tr("Recompensa · XP")} htmlFor="f-rx"><Input id="f-rx" type="number" value={reward.xp === undefined ? "" : Number(reward.xp)} onChange={(e) => setReward("xp", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
          <Field label={tr("Recompensa · sobre")} htmlFor="f-rp"><Input id="f-rp" value={String(reward.packId ?? "")} onChange={(e) => setReward("packId", e.target.value)} /></Field>
          <Field label={tr("Recompensa · nº de sobres")} htmlFor="f-rn"><Input id="f-rn" type="number" value={reward.packCount === undefined ? "" : Number(reward.packCount)} onChange={(e) => setReward("packCount", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
        </>)}
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-bad">▲ {td(error)}</p>}
      <div className="mt-4 flex gap-2">
        <Button onClick={onSave} disabled={busy || (isNew && !idOk)}>{busy ? tr("Guardando…") : tr("Guardar")}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancelar")}</Button>
      </div>
    </Panel>
  );
}
