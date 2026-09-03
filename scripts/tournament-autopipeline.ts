/**
 * `npm run tournament:autopipeline` — Auto Pipeline Coordinator (Watcher F3): transforma
 * eventos del Watcher en PipelineRequests deduplicados. Demo offline con el ejemplo
 * oficial (TeamEliminated + 2×StatisticsChanged ⇒ 1 petición GenerateReview). NUNCA
 * ejecuta ningún motor.
 */
import type { WatchEvent } from "@/tournament-watcher";
import { CoordinatorEngine, coordinatorMetrics } from "@/tournament-autopipeline";

async function main(): Promise<void> {
  const now = Date.now();
  const T = "valorant-masters-london-2026";
  const events: WatchEvent[] = [
    { seq: 1, at: now, tournamentId: T, kind: "team-eliminated", subject: "Team Heretics" },
    { seq: 2, at: now, tournamentId: T, kind: "statistics-changed", subject: "zekken" },
    { seq: 3, at: now, tournamentId: T, kind: "statistics-changed", subject: "Hereje" },
    { seq: 4, at: now, tournamentId: T, kind: "match-updated", subject: "m2" },
    { seq: 5, at: now, tournamentId: T, kind: "roster-changed", subject: "Madrid Wolves" },
  ];

  const engine = new CoordinatorEngine(() => now);
  const t0 = Date.now();
  const result = engine.ingest(events);
  const ms = Date.now() - t0;
  const m = coordinatorMetrics(engine.registry);

  console.log("# Tournament Auto Pipeline — coordinación (sin ejecutar nada)\n");
  console.log(`  eventos recibidos:      ${result.received}`);
  console.log(`  solicitudes generadas:  ${result.created.length}`);
  console.log(`  solicitudes fusionadas: ${result.merged}`);
  console.log(`  en espera: ${result.waited} · ignorados: ${result.ignored}`);
  console.log(`  pendientes en cola:     ${m.pending}`);
  console.log(`  tiempo: ${ms} ms\n`);
  for (const r of engine.plan()) {
    console.log(`  → ${r.id}`);
    console.log(`    acción: ${r.action} · motivo: ${r.reason} · eventos origen: [${r.sourceEventSeqs.join(", ")}]`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
