"use client";

/**
 * F79 · /admin/crafting → pestaña «Forge 2.0»: el documento de configuración de NEXUS FORGE (XP, curva, maestría,
 * recetas avanzadas, cadenas, planos, extras de proyecto, objetivos, logros, pity).
 *
 * El servidor valida TODO antes de guardar (`domain/forge/validate`): contenido REAL, suelo económico de cada receta
 * ACTIVA, nada activo que dependa de un borrador, sin ciclos, recompensas acotadas. Versión optimista y auditoría.
 * Lo nuevo nace DRAFT: guardar no publica nada; activar es cambiar el estado a ACTIVE, a mano, con su validación.
 */
import { useEffect, useMemo, useState } from "react";
import { Panel, Loading, ErrorBox, Pill, Button, Textarea, Field, Input } from "@/components/admin/cc/ui";
import { useAdminQuery, adminPost } from "@/components/admin/cc/api";
import type { ForgeConfig } from "@/domain/forge/types";

interface Review {
  regressions: { code: string; path: string; message: string }[];
  impact: { players: number; levelDrops: number; maxDrop: number; levelGains: number };
  problems: { code: string; message: string; path: string }[];
}
const CONFIRM_WORD = "RECALCULAR";

interface View {
  stored: boolean; reason: string; version: number; updatedAt: string | null;
  config: ForgeConfig; defaults: ForgeConfig;
  problems: { code: string; message: string; path: string }[];
  floors: { id: string; consumes: number; floor: { ratio: number; viable: boolean } | null }[];
}
const URL = "/api/admin/cms/forge";
const tone = (s: string) => (s === "ACTIVE" ? "ok" : s === "RETIRED" ? "bad" : "default") as "ok" | "bad" | "default";

