/**
 * ESPORTS AUTO-SYNC · INFORME LEGIBLE (Fase 24.6) — para el dry run y la CLI.
 *
 * Solo enseña lo que el resultado contiene. No inventa ni redondea hacia arriba.
 */
import type { EsportsSyncRunResult, EventSyncReport } from "./runner";

const pad = (s: string | number, n: number): string => String(s).padEnd(n);

export function formatEventReport(e: EventSyncReport): string[] {
  const lines: string[] = [];
  const head = `${e.name ?? e.eventId} (${e.eventId}${e.vlrEventId ? ` · vlr ${e.vlrEventId}` : ""})`;
  lines.push(`Event: ${head}`);
  lines.push(`  estado: ${e.status}${e.reason ? ` — ${e.reason}` : ""}${e.class ? ` · clase ${e.class}` : ""}`);
  if (e.policy) {
    const next = e.policy.nextDueAt ? new Date(e.policy.nextDueAt).toISOString() : "—";
    lines.push(`  policy: intervalo ${Math.round(e.policy.intervalMs / 1000)} s · siguiente ${next} · ${e.policy.reason}`);
  }
  const m = e.matches;
  lines.push("  matches:");
  lines.push(`    ${pad(m.unchanged, 4)} unchanged`);
  lines.push(`    ${pad(m.created, 4)} ${e.status === "dry-run" ? "would create" : "created"}`);
  lines.push(`    ${pad(m.updated, 4)} ${e.status === "dry-run" ? "would update" : "updated"}`);
  lines.push(`    ${pad(m.finished, 4)} ${e.status === "dry-run" ? "would finish" : "finished"}`);
  if (m.corrections) lines.push(`    ${pad(m.corrections, 4)} corrections (resultado ya terminado que cambia)`);
  lines.push(`    ${pad(m.invalid, 4)} invalid`);
  if (m.rejected) lines.push(`    ${pad(m.rejected, 4)} rejected (regresión de estado)`);
  const b = e.bracket;
  lines.push("  bracket:");
  lines.push(`    ${pad(b.confirmed, 4)} confirmed edges${b.skipped ? ` (${b.skipped}: no se escriben)` : ""}`);
  lines.push(`    ${pad(b.qualification, 4)} qualification nodes`);
  lines.push(`    ${pad(b.conflicts, 4)} conflicts`);
  lines.push("  pickems:");
  if (e.status === "dry-run") {
    lines.push(`    ${e.pickems.needed ? "1 event would require lifecycle (questions/resolution/scoring)" : "0 events would require scoring"}`);
  } else {
    lines.push(`    ran=${e.pickems.ran} created=${e.pickems.created} resolved=${e.pickems.resolved} corrected=${e.pickems.corrected} scored=${e.pickems.scored} users=${e.pickems.usersScored}`);
  }
  if (e.identityIssues) lines.push(`  identidades sin resolver: ${e.identityIssues}`);
  for (const n of e.notifications) lines.push(`  ${n.level.toUpperCase()} ${n.code}: ${n.message}`);
  for (const w of e.warnings.slice(0, 5)) lines.push(`  ⚠ ${w}`);
  if (e.warnings.length > 5) lines.push(`  … y ${e.warnings.length - 5} aviso(s) más de la fuente`);
  return lines;
}

export function formatRunReport(r: EsportsSyncRunResult): string {
  const lines: string[] = [];
  lines.push("═".repeat(74));
  lines.push(`  ESPORTS SYNC · ${r.dryRun ? "DRY RUN" : "RUN"} · ${r.mode} · ${r.runId}`);
  lines.push("═".repeat(74));
  if (r.skipped) lines.push(`  skipped: ${r.skipped}`);
  lines.push(`  eventos: ${r.eventsChecked} comprobados · ${r.eventsDue} tocaban · ${r.eventsSynced} ok · ${r.eventsChanged} con cambios · ${r.eventsFailed} con error · ${r.eventsSkipped} omitidos`);
  lines.push(`  partidos: ${r.matchesChecked} en fuente · +${r.matchesCreated} nuevos · ${r.matchesUpdated} cambios · ${r.matchesFinished} terminados · ${r.matchesRejected} rechazados · ${r.matchesInvalid} inválidos`);
  lines.push(`  pickems: ${r.pickemsScored} evento(s) corregido(s) · ${r.pickemsCorrected} rectificación(es) · ${r.usersScored} usuarios puntuados`);
  lines.push(`  lock: ${r.lock.acquired ? "adquirido" : "no adquirido"}${r.lock.recoveredStale ? " (lease caducado recuperado)" : ""}${r.lock.holder ? ` · en poder de ${r.lock.holder}` : ""}`);
  lines.push(`  duración: ${r.durationMs} ms · siguiente: ${r.nextDueAt ?? "—"}`);
  if (r.errors.length) {
    lines.push("  errores:");
    for (const e of r.errors) lines.push(`    ✗ ${e}`);
  }
  for (const e of r.events) { lines.push(""); lines.push(...formatEventReport(e)); }
  lines.push("═".repeat(74));
  return lines.join("\n");
}
