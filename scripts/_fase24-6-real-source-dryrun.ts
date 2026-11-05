/**
 * FASE 24.6 · REAL SOURCE / DRY RUN (instrumento `_`, fuera de CI)
 *
 *   npx tsx scripts/_fase24-6-real-source-dryrun.ts [vlrEventId=2766] [--pages N]
 *
 * Lee vlr.gg DE VERDAD (solo lectura, con el fetcher con timeout, allowlist y reintento
 * transitorio del pipeline), parsea, normaliza, valida y pasa el core en DRY RUN SIN base de
 * datos: no hay Supabase en este entorno y, aunque lo hubiera, el dry run no escribe nada.
 *
 * Lo que enseña: detección del evento, partidos y su estado, estructura del cuadro, y la
 * POLÍTICA de sincronización que se le aplicaría (clase e intervalo). Si el evento no ha
 * empezado, dirá UPCOMING: no se falsea ningún directo.
 *
 * Respeto a la fuente: 3 páginas del evento + como mucho `--pages` páginas de partido
 * (por defecto 8), con la pausa de cortesía de la configuración.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { importVlrTournament } from "@/importer-vlr";
import { getEsportsAutoSyncConfig } from "@/lib/esports/autosync/config";
import { createTimedFetcher, sourceRefFromInput } from "@/lib/esports/autosync/sourceRef";
import { runEsportsSync } from "@/lib/esports/autosync/runner";
import { formatRunReport } from "@/lib/esports/autosync/report";
import { classifyEvent, getEsportsSyncPolicy } from "@/lib/esports/autosync/policy";
import { createMemoryLogger } from "@/lib/esports/autosync/log";

const args = process.argv.slice(2);
const vlrEventId = args.find((a) => /^\d+$/.test(a)) ?? "2766";
const pagesIdx = args.indexOf("--pages");
const maxMatchPages = pagesIdx >= 0 ? Number(args[pagesIdx + 1]) || 8 : 8;

async function main(): Promise<void> {
  const cfg = getEsportsAutoSyncConfig(process.env);
  const ref = sourceRefFromInput(`vlr-${vlrEventId}`, vlrEventId)!;
  const logger = createMemoryLogger();
  const attempts: string[] = [];
  const fetcher = createTimedFetcher({
    timeoutMs: cfg.timeoutMs, retry: cfg.retry,
    onAttempt: (i) => attempts.push(`${i.attempt} ${i.url}${i.error ? ` ✗ ${i.error}` : ""}`),
  });

  const t0 = Date.now();
  console.log(`REAL SOURCE / DRY RUN · ${ref.url} · páginas de partido ≤ ${maxMatchPages} · timeout ${cfg.timeoutMs} ms`);
  const out = await importVlrTournament(ref.url, { fetcher, politeDelayMs: cfg.politeDelayMs, maxMatchPages, includeMatchDetails: true });
  const fetchMs = Date.now() - t0;
  const snap = out.snapshot;

  const now = Date.now();
  const byStatus = new Map<string, number>();
  for (const m of snap.matches) byStatus.set(m.status ?? "?", (byStatus.get(m.status ?? "?") ?? 0) + 1);
  const policyInput = { id: ref.eventId, status: snap.tournament.status, startDate: snap.tournament.startDate, endDate: snap.tournament.endDate, matches: snap.matches.map((m) => ({ status: m.status ?? "upcoming", startTime: m.startTime ?? null })) };
  const cls = classifyEvent(policyInput, now, cfg);
  const decision = getEsportsSyncPolicy(policyInput, {}, now, cfg, () => 0.5);

  const lines: string[] = [];
  lines.push(`# REAL SOURCE / DRY RUN · vlr.gg event ${vlrEventId} · ${new Date(now).toISOString()}`);
  lines.push("");
  lines.push(`Fuente: ${ref.url}`);
  lines.push(`Descarga: ${out.meta.pagesFetched} páginas en ${fetchMs} ms (detalle de ${out.meta.matchDetailsFetched}/${out.meta.matchesListed} partidos)`);
  lines.push(`Intentos: ${attempts.length} (${attempts.filter((a) => a.includes("✗")).length} con error)`);
  lines.push("");
  lines.push(`Evento: ${snap.tournament.name} · estado fuente=${snap.tournament.status} · ${snap.tournament.startDate ?? "?"} → ${snap.tournament.endDate ?? "?"}`);
  lines.push(`Equipos: ${snap.teams.length} · jugadores: ${snap.players.length} · partidos: ${snap.matches.length} · mapas: ${snap.maps?.length ?? 0} · filas scoreboard: ${snap.mapStats?.length ?? 0}`);
  lines.push(`Partidos por estado: ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(" · ")}`);
  const first = snap.matches.map((m) => m.startTime).filter(Boolean).sort()[0];
  lines.push(`Primer partido: ${first ?? "sin hora"}`);
  const st = out.meta.structure;
  lines.push(`Cuadro: presente=${st?.present ?? false} · aristas=${st?.edges ?? 0} · clasificación=${st?.qualification ?? 0} · desconocidas=${st?.unknown ?? 0} · conflictos=${st?.conflicts ?? 0}`);
  lines.push("");
  lines.push(`POLÍTICA: clase=${cls} · elegible=${decision.eligible} · intervalo=${Math.round(decision.intervalMs / 1000)} s · prioridad=${decision.priority} · ${decision.reason}`);
  lines.push("");
  lines.push("Avisos del conector:");
  for (const w of out.warnings.slice(0, 12)) lines.push(`  ⚠ ${w}`);
  if (out.warnings.length > 12) lines.push(`  … y ${out.warnings.length - 12} más`);
  lines.push("");

  // DRY RUN por el core, sin base de datos (sb: null): fuente → normalización → validación → informe.
  const r = await runEsportsSync(
    { sb: null, cfg, logger, fetchSnapshot: async () => ({ snapshot: snap, warnings: out.warnings }) },
    { mode: "manual", dryRun: true, targets: [ref] },
  );
  lines.push(formatRunReport(r));
  lines.push("");
  lines.push("Escrituras: NINGUNA (sb=null, dryRun=true, lock no adquirido=" + String(!r.lock.acquired) + ")");
  lines.push("Partidos (primeros 12):");
  for (const m of snap.matches.slice(0, 12)) lines.push(`  ${m.id.padEnd(8)} ${(m.status ?? "?").padEnd(9)} ${(m.startTime ?? "—").padEnd(24)} ${m.teamA} vs ${m.teamB}${m.scoreA != null ? ` ${m.scoreA}-${m.scoreB}` : ""}${m.winner ? ` → ${m.winner}` : ""} · ${m.round ?? ""}`);
  lines.push("");
  lines.push("Log estructurado:");
  for (const l of logger.lines) lines.push(`  ${l}`);

  const text = lines.join("\n");
  console.log(text);
  const dir = join(process.cwd(), "docs", "product", "qa", "fase24-6");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `real-source-dryrun-${vlrEventId}.txt`), text + "\n");
  console.log(`\nguardado en docs/product/qa/fase24-6/real-source-dryrun-${vlrEventId}.txt`);
}

main().catch((e) => { console.error(e); process.exit(1); });
