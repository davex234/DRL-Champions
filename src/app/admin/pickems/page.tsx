"use client";

/**
 * F87 · /admin/pickems — PICK'EMS 2.0. Borradores DERIVADOS de eventos reales (fuente 0045 + formato), aristas de
 * admin solo donde la fuente calla, validador = puerta de publicación, deriva de la fuente, recompensas con valor y
 * pasivo, cierres/reprogramación/VOID con motivo y liquidación. Aquí no se decide nada: `/api/admin/pickems` → RPC de
 * 0071 (admin releído en la BD, auditoría en la misma transacción). Nunca se introducen resultados a mano.
 */
import { useMemo, useState } from "react";
import { useAdminQuery, adminPost, dateTime, fmt, pct } from "@/components/admin/cc/api";
import { PageHeader, Panel, Pill, Loading, ErrorBox, Button, Empty, ConfirmDialog, Field, Input, Select, KV } from "@/components/admin/cc/ui";
import type { AdminBracketRow, AdminDetail, AdminLegacyRow } from "@/server/admin/pickems";
import type { FormatIssue, FormatDescriptor } from "@/domain/pickems/format";
import { TIER_LABEL, TIER_ORDER, REWARD_RULES_V1, describeTierReward, type BracketRewardConfig, type RewardTierId } from "@/domain/pickems/bracketRewards";
import { packLabel } from "@/domain/pickems/ledger";
import { ELIGIBILITY_LABEL, policyOf, requirementText, type EligibilityCode } from "@/domain/pickems/eligibility";
import type { LaunchReadiness } from "@/domain/pickems/launch";

type ListData = { brackets: AdminBracketRow[]; legacy: AdminLegacyRow[]; events: { id: string; name: string; status: string; stages: { id: string; name: string; kind: string | null; matches: number; detected: string | null }[] }[]; sync: { lastSuccessAt: string | null; lastStatus: string | null; consecutiveFailures: number; lastAttemptAt: string | null } };
interface Edge { from: string; to: string; source: "WINNER" | "LOSER"; slot: 1 | 2 | null }
interface Draft { id: string | null; version: number | null; eventId: string; stageIds: string[]; kind: string; slug: string; title: string; lockPolicy: "MATCH" | "STAGE"; adminEdges: Edge[] }
const STATUS_TONE: Record<string, "default" | "cyan" | "gold" | "ok" | "warn" | "bad"> = { DRAFT: "default", PUBLISHED: "cyan", SETTLED: "ok", CANCELLED: "bad" };
const PACKS = ["estandar", "premium", "oro", "masters", "champions", "icon"];

export default function AdminPickemsPage() {
  const list = useAdminQuery<ListData>("/api/admin/pickems");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const detail = useAdminQuery<AdminDetail>(selected ? `/api/admin/pickems?id=${selected}` : null);
  return (
    <div>
      <PageHeader eyebrow="Juego" title="Pick'ems 2.0" description="Cuadros de predicción sobre eventos esports REALES. Nada se publica ni se premia solo: borrador → validador → publicar; recompensas apagadas hasta aprobar su economía."
        actions={<Button onClick={() => { setSelected(null); setDraft({ id: null, version: null, eventId: "", stageIds: [], kind: "", slug: "", title: "", lockPolicy: "MATCH", adminEdges: [] }); }} data-testid="pickem-new">Nuevo borrador</Button>} />
      {list.data && <SyncPanel s={list.data.sync} />}
      {draft && list.data && <DraftEditor key={draft.id ?? "new"} initial={draft} events={list.data.events} onClose={() => setDraft(null)} onSaved={(id) => { setDraft(null); list.reload(); setSelected(id); detail.reload(); }} />}
      <Panel title="Pick'ems" subtitle="Un borrador solo existe aquí; un publicado con jugadores no se despublica (se cancela con motivo).">
        {list.loading && <Loading />}
        {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (list.data.brackets.length === 0 ? <Empty title="Sin Pick'ems 2.0">Crea un borrador desde un evento real.</Empty> : (
          <ul className="divide-y divide-white/[0.06]" data-testid="admin-pickems">
            {list.data.brackets.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => { setDraft(null); setSelected(b.id); }} className="nx-focus flex w-full flex-wrap items-center gap-3 px-2 py-3 text-left hover:bg-white/[0.04]" data-slug={b.slug}>
                  <Pill tone="cyan">2.0</Pill>
                  <Pill tone={STATUS_TONE[b.status] ?? "default"}>{b.status}</Pill>
                  <span className="min-w-0 flex-1 truncate font-bold text-ink-primary">{b.title} <span className="font-mono text-[12px] text-ink-faint">{b.slug}</span></span>
                  <span className="text-[12px] text-ink-muted">{b.formatLabel} · {b.nodes} partidos · {b.participants} jugadores</span>
                  <Pill tone={b.rewardsStatus === "ACTIVE" ? "gold" : "default"}>Recompensas {b.rewardsStatus}</Pill>
                </button>
              </li>
            ))}
          </ul>
        ))}
      </Panel>
      {list.data && <LegacyPanel rows={list.data.legacy ?? []} />}
      {selected && (
        <div className="mt-4">
          {detail.loading && <Loading />}
          {detail.error && <ErrorBox error={detail.error} onRetry={detail.reload} />}
          {detail.data && <BracketDetail d={detail.data} onChanged={() => { detail.reload(); list.reload(); }}
            onEdit={() => setDraft({ id: detail.data!.bracket.id, version: detail.data!.bracket.version, eventId: detail.data!.bracket.event_id, stageIds: detail.data!.bracket.stage_ids, kind: detail.data!.bracket.format_kind, slug: detail.data!.bracket.slug, title: detail.data!.bracket.title, lockPolicy: detail.data!.bracket.lock_policy, adminEdges: (detail.data!.bracket.admin_edges as Edge[]) ?? [] })} />}
        </div>
      )}
    </div>
  );
}

