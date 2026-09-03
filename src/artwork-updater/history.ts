/**
 * HISTORY — consultas e INTEGRIDAD del historial: versiones, proveedor, fecha lógica,
 * cambio, motivo y usuario de cada evento. Auditoría de "cero pérdidas": secuencia global
 * monótona, versiones consecutivas sin huecos, current siempre existente.
 */
import type { ChangeEvent, LifecycleState, VersionedAsset } from "./types";

export const historyOf = (state: LifecycleState, assetId: string): ChangeEvent[] =>
  state.assets[assetId]?.history ?? [];

export const versionsOf = (state: LifecycleState, assetId: string): VersionedAsset["versions"] =>
  state.assets[assetId]?.versions ?? [];

/** Todos los eventos del estado en orden de secuencia (cronología global). */
export function timeline(state: LifecycleState): ChangeEvent[] {
  return Object.values(state.assets).flatMap((a) => a.history).sort((a, b) => a.seq - b.seq);
}

/** Auditoría de integridad (vacío = historial íntegro). */
export function auditLifecycle(state: LifecycleState): string[] {
  const issues: string[] = [];
  const seqs = timeline(state).map((e) => e.seq);
  for (let i = 1; i < seqs.length; i++) if (seqs[i] <= seqs[i - 1]) issues.push(`seq no monótona: ${seqs[i]} tras ${seqs[i - 1]}`);
  for (const a of Object.values(state.assets)) {
    a.versions.forEach((v, i) => { if (v.version !== i + 1) issues.push(`${a.assetId}: hueco de versiones en v${v.version}`); });
    if (!a.versions.some((v) => v.version === a.current)) issues.push(`${a.assetId}: current v${a.current} inexistente`);
    if (!a.history.length) issues.push(`${a.assetId}: sin historial`);
  }
  return issues;
}
