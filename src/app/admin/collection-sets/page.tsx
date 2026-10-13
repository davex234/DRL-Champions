"use client";

/**
 * F82 · /admin/collection-sets — COLLECTION SETS dentro del panel existente.
 *
 * Generar borradores desde la BD/catálogo real (nunca publica), revisar requisitos con sus cartas, editar el borrador
 * (título, insignia, quitar requisito, añadir jugador o carta), previsualizar (validación completa + usuarios que ya lo
 * cumplirían), publicar (valida, congela y firma con checksum) y retirar. Lo publicado no se edita: nueva versión.
 * Todo lo decide el servidor (`server/cms/collectionSets.ts`) y queda en Auditoría.
 */
import { useEffect, useMemo, useState } from "react";
import { PageHeader, Panel, Loading, ErrorBox, Pill, Button, Field, Input, Tabs, Empty, Stat, ConfirmDialog, Textarea } from "@/components/admin/cc/ui";
import { useAdminQuery, adminPost } from "@/components/admin/cc/api";
import { TrophyBadge } from "@/components/trophies/TrophyBadge";
import type { AdminSetsView, AdminSetRow, PreviewView } from "@/server/cms/collectionSets";

const URL = "/api/admin/cms/collection-sets";
const tone = (s: string) => (s === "PUBLISHED" ? "ok" : s === "RETIRED" ? "bad" : "default") as "ok" | "bad" | "default";
const SKIP_TEXT: Record<string, string> = {
  NO_IDENTITY: "sin identidad canónica", IDENTITY_CONFLICT: "identidad en conflicto (20.2)", NO_LOGO: "sin logo real",
  TOO_FEW_PLAYERS: "menos de 4 jugadores", UNOBTAINABLE: "requisito no obtenible", TOO_SMALL: "edición demasiado pequeña", TOO_LARGE: "edición demasiado grande",
};

