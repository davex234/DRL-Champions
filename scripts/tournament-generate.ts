/**
 * `npm run tournament:generate <url>` — genera las cartas de un torneo de vlr.gg y actualiza el
 * catálogo/runtime ejecutando el pipeline oficial completo (Importer VLR → Importer → Analyzer →
 * Performance → Card Generator → Materializer → Catalog Builder → Publisher). Sin lógica aquí:
 * todo vive en `src/tournament-orchestrator/` y en los motores existentes.
 */
import { runCli } from "@/tournament-orchestrator";

runCli(process.argv.slice(2), { now: Date.now() })
  .then((run) => { process.exitCode = run.exitCode; })
  .catch((e) => { console.error(e); process.exitCode = 1; });
