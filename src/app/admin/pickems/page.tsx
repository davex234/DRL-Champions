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
import { ns, td as i18nTd } from "@/i18n/runtime";
import { roundText } from "@/lib/bracket/roundText";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const i18nT = ns("admin");

type ListData = { brackets: AdminBracketRow[]; legacy: AdminLegacyRow[]; events: { id: string; name: string; status: string; stages: { id: string; name: string; kind: string | null; matches: number; detected: string | null }[] }[]; sync: { lastSuccessAt: string | null; lastStatus: string | null; consecutiveFailures: number; lastAttemptAt: string | null } };
interface Edge { from: string; to: string; source: "WINNER" | "LOSER"; slot: 1 | 2 | null }
interface Draft { id: string | null; version: number | null; eventId: string; stageIds: string[]; kind: string; slug: string; title: string; lockPolicy: "MATCH" | "STAGE"; adminEdges: Edge[] }
const STATUS_TONE: Record<string, "default" | "cyan" | "gold" | "ok" | "warn" | "bad"> = { DRAFT: "default", PUBLISHED: "cyan", SETTLED: "ok", CANCELLED: "bad" };
const PACKS = ["estandar", "premium", "oro", "masters", "champions", "icon"];

export default function AdminPickemsPage() {
  useLocale();
  const list = useAdminQuery<ListData>("/api/admin/pickems");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const detail = useAdminQuery<AdminDetail>(selected ? `/api/admin/pickems?id=${selected}` : null);
  return (
    <div>
      <PageHeader eyebrow={i18nT("Juego")} title={i18nT("Pick'ems 2.0")} description={i18nT("Cuadros de predicción sobre eventos esports REALES. Nada se publica ni se premia solo: borrador → validador → publicar; recompensas apagadas hasta aprobar su economía.")}
        actions={<Button onClick={() => { setSelected(null); setDraft({ id: null, version: null, eventId: "", stageIds: [], kind: "", slug: "", title: "", lockPolicy: "MATCH", adminEdges: [] }); }} data-testid="pickem-new">{i18nT("Nuevo borrador")}</Button>} />
      {list.data && <SyncPanel s={list.data.sync} />}
      {draft && list.data && <DraftEditor key={draft.id ?? "new"} initial={draft} events={list.data.events} onClose={() => setDraft(null)} onSaved={(id) => { setDraft(null); list.reload(); setSelected(id); detail.reload(); }} />}
      <Panel title={i18nT("Pick'ems")} subtitle={i18nT("Un borrador solo existe aquí; un publicado con jugadores no se despublica (se cancela con motivo).")}>
        {list.loading && <Loading />}
        {list.error && <ErrorBox error={i18nTd(list.error)} onRetry={list.reload} />}
        {list.data && (list.data.brackets.length === 0 ? <Empty title={i18nT("Sin Pick'ems 2.0")}>{i18nT("Crea un borrador desde un evento real.")}</Empty> : (
          <ul className="divide-y divide-white/[0.06]" data-testid="admin-pickems">
            {list.data.brackets.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => { setDraft(null); setSelected(b.id); }} className="nx-focus flex w-full flex-wrap items-center gap-3 px-2 py-3 text-left hover:bg-white/[0.04]" data-slug={b.slug}>
                  <Pill tone="cyan">2.0</Pill>
                  <Pill tone={STATUS_TONE[b.status] ?? "default"}>{i18nTd(b.status)}</Pill>
                  <span className="min-w-0 flex-1 truncate font-bold text-ink-primary">{i18nTd(b.title)} <span className="font-mono text-[12px] text-ink-faint">{b.slug}</span></span>
                  <span className="text-[12px] text-ink-muted">{i18nT("{formato} · {partidos} partidos · {jugadores} jugadores", { formato: i18nTd(b.formatLabel), partidos: b.nodes, jugadores: b.participants })}</span>
                  <Pill tone={b.rewardsStatus === "ACTIVE" ? "gold" : "default"}>{i18nT("Recompensas {estado}", { estado: i18nTd(b.rewardsStatus) })}</Pill>
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
          {detail.error && <ErrorBox error={i18nTd(detail.error)} onRetry={detail.reload} />}
          {detail.data && <BracketDetail d={detail.data} onChanged={() => { detail.reload(); list.reload(); }}
            onEdit={() => setDraft({ id: detail.data!.bracket.id, version: detail.data!.bracket.version, eventId: detail.data!.bracket.event_id, stageIds: detail.data!.bracket.stage_ids, kind: detail.data!.bracket.format_kind, slug: detail.data!.bracket.slug, title: detail.data!.bracket.title, lockPolicy: detail.data!.bracket.lock_policy, adminEdges: (detail.data!.bracket.admin_edges as Edge[]) ?? [] })} />}
        </div>
      )}
    </div>
  );
}

/** F87.1 · Pick'ems CLÁSICOS (0012): solo lectura. Desde el corte (0072) no se crean ni se predicen nuevos; los anteriores conservan sus reglas. */
function LegacyPanel({ rows }: { rows: AdminLegacyRow[] }) {
  useLocale();
  return (
    <Panel title={i18nT("Pick'ems clásicos (LEGACY)")} subtitle={i18nT("Anteriores al corte F87.1: conservan sus predicciones, puntos y recompensas históricas. No se crean nuevos; las recompensas futuras son de Pick'ems 2.0.")} dense>
      {rows.length === 0 ? <p className="text-sm text-ink-muted">{i18nT("Ninguno.")}</p> : (
        <ul className="divide-y divide-white/[0.06]" data-testid="admin-legacy-pickems">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-2 py-2 text-sm" data-legacy-mode={r.legacyMode}>
              <Pill tone="gold">{i18nT("LEGACY")}</Pill>
              <Pill tone={r.legacyMode === "LEGACY_V1" ? "warn" : "default"}>{r.legacyMode === "LEGACY_V1" ? i18nT("Reglas legacy vigentes") : i18nT("Retirado")}</Pill>
              <span className="min-w-0 flex-1 truncate font-bold text-ink-primary">{i18nTd(r.eventName) ?? r.eventId} <span className="font-mono text-[12px] text-ink-faint">{r.eventId}</span></span>
              <span className="text-[12px] text-ink-muted">{i18nT("{estado} · {preguntas} preguntas ({abiertas} abiertas) · {participantes} participantes · {pagadas} recompensas pagadas", { estado: i18nTd(r.status), preguntas: r.questions, abiertas: r.openQuestions, participantes: r.submissions, pagadas: r.rewardsPaid })}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SyncPanel({ s }: { s: ListData["sync"] }) {
  useLocale();
  return (
    <Panel title={i18nT("Worker esports (solo lectura)")} dense>
      <KV cols={3} items={[[i18nT("Último éxito"), dateTime(s.lastSuccessAt)], [i18nT("Último intento"), dateTime(s.lastAttemptAt)], [i18nT("Estado"), <span key="s">{i18nTd(s.lastStatus) ?? "—"}{s.consecutiveFailures ? i18nT(" · {consecutiveFailures} fallos seguidos", { consecutiveFailures: s.consecutiveFailures }) : ""}</span>]]} />
    </Panel>
  );
}

function Issues({ issues }: { issues: FormatIssue[] }) {
  useLocale();
  if (!issues.length) return <p className="text-sm text-ok">{i18nT("✓ Sin problemas: el validador lo deja publicar.")}</p>;
  return (
    <ul className="space-y-1 text-sm" data-testid="pickem-issues">
      {issues.map((i, k) => <li key={k} className={i.severity === "ERROR" ? "text-bad" : "text-warn"}><b>{i.severity === "ERROR" ? i18nT("ERROR") : i18nT("AVISO")}</b> · {i.code} · {i18nTd(i.message)}</li>)}
    </ul>
  );
}

function Summary({ d }: { d: FormatDescriptor }) {
  useLocale();
  const by = (o: string) => d.edges.filter((e) => e.origin === o).length;
  return <KV cols={3} items={[[i18nT("Formato"), d.kind], [i18nT("Partidos"), d.nodes.length], [i18nT("Secciones"), d.sections.map((s) => s.label).join(", ")], [i18nT("Aristas de la fuente"), by("SOURCE")], [i18nT("Derivadas del formato"), by("FORMAT_DERIVED")], [i18nT("De admin"), by("ADMIN")], [i18nT("Plazas"), d.qualifications.length], [i18nT("Puntos máx."), d.nodes.reduce((s, n) => s + n.points, 0)], [i18nT("Entrada"), d.nodes.filter((n) => n.seeds).length]]} />;
}

function DraftEditor({ initial, events, onClose, onSaved }: { initial: Draft; events: ListData["events"]; onClose: () => void; onSaved: (id: string) => void }) {
  useLocale();
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
    } catch (e) { setErr(e instanceof Error ? e.message : i18nT("Error")); } finally { setBusy(false); }
  };
  return (
    <Panel title={f.id ? i18nT("Editar borrador") : i18nT("Nuevo borrador")} subtitle={i18nT("El formato y el grafo se derivan de los datos reales. Solo se añaden aristas donde la fuente no las publica.")} actions={<Button variant="ghost" onClick={onClose}>{i18nT("Cerrar")}</Button>}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={i18nT("Evento real")} htmlFor="pk-ev">
          <Select id="pk-ev" value={f.eventId} disabled={!!f.id} onChange={(e) => { setF({ ...f, eventId: e.target.value, stageIds: [] }); setPreview(null); }}>
            <option value="">{i18nT("— elige —")}</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} ({i18nTd(e.status)})</option>)}
          </Select>
        </Field>
        <Field label={i18nT("Fases (ámbito)")} htmlFor="pk-st" hint={i18nT("Grupos y playoffs van en ámbitos separados: la fuente no publica qué clasificado ocupa qué hueco.")}>
          <div id="pk-st" className="space-y-1">
            {(ev?.stages ?? []).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!!f.id} checked={f.stageIds.includes(s.id)} onChange={(e) => { setF({ ...f, stageIds: e.target.checked ? [...f.stageIds, s.id] : f.stageIds.filter((x) => x !== s.id) }); setPreview(null); }} />
                {fill(i18nT("{nombre} · {n} partidos · detectado: {formato}", { nombre: s.name, n: s.matches, ...slots("formato") }), { formato: <b>{i18nTd(s.detected) ?? i18nT("desconocido")}</b> })}
              </label>
            ))}
          </div>
        </Field>
        <Field label={i18nT("Slug")} htmlFor="pk-slug"><Input id="pk-slug" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} placeholder={i18nT("champions-2026-playoffs")} /></Field>
        <Field label={i18nT("Título")} htmlFor="pk-title"><Input id="pk-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={i18nT("Champions 2026 · Playoffs")} /></Field>
        <Field label={i18nT("Cierre")} htmlFor="pk-lock" hint={i18nT("Por partido (recomendado): cada predicción cierra cuando empieza SU partido.")}>
          <Select id="pk-lock" value={f.lockPolicy} onChange={(e) => setF({ ...f, lockPolicy: e.target.value as Draft["lockPolicy"] })}>
            <option value="MATCH">{i18nT("Por partido")}</option><option value="STAGE">{i18nT("Por fase (todo cierra con el primer partido)")}</option>
          </Select>
        </Field>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-sm font-bold text-ink-primary">{i18nT("Aristas de admin ({n}) — solo sobre partidos REALES; contradecir a la fuente es un error", { n: f.adminEdges.length })}</p>
        {f.adminEdges.map((e, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm" data-testid="pickem-admin-edge">
            <NodeSelect nodes={nodes} value={e.from} onChange={(v) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, from: v } : x)) })} />
            <Select value={e.source} onChange={(ev2) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, source: ev2.target.value as Edge["source"] } : x)) })} className="w-32"><option value="WINNER">{i18nT("ganador →")}</option><option value="LOSER">{i18nT("perdedor →")}</option></Select>
            <NodeSelect nodes={nodes} value={e.to} onChange={(v) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, to: v } : x)) })} />
            <Select value={String(e.slot ?? "")} onChange={(ev2) => setF({ ...f, adminEdges: f.adminEdges.map((x, k) => (k === i ? { ...x, slot: ev2.target.value === "1" ? 1 : ev2.target.value === "2" ? 2 : null } : x)) })} className="w-28"><option value="">{i18nT("hueco libre")}</option><option value="1">{i18nT("hueco 1")}</option><option value="2">{i18nT("hueco 2")}</option></Select>
            <Button variant="ghost" size="sm" onClick={() => setF({ ...f, adminEdges: f.adminEdges.filter((_, k) => k !== i) })}>{i18nT("Quitar")}</Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setF({ ...f, adminEdges: [...f.adminEdges, { from: "", to: "", source: "LOSER", slot: null }] })}>{i18nT("Añadir arista")}</Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy || !f.eventId || !f.stageIds.length} onClick={() => run("preview")} data-testid="pickem-preview">{i18nT("Vista previa y validar")}</Button>
        <Button disabled={busy || !preview?.descriptor} onClick={() => run(f.id ? "update" : "create")} data-testid="pickem-save">{f.id ? i18nT("Guardar borrador") : i18nT("Crear borrador")}</Button>
      </div>
      {err && <p className="mt-2 text-sm text-bad" role="alert">{i18nTd(err)}</p>}
      {preview && (
        <div className="mt-4 space-y-3">
          {preview.descriptor ? <Summary d={preview.descriptor} /> : <p className="text-sm text-bad">{i18nT("No se puede derivar:")} {i18nTd(preview.issues[0]?.message)}</p>}
          <Issues issues={preview.issues} />
          <p className="text-[12px] text-ink-muted">{i18nT("Un borrador puede guardarse con errores; NO se puede publicar hasta que el validador quede limpio.")}</p>
        </div>
      )}
    </Panel>
  );
}

