# DRL Champions — Release System (Fase 1/7)

Arquitectura modular del sistema de releases. Cada responsabilidad vive en un **engine**
independiente, desacoplado y testeable. Prepara las Fases 2–7 (CI/CD, transporte, servidor)
sin reescribir nada. **No publica ni despliega todavía.**

```
scripts/release/
├── core/                      utilidades compartidas (matan duplicaciones)
│   ├── proc.mjs               ejecutar comandos (spawnSync) — único
│   ├── fsx.mjs                walk / read / write / ensureDir — único (antes ×3)
│   ├── hash.mjs               sha256Hex / sha256File — único (antes ×2)
│   └── args.mjs               parser CLI — único (antes ×2)
├── version-engine.mjs         AUTORIDAD de versión: version·build·canal·changelog·fecha·commit·hash
├── build-engine.mjs           compilar: web · desktop · tauri · assets
├── sign-engine.mjs            firma minisign · SHA256 · verificación (futura)
├── artifact-engine.mjs        descubrir artefactos (sin rutas hardcodeadas)
├── manifest-engine.mjs        latest.json · meta.json · files.json
├── publish-engine.mjs         objeto Release (desacoplado del servidor) — NO publica
├── pipeline.mjs               orquesta los engines (no conoce internos)
└── index.mjs                  API pública del Release System
```

## Flujo (pipeline)
```
Version (detectar cambios → bump build+semver)
  → Build (web + desktop + bundle firmado)
  → Sign (recoger firmas .sig + SHA256)
  → Manifest (latest + meta + files)
  → Artifacts (descubrir installers/firmas)
  → Release (objeto Release + stage local)
```
`git push` (Fase 7) disparará esto vía CI; hoy se invoca con `npm run release`.

## Engines (responsabilidad única)
| Engine | Responsabilidad | API |
|---|---|---|
| **Version** | Autoridad única de versiones. Nadie bumpea a mano. | `readVersion·nextVersion·bumpSemver·fullVersion·syncProject·fingerprint·diff·detectChanges·releaseNotes·applyVersion·recordRelease·gitCommit` |
| **Build** | Solo compila. | `buildWeb·buildDesktopExport·buildTauriBundle·buildAssets·buildAll` |
| **Sign** | Firma aislada. | `signingAvailable·collectSignatures·verify·sha256Hex·sha256File` |
| **Artifact** | Descubrimiento sin rutas fijas. | `discover·primaryBundleDir` |
| **Manifest** | latest/meta/files (builders puros + escritura + verificación). | `platformKey·artifactName·buildLatest·buildMeta·buildFiles·filesFromResources·writeManifests·verifyResources` |
| **Publish** | Ensambla `Release` desacoplado del destino. **No sube nada.** | `assembleRelease·stage` |
| **Pipeline** | Orquestador. | `run(opts)` |

## Reglas de arquitectura (validadas por `npm run release:arch`)
- **Acoplamiento lateral = 0**: ningún engine importa a otro; solo el `pipeline` los compone.
- **Sin duplicaciones**: `walk`, hashing y parser de args viven una sola vez en `core/`.
- **Determinismo**: `buildLatest`, `bumpSemver`, `fingerprint` son deterministas.
- **Reutiliza el updater OFICIAL de Tauri**: no se crea otro updater; `sign-engine` solo recoge
  las firmas que produce Tauri y `manifest-engine` genera el `latest.json` que Tauri consume.

## CLI (compatibilidad mantenida)
- `npm run release [-- --channel --minor/--major/--none --no-bundle --skip-web --force --dry --notes --date]`
- `node scripts/gen-latest.mjs …` (capa fina sobre Sign+Artifact+Manifest)
- `npm run release:arch` — validación de arquitectura + métricas
- `npm run release:verify` — flujo de versión/cambios/cliente

## Objeto `Release` (lo que consumirá la Fase 2+)
```jsonc
{
  "id": "stable-0.6.1+128", "version": "0.6.1", "build": 128, "full": "0.6.1+128",
  "channel": "stable", "date": "…", "commit": "abc1234", "hash": "<fingerprint>",
  "notes": "…", "baseUrl": "https://update.drlchampions.com",
  "files": [{ "name": "…setup.exe", "size": 0, "sha256": "…", "signed": true, "kind": "installer" }],
  "manifests": { "hasLatest": true, "hasMeta": true, "hasFiles": true },
  "signed": true, "ready": true
}
```
La Fase 2 añadirá un **transporte** (servidor/CDN/CI) que recibe este objeto y lo publica; el
resto de engines no cambia.

## Qué NO se hizo (por diseño, fases siguientes)
GitHub Actions, despliegue, subida a servidor, CI/CD. La Fase 1 solo deja la arquitectura lista.
