/**
 * `npm run artwork:update [ruta-estado.json]` — pasada de mantenimiento del ciclo de vida:
 * snapshot del Artwork Manager actual → diff contra el estado persistido → actualizar solo
 * lo necesario → invalidar cache quirúrgicamente → persistir la nueva versión del estado.
 * SOLO administra el registry: no genera cartas, no renderiza, no descarga.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ArtworkEngine } from "@/artwork";
import {
  AssetLifecycleEngine, createLifecycleState, snapshotManager,
  type LifecycleState,
} from "@/artwork-updater";

async function main(): Promise<void> {
  const statePath = process.argv[2] ?? join(process.cwd(), "output", "artwork-lifecycle.json");
  const now = Date.now();

  const state: LifecycleState = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, "utf8")) as LifecycleState)
    : createLifecycleState();

  const artwork = new ArtworkEngine();
  const engine = new AssetLifecycleEngine(artwork, state);
  const incoming = snapshotManager(artwork);

  console.log(`# Artwork Update — ciclo de vida del registry`);
  const t0 = Date.now();
  const r = engine.sync(incoming, { actor: "cli", at: now, reason: "pasada de mantenimiento" });
  const ms = Date.now() - t0;
  const m = engine.metrics();

  console.log(`  assets revisados:   ${incoming.length}`);
  console.log(`  actualizados:       ${r.diff.added.length + r.diff.modified.length} (nuevos ${r.diff.added.length} · modificados ${r.diff.modified.length})`);
  console.log(`  sin cambios:        ${r.diff.unchanged.length}`);
  console.log(`  obsoletos:          ${r.diff.obsolete.length} · eliminados: ${r.diff.removed.length}`);
  console.log(`  cache invalidada:   ${r.invalidated.assetIds.length} asset(s) (jamás toda)`);
  console.log(`  versiones totales:  ${m.versions} · eventos: ${m.events}`);
  console.log(`  tiempo: ${ms} ms`);

  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(engine.state, null, 2));
  console.log(`  estado persistido:  ${statePath}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