/** F87.1 · Pick'ems CLÁSICOS (0012): solo lectura. Desde el corte (0072) no se crean ni se predicen nuevos; los anteriores conservan sus reglas. */
function LegacyPanel({ rows }: { rows: AdminLegacyRow[] }) {
  return (
    <Panel title="Pick'ems clásicos (LEGACY)" subtitle="Anteriores al corte F87.1: conservan sus predicciones, puntos y recompensas históricas. No se crean nuevos; las recompensas futuras son de Pick'ems 2.0." dense>
      {rows.length === 0 ? <p className="text-sm text-ink-muted">Ninguno.</p> : (
        <ul className="divide-y divide-white/[0.06]" data-testid="admin-legacy-pickems">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-2 py-2 text-sm" data-legacy-mode={r.legacyMode}>
              <Pill tone="gold">LEGACY</Pill>
              <Pill tone={r.legacyMode === "LEGACY_V1" ? "warn" : "default"}>{r.legacyMode === "LEGACY_V1" ? "Reglas legacy vigentes" : "Retirado"}</Pill>
              <span className="min-w-0 flex-1 truncate font-bold text-ink-primary">{r.eventName ?? r.eventId} <span className="font-mono text-[12px] text-ink-faint">{r.eventId}</span></span>
              <span className="text-[12px] text-ink-muted">{r.status} · {r.questions} preguntas ({r.openQuestions} abiertas) · {r.submissions} participantes · {r.rewardsPaid} recompensas pagadas</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SyncPanel({ s }: { s: ListData["sync"] }) {
  return (
    <Panel title="Worker esports (solo lectura)" dense>
      <KV cols={3} items={[["Último éxito", dateTime(s.lastSuccessAt)], ["Último intento", dateTime(s.lastAttemptAt)], ["Estado", <span key="s">{s.lastStatus ?? "—"}{s.consecutiveFailures ? ` · ${s.consecutiveFailures} fallos seguidos` : ""}</span>]]} />
    </Panel>
  );
}

function Issues({ issues }: { issues: FormatIssue[] }) {
  if (!issues.length) return <p className="text-sm text-ok">✓ Sin problemas: el validador lo deja publicar.</p>;
  return (
    <ul className="space-y-1 text-sm" data-testid="pickem-issues">
      {issues.map((i, k) => <li key={k} className={i.severity === "ERROR" ? "text-bad" : "text-warn"}><b>{i.severity === "ERROR" ? "ERROR" : "AVISO"}</b> · {i.code} · {i.message}</li>)}
    </ul>
  );
}

function Summary({ d }: { d: FormatDescriptor }) {
  const by = (o: string) => d.edges.filter((e) => e.origin === o).length;
  return <KV cols={3} items={[["Formato", d.kind], ["Partidos", d.nodes.length], ["Secciones", d.sections.map((s) => s.label).join(", ")], ["Aristas de la fuente", by("SOURCE")], ["Derivadas del formato", by("FORMAT_DERIVED")], ["De admin", by("ADMIN")], ["Plazas", d.qualifications.length], ["Puntos máx.", d.nodes.reduce((s, n) => s + n.points, 0)], ["Entrada", d.nodes.filter((n) => n.seeds).length]]} />;
}

function DraftEditor({ initial, events, onClose, onSaved }: { initial: Draft; events: ListData["events"]; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<Draft>(initial);
  const [preview, setPreview] = useState<{ descriptor: FormatDescriptor | null; issues: FormatIssue[]; detected: string | null; canPublish: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ev = events.find((e) => e.id === f.eventId);
  const fields = { eventId: f.eventId, stageIds: f.stageIds, kind: f.kind || null, slug: f.slug, title: f.title, lockPolicy: f.lockPolicy, adminEdges: f.adminEdges };
  const nodes = preview?.descriptor?.nodes ?? [];
  const run = async (action: "preview" | "create" | "update") => {
    setBusy(true); setErr(null);
    try {
      if (action === "preview") {
        const r = await adminPost<typeof preview & object>("/api/admin/pickems", { action, fields });
        setPreview(r);
        // Sugerencias: una fila vacía por cada perdedor sin destino (el admin la completa con el cuadro oficial).
        const missing = (r?.issues ?? []).filter((i) => i.code === "LOSER_MISSING" && i.matchId).map((i) => i.matchId!);
        setF((x) => ({ ...x, adminEdges: [...x.adminEdges, ...missing.filter((m) => !x.adminEdges.some((e) => e.from === m && e.source === "LOSER")).map((m) => ({ from: m, to: "", source: "LOSER" as const, slot: null }))] }));
      } else {
        const r = await adminPost<{ id: string }>("/api/admin/pickems", action === "create" ? { action, fields } : { action, id: f.id, version: f.version, fields });
        onSaved(r.id);
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  };
  return (
    <Panel title={f.id ? "Editar borrador" : "Nuevo borrador"} subtitle="El formato y el grafo se derivan de los datos reales. Solo se añaden aristas donde la fuente no las publica." actions={<Button variant="ghost" onClick={onClose}>Cerrar</Button>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Evento real" htmlFor="pk-ev">
          <Select id="pk-ev" value={f.eventId} disabled={!!f.id} onChange={(e) => { setF({ ...f, eventId: e.target.value, stageIds: [] }); setPreview(null); }}>
            <option value="">— elige —</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status})</option>)}
          </Select>
        </Field>
        <Field label="Fases (ámbito)" htmlFor="pk-st" hint="Grupos y playoffs van en ámbitos separados: la fuente no publica qué clasificado ocupa qué hueco.">
          <div id="pk-st" className="space-y-1">
            {(ev?.stages ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!!f.id} checked={f.stageIds.includes(s.id)} onChange={(e) => { setF({ ...f, stageIds: e.target.checked ? [...f.stageIds, s.id] : f.stageIds.filter((x) => x !== s.id) }); setPreview(null); }} />
                {s.name} · {s.matches} partidos · detectado: <b>{s.detected ?? "desconocido"}</b>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Slug" htmlFor="pk-slug"><Input id="pk-slug" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder="champions-2026-playoffs" /></Field>
        <Field label="Título" htmlFor="pk-title"><Input id="pk-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Champions 2026 · Playoffs" /></Field>
        <Field label="Cierre" htmlFor="pk-lock" hint="Por partido (recomendado): cada predicción cierra cuando empieza SU partido.">
          <Select id="pk-lock" value={f.lockPolicy} onChange={(e) => setF({ ...f, lockPolicy: e.target.value as Draft["lockPolicy"] })}>
            <option value="MATCH">Por partido</option><option value="STAGE">Por fase (todo cierra con el primer partido)</option>
          </Select>
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-sm font-bold text-ink-primary">Aristas de admin ({f.adminEdges.length}) — solo sobre partidos REALES; contradecir a la fuente es un error</p>
        {f.adminEdges.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm" data-testid="pickem-admin-edge">
            <NodeSelect nodes={nodes} value={e.from} onChange={(v) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, from: v } : x)) })} />
            <Select value={e.source} onChange={(ev2) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, source: ev2.target.value as Edge["source"] } : x)) })} className="w-32"><option value="WINNER">ganador →</option><option value="LOSER">perdedor →</option></Select>
            <NodeSelect nodes={nodes} value={e.to} onChange={(v) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, to: v } : x)) })} />
            <Select value={String(e.slot ?? "")} onChange={(ev2) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, slot: ev2.target.value === "1" ? 1 : ev2.target.value === "2" ? 2 : null } : x)) })} className="w-28"><option value="">hueco libre</option><option value="1">hueco 1</option><option value="2">hueco 2</option></Select>
            <Button variant="ghost" size="sm" onClick={() => setF({ ...f, adminEdges: f.adminEdges.filter((_, k) => k !== i) })}>Quitar</Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setF({ ...f, adminEdges: [...f.adminEdges, { from: "", to: "", source: "LOSER", slot: null }] })}>Añadir arista</Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy || !f.eventId || !f.stageIds.length} onClick={() => run("preview")} data-testid="pickem-preview">Vista previa y validar</Button>
        <Button disabled={busy || !preview?.descriptor} onClick={() => run(f.id ? "update" : "create")} data-testid="pickem-save">{f.id ? "Guardar borrador" : "Crear borrador"}</Button>
      </div>
      {err && <p className="mt-2 text-sm text-bad" role="alert">{err}</p>}
      {preview && (
        <div className="mt-4 space-y-3">
          {preview.descriptor ? <Summary d={preview.descriptor} /> : <p className="text-sm text-bad">No se puede derivar: {preview.issues[0]?.message}</p>}
          <Issues issues={preview.issues} />
          <p className="text-[12px] text-ink-muted">Un borrador puede guardarse con errores; NO se puede publicar hasta que el validador quede limpio.</p>
        </div>
      )}
    </Panel>
  );
}

