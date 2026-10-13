"use client";

/**
 * F83 · /admin/seasons — TEMPORADAS DE LA RUTA (BD), dentro del Control Center existente.
 *
 * Crear el borrador (plantilla), editar fechas, curva, XP por fuente, recompensas por nivel y retos diarios/semanales,
 * previsualizar (validación + TOTAL de recompensas posibles + simulación de perfiles) y publicar (escribiendo PUBLICAR)
 * o cancelar antes de empezar. Lo decide el servidor (`server/cms/seasons.ts`); la BD congela lo publicado.
 */
import { useEffect, useState } from "react";
import { useAdminQuery, adminPost, dateTime, fmt } from "@/components/admin/cc/api";
import { Panel, Pill, Button, Field, Input, Select, Textarea, ConfirmDialog, DataTable, ErrorBox, Loading, KV } from "@/components/admin/cc/ui";
import { PACKS } from "@/data/packs";
import { CHALLENGE_CONDITIONS } from "@/domain/seasonTrack/validate";
import type { AdminSeasonRow, SeasonPreview } from "@/server/cms/seasons";
import type { ChallengeDef, LevelReward, SeasonConfig } from "@/domain/seasonTrack/types";

const URL = "/api/admin/cms/seasons";
const tone = (p: string) => (p === "ACTIVE" ? "ok" : p === "SCHEDULED" ? "cyan" : p === "DRAFT" ? "default" : p === "CANCELLED" ? "bad" : "warn") as "ok" | "cyan" | "default" | "bad" | "warn";
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

