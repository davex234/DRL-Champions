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
import { ns, td as i18nTd } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

const URL = "/api/admin/cms/collection-sets";
const tone = (s: string) => (s === "PUBLISHED" ? "ok" : s === "RETIRED" ? "bad" : "default") as "ok" | "bad" | "default";
const SKIP_TEXT: Record<string, string> = {
  NO_IDENTITY: "sin identidad canónica", IDENTITY_CONFLICT: "identidad en conflicto (20.2)", NO_LOGO: "sin logo real",
  TOO_FEW_PLAYERS: "menos de 4 jugadores", UNOBTAINABLE: "requisito no obtenible", TOO_SMALL: "edición demasiado pequeña", TOO_LARGE: "edición demasiado grande",
};

export default function CollectionSetsAdminPage() {
  useLocale();
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
      setNotice(t("{length} borradores creados · {length2} ya existían · {length3} descartados (ver Generador). Nada se ha publicado.", { length: r.created.length, length2: r.existing.length, length3: r.skipped.length }));
      q.reload();
    } catch (e) { setError(e instanceof Error ? e.message : t("Error")); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader eyebrow={t("Contenido · F82")} title={t("Colecciones")} description={t("Collection Sets de equipo y de edición. Los requisitos se congelan al publicar; un cambio de plantilla o de catálogo se publica como versión nueva. La recompensa es solo una insignia permanente.")} actions={<>
        <Button variant="ghost" onClick={() => void generate("TEAM")} disabled={busy} data-testid="gen-team">{t("Generar borradores de equipos")}</Button>
        <Button variant="ghost" onClick={() => void generate("EDITION")} disabled={busy} data-testid="gen-edition">{t("Generar borradores de ediciones")}</Button>
      </>} />
      {notice && <Panel tone="cyan"><p className="text-[14px] text-ink-secondary" data-testid="gen-notice">{i18nTd(notice)}</p></Panel>}
      {error && <ErrorBox error={i18nTd(error)} />}
      {q.loading && <Loading />}
      {q.error && <ErrorBox error={i18nTd(q.error)} onRetry={q.reload} />}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Borradores")} value={counts.draft} />
            <Stat label={t("Publicados")} value={counts.published} accent="ok" />
            <Stat label={t("Retirados")} value={counts.retired} accent="bad" />
            <Stat label={t("Compleciones")} value={counts.completions} accent="gold" />
          </div>
          <Tabs value={tab} onChange={setTab} label={t("Secciones")} items={[{ id: "sets", label: t("Sets"), count: sets.length }, { id: "generator", label: t("Generador (auditoría)"), count: q.data.proposals.length }]} />
          {tab === "sets" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <Panel title={t("Sets")} subtitle={t("Elige uno para revisar, editar o publicar")}>
                {sets.length === 0 ? <Empty title={t("Aún no hay sets")}>{t("Genera borradores desde la BD con los botones de arriba.")}</Empty> : (
                  <ul className="divide-y divide-white/[0.06]" data-testid="admin-set-list">
                    {sets.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => setSelected(s.id)} data-set={s.id}
                          className={`nx-focus flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-white/[0.04] ${selected === s.id ? "bg-white/[0.06]" : ""}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold text-white">{i18nTd(s.title)}</span>
                            <span className="block truncate text-[12px] text-ink-muted">{t("{id} · {tipo} · v{version} · {requisitos} requisitos · {compleciones} compleciones", { id: s.id, tipo: i18nTd(s.kind), version: s.version, requisitos: s.requirements.length, compleciones: s.completions })}</span>
                          </span>
                          <Pill tone={tone(s.status)}>{i18nTd(s.status)}</Pill>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {selected ? <SetEditor key={selected} id={selected} row={sets.find((s) => s.id === selected) ?? null} onChanged={() => q.reload()} /> : <Panel title={t("Detalle")}><p className="text-[14px] text-ink-muted">{t("Selecciona un set.")}</p></Panel>}
            </div>
          )}
          {tab === "generator" && (
            <Panel title={t("Lo que la BD permite hoy")} subtitle={t("Resultado del generador sobre el catálogo real: candidatos y descartes con su motivo. No escribe nada.")}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]" data-testid="generator-table">
                  <thead className="text-ink-muted"><tr><th className="py-1 pr-3">{t("Tipo")}</th><th className="py-1 pr-3">{t("Sujeto")}</th><th className="py-1 pr-3">{t("Resultado")}</th><th className="py-1">{t("Estado")}</th></tr></thead>
                  <tbody>
                    {q.data.proposals.map(({ result, exists }) => (
                      <tr key={`${result.kind}:${result.subjectId}`} className="border-t border-white/[0.06]">
                        <td className="py-1 pr-3">{i18nTd(result.kind)}</td>
                        <td className="py-1 pr-3 text-white">{i18nTd(result.title)}</td>
                        <td className="py-1 pr-3">{"skip" in result ? <span className="text-ink-muted">{result.skip.map((k) => i18nTd(SKIP_TEXT[k]) ?? k).join(" · ")}{result.detail ? ` — ${result.detail}` : ""}</span> : <span>{result.logo ? t("{n} requisitos · logo real", { n: result.requirements.length }) : t("{n} requisitos", { n: result.requirements.length })}</span>}</td>
                        <td className="py-1">{"skip" in result ? <Pill tone="warn">{t("Descartado")}</Pill> : exists ? <Pill tone="cyan">{t("Ya existe")}</Pill> : <Pill tone="ok">{t("Elegible")}</Pill>}</td>
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
  useLocale();
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
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : t("Error")); });
    return () => { live = false; };
  }, [id, rowVersion]);

  const act = async (body: Record<string, unknown>) => {
    if (!row) return;
    setBusy(true); setErr(null);
    try { await adminPost(URL, { id, expectedVersion: row.rowVersion, ...body }); setConfirm(null); setReason(""); setAddId(""); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : t("Error")); } finally { setBusy(false); }
  };

  if (!row) return <Panel title={t("Detalle")}><p className="text-[14px] text-ink-muted">{t("El set ya no existe.")}</p></Panel>;
  const draft = row.status === "DRAFT";
  return (
    <Panel title={i18nTd(row.title)} subtitle={`${row.id} · ${row.family} · v${row.version} · ${row.status}${row.checksum ? ` · sha256 ${row.checksum.slice(0, 12)}…` : ""}`} actions={<Pill tone={tone(row.status)}>{i18nTd(row.status)}</Pill>}>
      {err && <ErrorBox error={i18nTd(err)} />}
      {!pv ? <Loading rows={3} /> : (
        <div className="space-y-4" data-testid="admin-set-detail">
          <div className="flex flex-wrap items-center gap-4">
            <TrophyBadge badge={{ id: row.reward.badgeId, label: row.title, logo: row.logo, color: row.kind === "TEAM" ? "#19e3ff" : "#ffce4f", kind: row.kind, caption: row.kind === "TEAM" ? t("Equipo completado") : t("Edición") }} size="md" showLabel />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
              <dt className="text-ink-muted">{t("Jugadores")}</dt><dd className="text-white">{pv.players}</dd>
              <dt className="text-ink-muted">{t("Requisitos")}</dt><dd className="text-white">{pv.set.requirements.length}</dd>
              <dt className="text-ink-muted">{t("Insignia")}</dt><dd className="truncate text-white">{row.reward.badgeId}</dd>
              <dt className="text-ink-muted">{t("Logo")}</dt><dd className="truncate text-white">{i18nTd(row.logo) ?? t("— (lenguaje visual propio)")}</dd>
              <dt className="text-ink-muted">{t("Ya lo cumplen")}</dt><dd className="text-white" data-testid="estimated">{pv.estimatedCompleters ?? "—"} {t("usuarios")}</dd>
              <dt className="text-ink-muted">{t("Compleciones")}</dt><dd className="text-white">{row.completions}</dd>
            </dl>
          </div>
          {draft && (pv.issues.length ? (
            <div className="rounded border border-amber-300/30 bg-amber-300/[0.06] p-3 text-[13px]" data-testid="publish-issues">
              <p className="font-semibold text-amber-200">{t("No se puede publicar todavía:")}</p>
              <ul className="mt-1 list-disc pl-5 text-ink-secondary">{pv.issues.map((i, k) => <li key={k}>{i.code}{i.detail ? ` — ${i.detail}` : ""}</li>)}</ul>
            </div>
          ) : <p className="text-[13px] text-emerald-300" data-testid="publish-ok">{t("Validación completa: listo para publicar.")}</p>)}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]" data-testid="admin-requirements">
              <thead className="text-ink-muted"><tr><th className="py-1 pr-3">{t("Requisito")}</th><th className="py-1 pr-3">{t("Cartas elegibles")}</th>{draft && <th className="py-1" />}</tr></thead>
              <tbody>
                {pv.requirements.map((r) => (
                  <tr key={r.key} className="border-t border-white/[0.06] align-top">
                    <td className="py-1.5 pr-3 text-white">{i18nTd(r.label)}<span className="block text-[11px] text-ink-muted">{r.key} · {i18nTd(r.type)}</span></td>
                    <td className="py-1.5 pr-3">{r.cards.map((c) => <span key={c.id} className={`mr-2 inline-block ${c.obtainable ? "text-ink-secondary" : "text-red-300"}`}>{c.id} ({c.ovr}, {c.team}){c.obtainable ? "" : (" " + t("✕ no obtenible"))}</span>)}</td>
                    {draft && <td className="py-1.5"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void act({ action: "update", patch: { removeKey: r.key } })}>{t("Quitar")}</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {draft && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("Título")} htmlFor="cs-title"><Input id="cs-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label={t("Insignia (insignia:coleccion:…)")} htmlFor="cs-badge"><Input id="cs-badge" value={badgeId} onChange={(e) => setBadgeId(e.target.value)} /></Field>
              <div className="flex items-end gap-2 md:col-span-2">
                <Button size="sm" disabled={busy || (title === row.title && badgeId === row.reward.badgeId)} onClick={() => void act({ action: "update", patch: { ...(title !== row.title ? { title } : {}), ...(badgeId !== row.reward.badgeId ? { badgeId } : {}) } })}>{t("Guardar cambios")}</Button>
              </div>
              <Field label={row.kind === "TEAM" ? t("Añadir jugador (id del catálogo)") : t("Añadir carta (id del catálogo)")} htmlFor="cs-add">
                <Input id="cs-add" value={addId} onChange={(e) => setAddId(e.target.value.trim())} placeholder={row.kind === "TEAM" ? t("p. ej. jawgemo") : t("p. ej. jawgemo__champions-s")} />
              </Field>
              <div className="flex items-end"><Button size="sm" variant="ghost" disabled={busy || !addId} onClick={() => void act({ action: "update", patch: row.kind === "TEAM" ? { addPlayerId: addId } : { addCardId: addId } })}>{t("Añadir requisito")}</Button></div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {draft && <Button disabled={busy || pv.issues.length > 0} onClick={() => setConfirm("publish")} data-testid="publish">{t("Publicar")}</Button>}
            {draft && <Button variant="ghost" disabled={busy} onClick={() => setConfirm("delete")}>{t("Borrar borrador")}</Button>}
            {row.status === "PUBLISHED" && <Button variant="danger" disabled={busy} onClick={() => setConfirm("retire")}>{t("Retirar")}</Button>}
            {!draft && <Button variant="ghost" disabled={busy} onClick={() => void adminPost(URL, { action: "newVersion", family: row.family }).then(onChanged).catch((e) => setErr(e instanceof Error ? e.message : t("Error")))}>{t("Nueva versión (borrador)")}</Button>}
          </div>
        </div>
      )}
      <ConfirmDialog open={confirm === "publish"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "publish" })} title={t("Publicar {title}", { title: i18nTd(row.title) })} risk="HIGH" confirmLabel={t("Publicar")} busy={busy} error={i18nTd(err)} typeToConfirm={row.id}>
        {t("Los {n} requisitos y la insignia quedan CONGELADOS. Todos los jugadores verán este objetivo y {usuarios} ya podrían reclamarlo.", { n: row.requirements.length, usuarios: pv?.estimatedCompleters ?? "?" })}
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "retire"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "retire", reason })} title={t("Retirar {title}", { title: i18nTd(row.title) })} risk="HIGH" confirmLabel={t("Retirar")} busy={busy} error={i18nTd(err)} canConfirm={reason.trim().length >= 8}>
        <p>{t("Deja de ser un objetivo. Las {n} compleciones e insignias ya concedidas se conservan.", { n: row.completions })}</p>
        <Textarea aria-label={t("Motivo")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Motivo (8 caracteres o más)")} />
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "deleteDraft" })} title={t("Borrar borrador {id}", { id: row.id })} risk="MEDIUM" confirmLabel={t("Borrar")} busy={busy} error={i18nTd(err)}>
        {t("Solo se borra el borrador; nunca un set publicado.")}
      </ConfirmDialog>
    </Panel>
  );
}
