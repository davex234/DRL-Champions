# Build Cloud — Secrets & Variables (Fase 2/7)

Configurar en GitHub → Settings → Secrets and variables → Actions. **Preparados aunque aún no
se publique nada** (Fase 2 solo compila). Sin estos, los workflows siguen pasando: el bundle
firmado se omite (`--no-bundle`) y se hace verificación de compilación de Rust.

## Secrets (cifrados)
| Nombre | Uso | Requerido para |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Clave privada minisign (contenido de `src-tauri/.tauri-signing.key`) | Generar instaladores firmados + `latest.json` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Contraseña de la clave (vacía si no tiene) | Idem |

## Variables (texto plano)
| Nombre | Ejemplo | Uso |
|---|---|---|
| `UPDATE_ENDPOINT` | `https://update.drlchampions.com` | Base de URLs en `latest.json`/`meta.json` |
| `RELEASE_CHANNEL` | `stable` | Canal por defecto del pipeline |
| `BUILD_CONFIGURATION` | `release` | Modo de build (informativo en el report) |

## Cómo cargar la clave de firma (cuando toque, Fase 3+)
```bash
# El contenido EXACTO del fichero, como secret TAURI_SIGNING_PRIVATE_KEY:
cat src-tauri/.tauri-signing.key
```
La clave **nunca** se commitea (está en `.gitignore`). El `pubkey` correspondiente vive en
`src-tauri/tauri.conf.json` y es el que verifica el updater oficial de Tauri.

## Publicación (Fase 3) — todo OPCIONAL

El sistema de transporte elige el destino automáticamente. **Sin ninguna de estas → provider
`local`** (publica en `dist/published/`, efímero en CI pero prueba el flujo completo). Con
credenciales presentes se publica de verdad. Preferencia automática: `r2 → github → filesystem → local`.

### Variables
| Nombre | Ejemplo | Uso |
|---|---|---|
| `DRL_PUBLISH_PROVIDER` | `r2` / `github` / `filesystem` / `local` | Fuerza un provider concreto (omítela para auto) |
| `DRL_PUBLISH_FS_DIR` | `D:\drl-cdn` | Raíz del provider `filesystem` (share/volumen servido) |
| `DRL_PUBLISH_FS_URL` | `https://update.drlchampions.com` | URL pública del provider `filesystem` |
| `R2_BUCKET` | `drl-updates` | Bucket de Cloudflare R2 |
| `R2_PUBLIC_BASE` | `https://update.drlchampions.com` | Base pública del bucket (CDN) |

### Secrets (R2 — S3-compatible)
| Nombre | Uso |
|---|---|
| `R2_ACCOUNT_ID` | Account ID de Cloudflare (endpoint `<id>.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` | Access key del token R2 |
| `R2_SECRET_ACCESS_KEY` | Secret key del token R2 |

> GitHub Release provider: usa el `GITHUB_TOKEN` que el workflow ya inyecta + `GITHUB_REPOSITORY`.

## Workflows que las consumen
- `build.yml`: firma (secrets) + endpoint/canal/config (vars).
- `release.yml`: build + **publish** (firma + endpoint/canal + variables/secrets de publicación).
- `verify.yml` / `test.yml`: ninguno (solo checks).