export function SeasonTrackAdmin() {
  const q = useAdminQuery<{ seasons: AdminSeasonRow[]; legacy: { id: string; name: string; startsAt: string; endsAt: string }[] }>(URL);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seasons = q.data?.seasons ?? [];
  const create = async () => {
    setBusy(true); setErr(null);
    try { const s = await adminPost<{ id: string }>(URL, { action: "create" }); setSelected(s.id); q.reload(); } catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-4" data-testid="season-track-admin">
      <Panel title="Ruta de temporada (F83)" subtitle="Temporadas en BD: XP de temporada, retos y recompensas por nivel. Una temporada publicada queda congelada; no puede solaparse con otra ni con el pase heredado del calendario."
        actions={<Button variant="ghost" size="sm" disabled={busy || seasons.some((s) => s.status === "DRAFT")} onClick={() => void create()} data-testid="season-create">Nuevo borrador</Button>}>
        {err && <ErrorBox error={err} />}
        {q.loading && <Loading />}
        {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
        {q.data && (seasons.length === 0 ? <p className="text-[14px] text-ink-muted">Sin temporadas de la ruta. Crea el borrador de la primera.</p> : (
          <DataTable caption="Temporadas de la ruta" rows={seasons} rowKey={(r) => r.id}
            cols={[
              { key: "n", label: "Temporada", render: (r) => <button type="button" className="nx-focus text-left font-bold text-ink-primary underline-offset-2 hover:underline" onClick={() => setSelected(r.id)} data-season={r.id}>{r.name}</button> },
              { key: "f", label: "Fase", render: (r) => <Pill tone={tone(r.phase)}>{r.phase}</Pill> },
              { key: "s", label: "Inicio", render: (r) => dateTime(new Date(r.startsAt).toISOString()) },
              { key: "e", label: "Fin", render: (r) => dateTime(new Date(r.endsAt).toISOString()) },
              { key: "c", label: "Créditos máx.", align: "right", render: (r) => fmt(r.economy.credits) },
              { key: "p", label: "Sobres máx.", align: "right", render: (r) => r.economy.packs.map((p) => `${p.count}×${p.packId}`).join(" · ") || "—" },
            ]} />
        ))}
      </Panel>
      {selected && <SeasonEditor key={selected} id={selected} row={seasons.find((s) => s.id === selected) ?? null} onChanged={() => q.reload()} />}
    </section>
  );
}

function SeasonEditor({ id, row, onChanged }: { id: string; row: AdminSeasonRow | null; onChanged: () => void }) {
  const [pv, setPv] = useState<SeasonPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "publish" | "cancel" | "delete">(null);
  const [reason, setReason] = useState("");
  const [f, setF] = useState(() => row ? { name: row.name, description: row.description, startsAt: iso(row.startsAt), endsAt: iso(row.endsAt), claimUntil: iso(row.claimUntil), maxLevel: row.maxLevel, base: row.config.curve.base, step: row.config.curve.step } : null);
  const [cfg, setCfg] = useState<SeasonConfig | null>(row ? structuredClone(row.config) : null);
  useEffect(() => { void adminPost<SeasonPreview>(URL, { action: "preview", id }).then(setPv).catch((e) => setErr(e instanceof Error ? e.message : "Error")); }, [id, row?.rowVersion]);
  if (!row || !f || !cfg) return <Panel title="Temporada"><p className="text-[14px] text-ink-muted">La temporada ya no existe.</p></Panel>;
  const draft = row.status === "DRAFT";
  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try { await adminPost(URL, { id, expectedVersion: row.rowVersion, ...body }); setConfirm(null); setReason(""); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  };
  const setReward = (i: number, r: LevelReward) => setCfg({ ...cfg, rewards: cfg.rewards.map((x, k) => (k === i ? r : x)) });
  const setCh = (kind: "daily" | "weekly", i: number, c: ChallengeDef) => setCfg({ ...cfg, challenges: { ...cfg.challenges, [kind]: { ...cfg.challenges[kind], pool: cfg.challenges[kind].pool.map((x, k) => (k === i ? c : x)) } } });
  const num = (v: string) => (v === "" ? 0 : Math.trunc(Number(v)));
  return (
    <Panel title={row.name} subtitle={`${row.id} · temporada ${row.number} · ${row.status}${row.checksum ? ` · sha256 ${row.checksum.slice(0, 12)}…` : ""}`} actions={<Pill tone={tone(row.phase)}>{row.phase}</Pill>}>
      <div className="space-y-6" data-testid="season-editor">
        {err && <ErrorBox error={err} />}
        {pv && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div data-testid="season-preview">
              <h3 className="mb-2 font-display text-[13px] font-bold uppercase tracking-wide text-ink-secondary">Validación</h3>
              {pv.issues.length === 0 ? <p className="text-[13px] text-emerald-300" data-testid="season-valid">Validación completa: lista para publicar.</p>
                : <ul className="space-y-1 rounded border border-amber-300/30 bg-amber-300/[0.06] p-3 text-[13px]" data-testid="season-issues">{pv.issues.map((i, k) => <li key={k}><b>{i.code}</b>{i.detail ? ` · ${i.detail}` : ""}</li>)}</ul>}
              <h3 className="mb-2 mt-4 font-display text-[13px] font-bold uppercase tracking-wide text-ink-secondary">Total posible por jugador</h3>
              <KV items={[["Créditos", fmt(pv.economy.credits)], ["Sobres", pv.economy.packs.map((p) => `${p.count} × ${PACKS.find((x) => x.id === p.packId)?.name ?? p.packId}`).join(" · ") || "—"], ["Valor de los sobres", `${fmt(pv.economy.packValue)} créditos`], ["Insignias", pv.economy.badges.join(", ") || "—"], ["Valor total", `${fmt(pv.economy.totalValue)} créditos (${pv.seasonDays} días)`]]} />
            </div>
            <div>
              <h3 className="mb-2 font-display text-[13px] font-bold uppercase tracking-wide text-ink-secondary">Simulación (sobre la definición)</h3>
              <DataTable caption="Perfiles" rows={pv.simulation} rowKey={(r) => r.id} cols={[
                { key: "p", label: "Perfil", render: (r) => r.label },
                { key: "d", label: "XP/día", align: "right", render: (r) => fmt(r.xpPerDay) },
                { key: "l", label: "Nivel final", align: "right", render: (r) => r.levelAtEnd },
                { key: "m", label: "Días al máx.", align: "right", render: (r) => r.daysToMax ?? "—" },
                { key: "c", label: "Créditos", align: "right", render: (r) => fmt(r.credits) },
                { key: "s", label: "Sobres", align: "right", render: (r) => r.packs },
              ]} />
            </div>
          </div>
        )}

        <fieldset disabled={!draft || busy} className="space-y-4">
          <legend className="font-display text-[13px] font-bold uppercase tracking-wide text-ink-secondary">Datos y curva {draft ? "" : "(congelados)"}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Nombre" htmlFor="st-name"><Input id="st-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Nivel máximo" htmlFor="st-max"><Input id="st-max" type="number" value={f.maxLevel} onChange={(e) => setF({ ...f, maxLevel: num(e.target.value) })} /></Field>
            <Field label="Inicio (ISO UTC)" htmlFor="st-start"><Input id="st-start" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
            <Field label="Fin (ISO UTC)" htmlFor="st-end"><Input id="st-end" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
            <Field label="Reclamar hasta (ISO UTC)" htmlFor="st-claim"><Input id="st-claim" value={f.claimUntil} onChange={(e) => setF({ ...f, claimUntil: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="XP base por nivel" htmlFor="st-base"><Input id="st-base" type="number" value={f.base} onChange={(e) => setF({ ...f, base: num(e.target.value) })} /></Field>
              <Field label="Incremento por nivel" htmlFor="st-step"><Input id="st-step" type="number" value={f.step} onChange={(e) => setF({ ...f, step: num(e.target.value) })} /></Field>
            </div>
          </div>
          <Field label="Descripción" htmlFor="st-desc"><Textarea id="st-desc" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Button size="sm" onClick={() => void act({ action: "update", patch: { name: f.name, description: f.description, startsAt: f.startsAt, endsAt: f.endsAt, claimUntil: f.claimUntil, maxLevel: f.maxLevel, curve: { base: f.base, step: f.step } } })}>Guardar datos y curva</Button>
        </fieldset>

        <fieldset disabled={!draft || busy} className="space-y-3">
          <legend className="font-display text-[13px] font-bold uppercase tracking-wide text-ink-secondary">XP por fuente</legend>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([["PVE", "Partida IA"], ["DRAFT", "Partida Draft"], ["RANKED", "Partida ranked"], ["winBonus", "Bonus victoria"], ["dailyCap", "Tope diario partidas"]] as const).map(([k, l]) => (
              <Field key={k} label={l} htmlFor={`st-x-${k}`}><Input id={`st-x-${k}`} type="number" value={cfg.xp.match[k]} onChange={(e) => setCfg({ ...cfg, xp: { ...cfg.xp, match: { ...cfg.xp.match, [k]: num(e.target.value) } } })} /></Field>
            ))}
            <Field label="Crafteo" htmlFor="st-x-craft"><Input id="st-x-craft" type="number" value={cfg.xp.craft.amount} onChange={(e) => setCfg({ ...cfg, xp: { ...cfg.xp, craft: { ...cfg.xp.craft, amount: num(e.target.value) } } })} /></Field>
            <Field label="Tope diario crafteo" htmlFor="st-x-craftcap"><Input id="st-x-craftcap" type="number" value={cfg.xp.craft.dailyCap} onChange={(e) => setCfg({ ...cfg, xp: { ...cfg.xp, craft: { ...cfg.xp.craft, dailyCap: num(e.target.value) } } })} /></Field>
            <Field label="Colección completada" htmlFor="st-x-col"><Input id="st-x-col" type="number" value={cfg.xp.collection} onChange={(e) => setCfg({ ...cfg, xp: { ...cfg.xp, collection: num(e.target.value) } })} /></Field>
          </div>
          <Button size="sm" onClick={() => void act({ action: "update", patch: { xp: cfg.xp } })}>Guardar XP</Button>
        </fieldset>

        <fieldset disabled={!draft || busy} className="space-y-3">
          <legend className="font-display text-[13px] font-bold uppercase tracking-wide text-ink-secondary">Recompensas por nivel ({cfg.rewards.length})</legend>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]" data-testid="season-rewards">
              <thead className="text-ink-muted"><tr><th className="py-1">Nivel</th><th>Créditos</th><th>Sobre</th><th>Cantidad</th><th>Insignia</th><th /></tr></thead>
              <tbody>
                {cfg.rewards.map((r, i) => (
                  <tr key={i} className="border-t border-white/[0.06]">
                    <td className="py-1 pr-2"><Input aria-label={`Nivel de la fila ${i + 1}`} type="number" className="w-20" value={r.level} onChange={(e) => setReward(i, { ...r, level: num(e.target.value) })} /></td>
                    <td className="pr-2"><Input aria-label={`Créditos nivel ${r.level}`} type="number" className="w-28" value={r.reward.credits ?? ""} onChange={(e) => setReward(i, { ...r, reward: { ...r.reward, credits: e.target.value === "" ? undefined : num(e.target.value) } })} /></td>
                    <td className="pr-2"><Select aria-label={`Sobre nivel ${r.level}`} value={r.reward.packId ?? ""} onChange={(e) => setReward(i, { ...r, reward: { ...r.reward, packId: e.target.value || undefined, packCount: e.target.value ? r.reward.packCount ?? 1 : undefined } })}><option value="">—</option>{PACKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></td>
                    <td className="pr-2"><Input aria-label={`Cantidad de sobres nivel ${r.level}`} type="number" className="w-20" value={r.reward.packCount ?? ""} onChange={(e) => setReward(i, { ...r, reward: { ...r.reward, packCount: e.target.value === "" ? undefined : num(e.target.value) } })} /></td>
                    <td className="pr-2"><Input aria-label={`Insignia nivel ${r.level}`} value={r.reward.badge ?? ""} placeholder="insignia:temporada:…" onChange={(e) => setReward(i, { ...r, reward: { ...r.reward, badge: e.target.value || undefined } })} /></td>
                    <td><Button size="sm" variant="ghost" onClick={() => setCfg({ ...cfg, rewards: cfg.rewards.filter((_, k) => k !== i) })}>Quitar</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCfg({ ...cfg, rewards: [...cfg.rewards, { level: Math.min(row.maxLevel, (cfg.rewards.at(-1)?.level ?? 0) + 1), reward: { credits: 100 } }] })}>Añadir nivel</Button>
            <Button size="sm" onClick={() => void act({ action: "update", patch: { rewards: cfg.rewards.map((r) => ({ level: r.level, reward: Object.fromEntries(Object.entries(r.reward).filter(([, v]) => v !== undefined)) })) } })}>Guardar recompensas</Button>
          </div>
        </fieldset>

        {(["daily", "weekly"] as const).map((kind) => (
          <fieldset key={kind} disabled={!draft || busy} className="space-y-3">
            <legend className="font-display text-[13px] font-bold uppercase tracking-wide text-ink-secondary">Retos {kind === "daily" ? "diarios" : "semanales"} · se eligen {cfg.challenges[kind].count} por periodo (una familia por reto)</legend>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]" data-testid={`season-challenges-${kind}`}>
                <thead className="text-ink-muted"><tr><th className="py-1">Id</th><th>Texto</th><th>Familia</th><th>Condición</th><th>Dificultad</th><th>Objetivo</th><th>XP</th><th /></tr></thead>
                <tbody>
                  {cfg.challenges[kind].pool.map((c, i) => (
                    <tr key={i} className="border-t border-white/[0.06]">
                      <td className="py-1 pr-2"><Input aria-label={`Id reto ${i + 1}`} className="w-32" value={c.id} onChange={(e) => setCh(kind, i, { ...c, id: e.target.value.trim() })} /></td>
                      <td className="pr-2"><Input aria-label={`Texto ${c.id}`} value={c.label} onChange={(e) => setCh(kind, i, { ...c, label: e.target.value })} /></td>
                      <td className="pr-2"><Input aria-label={`Familia ${c.id}`} className="w-24" value={c.family} onChange={(e) => setCh(kind, i, { ...c, family: e.target.value.trim() })} /></td>
                      <td className="pr-2"><Select aria-label={`Condición ${c.id}`} value={c.condition.type} onChange={(e) => setCh(kind, i, { ...c, condition: { ...c.condition, type: e.target.value as ChallengeDef["condition"]["type"] } })}>{[...CHALLENGE_CONDITIONS].map((t) => <option key={t} value={t}>{t}</option>)}</Select></td>
                      <td className="pr-2"><Select aria-label={`Dificultad ${c.id}`} value={c.condition.minDifficulty ?? ""} onChange={(e) => setCh(kind, i, { ...c, condition: { ...c.condition, minDifficulty: (e.target.value || undefined) as ChallengeDef["condition"]["minDifficulty"] } })}><option value="">—</option><option value="NORMAL">NORMAL</option><option value="HARD">HARD</option></Select></td>
                      <td className="pr-2"><Input aria-label={`Objetivo ${c.id}`} type="number" className="w-20" value={c.target} onChange={(e) => setCh(kind, i, { ...c, target: num(e.target.value) })} /></td>
                      <td className="pr-2"><Input aria-label={`XP ${c.id}`} type="number" className="w-20" value={c.xp} onChange={(e) => setCh(kind, i, { ...c, xp: num(e.target.value) })} /></td>
                      <td><Button size="sm" variant="ghost" onClick={() => setCfg({ ...cfg, challenges: { ...cfg.challenges, [kind]: { ...cfg.challenges[kind], pool: cfg.challenges[kind].pool.filter((_, k) => k !== i) } } })}>Quitar</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Retos por periodo" htmlFor={`st-count-${kind}`}><Input id={`st-count-${kind}`} type="number" className="w-24" value={cfg.challenges[kind].count} onChange={(e) => setCfg({ ...cfg, challenges: { ...cfg.challenges, [kind]: { ...cfg.challenges[kind], count: num(e.target.value) } } })} /></Field>
              <Button size="sm" variant="ghost" onClick={() => setCfg({ ...cfg, challenges: { ...cfg.challenges, [kind]: { ...cfg.challenges[kind], pool: [...cfg.challenges[kind].pool, { id: `${kind[0]}-nuevo-${cfg.challenges[kind].pool.length + 1}`, family: "nueva", label: "Juega 1 partida", condition: { type: "MATCH_PLAY" }, target: 1, xp: 100 }] } } })}>Añadir reto</Button>
              <Button size="sm" onClick={() => void act({ action: "update", patch: { challenges: cfg.challenges } })}>Guardar retos</Button>
            </div>
          </fieldset>
        ))}

        <div className="flex flex-wrap gap-2 border-t border-white/[0.08] pt-4">
          {draft && <Button disabled={busy || !pv || pv.issues.length > 0} onClick={() => setConfirm("publish")} data-testid="season-publish">Publicar</Button>}
          {draft && <Button variant="ghost" disabled={busy} onClick={() => setConfirm("delete")}>Borrar borrador</Button>}
          {row.status === "PUBLISHED" && row.phase === "SCHEDULED" && <Button variant="danger" disabled={busy} onClick={() => setConfirm("cancel")}>Cancelar (antes de empezar)</Button>}
        </div>
      </div>
      <ConfirmDialog open={confirm === "publish"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "publish", confirm: "PUBLICAR" })} title={`Publicar ${row.name}`} risk="CRITICAL" confirmLabel="Publicar" busy={busy} error={err} typeToConfirm="PUBLICAR">
        Congela fechas, curva, recompensas y retos. Desde {dateTime(new Date(row.startsAt).toISOString())} los jugadores ganarán XP de temporada y podrán reclamar hasta {pv ? fmt(pv.economy.credits) : "—"} créditos y {pv?.economy.packs.map((p) => `${p.count}×${p.packId}`).join(", ") || "ningún sobre"} cada uno.
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "cancel"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "cancel", reason })} title={`Cancelar ${row.name}`} risk="HIGH" confirmLabel="Cancelar temporada" busy={busy} error={err} canConfirm={reason.trim().length >= 8}>
        <Field label="Motivo (8+ caracteres)" htmlFor="st-reason"><Textarea id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} onConfirm={() => void act({ action: "deleteDraft" })} title={`Borrar ${row.name}`} risk="MEDIUM" confirmLabel="Borrar" busy={busy} error={err}>Se borra el borrador (nada publicado).</ConfirmDialog>
    </Panel>
  );
}
