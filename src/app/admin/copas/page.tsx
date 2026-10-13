"use client";

/**
 * F86 · /admin/copas — TORNEOS DE JUGADORES. Lista, borradores (crear/editar con vista previa y validación), publicar,
 * cancelar, generar el cuadro tras el cierre y resolver cruces retenidos o con el plazo vencido.
 *
 * Aquí no se decide nada: `/api/admin/cups` → RPC de 0069 (admin releído en la BD, motivo obligatorio, auditoría en la
 * misma transacción). No hay edición libre del cuadro ni de ganadores. Para que avance un jugador hay que escribir su
 * #TAG exacto; para eliminar a los dos, «ELIMINAR A LOS DOS»; para cancelar un torneo en curso, su identificador.
 */
import { useMemo, useState } from "react";
import { useAdminQuery, adminPost, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, Pill, Loading, ErrorBox, Button, Empty, ConfirmDialog, Field, Input, Select, Textarea, KV } from "@/components/admin/cc/ui";
import type { AdminCupRow, AdminCupDetail, AdminCupMatch } from "@/server/admin/cups";
import { PHASE_LABEL, MATCH_LABEL } from "@/domain/cups/lifecycle";
import { PLACEMENT_LABEL } from "@/domain/cups/bracket";

interface Preview { valid: boolean; publishable: boolean; errors: { field: string; message: string }[]; schedule: { round: number; name: string; availableAt: string; deadlineAt: string }[]; bracketForMax: number | null; byesAtMin: number | null }
type Form = { slug: string; name: string; description: string; rules: string; registrationOpenAt: string; registrationCloseAt: string; startsAt: string; minParticipants: number; maxParticipants: number; roundWindowMinutes: number; visibility: "PUBLIC" | "UNLISTED" };

/** `datetime-local` (hora local del admin) ⇄ ISO con zona: el servidor recibe siempre una hora absoluta. */
const toLocal = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (local: string) => (local ? new Date(local).toISOString() : "");
const EMPTY = (): Form => {
  const day = 86_400_000, now = Date.now();
  return { slug: "", name: "", description: "", rules: "Eliminación directa a partida única. Cada ronda tiene su plazo; un empate o un plazo vencido lo resuelve la organización.", registrationOpenAt: new Date(now + day).toISOString(), registrationCloseAt: new Date(now + 3 * day).toISOString(), startsAt: new Date(now + 3 * day + 3_600_000).toISOString(), minParticipants: 4, maxParticipants: 64, roundWindowMinutes: 1440, visibility: "PUBLIC" };
};
const PHASE_TONE: Record<string, "default" | "cyan" | "gold" | "drl" | "ok" | "warn" | "bad"> = { DRAFT: "default", SCHEDULED: "cyan", REGISTRATION_OPEN: "cyan", REGISTRATION_CLOSED: "warn", IN_PROGRESS: "drl", COMPLETED: "gold", CANCELLED: "bad" };

