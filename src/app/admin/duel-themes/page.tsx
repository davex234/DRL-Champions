"use client";

/**
 * F71 · /admin/duel-themes — TEMÁTICAS DE DUELO. Solo visual: el fondo del recinto del duelo (no toca reglas, stats,
 * recompensas, rating ni economía).
 *
 * Un tema = un fondo subido con el Asset Manager de F60 (validado en servidor) + nombre, slug, estado, fechas
 * opcionales, prioridad y «por defecto». Vigente: evento activo en fechas con más prioridad → el por defecto del
 * panel → la arena de siempre (DEFAULT de código). Cada cambio queda en Auditoría.
 */
import { useState } from "react";
import { PageHeader, Panel, Loading, ErrorBox, Pill, Button, Field, Input, Select, Empty } from "@/components/admin/cc/ui";
import { useAdminQuery, adminPost, dateTime } from "@/components/admin/cc/api";
import { AssetUploader } from "@/components/admin/cms/cms";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("admin");

interface Theme {
  id: string; slug: string; name: string; status: "active" | "inactive"; startAt: string | null; endAt: string | null;
  priority: number; isDefault: boolean; rev: number; assetStatus: string; wide: string | null; narrow: string | null;
  assetName: string; width: number | null; height: number | null;
}
interface ActiveTheme { id: string; slug: string; name: string; wide: string; narrow: string; source: "event" | "panel-default" | "code-default" }
interface View { themes: Theme[]; backgrounds: { id: string; name: string; url: string | null; width: number | null; height: number | null }[]; active: ActiveTheme; codeDefault: ActiveTheme }

interface Draft { assetId: string; slug: string; name: string; status: "active" | "inactive"; startAt: string; endAt: string; priority: string; isDefault: boolean; expectedRev: number | null }

const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
const SOURCE: Record<ActiveTheme["source"], string> = { event: "Evento activo", "panel-default": "Por defecto (panel)", "code-default": "Por defecto (arena de siempre)" };

