"use client";

/**
 * F60 · /admin/maps — los mapas del Tactical Coach con su PREPARACIÓN real (asset, miniatura, encuadre, anclajes y grafo
 * de navegación) y su estado en el pool de esports. Sólo lectura: la navegación es regla de juego generada y versionada;
 * un mapa sin grafo sale NOT READY y no entra en el entrenador.
 */
import { PageHeader, Panel, Loading, ErrorBox, Pill, LevelBadge } from "@/components/admin/cc/ui";
import { useAdminQuery } from "@/components/admin/cc/api";

interface MapRow { id: string; name: string; width: number; height: number; sites: number; asset: string; thumb: string; checks: { key: string; label: string; ok: boolean }[]; ready: boolean; esportsPool: boolean | null; assetBytes: number | null }

export default function MapsPage() {
  const q = useAdminQuery<{ maps: MapRow[]; esportsOnly: string[] }>("/api/admin/cms/maps");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido" title="Mapas" description="Qué necesita cada mapa para ser jugable en el entrenador. Un mapa nuevo puede prepararse, pero no entra hasta tener asset, encuadre, anclajes y grafo de navegación válidos." />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!q.data ? <Loading rows={6} /> : (
        <Panel>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="maps-grid">
            {q.data.maps.map((m) => (
              <li key={m.id} className="overflow-hidden rounded-panel border border-white/10">
                <img src={m.thumb} alt={`Mapa ${m.name}`} loading="lazy" className="aspect-[16/10] w-full bg-[#070a10] object-contain" />
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-2"><b className="font-display text-[15px] uppercase text-ink-primary">{m.name}</b>{m.ready ? <LevelBadge level="HEALTHY" label="READY" /> : <LevelBadge level="WARNING" label="NOT READY" />}</div>
                  <p className="text-[12px] text-ink-faint">{m.width}×{m.height}px · {m.sites} sitios · {m.esportsPool === null ? "no está en esports" : m.esportsPool ? "pool activo esports" : "fuera del pool esports"}</p>
                  <ul className="flex flex-wrap gap-1">{m.checks.map((c) => <li key={c.key}><Pill tone={c.ok ? "ok" : "warn"}>{c.ok ? "✓" : "○"} {c.label}</Pill></li>)}</ul>
                </div>
              </li>
            ))}
          </ul>
          {q.data.esportsOnly.length > 0 && <p className="mt-3 text-[12px] text-ink-faint">Sólo en esports (sin versión táctica): {q.data.esportsOnly.join(", ")}</p>}
        </Panel>
      )}
    </div>
  );
}