export default function AdminCupsPage() {
  const list = useAdminQuery<{ cups: AdminCupRow[] }>("/api/admin/cups");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; version: number | null; form: Form; status: string } | null>(null);
  const detail = useAdminQuery<AdminCupDetail>(selected ? `/api/admin/cups?id=${selected}` : null);

  return (
    <div>
      <PageHeader eyebrow="Juego" title="Torneos de jugadores" description="Eliminación directa (4–64), inscripción gratuita, sin premios económicos: el campeón recibe un trofeo. Ningún torneo se publica solo."
        actions={<Button onClick={() => { setSelected(null); setEditing({ id: null, version: null, form: EMPTY(), status: "DRAFT" }); }} data-testid="cup-new">Nuevo borrador</Button>} />
      {editing && <CupEditor key={editing.id ?? "new"} editing={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); list.reload(); setSelected(id); detail.reload(); }} />}
      <Panel title="Torneos" subtitle="Los borradores solo existen aquí; un torneo publicado no se borra (se cancela).">
        {list.loading && <Loading />}
        {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
        {list.data && (list.data.cups.length === 0 ? <Empty title="Sin torneos todavía">Crea un borrador para empezar.</Empty> : (
          <ul className="divide-y divide-white/[0.06]" data-testid="admin-cups">
            {list.data.cups.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { setEditing(null); setSelected(c.id); }} className="nx-focus flex w-full flex-wrap items-center gap-3 px-2 py-3 text-left hover:bg-white/[0.04]" data-testid="admin-cup-row" data-slug={c.slug}>
                  <Pill tone={PHASE_TONE[c.phase] ?? "default"}>{PHASE_LABEL[c.phase]}</Pill>
                  <span className="min-w-0 flex-1 truncate font-bold text-ink-primary">{c.name} <span className="font-mono text-[12px] text-ink-faint">{c.slug}</span></span>
                  {c.visibility === "UNLISTED" && <Pill>No listado</Pill>}
                  <span className="text-[12px] text-ink-muted">{c.participants}/{c.max} · {dateTime(c.startsAt)}</span>
                  {c.problems > 0 && <Pill tone="warn">{c.problems} por resolver</Pill>}
                </button>
              </li>
            ))}
          </ul>
        ))}
      </Panel>
      {selected && (
        <div className="mt-4">
          {detail.loading && <Loading />}
          {detail.error && <ErrorBox error={detail.error} onRetry={detail.reload} />}
          {detail.data && <CupAdminDetail d={detail.data} onChanged={() => { detail.reload(); list.reload(); }}
            onEdit={() => setEditing({ id: detail.data!.cup.id, version: detail.data!.cup.version, status: detail.data!.cup.status, form: {
              slug: detail.data!.cup.slug, name: detail.data!.cup.name, description: detail.data!.cup.description, rules: detail.data!.cup.rules,
              registrationOpenAt: detail.data!.cup.registrationOpenAt, registrationCloseAt: detail.data!.cup.registrationCloseAt, startsAt: detail.data!.cup.startsAt,
              minParticipants: detail.data!.cup.min, maxParticipants: detail.data!.cup.max, roundWindowMinutes: detail.data!.cup.roundWindowMinutes, visibility: detail.data!.cup.visibility as Form["visibility"] } })} />}
        </div>
      )}
    </div>
  );
}