function NodeSelect({ nodes, value, onChange }: { nodes: FormatDescriptor["nodes"]; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-64">
      <option value="">— partido —</option>
      {nodes.map((n) => <option key={n.matchId} value={n.matchId}>{n.roundLabel} · {n.matchId}</option>)}
    </Select>
  );
}

/** F87.2 · preparación de lanzamiento: tres estados y cada puerta con su motivo (texto + símbolo, nunca solo color). */
function LaunchPanel({ launch, eligibility }: { launch: LaunchReadiness; eligibility: AdminDetail["eligibility"] }) {
  const LAUNCH: Record<LaunchReadiness["launch"], [string, "ok" | "warn" | "bad"]> = {
    READY_WITH_REWARDS: ["✓ Listo para lanzar con recompensas", "ok"], READY_WITHOUT_REWARDS: ["✓ Listo para publicar sin recompensas", "ok"], NOT_READY: ["✕ No listo", "bad"],
  };
  const rew: Record<LaunchReadiness["rewards"], [string, "default" | "ok" | "bad"]> = { OFF: ["Recompensas OFF", "default"], READY: ["✓ Recompensas listas", "ok"], NOT_READY: ["✕ Recompensas no listas", "bad"] };
  return (
    <Panel title="Preparación de lanzamiento" subtitle="Publicar exige estructura, fuente, cierres y puntuación. Con recompensas, además recompensas, economía, legacy y tiempo.">
      <div data-testid="pickem-launch" data-structure={launch.structure} data-rewards={launch.rewards} data-launch={launch.launch}>
        <KV cols={3} items={[
          ["Estructura", <Pill key="st" tone={launch.structure === "READY" ? "ok" : "bad"}>{launch.structure === "READY" ? "✓ LISTA" : "✕ NO LISTA"}</Pill>],
          ["Recompensas", <Pill key="rw" tone={rew[launch.rewards][1]}>{rew[launch.rewards][0]}</Pill>],
          ["Lanzamiento", <Pill key="la" tone={LAUNCH[launch.launch][1]}>{LAUNCH[launch.launch][0]}</Pill>],
        ]} />
        <ul className="mt-3 space-y-1 text-sm" data-testid="pickem-launch-gates">
          {launch.gates.map((g) => (
            <li key={g.id} data-gate={g.id} data-state={g.state} className={g.state === "PASS" ? "text-ok" : "text-bad"}>
              <span aria-hidden>{g.state === "PASS" ? "✓" : "✕"}</span> <b>{g.label}</b>{g.state === "PASS" ? " · correcto" : ""}
              {g.blockers.length > 0 && <ul className="ml-5 list-disc text-ink-secondary">{g.blockers.slice(0, 8).map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul>}
            </li>
          ))}
        </ul>
        <div className="mt-3 text-sm text-ink-secondary" data-testid="pickem-eligibility-admin">
          <b className="text-white">Elegibilidad para cobrar:</b> {eligibility.policy ?? "sin política"}
          {eligibility.summary === null ? " · no se pudo leer" : Object.keys(eligibility.summary).length === 0 ? " · sin participantes" : (
            <ul className="mt-1 flex flex-wrap gap-2">
              {Object.entries(eligibility.summary).map(([code, n]) => <li key={code}><Pill tone={code === "ELIGIBLE" ? "ok" : "warn"}>{code === "ELIGIBLE" ? "✓" : "ⓘ"} {ELIGIBILITY_LABEL[code as EligibilityCode] ?? code}: {n}</Pill></li>)}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function BracketDetail({ d, onChanged, onEdit }: { d: AdminDetail; onChanged: () => void; onEdit: () => void }) {
  const b = d.bracket;
  const [confirm, setConfirm] = useState<null | { title: string; risk: "MEDIUM" | "HIGH"; body: string; needsReason?: boolean; typed?: string; run: (reason: string) => Promise<unknown> }>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const post = (body: Record<string, unknown>) => adminPost("/api/admin/pickems", body);
  const go = async () => {
    if (!confirm) return;
    setBusy(true); setErr(null);
    try { await confirm.run(reason); setConfirm(null); setReason(""); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="pickem-detail">
      <Panel title={b.title} subtitle={<span className="font-mono">{b.slug}</span>} actions={
        <div className="flex flex-wrap gap-2">
          {b.status === "DRAFT" && <Button variant="ghost" onClick={onEdit}>Editar</Button>}
          {b.status === "DRAFT" && <Button variant="ghost" onClick={() => setConfirm({ title: "Refrescar con la fuente", risk: "MEDIUM", body: "Re-deriva el borrador con lo que hoy publica la fuente (y tus aristas).", run: () => post({ action: "refresh", id: b.id, version: b.version }) })}>Refrescar</Button>}
          {b.status === "DRAFT" && <Button disabled={!d.canPublish} onClick={() => setConfirm({ title: "Publicar Pick'em", risk: "HIGH", body: "Se congela el formato, los puntos y los cierres. Los jugadores podrán predecir. (Las recompensas siguen como estén: revisa abajo.)", typed: b.slug, run: () => post({ action: "publish", id: b.id, version: b.version }) })} data-testid="pickem-publish">Publicar</Button>}
          {b.status === "PUBLISHED" && d.participants === 0 && <Button variant="ghost" onClick={() => setConfirm({ title: "Despublicar", risk: "MEDIUM", body: "Vuelve a borrador (sin jugadores todavía).", run: () => post({ action: "unpublish", id: b.id, version: b.version }) })}>Despublicar</Button>}
          {(b.status === "PUBLISHED" || b.status === "SETTLED") && <Button onClick={() => setConfirm({ title: b.status === "SETTLED" ? "Reliquidar (corrección)" : "Liquidar", risk: "HIGH", needsReason: b.status === "SETTLED", body: "La BD calcula la puntuación final de cada jugador. Exige todos los partidos puntuables con resultado (o anulados) y 12 h de estabilidad. Una reliquidación NO toca reclamos ya hechos.", run: (r) => post({ action: "settle", id: b.id, settlementVersion: b.settlement_version, reason: r || null }) })} data-testid="pickem-settle">{b.status === "SETTLED" ? "Reliquidar" : "Liquidar"}</Button>}
          {(b.status === "DRAFT" || b.status === "PUBLISHED") && <Button variant="danger" onClick={() => setConfirm({ title: "Cancelar Pick'em", risk: "HIGH", needsReason: true, body: "Se conservan los picks; no habrá liquidación ni recompensas.", typed: b.slug, run: (r) => post({ action: "cancel", id: b.id, version: b.version, reason: r }) })}>Cancelar</Button>}
          {b.status === "DRAFT" && <Button variant="danger" onClick={() => setConfirm({ title: "Borrar borrador", risk: "HIGH", body: "Se borra el borrador (auditado).", typed: b.slug, run: () => post({ action: "delete", id: b.id, version: b.version }) })}>Borrar</Button>}
        </div>
      }>
        {d.legacyAuthority && <p className="mb-3 rounded border border-warn/40 p-2 text-sm text-warn" data-testid="pickem-legacy-authority">{"Este evento tiene un Pick'em clásico (LEGACY) con recompensas propias: aquí Pick'ems 2.0 puede publicarse, pero NO activar recompensas (una sola autoridad por evento)."}</p>}
        <KV cols={3} items={[["Sistema", <Pill key="sys" tone="cyan">{"Pick'ems 2.0"}</Pill>], ["Publicación", b.status], ["Liquidación", b.status === "SETTLED" ? `liquidado · v${b.settlement_version}` : "pendiente"], ["Recompensas", `${b.rewards_status} · v${b.rewards_version}`], ["Reglas", d.rulesV1 ? `${REWARD_RULES_V1} (aprobadas)` : "no son las v1 aprobadas"], ["Puntuación", b.scoring_version]]} />
        <div className="mt-3" />
        <KV cols={3} items={[["Estado", <Pill key="s" tone={STATUS_TONE[b.status]}>{b.status}</Pill>], ["Formato", b.formatLabel], ["Evento", b.event_id], ["Partidos", d.nodes.length], ["Puntos máx.", b.max_points], ["Cierre", b.lock_policy === "MATCH" ? "por partido" : "por fase"], ["Jugadores", d.participants], ["Completos / parciales / vacíos", `${d.completion.complete} / ${d.completion.partial} / ${d.completion.empty}`], ["Versión", `${b.version} · liquidación ${b.settlement_version}`], ["Checksum", <span key="c" className="font-mono text-[11px]">{b.descriptor_checksum.slice(0, 16)}…</span>], ["Publicado", dateTime(b.published_at)], ["Liquidado", dateTime(b.settled_at)]]} />
      </Panel>
      <LaunchPanel launch={d.launch} eligibility={d.eligibility} />
      <Panel title="Validador y datos" subtitle="Completitud de los datos reales y coherencia del grafo.">
        <Summary d={d.descriptor} />
        <div className="mt-3"><Issues issues={d.issues} /></div>
        {(d.drift.changed || d.drift.notes.length > 0) && (
          <div className="mt-3 rounded border border-warn/40 p-3 text-sm text-warn" data-testid="pickem-drift">
            <b>La fuente cambió desde lo guardado.</b> {b.status === "DRAFT" ? "Pulsa «Refrescar» antes de publicar." : `Nada se remapea: ${d.drift.affectedPicks} pick(s) afectado(s) quedan como fallos si su equipo ya no juega.`}
            <ul className="mt-1 list-disc pl-5">{d.drift.notes.slice(0, 12).map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
      </Panel>
      <Panel title="Partidos" subtitle="Cierre efectivo = mín(cierre congelado, inicio real). Reabrir solo si el partido real no ha empezado; todo con motivo y auditado.">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-ink-muted"><tr><th className="p-1">Ronda</th><th className="p-1">Partido</th><th className="p-1">Inicio real</th><th className="p-1">Cierre</th><th className="p-1">Estado</th><th className="p-1">Ganador real</th><th className="p-1">Picks</th><th className="p-1">Pts</th><th className="p-1"></th></tr></thead>
            <tbody>
              {d.nodes.map((n) => (
                <tr key={n.matchId} className="border-t border-white/[0.06]">
                  <td className="p-1">{n.roundLabel}</td>
                  <td className="p-1">{n.teamA ?? "TBD"} vs {n.teamB ?? "TBD"} <span className="font-mono text-ink-faint">{n.matchId}</span></td>
                  <td className="p-1">{dateTime(n.start)}</td>
                  <td className="p-1">{dateTime(n.lockAt)}{n.overridden ? " (reprogramado)" : ""}</td>
                  <td className="p-1">{n.voided ? <Pill tone="bad">VOID</Pill> : n.locked ? <Pill>cerrado</Pill> : b.status === "PUBLISHED" ? <Pill tone="cyan">abierto</Pill> : "—"} {n.realStatus}</td>
                  <td className="p-1">{n.winner ?? "—"}</td>
                  <td className="p-1">{n.pickCount}</td>
                  <td className="p-1">{n.points}</td>
                  <td className="p-1 whitespace-nowrap">
                    {b.status === "PUBLISHED" && (
                      <>
                        {!n.locked && <Button variant="ghost" size="sm" onClick={() => setConfirm({ title: `Cerrar ya ${n.matchId}`, risk: "HIGH", needsReason: true, body: "Cierra las predicciones de este partido ahora.", run: (r) => post({ action: "match", id: b.id, matchId: n.matchId, matchAction: "lock_now", reason: r }) })}>Cerrar</Button>}
                        {n.realStatus === "upcoming" && !n.winner && <Button variant="ghost" size="sm" onClick={() => { const until = prompt("Nueva hora de cierre (ISO, futura):", new Date(Date.now() + 3_600_000).toISOString()); if (until) setConfirm({ title: `Reprogramar ${n.matchId}`, risk: "HIGH", needsReason: true, body: `Reabre/mueve el cierre a ${until} (nunca más tarde que el inicio real).`, run: (r) => post({ action: "match", id: b.id, matchId: n.matchId, matchAction: "reschedule", until, reason: r }) }); }}>Reprogramar</Button>}
                        <Button variant="ghost" size="sm" onClick={() => setConfirm({ title: `${n.voided ? "Quitar VOID" : "Anular (VOID)"} ${n.matchId}`, risk: "HIGH", needsReason: true, body: n.voided ? "Vuelve a puntuar." : "No suma ni resta, sale del máximo y no rompe el perfecto.", run: (r) => post({ action: "match", id: b.id, matchId: n.matchId, matchAction: n.voided ? "unvoid" : "void", reason: r }) })}>{n.voided ? "Quitar VOID" : "VOID"}</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <RewardsEditor d={d} onChanged={onChanged} />
      <Panel title="Auditoría" dense>
        {d.audit.length === 0 ? <p className="text-sm text-ink-muted">Sin acciones.</p> : (
          <ul className="space-y-1 text-[12px]">{d.audit.map((a, i) => <li key={i}><span className="text-ink-muted">{dateTime(a.at)}</span> · <b>{a.action}</b> · {a.actorName ?? "—"}{typeof a.detail?.reason === "string" ? ` · «${a.detail.reason}»` : ""}</li>)}</ul>
        )}
      </Panel>
      <ConfirmDialog open={!!confirm} onClose={() => { setConfirm(null); setErr(null); }} onConfirm={go} title={confirm?.title ?? ""} risk={confirm?.risk ?? "MEDIUM"} busy={busy} error={err} typeToConfirm={confirm?.typed}
        canConfirm={!confirm?.needsReason || reason.trim().length >= 8} confirmLabel="Confirmar">
        <p className="text-sm">{confirm?.body}</p>
        {confirm?.needsReason && <Field label="Motivo (mín. 8)" htmlFor="pk-reason"><Input id="pk-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </ConfirmDialog>
    </div>
  );
}

function RewardsEditor({ d, onChanged }: { d: AdminDetail; onChanged: () => void }) {
  const [cfg, setCfg] = useState<BracketRewardConfig>(d.rewards);
  const [status, setStatus] = useState<string>(d.rewards.status);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const e = d.economy;
  const tiers = useMemo(() => TIER_ORDER.map((id) => cfg.tiers.find((t) => t.id === id) ?? null), [cfg]);
  const setTier = (id: RewardTierId, patch: Partial<NonNullable<(typeof tiers)[number]>> | null) => setCfg((c) => {
    const rest = c.tiers.filter((t) => t.id !== id);
    if (patch === null) return { ...c, tiers: rest };
    const cur = c.tiers.find((t) => t.id === id) ?? { id, minRatio: id === "GOOD" ? 0.5 : id === "GREAT" ? 0.7 : id === "ELITE" ? 0.85 : null, reward: { packId: "estandar", packCount: 1 } };
    return { ...c, tiers: [...rest, { ...cur, ...patch, reward: { ...cur.reward, ...(patch.reward ?? {}) } }] };
  });
  const [confirmActive, setConfirmActive] = useState(false);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await adminPost("/api/admin/pickems", { action: "rewards", id: d.bracket.id, rewardsVersion: d.bracket.rewards_version, rewards: cfg, rewardsStatus: status, ack: status === "ACTIVE" ? ack : false });
      setMsg({ ok: true, text: "Guardado (auditado)." }); setConfirmActive(false); onChanged();
    } catch (er) { setMsg({ ok: false, text: er instanceof Error ? er.message : "Error" }); } finally { setBusy(false); }
  };
  const load = async () => {
    const r = await adminPost<{ rewards: BracketRewardConfig }>("/api/admin/pickems", { action: "proposeRewards", id: d.bracket.id });
    setCfg({ ...r.rewards, version: cfg.version }); setStatus("DRAFT");
  };
  return (
    <Panel title="Recompensas" tone="gold" subtitle="Solo sobres/cartas del catálogo e insignias insignia:pickem:*. Se congelan al primer cierre. ACTIVAS exige aceptar el pasivo.">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={d.rewards.status === "ACTIVE" ? "gold" : "default"}>Actual: {d.rewards.status} · v{d.bracket.rewards_version}</Pill>
        <Button variant="ghost" size="sm" onClick={load} data-testid="pickem-load-v1">Cargar reglas v1 aprobadas</Button>
        <label className="text-sm">Participación mínima <Input type="number" step="0.05" min="0.5" max="1" value={cfg.minCompletion} onChange={(ev) => setCfg({ ...cfg, minCompletion: Number(ev.target.value) })} className="inline-block w-24" /></label>
      </div>
      <table className="mt-3 w-full text-left text-[12px]">
        <thead className="text-ink-muted"><tr><th className="p-1">Escalón</th><th className="p-1">Listón</th><th className="p-1">Sobre</th><th className="p-1">Nº</th><th className="p-1">Insignia</th><th className="p-1">Valor</th><th className="p-1"></th></tr></thead>
        <tbody>
          {TIER_ORDER.map((id, i) => {
            const t = tiers[i];
            const value = e.perTier.find((x) => x.id === id)?.value;
            return (
              <tr key={id} className="border-t border-white/[0.06]">
                <td className="p-1 font-bold">{TIER_LABEL[id]}</td>
                <td className="p-1">{t && (id === "GOOD" || id === "GREAT" || id === "ELITE") ? <Input type="number" step="0.05" value={t.minRatio ?? 0} onChange={(ev) => setTier(id, { minRatio: Number(ev.target.value) })} className="w-20" /> : id === "PARTICIPATION" ? "completitud" : id === "PERFECT" ? "todo acertado" : "—"}</td>
                <td className="p-1">{t && <Select value={t.reward.packId ?? ""} onChange={(ev) => setTier(id, { reward: { packId: ev.target.value || null } })}><option value="">—</option>{PACKS.map((p) => <option key={p} value={p}>{p}</option>)}</Select>}</td>
                <td className="p-1">{t && <Input type="number" min="1" max="3" value={t.reward.packCount ?? 1} onChange={(ev) => setTier(id, { reward: { packCount: Number(ev.target.value) } })} className="w-16" />}</td>
                <td className="p-1">{t && <Input value={(t.reward.cosmetics ?? []).join(",")} placeholder="insignia:pickem:…" onChange={(ev) => setTier(id, { reward: { cosmetics: ev.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} className="w-64" />}</td>
                <td className="p-1">{value !== undefined ? fmt(value) : "—"}</td>
                <td className="p-1">{t ? <Button variant="ghost" size="sm" onClick={() => setTier(id, null)}>Quitar</Button> : <Button variant="ghost" size="sm" onClick={() => setTier(id, {})}>Añadir</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.rewardIssues.length > 0 && <ul className="mt-2 text-[12px]">{d.rewardIssues.map((i, k) => <li key={k} className={i.severity === "ERROR" ? "text-bad" : "text-warn"}>{i.severity} · {i.message}</li>)}</ul>}
      <div className="mt-3">
        <KV cols={3} items={[["Escalón más caro", fmt(e.maxTierValue)], ["Peor caso (jugadores actuales)", fmt(e.worstCaseParticipants)], ["Peor caso (1.000 jugadores)", fmt(e.worstCase1000)], ["Valor provisional repartido", e.provisionalValue === null ? "—" : fmt(e.provisionalValue)]]} />
        {e.simulation.length > 0 && (
          <table className="mt-2 w-full text-left text-[12px]" data-testid="pickem-economy">
            <thead className="text-ink-muted"><tr><th className="p-1">Precisión</th><th className="p-1">Nada</th>{TIER_ORDER.map((t) => <th key={t} className="p-1">{TIER_LABEL[t]}</th>)}<th className="p-1">Tasa de perfecto</th><th className="p-1">Valor esperado</th></tr></thead>
            <tbody>{e.simulation.map((s) => <tr key={s.accuracy} className="border-t border-white/[0.06]"><td className="p-1">{pct(s.accuracy, 0)}</td><td className="p-1">{pct(s.dist.NONE)}</td>{TIER_ORDER.map((t) => <td key={t} className="p-1">{pct(s.dist[t])}</td>)}<td className="p-1">{pct(s.perfectRate, 2)}</td><td className="p-1">{fmt(s.ev)}</td></tr>)}</tbody>
          </table>
        )}
        {e.warnings.map((w, i) => <p key={i} className="text-[12px] text-warn">⚠ {w}</p>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(ev) => setStatus(ev.target.value)} className="w-40"><option value="OFF">OFF</option><option value="DRAFT">BORRADOR</option><option value="ACTIVE">ACTIVAS</option></Select>
        <Button disabled={busy || d.bracket.status === "SETTLED" || d.bracket.status === "CANCELLED" || (status === "ACTIVE" && d.activationBlockers.length > 0)} onClick={() => (status === "ACTIVE" ? setConfirmActive(true) : save())} data-testid="pickem-save-rewards">Guardar recompensas</Button>
        {msg && <span className={msg.ok ? "text-sm text-ok" : "text-sm text-bad"}>{msg.text}</span>}
      </div>
      {d.activationBlockers.length > 0 && (
        <div className="mt-3 text-[12px]" data-testid="pickem-activation-blockers">
          <p className="font-bold text-ink-primary">Para ACTIVAR falta:</p>
          <ul className="list-disc pl-5 text-warn">{d.activationBlockers.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      <ConfirmDialog open={confirmActive} onClose={() => setConfirmActive(false)} onConfirm={save} title="Activar recompensas" risk="CRITICAL" busy={busy} error={msg && !msg.ok ? msg.text : null}
        typeToConfirm={d.bracket.slug} canConfirm={ack} confirmLabel="Activar">
        <div className="space-y-2 text-sm" data-testid="pickem-activate-summary">
          <p><b>{d.bracket.title}</b> · {d.bracket.event_id} · reglas {cfg.rulesVersion ?? "—"} · versión de recompensas {d.bracket.rewards_version + 1}</p>
          <ul className="list-disc pl-5">{TIER_ORDER.map((id) => { const t = cfg.tiers.find((x) => x.id === id); return t ? <li key={id}>{TIER_LABEL[id]} — {describeTierReward(t.reward, packLabel).join(" + ")}</li> : null; })}</ul>
          <p>Máximo por jugador: <b>{fmt(e.maxTierValue)}</b> (+ insignia si es perfecto). Peor caso con 1.000 jugadores: {fmt(e.worstCase1000)}. Un solo escalón por jugador (el más alto).</p>
          <p data-testid="pickem-activate-eligibility">Elegibilidad para cobrar: <b>{cfg.eligibilityPolicy ?? "ninguna (no se puede activar)"}</b> · {requirementText(policyOf(cfg.eligibilityPolicy))} Cualquiera puede predecir y salir en la clasificación.</p>
          <p className="text-warn">Se congelan al primer cierre de predicción. Publicar y activar son decisiones distintas.</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(ev) => setAck(ev.target.checked)} data-testid="pickem-ack" /> Acepto el pasivo y las reglas</label>
        </div>
      </ConfirmDialog>
    </Panel>
  );
}
