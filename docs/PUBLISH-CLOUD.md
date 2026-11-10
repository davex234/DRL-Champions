# Publish Cloud — Sistema de Publicación (Fase 3/7)

Cierra el último paso manual: tras un `git push`, la nueva versión queda **publicada
automáticamente** en el destino configurado. Los Launchers la encuentran sin copiar archivos a mano.

```
Git Push → GitHub Actions → Verify → Tests → Build → Sign → Artifacts → Manifest →
           Publish → Servidor DRL → Release disponible → Los Launchers pueden verla
```

La publicación es **el siguiente paso del pipeline**, no otro flujo. Reutiliza todo lo de la
Fase 1/2 (Release Pipeline, Publish/Manifest/Artifact/Version Engines) y añade una capa de
**transporte desacoplada**: el Release Pipeline NO conoce el servidor.

## Arquitectura

```
ReleasePipeline (build/sign/manifest)         ← intacto, no conoce el servidor
        │  produce: objeto Release + stagedDir (dist/update/<canal>/)
        ▼
run-pipeline.mjs (orquestador Build Cloud)    ← "siguiente paso": publica
        │
        ▼
Transport Engine  ── upload() · verify() · health() · rollback() · cleanup()
        │
        ▼
Provider (intercambiable, misma interfaz)
        ├─ Local        (dist/published/, SIEMPRE disponible — sin secrets)
        ├─ Filesystem   (share/volumen externo, DRL_PUBLISH_FS_DIR)
        ├─ GitHub Release (assets por canal vía gh CLI)
        └─ Cloudflare R2 (S3-compatible, SigV4)
```

- **Publish Engine** sigue entregando solo el objeto `Release`. **Transport Engine** decide cómo
  subirlo. Cero acoplamiento con el destino.
- Código nuevo aislado en `scripts/release/transport/` (no toca los 7 engines → `release:arch` 33/33).

## Providers

Todos implementan el mismo contrato (`configured · health · put · getBytes · list · remove · copy · url`).
**Funcionan aunque falten secrets**: si un provider no está configurado, el selector elige otro;
`local` es el último recurso y siempre está disponible.

Selección: `DRL_PUBLISH_PROVIDER` fuerza uno; en automático se prefiere el más remoto configurado
(`r2 → github → filesystem → local`). Ver `.github/SECRETS.md`.

## Estructura publicada (aislamiento por canal)

```
<canal>/                      # stable | beta | developer | nightly  (aislados)
  latest.json meta.json files.json release.json
  *.exe *.msi
  release-report.json RELEASE-REPORT.md pipeline-state.json publish.json
  releases/
    <version+build>/          # copia archivada de cada release (rollback)
    history.json              # anillo N, N-1, N-2 + puntero vigente
```

## Verificación (no marca Ready si algo falla)

Tras subir, `Transport Engine.verify()` re-descarga del provider y comprueba **byte a byte**
(hash SHA256 + tamaño + accesibilidad). Exige `latest.json`/`files.json` accesibles. Si falla,
el Release **no** pasa a Ready (status `failed`, exit ≠ 0).

## Rollback (arquitectura preparada, sin UI)

Cada publicación archiva su set y mantiene el anillo `N, N-1, N-2` (`cleanup(keep=3)`).
`Transport Engine.rollback(channel, full)` repunta la versión vigente a una anterior copiando su
copia archivada. Sin disparador visual en esta fase.

## Estado del pipeline (persistido)

```
Queued → Running → Building → Signing → Generating manifests →
Uploading → Verifying → Published → Ready        (o → Failed)
```

`pipeline-state.json` + `publish.json` quedan junto a los artefactos con: historial, tiempo de
subida, tamaño publicado, destino, canal, estado, hashes y rollback disponible → **datos listos
para el dashboard de la Fase 4** (esta fase no añade UI).

## Seguridad (sin cambios)

minisign + SHA256 + updater oficial de Tauri + canales + integridad intactos. No se crea ningún
mecanismo de actualización nuevo: solo se transporta lo que el pipeline ya generaba.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run ci:pipeline` | Build + **publish** (provider auto; sin secrets → local) |
| `npm run publish:verify` | Harness del sistema de publicación (providers, transporte, anillo, byte-idéntico) |
| `npm run publish:simulate` | Publicación completa simulada + comparación publicado vs generado byte a byte |
| `npm run ci:simulate` | Artefactos CI == `npm run release` (sin publicar) |

## Qué queda para la Fase 4/7

- **Dashboard visual** consumiendo `publish.json` / `pipeline-state.json` / `history.json`.
- **Rollback visual** (la lógica `rollback()`/anillo ya existe).
- Endpoint/servidor real sirviendo `<canal>/latest.json` (R2/CDN) — credenciales en Secrets.
