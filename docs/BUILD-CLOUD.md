# DRL Champions — Build Cloud (Fase 2/7)

Infraestructura de compilación automática. Cada push compila el juego, genera artefactos y
deja preparada la publicación para la Fase 3. **No publica nada todavía.**

## Workflows (`.github/workflows/`)
| Workflow | Trigger | Runner | Responsabilidad |
|---|---|---|---|
| `verify.yml` | push + PR | ubuntu | typecheck · release:arch · updater:verify · cards:verify · release:verify (fail-fast) |
| `test.yml` | push + PR | ubuntu | `npm test` (suite `node:test`, 113 tests) |
| `build.yml` | push main + dispatch | windows | compila web + desktop + Tauri + assets; sube `out/` + instaladores. **No publica.** |
| `release.yml` | push main + tags + dispatch | windows | ejecuta el **mismo `ReleasePipeline`** (vía `scripts/ci/run-pipeline.mjs`); genera Release + manifiestos + report + estado. **No publica.** |

Cada uno con una sola responsabilidad y `concurrency` para cancelar ejecuciones obsoletas.

## Reutilización (cero lógica nueva)
- `release.yml` → `scripts/ci/run-pipeline.mjs` → **importa `ReleasePipeline`** (Fase 1). No duplica nada.
- El hook `onPhase` (añadido al pipeline, no invasivo) alimenta la **máquina de estado**
  `scripts/release/pipeline-state.mjs` (Queued→Running→Building→Signing→Generating manifests→Ready)
  — preparada para el dashboard de la Fase 3.
- `npm test` = `scripts/ci/run-tests.mjs` (descubre `*.test.ts` y los corre con `node:test`).

## Artefactos del workflow (descargables, sin publicar)
`release.yml` sube `dist/update/<canal>/**`:
- `…-setup.exe`, `…_x64_en-US.msi` (si hay clave de firma)
- `latest.json` (updater Tauri, si firmado) · `meta.json` · `files.json`
- `release-report.json` + `RELEASE-REPORT.md` (commit·branch·autor·versión·build·canal·tiempo·tests·hashes·firma·estado)
- `pipeline-state.json` (estado del pipeline para Fase 3)
- `release.json` (descriptor del objeto Release)

`build.yml` sube `out/**` + instaladores como verificación de compilación.

## Secrets / Variables
Ver `.github/SECRETS.md`. Preparados aunque no se usen aún: `TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (secrets); `UPDATE_ENDPOINT`, `RELEASE_CHANNEL`,
`BUILD_CONFIGURATION` (vars). **Sin la clave, el bundle se omite (`--no-bundle`)** y se hace
`cargo check`: los workflows siguen en verde.

## Caché (velocidad)
- npm: `actions/setup-node` con `cache: npm`.
- Rust/Cargo/Tauri: `Swatinem/rust-cache@v2` (`workspaces: src-tauri`).
- Next: `actions/cache` sobre `.next/cache`.

## Builds reproducibles
`next.config.mjs` define `generateBuildId` derivado de `version.json` (`drl-<version>-<build>`):
dos compilaciones de la misma versión producen `out/` **byte-idéntico**. Gracias a esto el
simulador verifica que los artefactos del Build Cloud coinciden EXACTAMENTE con `npm run release`.

## Probar en local
```bash
npm run ci:pipeline     # ejecuta el Build Cloud localmente (igual que release.yml)
npm run ci:simulate     # corre release + run-pipeline y compara artefactos (deben coincidir)
```

## Tiempo estimado de build (orientativo)
| Workflow | Frío | Con caché |
|---|---|---|
| verify | ~2–3 min | ~1–2 min |
| test | ~2–3 min | ~1–2 min |
| build (windows + Rust + Tauri) | ~10–15 min | ~4–7 min |
| release (pipeline completo) | ~10–15 min | ~4–7 min |
(Local sin Rust, `--no-bundle`: ~22 s.)

## Preparado para la Fase 3/7
- Objeto `Release` + `release.json` ya ensamblados, desacoplados del destino.
- `pipeline-state.json` con la máquina de estados lista para un dashboard.
- Secrets/vars declarados; con la clave de firma, `release.yml` produce el OTA firmado sin tocar nada.
- Falta (Fase 3+): transporte/publicación al servidor, dashboard UI, despliegue. **Nada de eso se hizo aquí.**
