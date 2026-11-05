/**
 * RELEASE (CLI) — entrada fina del Release System. Toda la lógica vive en los engines de
 * `scripts/release/`; aquí solo se parsean opciones y se invoca el pipeline.
 *
 *   npm run release [-- opciones]
 *
 * Opciones: --channel <c> · --minor · --major · --none · --no-bundle · --skip-web ·
 *           --force · --dry · --notes "texto" · --date <iso>
 *
 * Firma (bundle real): TAURI_SIGNING_PRIVATE_KEY[_PASSWORD] en el entorno.
 */
import { parseArgs } from "./release/core/args.mjs";
import ReleasePipeline from "./release/pipeline.mjs";

const { has, opt } = parseArgs();
const level = has("major") ? "major" : has("minor") ? "minor" : has("none") ? "none" : "patch";

const opts = {
  channel: opt("channel"),
  level,
  noBundle: has("no-bundle"),
  skipWeb: has("skip-web"),
  force: has("force"),
  dry: has("dry"),
  notes: opt("notes"),
  date: opt("date"),
};

console.log("━━━ DRL RELEASE SYSTEM (Fase 1/7) ━━━");

ReleasePipeline.run(opts)
  .then((r) => {
    if (r.cancelled) { console.log(`\nNo changes detected.\nRelease cancelled.\n(${r.version} ${r.channel}; usa --force)`); process.exit(0); }
    if (r.dry) {
      console.log(`\n(--dry) ${r.prev.version}+${r.prev.build} → ${r.next.version}+${r.next.build} (${r.channel})`);
      console.log(`módulos: ${r.modules.join(", ") || "—"}`);
      process.exit(0);
    }
    console.log(`\n✅ ${r.release.full} (${r.release.channel}) en dist/update/${r.release.channel}/`);
    if (!r.written.latest) console.log("⚠ Sin instalador firmado (latest.json). Ejecuta en host de build con la clave para el OTA real.");
    process.exit(0);
  })
  .catch((e) => { console.error(`\n❌ Release falló: ${e.message}`); process.exit(1); });