export function ForgeAdminPanel() {
  const q = useAdminQuery<View>(URL);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // F79.1 · revisión previa (sin escribir): cambios regresivos + impacto real en jugadores.
  const [review, setReview] = useState<Review | null>(null);
  const [typed, setTyped] = useState("");
  useEffect(() => { if (q.data) setText(JSON.stringify(q.data.config, null, 2)); }, [q.data]);
  useEffect(() => { setReview(null); setTyped(""); }, [text]);
  const parsed = useMemo(() => {
    try {
      const doc = JSON.parse(text) as unknown;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false as const, err: "El documento debe ser un objeto JSON ({ … })" };
      return { ok: true as const, doc };
    } catch (e) { return { ok: false as const, err: e instanceof Error ? e.message : "JSON inválido" }; }
  }, [text]);

  const doSave = async (confirmRegression: boolean) => {
    if (!q.data || !parsed.ok) return;
    setBusy(true); setError(null); setSaved(null);
    try {
      const r = await adminPost<{ version: number }>(URL, { action: "save", doc: parsed.doc as Record<string, unknown>, expectedVersion: q.data.version, reason, ...(confirmRegression ? { confirmRegression: true } : {}) });
      setSaved(`Guardado · versión ${r.version}`); setReview(null); setTyped(""); q.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
  };
  // Guardar = primero revisar en el servidor. Si nada es regresivo, se guarda; si lo es, se para y se explica.
  const save = async () => {
    if (!q.data || !parsed.ok) return;
    setBusy(true); setError(null); setSaved(null);
    let rv: Review;
    try { rv = await adminPost<Review>(URL, { action: "impact", doc: parsed.doc as Record<string, unknown> }); }
    catch (e) { setError(e instanceof Error ? e.message : "Error"); setBusy(false); return; }
    setBusy(false);
    if (rv.problems.length > 0) { setReview(rv); setError(`El documento tiene ${rv.problems.length} problema(s): corrígelos antes de guardar.`); return; }
    if (rv.regressions.length > 0) { setReview(rv); return; }
    await doSave(false);
  };

  if (q.loading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  const c = q.data.config;
  const rows: { kind: string; id: string; name: string; status: string }[] = [
    ...c.recipes.map((r) => ({ kind: "Receta", id: r.id, name: r.name, status: r.status })),
    ...c.chains.map((r) => ({ kind: "Cadena", id: r.id, name: r.name, status: r.status })),
    ...c.blueprints.map((r) => ({ kind: "Plano", id: r.id, name: r.name, status: r.status })),
    ...c.objectives.map((r) => ({ kind: `Objetivo ${r.period === "DAILY" ? "diario" : "semanal"}`, id: r.id, name: r.name, status: r.status })),
    ...c.achievements.map((r) => ({ kind: "Logro", id: r.id, name: r.name, status: r.status })),
  ];
  return (
    <div className="space-y-4" data-testid="admin-forge">
      {!q.data.stored && (
        <Panel tone="gold" title="Migración 0061 pendiente">
          <p className="text-[14px] text-ink-secondary">La tabla <code>forge_config</code> aún no existe. La Forja funciona con la configuración por defecto (nivel, XP, maestría e historial; todo el contenido nuevo en borrador). Para guardar cambios hay que autorizar y aplicar <code>0061_forge_progression.sql</code>.</p>
        </Panel>
      )}
      <Panel title="Estado" subtitle={q.data.version ? `Versión ${q.data.version}${q.data.updatedAt ? ` · ${new Date(q.data.updatedAt).toLocaleString("es-ES")}` : ""}` : "Sin guardar: valores por defecto"}>
        <div className="flex flex-wrap gap-2">
          <Pill tone={c.enabled ? "ok" : "warn"}>Forge 2.0 {c.enabled ? "visible" : "oculta"}</Pill>
          <Pill tone={c.pity.enabled ? "warn" : "default"}>Pity {c.pity.enabled ? "ACTIVO" : "desactivado"}</Pill>
          <Pill tone="cyan">Curva {c.curve.base}·{c.curve.growth}^n · máx {c.curve.maxLevel}</Pill>
          <Pill tone={q.data.problems.length ? "bad" : "ok"}>{q.data.problems.length ? `${q.data.problems.length} problemas` : "Sin problemas"}</Pill>
        </div>
        {q.data.problems.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-bad">{q.data.problems.slice(0, 20).map((p, i) => <li key={i}>▲ <code>{p.path}</code> {p.message}</li>)}</ul>}
      </Panel>
      <Panel title="Contenido" subtitle="Todo lo nuevo nace DRAFT. Activar = cambiar su estado a ACTIVE en el documento (el servidor lo valida).">
        <ul className="divide-y divide-white/5">
          {rows.map((r) => {
            const f = q.data!.floors.find((x) => x.id === r.id);
            return (
              <li key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center gap-3 py-1.5">
                <span className="min-w-[120px] text-[12px] uppercase text-ink-muted">{r.kind}</span>
                <b className="min-w-[180px] text-ink-primary">{r.name}</b>
                <code className="text-[12px] text-ink-muted">{r.id}</code>
                <Pill tone={tone(r.status)}>{r.status}</Pill>
                {f?.floor && <Pill tone={f.consumes >= f.floor.ratio ? "cyan" : "warn"}>consume {f.consumes} · suelo {f.floor.ratio}</Pill>}
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="Cómo se calcula la progresión">
        <p className="text-[13px] text-ink-secondary" data-testid="admin-forge-policy">
          El nivel, la XP y la maestría de cada jugador se <b>calculan</b> con las reglas de este documento sobre su historial real.
          Subir XP, suavizar la curva o bajar umbrales es seguro (nadie baja). <b>Bajar XP, endurecer la curva, subir umbrales o
          devolver a borrador una cadena/objetivo vivo recalcularía a la baja a jugadores reales</b>: el servidor lo bloquea y solo se
          aplica con una confirmación explícita, un motivo y queda auditado.
        </p>
      </Panel>
      <Panel title="Documento" subtitle="JSON del documento completo. Se valida en servidor al guardar (contenido real, suelos, dependencias, recompensas).">
        <Textarea aria-label="Configuración de la Forja (JSON)" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[420px] font-mono text-[12px]" spellCheck={false} />
        {!parsed.ok && <p role="alert" className="mt-2 text-[13px] text-bad">▲ {parsed.err}</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Motivo (auditoría)" htmlFor="forge-reason"><Input id="forge-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
          <div className="flex items-end gap-2">
            <Button variant="ghost" onClick={() => setText(JSON.stringify(q.data!.defaults, null, 2))} disabled={busy}>Cargar valores por defecto</Button>
            <Button onClick={save} disabled={busy || !parsed.ok || !q.data.stored} data-testid="admin-forge-save">{busy ? "Revisando…" : "Revisar y guardar"}</Button>
          </div>
        </div>
        {review && review.problems.length > 0 && (
          <ul className="mt-3 space-y-1 text-[13px] text-bad" data-testid="admin-forge-problems">{review.problems.slice(0, 20).map((p, i) => <li key={i}>▲ <code>{p.path}</code> {p.message}</li>)}</ul>
        )}
        {review && review.problems.length === 0 && review.regressions.length > 0 && (
          <div role="alert" className="mt-4 border border-bad/60 bg-bad/10 p-4" data-testid="admin-forge-regression">
            <p className="text-[14px] font-bold text-bad">Este cambio puede BAJAR la progresión de jugadores reales</p>
            <ul className="mt-2 space-y-1 text-[13px] text-ink-secondary">{review.regressions.map((r, i) => <li key={i}>▼ {r.message} <code className="text-ink-muted">({r.path})</code></li>)}</ul>
            <p className="mt-2 text-[13px] text-ink-primary" data-testid="admin-forge-impact">
              Impacto calculado sobre el historial real: <b>{review.impact.levelDrops}</b> de {review.impact.players} jugadores con progreso bajarían de nivel
              {review.impact.levelDrops > 0 ? ` (hasta ${review.impact.maxDrop} nivel${review.impact.maxDrop === 1 ? "" : "es"})` : ""}; {review.impact.levelGains} subirían.
              Los planos y recetas que dependen del nivel también podrían volver a bloquearse.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label={`Escribe ${CONFIRM_WORD} para recalcular (y rellena el motivo, mín. 8 caracteres)`} htmlFor="forge-confirm">
                <Input id="forge-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="admin-forge-confirm-word" />
              </Field>
              <div className="flex items-end gap-2">
                <Button variant="ghost" onClick={() => setReview(null)} disabled={busy}>Cancelar</Button>
                <Button variant="danger" onClick={() => doSave(true)} disabled={busy || typed.trim() !== CONFIRM_WORD || reason.trim().length < 8} data-testid="admin-forge-recalc">Recalcular progresión y guardar</Button>
              </div>
            </div>
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-[13px] text-bad">▲ {error}</p>}
        {saved && <p role="status" className="mt-3 text-[13px] text-ok">✓ {saved}</p>}
      </Panel>
    </div>
  );
}