export default function CollectionSetsAdminPage() {
  const q = useAdminQuery<AdminSetsView>(URL);
  const [tab, setTab] = useState<"sets" | "generator">("sets");
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sets = useMemo(() => q.data?.sets ?? [], [q.data]);
  const counts = useMemo(() => ({
    draft: sets.filter((s) => s.status === "DRAFT").length,
    published: sets.filter((s) => s.status === "PUBLISHED").length,
    retired: sets.filter((s) => s.status === "RETIRED").length,
    completions: sets.reduce((n, s) => n + s.completions, 0),
  }), [sets]);

  const generate = async (kind: "TEAM" | "EDITION") => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await adminPost<{ created: string[]; existing: string[]; skipped: unknown[] }>(URL, { action: "generate", kind });
      setNotice(`${r.created.length} borradores creados · ${r.existing.length} ya existían · ${r.skipped.length} descartados (ver Generador). Nada se ha publicado.`);
      q.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Contenido · F82" title="Colecciones" description="Collection Sets de equipo y de edición. Los requisitos se congelan al publicar; un cambio de plantilla o de catálogo se publica como versión nueva. La recompensa es solo una insignia permanente." actions={<>
        <Button variant="ghost" onClick={() => void generate("TEAM")} disabled={busy} data-testid="gen-team">Generar borradores de equipos</Button>
        <Button variant="ghost" onClick={() => void generate("EDITION")} disabled={busy} data-testid="gen-edition">Generar borradores de ediciones</Button>
      </>} />
      {notice && <Panel tone="cyan"><p className="text-[14px] text-ink-secondary" data-testid="gen-notice">{notice}</p></Panel>}
      {error && <ErrorBox error={error} />}
      {q.loading && <Loading />}
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Borradores" value={counts.draft} />
            <Stat label="Publicados" value={counts.published} accent="ok" />
            <Stat label="Retirados" value={counts.retired} accent="bad" />
            <Stat label="Compleciones" value={counts.completions} accent="gold" />
          </div>
          <Tabs value={tab} onChange={setTab} label="Secciones" items={[{ id: "sets", label: "Sets", count: sets.length }, { id: "generator", label: "Generador (auditoría)", count: q.data.proposals.length }]} />
          {tab === "sets" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <Panel title="Sets" subtitle="Elige uno para revisar, editar o publicar">
                {sets.length === 0 ? <Empty title="Aún no hay sets">Genera borradores desde la BD con los botones de arriba.</Empty> : (
                  <ul className="divide-y divide-white/[0.06]" data-testid="admin-set-list">
                    {sets.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => setSelected(s.id)} data-set={s.id}
                          className={`nx-focus flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-white/[0.04] ${selected === s.id ? "bg-white/[0.06]" : ""}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-white">{s.title}</span>
                            <span className="block truncate text-[12px] text-ink-muted">{s.id} · {s.kind} · v{s.version} · {s.requirements.length} requisitos · {s.completions} compleciones</span>
                          </span>
                          <Pill tone={tone(s.status)}>{s.status}</Pill>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {selected ? <SetEditor key={selected} id={selected} row={sets.find((s) => s.id === selected) ?? null} onChanged={() => q.reload()} /> : <Panel title="Detalle"><p className="text-[14px] text-ink-muted">Selecciona un set.</p></Panel>}
            </div>
          )}
          {tab === "generator" && (
            <Panel title="Lo que la BD permite hoy" subtitle="Resultado del generador sobre el catálogo real: candidatos y descartes con su motivo. No escribe nada.">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]" data-testid="generator-table">
                  <thead className="text-ink-muted"><tr><th className="py-1 pr-3">Tipo</th><th className="py-1 pr-3">Sujeto</th><th className="py-1 pr-3">Resultado</th><th className="py-1">Estado</th></tr></thead>
                  <tbody>
                    {q.data.proposals.map(({ result, exists }) => (
                      <tr key={`${result.kind}:${result.subjectId}`} className="border-t border-white/[0.06]">
                        <td className="py-1 pr-3">{result.kind}</td>
                        <td className="py-1 pr-3 text-white">{result.title}</td>
                        <td className="py-1 pr-3">{"skip" in result ? <span className="text-ink-muted">{result.skip.map((k) => SKIP_TEXT[k] ?? k).join(" · ")}{result.detail ? ` — ${result.detail}` : ""}</span> : <span>{result.requirements.length} requisitos{result.logo ? " · logo real" : ""}</span>}</td>
                        <td className="py-1">{"skip" in result ? <Pill tone="warn">Descartado</Pill> : exists ? <Pill tone="cyan">Ya existe</Pill> : <Pill tone="ok">Elegible</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function SetEditor({ id, row, onChanged }: { id: string; row: AdminSetRow | null; onChanged: () => void }) {
  const [pv, setPv] = useState<PreviewView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(row?.title ?? "");
  const [badgeId, setBadgeId] = useState(row?.reward.badgeId ?? "");
  const [addId, setAddId] = useState("");
  const [confirm, setConfirm] = useState<null | "publish" | "retire" | "delete">(null);
  const [reason, setReason] = useState("");

  const rowVersion = row?.rowVersion;
  useEffect(() => {
    let live = true;
    setErr(null);
    adminPost<PreviewView>(URL, { action: "preview", id })
      .then((v) => { if (live) setPv(v); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : "Error"); });
    return () => { live = false; };
  }, [id, rowVersion]);

  const act = async (body: Record<string, unknown>) => {
    if (!row) return;
    setBusy(true); setErr(null);
    try { await adminPost(URL, { id, expectedVersion: row.rowVersion, ...body }); setConfirm(null); setReason(""); setAddId(""); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  };

  if (!row) return <Panel title="Detalle"><p className="text-[14px] text-ink-muted">El set ya no existe.</p></Panel>;
  const draft = row.status === "DRAFT";
  return (
    <Panel title={row.title} subtitle={`${row.id} · ${row.family} · v${row.version} · ${row.status}${row.checksum ? ` · sha256 ${row.checksum.slice(0, 12)}…` : ""}`} actions={<Pill tone={tone(row.status)}>{row.status}</Pill>}>
      {err && <ErrorBox error={err} />}
      {!pv ? <Loading rows={3} /> : (
        <div className="space-y-4" data-testid="admin-set-detail">
          <div className="flex flex-wrap items-center gap-4">
            <TrophyBadge badge={{ id: row.reward.badgeId, label: row.title, logo: row.logo, color: row.kind === "TEAM" ? "#19e3ff" : "#ffce4f", kind: row.kind, caption: row.kind === "TEAM" ? "Equipo completado" : "Edición" }} size="md" showLabel />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
              <dt className="text-ink-muted">Jugadores</dt><dd className="text-white">{pv.players}</dd>
              <dt className="text-ink-muted">Requisitos</dt><dd className="text-white">{pv.set.requirements.length}</dd>
              <dt className="text-ink-muted">Insignia</dt><dd className="truncate text-white">{row.reward.badgeId}</dd>
              <dt className="text-ink-muted">Logo</dt><dd className="truncate text-white">{row.logo ?? "— (lenguaje visual propio)"}</dd>
              <dt className="text-ink-muted">Ya lo cumplen</dt><dd className="text-white" data-testid="estimated">{pv.estimatedCompleters ?? "—"} usuarios</dd>
              <dt className="text-ink-muted">Compleciones</dt><dd className="text-white">{row.completions}</dd>
            </dl>
          </div>
          {draft && (pv.issues.length ? (
            <div className="rounded border border-amber-300/30 bg-amber-300/[0.06] p-3 text-[13px]" data-testid="publish-issues">
              <p className="font-semibold text-amber-200">No se puede publicar todavía:</p>
              <ul className="mt-1 list-disc pl-5 text-ink-secondary">{pv.issues.map((i, k) => <li key={k}>{i.code}{i.detail ? ` — ${i.detail}` : ""}</li>)}</ul>
            </div>
          ) : <p className="text-[13px] text-emerald-300" data-testid="publish-ok">Validación completa: listo para publicar.</p>)}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]" data-testid="admin-requirements">
              <thead className="text-ink-muted"><tr><th className="py-1 pr-3">Requisito</th><th className="py-1 pr-3">Cartas elegibles</th>{draft && <th className="py-1" />}</tr></thead>
              <tbody>
                {pv.requirements.map((r) => (
                  <tr key={r.key} className="border-t border-white/[0.06] align-top">
                    <td className="py-1.5 pr-3 text-white">{r.label}<span className="block text-[11px] text-ink-muted">{r.key} · {r.type}</span></td>
                    <td className="py-1.5 pr-3">{r.cards.map((c) => <span key={c.id} className={`mr-2 inline-block ${c.obtainable ? "text-ink-secondary" : "text-red-300"}`}>{c.id} ({c.ovr}, {c.team}){c.obtainable ? "" : " ✕ no obtenible"}</span>)}</td>
                    {draft && <td className="py-1.5"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "update", patch: { removeKey: r.key } })}>Quitar</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {draft && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Título" htmlFor="cs-title"><Input id="cs-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Insignia (insignia:coleccion:…)" htmlFor="cs-badge"><Input id="cs-badge" value={badgeId} onChange={(e) => setBadgeId(e.target.value)} /></Field>
              <div className="flex items-end gap-2 md:col-span-2">
                <Button size="sm" disabled={busy || (title === row.title && badgeId === row.reward.badgeId)} onClick={() => void act({ action: "update", patch: { ...(title !== row.title ? { title } : {}), ...(badgeId !== row.reward.badgeId ? { badgeId } : {}) } })}>Guardar cambios</Button>
              </div>
              <Field label={row.kind === "TEAM" ? "Añadir jugador (id del catálogo)" : "Añadir carta (id del catálogo)"} htmlFor="cs-add">
                <Input id="cs-add" value={addId} onChange={(e) => setAddId(e.target.value.trim())} placeholder={row.kind === "TEAM" ? "p. ej. jawgemo" : "p. ej. jawgemo__champions-s"} />
              </Field>
              <div className="flex items-end"><Button size="sm" variant="ghost" disabled={busy || !addId} onClick={() => void act({ action: "update", patch: row.kind === "TEAM" ? { addPlayerId: addId } : { addCardId: addId } })}>Añadir requisito</Button></div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {draft && <Button disabled={busy || pv.issues.length > 0} onClick={() => setConfirm("publish")} data-testid="publish">Publicar</Button>}
            {draft && <Button variant="ghost" disabled={busy} onClick={() => setConfirm("delete")}>Borrar borrador</Button>}
            {row.status === "PUBLISHED" && <Button variant="danger" disabled={busy} onClick={() => setConfirm("retire")}>Retirar</Button>}
            {!draft && <Button variant="ghost" disabled={busy} onClick={() => void adminPost(URL, { action: "newVersion", family: row.family }).then(onChanged).catch((e) => setErr(e instanceof Error ? e.message : "Error"))}>Nueva versión (borrador)</Button>}
          </div>
        </div>
      )}
      <ConfirmDialog open={confirm === "publish"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "publish" })} title={`Publicar ${row.title}`} risk="HIGH" confirmLabel="Publicar" busy={busy} error={err} typeToConfirm={row.id}>
        Los {row.requirements.length} requisitos y la insignia quedan CONGELADOS. Todos los jugadores verán este objetivo y {pv?.estimatedCompleters ?? "?"} ya podrían reclamarlo.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "retire"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "retire", reason })} title={`Retirar ${row.title}`} risk="HIGH" confirmLabel="Retirar" busy={busy} error={err} canConfirm={reason.trim().length >= 8}>
        <p>Deja de ser un objetivo. Las {row.completions} compleciones e insignias ya concedidas se conservan.</p>
        <Textarea aria-label="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (8 caracteres o más)" />
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "deleteDraft" })} title={`Borrar borrador ${row.id}`} risk="MEDIUM" confirmLabel="Borrar" busy={busy} error={err}>
        Solo se borra el borrador; nunca un set publicado.
      </ConfirmDialog>
    </Panel>
  );
}
