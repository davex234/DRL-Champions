"use client";

/**
 * F58 · /admin/system — versión, entorno, migraciones, flags (SOLO LECTURA) y comprobaciones de salud. Cada luz sale
 * de una comprobación real hecha en el servidor en esta petición; ninguna es decorativa. Nunca se muestran claves,
 * tokens ni cadenas de conexión: de una clave solo se dice si está configurada.
 */
import { useAdminQuery, fmt } from "@/components/admin/cc/api";
import { PageHeader, Panel, LevelBadge, Loading, ErrorBox, KV, Pill, Button, type Level } from "@/components/admin/cc/ui";

interface V {
  version: string; environment: string; migrationHead: string; schema: Record<string, boolean> | null; overall: Level;
  flags: { key: string; value: string; critical: boolean; note: string }[];
  checks: { id: string; label: string; level: Level; detail: string }[];
  catalog: { code: number; db: number | null; published: number | null };
}

export default function SystemPage() {
  const q = useAdminQuery<V>("/api/admin/system");
  const d = q.data;
  return (
    <>
      <PageHeader eyebrow="Control" title="Sistema" description="Salud comprobada en vivo. Los flags críticos son de solo lectura: el mercado y los pagos no se activan desde un interruptor del panel."
        actions={<Button variant="ghost" onClick={q.reload} disabled={q.loading}>{q.loading ? "Comprobando…" : "Volver a comprobar"}</Button>} />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={8} />}
      {d && (
        <div className="space-y-6">
          <Panel title="Estado general" actions={<LevelBadge level={d.overall} label={d.overall === "HEALTHY" ? "Todo en verde" : d.overall === "WARNING" ? "Con avisos" : "Crítico"} />}>
            <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{d.checks.map((c) => <li key={c.id} className="flex items-start gap-3 rounded-card border border-white/[0.07] bg-white/[0.02] px-3 py-2.5"><LevelBadge level={c.level} /><span><span className="block text-[14px] font-semibold text-ink-primary">{c.label}</span><span className="text-[12px] text-ink-muted">{c.detail}</span></span></li>)}</ul>
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Versión y datos">
              <KV items={[["Versión", `v${d.version}`], ["Entorno", d.environment], ["Cabeza de migraciones", d.migrationHead], ["Catálogo", `${fmt(d.catalog.db)} en BD · ${fmt(d.catalog.published)} publicadas · ${fmt(d.catalog.code)} en código`]]} />
              {d.schema && <div className="mt-4 flex flex-wrap gap-1.5">{Object.entries(d.schema).map(([k, v]) => <Pill key={k} tone={v ? "ok" : "bad"}>{v ? "✔" : "✖"} {k}</Pill>)}</div>}
            </Panel>
            <Panel title="Feature flags" subtitle="Solo lectura">
              <ul className="space-y-2">{d.flags.map((f) => (
                <li key={f.key} className="rounded-card border border-white/[0.07] px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2"><code className="text-[13px] text-ink-primary">{f.key}</code><Pill tone={f.value === "true" ? "bad" : f.value === "false" ? "ok" : "default"}>{f.value}</Pill>{f.critical && <Pill tone="warn">crítico</Pill>}</div>
                  <p className="mt-1 text-[12px] text-ink-faint">{f.note}</p>
                </li>
              ))}</ul>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