export default function DuelThemesPage() {
  useLocale();
  const q = useAdminQuery<View>("/api/admin/cms/duel-themes");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edit = (t: Theme) => setDraft({ assetId: t.id, slug: t.slug, name: t.name, status: t.status, startAt: toLocal(t.startAt), endAt: toLocal(t.endAt), priority: String(t.priority), isDefault: t.isDefault, expectedRev: t.rev });
  const fresh = (assetId: string) => setDraft({ assetId, slug: "", name: "", status: "inactive", startAt: "", endAt: "", priority: "0", isDefault: false, expectedRev: null });

  const run = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { await adminPost("/api/admin/cms/duel-themes", body); setDraft(null); q.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : tr("No se pudo guardar")); }
    finally { setBusy(false); }
  };
  const save = (d: Draft) => run({
    action: "save", assetId: d.assetId, expectedRev: d.expectedRev,
    theme: { slug: d.slug, name: d.name, status: d.status, priority: Number(d.priority || 0), isDefault: d.isDefault,
      startAt: d.startAt ? new Date(d.startAt).toISOString() : null, endAt: d.endAt ? new Date(d.endAt).toISOString() : null },
  });
  const toggle = (t: Theme) => run({ action: "save", assetId: t.id, expectedRev: t.rev, theme: { ...t, status: t.status === "active" ? "inactive" : "active" } });
  const makeDefault = (t: Theme) => run({ action: "save", assetId: t.id, expectedRev: t.rev, theme: { ...t, isDefault: true, startAt: null, endAt: null, status: "active" } });

  return (
    <div className="space-y-5" data-testid="admin-duel-themes">
      <PageHeader eyebrow={tr("Contenido")} title={tr("Temáticas de duelo")}
        description={tr("El fondo del duelo por evento. Solo visual: no cambia reglas, recompensas, rating ni economía. Sin evento vigente se usa el por defecto; si nada vale, la arena de siempre.")} />
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {error && <ErrorBox error={td(error)} />}
      {!q.data ? <Loading rows={5} /> : (
        <>
          <Panel title={tr("Vigente ahora")} tone="cyan">
            <div className="flex flex-wrap items-center gap-4" data-testid="duel-theme-active">
              <img src={q.data.active.narrow} alt="" className="h-20 w-36 rounded-[6px] border border-white/10 object-cover" />
              <div>
                <b className="font-display text-[16px] uppercase text-ink-primary">{q.data.active.name}</b>
                <p className="text-[12px] text-ink-faint">{tr("{origen} · slug «{slug}»", { origen: td(SOURCE[q.data.active.source]), slug: q.data.active.slug })}</p>
              </div>
            </div>
          </Panel>

          <Panel title={tr("Temas")} subtitle={tr("Evento = activo y en fechas; gana la mayor prioridad. Solo un tema puede ser el por defecto.")}>
            {q.data.themes.length === 0 ? <Empty title={tr("Sin temas")}>{tr("Sube un fondo y crea el primero.")}</Empty> : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {q.data.themes.map((t) => (
                  <li key={t.id} className="overflow-hidden rounded-panel border border-white/10" data-testid={`duel-theme-${t.slug}`}>
                    {t.narrow ? <img src={t.narrow} alt={tr("Fondo {name}", { name: t.name })} loading="lazy" className="aspect-[16/8] w-full bg-[#070a10] object-cover" /> : <div className="aspect-[16/8] w-full bg-[#070a10]" />}
                    <div className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <b className="font-display text-[15px] uppercase text-ink-primary">{t.name}</b>
                        <span className="flex gap-1">
                          {t.isDefault && <Pill tone="gold">{tr("Por defecto")}</Pill>}
                          <Pill tone={t.status === "active" ? "ok" : "default"}>{t.status === "active" ? tr("Activo") : tr("Inactivo")}</Pill>
                        </span>
                      </div>
                      <p className="text-[12px] text-ink-faint">{tr("«{slug}» · prioridad {prioridad} · {fechas}", { slug: t.slug, prioridad: t.priority, fechas: t.startAt || t.endAt ? `${dateTime(t.startAt)} → ${dateTime(t.endAt)}` : tr("sin fechas") })}{t.assetStatus !== "approved" ? (" " + tr("· fondo no aprobado")) : ""}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => edit(t)} disabled={busy}>{tr("Editar")}</Button>
                        <Button size="sm" variant="ghost" onClick={() => toggle(t)} disabled={busy}>{t.status === "active" ? tr("Desactivar") : tr("Activar")}</Button>
                        {!t.isDefault && <Button size="sm" variant="ghost" onClick={() => makeDefault(t)} disabled={busy}>{tr("Hacer por defecto")}</Button>}
                        <Button size="sm" variant="ghost" onClick={() => run({ action: "remove", assetId: t.id, expectedRev: t.rev })} disabled={busy}>{tr("Retirar tema")}</Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={tr("Nuevo tema")} subtitle={tr("Primero el fondo (se valida en servidor: formato, tamaño, dimensiones y proporción); después sus datos.")}>
            <AssetUploader kind="background" label={tr("Fondo de arena (panorámico)")} onUploaded={(a) => fresh(a.id)} />
            {q.data.backgrounds.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-[12px] text-ink-faint">{tr("O usa un fondo ya subido:")}</p>
                <ul className="flex flex-wrap gap-2">
                  {q.data.backgrounds.map((b) => (
                    <li key={b.id}><button type="button" className="nx-focus overflow-hidden rounded-[6px] border border-white/10 hover:border-drl-cyan/60" onClick={() => fresh(b.id)} title={b.name}>
                      {b.url ? <img src={b.url} alt={b.name} className="h-14 w-28 object-cover" loading="lazy" /> : <span className="block h-14 w-28" />}
                    </button></li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {draft && (
            <Panel title={draft.expectedRev == null ? tr("Crear tema") : tr("Editar tema")} tone="gold">
              <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void save(draft); }} data-testid="duel-theme-form">
                <Field label={tr("Nombre")} htmlFor="dt-name"><Input id="dt-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={60} /></Field>
                <Field label={tr("Slug")} hint={tr("a-z, 0-9 y guiones")} htmlFor="dt-slug"><Input id="dt-slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })} required maxLength={40} /></Field>
                <Field label={tr("Estado")} htmlFor="dt-status"><Select id="dt-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}><option value="inactive">{tr("Inactivo")}</option><option value="active">{tr("Activo")}</option></Select></Field>
                <Field label={tr("Prioridad")} hint={tr("0–1000; gana la mayor")} htmlFor="dt-prio"><Input id="dt-prio" type="number" min={0} max={1000} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} /></Field>
                <Field label={tr("Inicio (opcional)")} htmlFor="dt-start"><Input id="dt-start" type="datetime-local" value={draft.startAt} onChange={(e) => setDraft({ ...draft, startAt: e.target.value })} disabled={draft.isDefault} /></Field>
                <Field label={tr("Fin (opcional)")} htmlFor="dt-end"><Input id="dt-end" type="datetime-local" value={draft.endAt} onChange={(e) => setDraft({ ...draft, endAt: e.target.value })} disabled={draft.isDefault} /></Field>
                <label className="flex items-center gap-2 text-[13px] text-ink-secondary md:col-span-2">
                  <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked, startAt: e.target.checked ? "" : draft.startAt, endAt: e.target.checked ? "" : draft.endAt })} />
                  {tr("Tema por defecto (sin fechas; sustituye a la arena de siempre cuando no hay evento)")}
                </label>
                <div className="flex gap-2 md:col-span-2">
                  <Button type="submit" disabled={busy}>{busy ? tr("Guardando…") : tr("Guardar")}</Button>
                  <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>{tr("Cancelar")}</Button>
                </div>
              </form>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