function NodeSelect({ nodes, value, onChange }: { nodes: FormatDescriptor["nodes"]; value: string; onChange: (v: string) => void }) {
  useLocale();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-64">
      <option value="">{i18nT("— partido —")}</option>
      {nodes.map((n) => <option key={n.matchId} value={n.matchId}>{roundText(n.roundLabel)} · {n.matchId}</option>)}
    </Select>
  );
}

/** F87.2 · preparación de lanzamiento: tres estados y cada puerta con su motivo (texto + símbolo, nunca solo color). */
function LaunchPanel({ launch, eligibility }: { launch: LaunchReadiness; eligibility: AdminDetail["eligibility"] }) {
  useLocale();
  const LAUNCH: Record<LaunchReadiness["launch"], [string, "ok" | "warn" | "bad"]> = {
    READY_WITH_REWARDS: [i18nT("✓ Listo para lanzar con recompensas"), "ok"], READY_WITHOUT_REWARDS: [i18nT("✓ Listo para publicar sin recompensas"), "ok"], NOT_READY: [i18nT("✕ No listo"), "bad"],
  };
  const rew: Record<LaunchReadiness["rewards"], [string, "default" | "ok" | "bad"]> = { OFF: [i18nT("Recompensas OFF"), "default"], READY: [i18nT("✓ Recompensas listas"), "ok"], NOT_READY: [i18nT("✕ Recompensas no listas"), "bad"] };
  return (
    <Panel title={i18nT("Preparación de lanzamiento")} subtitle={i18nT("Publicar exige estructura, fuente, cierres y puntuación. Con recompensas, además recompensas, economía, legacy y tiempo.")}>
      <div data-testid="pickem-launch" data-structure={launch.structure} data-rewards={launch.rewards} data-launch={launch.launch}>
        <KV cols={3} items={[
          [i18nT("Estructura"), <Pill key="st" tone={launch.structure === "READY" ? "ok" : "bad"}>{launch.structure === "READY" ? i18nT("✓ LISTA") : i18nT("✕ NO LISTA")}</Pill>],
          [i18nT("Recompensas"), <Pill key="rw" tone={rew[launch.rewards][1]}>{i18nTd(rew[launch.rewards][0])}</Pill>],
          [i18nT("Lanzamiento"), <Pill key="la" tone={LAUNCH[launch.launch][1]}>{i18nTd(LAUNCH[launch.launch][0])}</Pill>],
        ]} />
        <ul className="mt-3 space-y-1 text-sm" data-testid="pickem-launch-gates">
          {launch.gates.map((g) => (
            <li key={g.id} data-gate={g.id} data-state={g.state} className={g.state === "PASS" ? "text-ok" : "text-bad"}>
              <span aria-hidden>{g.state === "PASS" ? "✓" : "✕"}</span> <b>{i18nTd(g.label)}</b>{g.state === "PASS" ? (" " + i18nT("· correcto")) : ""}
              {g.blockers.length > 0 && <ul className="ml-5 list-disc text-ink-secondary">{g.blockers.slice(0, 8).map((b, i) => <li key={i} className="break-words">{i18nTd(b)}</li>)}</ul>}
            </li>
          ))}
        </ul>
        <div className="mt-3 text-sm text-ink-secondary" data-testid="pickem-eligibility-admin">
          <b className="text-white">{i18nT("Elegibilidad para cobrar:")}</b> {i18nTd(eligibility.policy) ?? i18nT("sin política")}
          {eligibility.summary === null ? (" " + i18nT("· no se pudo leer")) : Object.keys(eligibility.summary).length === 0 ? (" " + i18nT("· sin participantes")) : (
            <ul className="mt-1 flex flex-wrap gap-2">
              {Object.entries(eligibility.summary).map(([code, n]) => <li key={code}><Pill tone={code === "ELIGIBLE" ? "ok" : "warn"}>{code === "ELIGIBLE" ? "✓" : "ⓘ"} {i18nTd(ELIGIBILITY_LABEL[code as EligibilityCode]) ?? code}: {n}</Pill></li>)}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function BracketDetail({ d, onChanged, onEdit }: { d: AdminDetail; onChanged: () => void; onEdit: () => void }) {
  useLocale();
  const b = d.bracket;
  const [confirm, setConfirm] = useState<null | { title: string; risk: "MEDIUM" | "HIGH"; body: string; needsReason?: boolean; typed?: string; run: (reason: string) => Promise<unknown> }>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const post = (body: Record<string, unknown>) => adminPost("/api/admin/pickems", body);
  const go = async () => {
    if (!confirm) return;
    setBusy(true); setErr(null);
    try { await confirm.run(reason); setConfirm(null); setReason(""); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : i18nT("Error")); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4" data-testid="pickem-detail">
      <Panel title={i18nTd(b.title)} subtitle={<span className="font-mono">{b.slug}</span>} actions={
        <div className="flex flex-wrap gap-2">
          {b.status === "DRAFT" && <Button variant="ghost" onClick={onEdit}>{i18nT("Editar")}</Button>}
          {b.status === "DRAFT" && <Button variant="ghost" onClick={() => setConfirm({ title: i18nT("Refrescar con la fuente"), risk: "MEDIUM", body: i18nT("Re-deriva el borrador con lo que hoy publica la fuente (y tus aristas)."), run: () => post({ action: "refresh", id: b.id, version: b.version }) })}>{i18nT("Refrescar")}</Button>}
          {b.status === "DRAFT" && <Button disabled={!d.canPublish} onClick={() => setConfirm({ title: i18nT("Publicar Pick'em"), risk: "HIGH", body: i18nT("Se congela el formato, los puntos y los cierres. Los jugadores podrán predecir. (Las recompensas siguen como estén: revisa abajo.)"), typed: b.slug, run: () => post({ action: "publish", id: b.id, version: b.version }) })} data-testid="pickem-publish">{i18nT("Publicar")}</Button>}
          {b.status === "PUBLISHED" && d.participants === 0 && <Button variant="ghost" onClick={() => setConfirm({ title: i18nT("Despublicar"), risk: "MEDIUM", body: i18nT("Vuelve a borrador (sin jugadores todavía)."), run: () => post({ action: "unpublish", id: b.id, version: b.version }) })}>{i18nT("Despublicar")}</Button>}
          {(b.status === "PUBLISHED" || b.status === "SETTLED") && <Button onClick={() => setConfirm({ title: b.status === "SETTLED" ? i18nT("Reliquidar (corrección)") : i18nT("Liquidar"), risk: "HIGH", needsReason: b.status === "SETTLED", body: i18nT("La BD calcula la puntuación final de cada jugador. Exige todos los partidos puntuables con resultado (o anulados) y 12 h de estabilidad. Una reliquidación NO toca reclamos ya hechos."), run: (r) => post({ action: "settle", id: b.id, settlementVersion: b.settlement_version, reason: r || null }) })} data-testid="pickem-settle">{b.status === "SETTLED" ? i18nT("Reliquidar") : i18nT("Liquidar")}</Button>}
          {(b.status === "DRAFT" || b.status === "PUBLISHED") && <Button variant="danger" onClick={() => setConfirm({ title: i18nT("Cancelar Pick'em"), risk: "HIGH", needsReason: true, body: i18nT("Se conservan los picks; no habrá liquidación ni recompensas."), typed: b.slug, run: (r) => post({ action: "cancel", id: b.id, version: b.version, reason: r }) })}>{i18nT("Cancelar")}</Button>}
          {b.status === "DRAFT" && <Button variant="danger" onClick={() => setConfirm({ title: i18nT("Borrar borrador"), risk: "HIGH", body: i18nT("Se borra el borrador (auditado)."), typed: b.slug, run: () => post({ action: "delete", id: b.id, version: b.version }) })}>{i18nT("Borrar")}</Button>}
        </div>
      }>
        {d.legacyAuthority && <p className="mb-3 rounded border border-warn/40 p-2 text-sm text-warn" data-testid="pickem-legacy-authority">{i18nT("Este evento tiene un Pick'em clásico (LEGACY) con recompensas propias: aquí Pick'ems 2.0 puede publicarse, pero NO activar recompensas (una sola autoridad por evento).")}</p>}
        <KV cols={3} items={[[i18nT("Sistema"), <Pill key="sys" tone="cyan">{i18nT("Pick'ems 2.0")}</Pill>], [i18nT("Publicación"), b.status], [i18nT("Liquidación"), b.status === "SETTLED" ? i18nT("liquidado · v{v}", { v: b.settlement_version }) : i18nT("pendiente")], [i18nT("Recompensas"), `${b.rewards_status} · v${b.rewards_version}`], [i18nT("Reglas"), d.rulesV1 ? i18nT("{reglas} (aprobadas)", { reglas: REWARD_RULES_V1 }) : i18nT("no son las v1 aprobadas")], [i18nT("Puntuación"), b.scoring_version]]} />
        <div className="mt-3" />
        <KV cols={3} items={[[i18nT("Estado"), <Pill key="s" tone={STATUS_TONE[b.status]}>{i18nTd(b.status)}</Pill>], [i18nT("Formato"), b.formatLabel], [i18nT("Evento"), b.event_id], [i18nT("Partidos"), d.nodes.length], [i18nT("Puntos máx."), b.max_points], [i18nT("Cierre"), b.lock_policy === "MATCH" ? i18nT("por partido") : i18nT("por fase")], [i18nT("Jugadores"), d.participants], [i18nT("Completos / parciales / vacíos"), `${d.completion.complete} / ${d.completion.partial} / ${d.completion.empty}`], [i18nT("Versión"), i18nT("{version} · liquidación {settlement_version}", { version: b.version, settlement_version: b.settlement_version })], [i18nT("Checksum"), <span key="c" className="font-mono text-[11px]">{b.descriptor_checksum.slice(0, 16)}…</span>], [i18nT("Publicado"), dateTime(b.published_at)], [i18nT("Liquidado"), dateTime(b.settled_at)]]} />
      </Panel>
      <LaunchPanel launch={d.launch} eligibility={d.eligibility} />
      <Panel title={i18nT("Validador y datos")} subtitle={i18nT("Completitud de los datos reales y coherencia del grafo.")}>
        <Summary d={d.descriptor} />
        <div className="mt-3"><Issues issues={d.issues} /></div>
        {(d.drift.changed || d.drift.notes.length > 0) && (
          <div className="mt-3 rounded border border-warn/40 p-3 text-sm text-warn" data-testid="pickem-drift">
            <b>{i18nT("La fuente cambió desde lo guardado.")}</b> {b.status === "DRAFT" ? i18nT("Pulsa «Refrescar» antes de publicar.") : i18nT("Nada se remapea: {affectedPicks} pick(s) afectado(s) quedan como fallos si su equipo ya no juega.", { affectedPicks: d.drift.affectedPicks })}
            <ul className="mt-1 list-disc pl-5">{d.drift.notes.slice(0, 12).map((n, i) => <li key={i}>{i18nTd(n)}</li>)}</ul>
          </div>
        )}
      </Panel>
      <Panel title={i18nT("Partidos")} subtitle={i18nT("Cierre efectivo = mín(cierre congelado, inicio real). Reabrir solo si el partido real no ha empezado; todo con motivo y auditado.")}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead className="text-ink-muted"><tr><th className="p-1">{i18nT("Ronda")}</th><th className="p-1">{i18nT("Partido")}</th><th className="p-1">{i18nT("Inicio real")}</th><th className="p-1">{i18nT("Cierre")}</th><th className="p-1">{i18nT("Estado")}</th><th className="p-1">{i18nT("Ganador real")}</th><th className="p-1">{i18nT("Picks")}</th><th className="p-1">{i18nT("Pts")}</th><th className="p-1"></th></tr></thead>
            <tbody>
              {d.nodes.map((n) => (
                <tr key={n.matchId} className="border-t border-white/[0.06]">
                  <td className="p-1">{roundText(n.roundLabel)}</td>
                  <td className="p-1">{i18nTd(n.teamA) ?? i18nT("TBD")} {i18nT("vs")} {i18nTd(n.teamB) ?? i18nT("TBD")} <span className="font-mono text-ink-faint">{n.matchId}</span></td>
                  <td className="p-1">{dateTime(n.start)}</td>
                  <td className="p-1">{dateTime(n.lockAt)}{n.overridden ? (" " + i18nT("(reprogramado)")) : ""}</td>
                  <td className="p-1">{n.voided ? <Pill tone="bad">{i18nT("VOID")}</Pill> : n.locked ? <Pill>{i18nT("cerrado")}</Pill> : b.status === "PUBLISHED" ? <Pill tone="cyan">{i18nT("abierto")}</Pill> : "—"} {i18nTd(n.realStatus)}</td>
                  <td className="p-1">{n.winner ?? "—"}</td>
                  <td className="p-1">{n.pickCount}</td>
                  <td className="p-1">{n.points}</td>
                  <td className="p-1 whitespace-nowrap">
                    {b.status === "PUBLISHED" && (
                      <>
                        {!n.locked && <Button variant="ghost" size="sm" onClick={() => setConfirm({ title: i18nT("Cerrar ya {matchId}", { matchId: n.matchId }), risk: "HIGH", needsReason: true, body: i18nT("Cierra las predicciones de este partido ahora."), run: (r) => post({ action: "match", id: b.id, matchId: n.matchId, matchAction: "lock_now", reason: r }) })}>{i18nT("Cerrar")}</Button>}
                        {n.realStatus === "upcoming" && !n.winner && <Button variant="ghost" size="sm" onClick={() => { const until = prompt(i18nT("Nueva hora de cierre (ISO, futura):"), new Date(Date.now() + 3_600_000).toISOString()); if (until) setConfirm({ title: i18nT("Reprogramar {matchId}", { matchId: n.matchId }), risk: "HIGH", needsReason: true, body: i18nT("Reabre/mueve el cierre a {until} (nunca más tarde que el inicio real).", { until: i18nTd(until) }), run: (r) => post({ action: "match", id: b.id, matchId: n.matchId, matchAction: "reschedule", until, reason: r }) }); }}>{i18nT("Reprogramar")}</Button>}
                        <Button variant="ghost" size="sm" onClick={() => setConfirm({ title: `${n.voided ? i18nT("Quitar VOID") : i18nT("Anular (VOID)")} ${n.matchId}`, risk: "HIGH", needsReason: true, body: n.voided ? i18nT("Vuelve a puntuar.") : i18nT("No suma ni resta, sale del máximo y no rompe el perfecto."), run: (r) => post({ action: "match", id: b.id, matchId: n.matchId, matchAction: n.voided ? "unvoid" : "void", reason: r }) })}>{n.voided ? i18nT("Quitar VOID") : i18nT("VOID")}</Button>
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
      <Panel title={i18nT("Auditoría")} dense>
        {d.audit.length === 0 ? <p className="text-sm text-ink-muted">{i18nT("Sin acciones.")}</p> : (
          <ul className="space-y-1 text-[12px]">{d.audit.map((a, i) => <li key={i}><span className="text-ink-muted">{dateTime(a.at)}</span> · <b>{i18nTd(a.action)}</b> · {i18nTd(a.actorName) ?? "—"}{typeof a.detail?.reason === "string" ? ` · «${a.detail.reason}»` : ""}</li>)}</ul>
        )}
      </Panel>
      <ConfirmDialog open={!!confirm} onClose={() => { setConfirm(null); setErr(null); }} onConfirm={go} title={i18nTd(confirm?.title) ?? ""} risk={confirm?.risk ?? "MEDIUM"} busy={busy} error={i18nTd(err)} typeToConfirm={confirm?.typed}
        canConfirm={!confirm?.needsReason || reason.trim().length >= 8} confirmLabel={i18nT("Confirmar")}>
        <p className="text-sm">{i18nTd(confirm?.body)}</p>
        {confirm?.needsReason && <Field label={i18nT("Motivo (mín. 8)")} htmlFor="pk-reason"><Input id="pk-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </ConfirmDialog>
    </div>
  );
}

function RewardsEditor({ d, onChanged }: { d: AdminDetail; onChanged: () => void }) {
  useLocale();
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
      setMsg({ ok: true, text: i18nT("Guardado (auditado).") }); setConfirmActive(false); onChanged();
    } catch (er) { setMsg({ ok: false, text: er instanceof Error ? er.message : i18nT("Error") }); } finally { setBusy(false); }
  };
  const load = async () => {
    const r = await adminPost<{ rewards: BracketRewardConfig }>("/api/admin/pickems", { action: "proposeRewards", id: d.bracket.id });
    setCfg({ ...r.rewards, version: cfg.version }); setStatus("DRAFT");
  };
  return (
    <Panel title={i18nT("Recompensas")} tone="gold" subtitle={i18nT("Solo sobres/cartas del catálogo e insignias insignia:pickem:*. Se congelan al primer cierre. ACTIVAS exige aceptar el pasivo.")}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={d.rewards.status === "ACTIVE" ? "gold" : "default"}>{i18nT("Actual:")} {i18nTd(d.rewards.status)} · v{d.bracket.rewards_version}</Pill>
        <Button variant="ghost" size="sm" onClick={load} data-testid="pickem-load-v1">{i18nT("Cargar reglas v1 aprobadas")}</Button>
        <label className="text-sm">{i18nT("Participación mínima")} <Input type="number" step="0.05" min="0.5" max="1" value={cfg.minCompletion} onChange={(ev) => setCfg({ ...cfg, minCompletion: Number(ev.target.value) })} className="inline-block w-24" /></label>
      </div>
      <table className="mt-3 w-full text-left text-[12px]">
        <thead className="text-ink-muted"><tr><th className="p-1">{i18nT("Escalón")}</th><th className="p-1">{i18nT("Listón")}</th><th className="p-1">{i18nT("Sobre")}</th><th className="p-1">{i18nT("Nº")}</th><th className="p-1">{i18nT("Insignia")}</th><th className="p-1">{i18nT("Valor")}</th><th className="p-1"></th></tr></thead>
        <tbody>
          {TIER_ORDER.map((id, i) => {
            const t = tiers[i];
            const value = e.perTier.find((x) => x.id === id)?.value;
            return (
              <tr key={id} className="border-t border-white/[0.06]">
                <td className="p-1 font-bold">{i18nTd(TIER_LABEL[id])}</td>
                <td className="p-1">{t && (id === "GOOD" || id === "GREAT" || id === "ELITE") ? <Input type="number" step="0.05" value={t.minRatio ?? 0} onChange={(ev) => setTier(id, { minRatio: Number(ev.target.value) })} className="w-20" /> : id === "PARTICIPATION" ? i18nT("completitud") : id === "PERFECT" ? i18nT("todo acertado") : "—"}</td>
                <td className="p-1">{t && <Select value={t.reward.packId ?? ""} onChange={(ev) => setTier(id, { reward: { packId: ev.target.value || null } })}><option value="">—</option>{PACKS.map((p) => <option key={p} value={p}>{i18nTd(p)}</option>)}</Select>}</td>
                <td className="p-1">{t && <Input type="number" min="1" max="3" value={t.reward.packCount ?? 1} onChange={(ev) => setTier(id, { reward: { packCount: Number(ev.target.value) } })} className="w-16" />}</td>
                <td className="p-1">{t && <Input value={(t.reward.cosmetics ?? []).join(",")} placeholder={i18nT("insignia:pickem:…")} onChange={(ev) => setTier(id, { reward: { cosmetics: ev.target.value.split(",").map((x) => x.trim()).filter(Boolean) } })} className="w-64" />}</td>
                <td className="p-1">{value !== undefined ? fmt(value) : "—"}</td>
                <td className="p-1">{t ? <Button variant="ghost" size="sm" onClick={() => setTier(id, null)}>{i18nT("Quitar")}</Button> : <Button variant="ghost" size="sm" onClick={() => setTier(id, {})}>{i18nT("Añadir")}</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {d.rewardIssues.length > 0 && <ul className="mt-2 text-[12px]">{d.rewardIssues.map((i, k) => <li key={k} className={i.severity === "ERROR" ? "text-bad" : "text-warn"}>{i18nTd(i.severity)} · {i18nTd(i.message)}</li>)}</ul>}
      <div className="mt-3">
        <KV cols={3} items={[[i18nT("Escalón más caro"), fmt(e.maxTierValue)], [i18nT("Peor caso (jugadores actuales)"), fmt(e.worstCaseParticipants)], [i18nT("Peor caso (1.000 jugadores)"), fmt(e.worstCase1000)], [i18nT("Valor provisional repartido"), e.provisionalValue === null ? "—" : fmt(e.provisionalValue)]]} />
        {e.simulation.length > 0 && (
          <table className="mt-2 w-full text-left text-[12px]" data-testid="pickem-economy">
            <thead className="text-ink-muted"><tr><th className="p-1">{i18nT("Precisión")}</th><th className="p-1">{i18nT("Nada")}</th>{TIER_ORDER.map((t) => <th key={t} className="p-1">{i18nTd(TIER_LABEL[t])}</th>)}<th className="p-1">{i18nT("Tasa de perfecto")}</th><th className="p-1">{i18nT("Valor esperado")}</th></tr></thead>
            <tbody>{e.simulation.map((s) => <tr key={s.accuracy} className="border-t border-white/[0.06]"><td className="p-1">{pct(s.accuracy, 0)}</td><td className="p-1">{pct(s.dist.NONE)}</td>{TIER_ORDER.map((t) => <td key={t} className="p-1">{pct(s.dist[t])}</td>)}<td className="p-1">{pct(s.perfectRate, 2)}</td><td className="p-1">{fmt(s.ev)}</td></tr>)}</tbody>
          </table>
        )}
        {e.warnings.map((w, i) => <p key={i} className="text-[12px] text-warn">⚠ {i18nTd(w)}</p>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Select value={status} onChange={(ev) => setStatus(ev.target.value)} className="w-40"><option value="OFF">{i18nT("OFF")}</option><option value="DRAFT">{i18nT("BORRADOR")}</option><option value="ACTIVE">{i18nT("ACTIVAS")}</option></Select>
        <Button disabled={busy || d.bracket.status === "SETTLED" || d.bracket.status === "CANCELLED" || (status === "ACTIVE" && d.activationBlockers.length > 0)} onClick={() => (status === "ACTIVE" ? setConfirmActive(true) : save())} data-testid="pickem-save-rewards">{i18nT("Guardar recompensas")}</Button>
        {msg && <span className={msg.ok ? "text-sm text-ok" : "text-sm text-bad"}>{i18nTd(msg.text)}</span>}
      </div>
      {d.activationBlockers.length > 0 && (
        <div className="mt-3 text-[12px]" data-testid="pickem-activation-blockers">
          <p className="font-bold text-ink-primary">{i18nT("Para ACTIVAR falta:")}</p>
          <ul className="list-disc pl-5 text-warn">{d.activationBlockers.map((x, i) => <li key={i}>{i18nTd(x)}</li>)}</ul>
        </div>
      )}
      <ConfirmDialog open={confirmActive} onClose={() => setConfirmActive(false)} onConfirm={save} title={i18nT("Activar recompensas")} risk="CRITICAL" busy={busy} error={msg && !msg.ok ? i18nTd(msg.text) : null}
        typeToConfirm={d.bracket.slug} canConfirm={ack} confirmLabel={i18nT("Activar")}>
        <div className="space-y-2 text-sm" data-testid="pickem-activate-summary">
          <p>{fill(i18nT("{titulo} · {evento} · reglas {reglas} · versión de recompensas {version}", { ...slots("titulo"), evento: d.bracket.event_id, reglas: cfg.rulesVersion ?? "—", version: d.bracket.rewards_version + 1 }), { titulo: <b>{i18nTd(d.bracket.title)}</b> })}</p>
          <ul className="list-disc pl-5">{TIER_ORDER.map((id) => { const t = cfg.tiers.find((x) => x.id === id); return t ? <li key={id}>{i18nTd(TIER_LABEL[id])} — {describeTierReward(t.reward, packLabel).join(" + ")}</li> : null; })}</ul>
          <p>{fill(i18nT("Máximo por jugador: {maximo} (+ insignia si es perfecto). Peor caso con 1.000 jugadores: {peor}. Un solo escalón por jugador (el más alto).", { ...slots("maximo"), peor: fmt(e.worstCase1000) }), { maximo: <b>{fmt(e.maxTierValue)}</b> })}</p>
          <p data-testid="pickem-activate-eligibility">{i18nT("Elegibilidad para cobrar:")} <b>{i18nTd(cfg.eligibilityPolicy) ?? i18nT("ninguna (no se puede activar)")}</b> · {requirementText(policyOf(cfg.eligibilityPolicy))} {i18nT("Cualquiera puede predecir y salir en la clasificación.")}</p>
          <p className="text-warn">{i18nT("Se congelan al primer cierre de predicción. Publicar y activar son decisiones distintas.")}</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(ev) => setAck(ev.target.checked)} data-testid="pickem-ack" /> {i18nT("Acepto el pasivo y las reglas")}</label>
        </div>
      </ConfirmDialog>
    </Panel>
  );
}