function CupEditor({ editing, onClose, onSaved }: { editing: { id: string | null; version: number | null; form: Form; status: string }; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<Form>(editing.form);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textOnly = editing.status !== "DRAFT";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const fields = textOnly ? { name: f.name, description: f.description, rules: f.rules } : f;

  async function runPreview() {
    setError(null);
    try { setPreview(await adminPost<Preview>("/api/admin/cups", { action: "preview", fields: f })); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo validar"); }
  }
  async function save() {
    setBusy(true); setError(null);
    try {
      const r = editing.id
        ? await adminPost<{ id: string }>("/api/admin/cups", { action: "update", id: editing.id, version: editing.version, fields })
        : await adminPost<{ id: string }>("/api/admin/cups", { action: "create", fields: f });
      onSaved(r.id);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar"); } finally { setBusy(false); }
  }
  return (
    <Panel title={editing.id ? (textOnly ? "Corregir texto (torneo publicado)" : "Editar borrador") : "Nuevo borrador"} subtitle={textOnly ? "Publicado: formato, plazas, fechas y ventanas quedan congelados. Solo se corrige nombre, descripción y reglas." : "Guardar no publica: publicar es una acción aparte, con validación."} tone="cyan">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="cup-editor">
        <Field label="Nombre" htmlFor="cup-name"><Input id="cup-name" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={60} /></Field>
        <Field label="Identificador (URL)" htmlFor="cup-slug" hint="minúsculas, números y guiones; no cambia tras publicar"><Input id="cup-slug" value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} disabled={textOnly} maxLength={48} /></Field>
        <Field label="Descripción" htmlFor="cup-desc"><Textarea id="cup-desc" value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} /></Field>
        <Field label="Reglas" htmlFor="cup-rules"><Textarea id="cup-rules" value={f.rules} onChange={(e) => set("rules", e.target.value)} maxLength={2000} /></Field>
        <Field label="Abre la inscripción" htmlFor="cup-open"><Input id="cup-open" type="datetime-local" value={toLocal(f.registrationOpenAt)} onChange={(e) => set("registrationOpenAt", toIso(e.target.value))} disabled={textOnly} /></Field>
        <Field label="Cierra la inscripción" htmlFor="cup-close"><Input id="cup-close" type="datetime-local" value={toLocal(f.registrationCloseAt)} onChange={(e) => set("registrationCloseAt", toIso(e.target.value))} disabled={textOnly} /></Field>
        <Field label="Empieza (ronda 1)" htmlFor="cup-start"><Input id="cup-start" type="datetime-local" value={toLocal(f.startsAt)} onChange={(e) => set("startsAt", toIso(e.target.value))} disabled={textOnly} /></Field>
        <Field label="Ventana por ronda (minutos)" htmlFor="cup-window" hint="10 min – 7 días (10080)"><Input id="cup-window" type="number" min={10} max={10080} value={f.roundWindowMinutes} onChange={(e) => set("roundWindowMinutes", Number(e.target.value))} disabled={textOnly} /></Field>
        <Field label="Mínimo de inscritos" htmlFor="cup-min"><Input id="cup-min" type="number" min={4} max={64} value={f.minParticipants} onChange={(e) => set("minParticipants", Number(e.target.value))} disabled={textOnly} /></Field>
        <Field label="Máximo de inscritos" htmlFor="cup-max" hint="4–64"><Input id="cup-max" type="number" min={4} max={64} value={f.maxParticipants} onChange={(e) => set("maxParticipants", Number(e.target.value))} disabled={textOnly} /></Field>
        <Field label="Visibilidad" htmlFor="cup-vis" hint="No listado: solo por enlace directo (pruebas)"><Select id="cup-vis" value={f.visibility} onChange={(e) => set("visibility", e.target.value as Form["visibility"])} disabled={textOnly}><option value="PUBLIC">Público</option><option value="UNLISTED">No listado</option></Select></Field>
      </div>
      {preview && (
        <div className="mt-4 text-[13px]" data-testid="cup-preview">
          {preview.errors.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-warn">{preview.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
            : <p className="text-ok">Listo para publicar.</p>}
          {preview.valid && (
            <>
              <p className="mt-2 text-ink-muted">Cuadro si se llena: {preview.bracketForMax} plazas · con el mínimo, {preview.byesAtMin} pases directos.</p>
              <ol className="mt-1 space-y-0.5 text-ink-secondary">{preview.schedule.map((r) => <li key={r.round}>{r.name}: {dateTime(r.availableAt)} → {dateTime(r.deadlineAt)}</li>)}</ol>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] text-bad">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!textOnly && <Button variant="ghost" onClick={() => void runPreview()} data-testid="cup-preview-btn">Vista previa</Button>}
        <Button onClick={() => void save()} disabled={busy} data-testid="cup-save">{busy ? "Guardando…" : "Guardar"}</Button>
        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
      </div>
    </Panel>
  );
}

type Pending =
  | { kind: "publish" } | { kind: "cancel" } | { kind: "generate" }
  | { kind: "resolve"; m: AdminCupMatch; decision: "A" | "B" | "NONE" };

function CupAdminDetail({ d, onChanged, onEdit }: { d: AdminCupDetail; onChanged: () => void; onEdit: () => void }) {
  const c = d.cup;
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const confirmWord = useMemo(() => {
    if (!pending) return undefined;
    if (pending.kind === "cancel" && c.status === "IN_PROGRESS") return c.slug;
    if (pending.kind === "resolve") {
      if (pending.decision === "NONE") return "ELIMINAR A LOS DOS";
      const p = pending.decision === "A" ? pending.m.a : pending.m.b;
      return p?.tag ? `#${p.tag}` : undefined;
    }
    return undefined;
  }, [pending, c.status, c.slug]);
  const needsReason = pending?.kind === "cancel" || pending?.kind === "resolve";

  async function run() {
    if (!pending) return;
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = pending.kind === "publish" ? { action: "publish", id: c.id, version: c.version }
        : pending.kind === "generate" ? { action: "generate", id: c.id }
          : pending.kind === "cancel" ? { action: "cancel", id: c.id, reason, confirm: confirmWord ?? null }
            : { action: "resolve", id: c.id, round: pending.m.round, slot: pending.m.slot, decision: pending.decision, reason, confirm: confirmWord };
      const r = await adminPost<{ code?: string }>("/api/admin/cups", body);
      setDone(`${pending.kind === "publish" ? "Publicado" : pending.kind === "generate" ? (r.code === "UNDERFILLED" ? "Sin el mínimo: el torneo se canceló" : "Cuadro generado") : pending.kind === "cancel" ? "Torneo cancelado" : "Cruce resuelto"}.`);
      setPending(null); setReason(""); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo completar la operación"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4" data-testid="admin-cup-detail" data-status={c.status}>
      <Panel title={c.name} subtitle={<>{PHASE_LABEL[c.phase]} · <span className="font-mono">/copas/{c.slug}</span>{c.visibility === "UNLISTED" ? " · no listado" : ""}</>}
        actions={<div className="flex flex-wrap gap-2">
          {(c.status === "DRAFT" || c.status === "PUBLISHED" || c.status === "IN_PROGRESS") && <Button variant="ghost" onClick={onEdit} data-testid="cup-edit">{c.status === "DRAFT" ? "Editar" : "Corregir texto"}</Button>}
          {c.status === "DRAFT" && <Button onClick={() => { setError(null); setPending({ kind: "publish" }); }} data-testid="cup-publish">Publicar</Button>}
          {c.phase === "REGISTRATION_CLOSED" && <Button onClick={() => { setError(null); setPending({ kind: "generate" }); }} data-testid="cup-generate">Generar cuadro</Button>}
          {c.status !== "COMPLETED" && c.status !== "CANCELLED" && <Button variant="danger" onClick={() => { setError(null); setReason(""); setPending({ kind: "cancel" }); }} data-testid="cup-cancel">Cancelar torneo</Button>}
        </div>}>
        <KV cols={3} items={[
          ["Inscritos", `${c.participants}/${c.max} (mínimo ${c.min})`], ["Inscripción", `${dateTime(c.registrationOpenAt)} → ${dateTime(c.registrationCloseAt)}`], ["Empieza", dateTime(c.startsAt)],
          ["Ventana por ronda", `${c.roundWindowMinutes} min`], ["Cuadro", c.bracketSize ? `${c.bracketSize} plazas · ${c.rounds} rondas` : "sin generar"],
          ["Campeón", c.championName ? `${c.championName}${c.championTag ? ` #${c.championTag}` : ""}` : "—"],
        ]} />
        {c.cancelReason && <p className="mt-2 text-[13px] text-ink-muted">Cancelado: {c.cancelReason === "NOT_ENOUGH_PARTICIPANTS" ? "no se alcanzó el mínimo" : c.cancelReason}</p>}
        {done && <p role="status" className="mt-2 text-[13px] text-ok">{done}</p>}
      </Panel>

      {d.problems.length > 0 && (
        <Panel title="Cruces por resolver" subtitle="Retenidos (la partida acabó sin ganador) o con el plazo vencido sin partida. Nadie avanza hasta que se resuelvan." tone="gold">
          <ul className="space-y-2" data-testid="cup-problems">
            {d.problems.map((m) => (
              <li key={`${m.round}-${m.slot}`} className="flex flex-wrap items-center gap-2 rounded bg-white/[0.03] px-3 py-2 text-[13px]">
                <span className="font-bold text-ink-primary">{m.roundName} · cruce {m.slot + 1}</span>
                <Pill tone="warn">{MATCH_LABEL[m.state]}</Pill>
                <span className="text-ink-secondary">{m.a?.username ?? "—"} {m.a?.tag ? `#${m.a.tag}` : ""} vs {m.b?.username ?? "—"} {m.b?.tag ? `#${m.b.tag}` : ""}</span>
                {m.resolvable && <span className="ml-auto flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => { setError(null); setReason(""); setPending({ kind: "resolve", m, decision: "A" }); }} data-testid="cup-resolve-a">Avanza {m.a?.username ?? "A"}</Button>
                  <Button size="sm" onClick={() => { setError(null); setReason(""); setPending({ kind: "resolve", m, decision: "B" }); }} data-testid="cup-resolve-b">Avanza {m.b?.username ?? "B"}</Button>
                  <Button size="sm" variant="danger" onClick={() => { setError(null); setReason(""); setPending({ kind: "resolve", m, decision: "NONE" }); }} data-testid="cup-resolve-none">Los dos fuera</Button>
                </span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`Inscritos (${d.registrations.length})`} subtitle="Seed y rating de la FOTO tomada al generar el cuadro.">
        {d.registrations.length === 0 ? <Empty title="Nadie inscrito todavía" /> : (
          <ol className="grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2 lg:grid-cols-3" data-testid="cup-admin-regs">
            {d.registrations.map((p, i) => (
              <li key={`${p.tag}-${i}`} className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1.5">
                <span className="w-8 text-right font-mono text-ink-faint">{p.seed ? `#${p.seed}` : "—"}</span>
                <span className="min-w-0 flex-1 truncate text-ink-primary">{p.username}</span>
                <code className="text-[11px] text-ink-faint">{p.tag ? `#${p.tag}` : ""}</code>
                {p.seedRating !== null && <span className="text-[11px] text-ink-muted">{p.seedRating}</span>}
                {p.placement && <Pill tone={p.placement === "CHAMPION" ? "gold" : "default"}>{PLACEMENT_LABEL[p.placement]}</Pill>}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {d.matches.length > 0 && (
        <Panel title="Cuadro" subtitle="Solo lectura: no hay edición libre de ganadores.">
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[12px]">
            <thead><tr className="text-left text-ink-muted"><th className="py-1">Ronda</th><th>Cruce</th><th>A</th><th>B</th><th>Estado</th><th>Ganador</th><th>Resolución</th></tr></thead>
            <tbody>{d.matches.map((m) => (
              <tr key={`${m.round}-${m.slot}`} className="border-t border-white/[0.05]">
                <td className="py-1">{m.roundName}</td><td>{m.slot + 1}</td>
                <td>{m.a ? `${m.a.username} #${m.a.tag ?? ""}` : m.aEmpty ? "(vacío)" : "…"}</td>
                <td>{m.b ? `${m.b.username} #${m.b.tag ?? ""}` : m.bEmpty ? "(vacío)" : "…"}</td>
                <td>{MATCH_LABEL[m.state]}</td><td>{m.winner ?? ""}</td><td>{m.resolution ?? ""}{m.reason ? ` · ${m.reason}` : ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Panel>
      )}

      <Panel title="Auditoría del torneo" subtitle="Registro inmutable (content_audit_log).">
        {d.audit.length === 0 ? <Empty title="Sin acciones registradas" /> : (
          <ul className="space-y-1 text-[12px]" data-testid="cup-audit">{d.audit.map((a, i) => <li key={i} className="text-ink-secondary"><span className="text-ink-faint">{dateTime(a.at)}</span> · <b className="text-ink-primary">{a.action}</b> · {a.actorName}{typeof a.detail.reason === "string" ? ` · «${a.detail.reason}»` : ""}</li>)}</ul>
        )}
      </Panel>

      <ConfirmDialog open={!!pending} onClose={() => { if (!busy) setPending(null); }} onConfirm={() => void run()} busy={busy} error={error}
        risk={pending?.kind === "cancel" || pending?.kind === "resolve" ? "HIGH" : "MEDIUM"}
        title={pending?.kind === "publish" ? "Publicar el torneo" : pending?.kind === "generate" ? "Generar el cuadro" : pending?.kind === "cancel" ? "Cancelar el torneo" : "Resolver el cruce"}
        confirmLabel={pending?.kind === "publish" ? "Publicar" : pending?.kind === "generate" ? "Generar" : pending?.kind === "cancel" ? "Cancelar torneo" : "Resolver"}
        typeToConfirm={confirmWord} canConfirm={!needsReason || reason.trim().length >= 8}>
        {pending?.kind === "publish" && <p>Se hará público con estas fechas y plazas. Después solo se podrá corregir texto. La inscripción se abre sola en su fecha.</p>}
        {pending?.kind === "generate" && <p>Se fotografía el rating de cada inscrito, se siembra y se crea el cuadro UNA vez. Si no hay {c.min} inscritos, el torneo se cancela.</p>}
        {pending?.kind === "cancel" && <p>{c.status === "IN_PROGRESS" ? "El torneo está EN CURSO: lo jugado se conserva, lo pendiente se cancela y no habrá campeón." : "Nadie podrá inscribirse ni jugar."} No se puede deshacer.</p>}
        {pending?.kind === "resolve" && (
          <dl className="space-y-1" data-testid="cup-resolve-who">
            <div><dt className="inline text-ink-muted">Cruce: </dt><dd className="inline">{pending.m.roundName} · {pending.m.slot + 1}</dd></div>
            <div><dt className="inline text-ink-muted">Decisión: </dt><dd className="inline font-bold">{pending.decision === "NONE" ? "Los dos quedan eliminados" : `Avanza ${(pending.decision === "A" ? pending.m.a : pending.m.b)?.username ?? "?"}`}</dd></div>
          </dl>
        )}
        {needsReason && (
          <Field label="Motivo (obligatorio, queda en la auditoría)" htmlFor="cup-reason"><Textarea id="cup-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        )}
      </ConfirmDialog>
    </div>
  );
}
