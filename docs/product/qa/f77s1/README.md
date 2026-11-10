# F77-S1 · Rotación del secreto JWT de Supabase (DRLCards) — evidencia

2026-10-01. Sin secretos: solo estados, recuentos y prefijos de hash.

## Causa

El stack `supabase-drlcards` en producción usaba el secreto HS256 **público por defecto** de Supabase. Lo usaban auth, storage, realtime, studio y edge. PostgREST lo tenía como `oct` en su JWKS, y el tenant de Realtime en la BD también lo guardaba. Las claves anon y service_role de la app y del worker estaban firmadas con él. Además, Kong traducía las claves opacas **públicas por defecto** del CLI (`sb_secret_*` / `sb_publishable_*`) a service_role y anon.

Con eso, cualquiera podía obtener privilegios de service_role por `https://valorosters.com/{auth,rest,storage}/v1`.

## Qué se hizo

| Paso | Detalle |
|---|---|
| Copia | `/opt/nexus/backups/supabase-drlcards/f77s1-20261001T171503Z/` (700, SHA256SUMS) + `rollback.sh --yes` |
| Generación | En el VPS: secreto de 64 caracteres. anon y service_role se volvieron a firmar con las mismas claims. Claves `sb_*` nuevas y aleatorias. |
| Consumidores | `compose.yml` (auth, rest, storage, realtime, studio, edge y db*), `kong/kong.yml`, `valorosters/secrets/app.env`, `drlcards-sync/env/esports-sync.env` |
| BD | `_realtime.tenants` (secreto cifrado AES-128-ECB con `DB_ENC_KEY` + JWKS) como `supabase_admin`. `RESET app.settings.jwt_secret`: sin uso, y `log_statement=ddl` lo habría escrito en el log. |
| Reinicio | Solo auth, rest, storage, realtime, studio, edge_runtime y kong. La BD NO se reinició. |
| App | Release `drl-0.1.1-1-99bda6f0-f77s1` compilada con el contenedor de F75: mismo BUILD_ID (mismo código) y anon nueva. Activada con `deploy.sh --activate`. |
| Corte | ~30 s (17:32:17–17:32:47Z) |

\* El contenedor `db` conserva el valor antiguo en su entorno. Es solo de inicialización y no valida tokens. Ojo: un `docker compose up -d` del stack entero lo recrearía, con un reinicio de Postgres.

Incidencia durante el swap: el primer intento falló en el paso de BD (`permission denied for table tenants`; `postgres` no es el dueño). La transacción no se confirmó y no se recreó ningún contenedor. El intento se completó como `supabase_admin` tras comprobar el estado.

## Resultados

| Prueba | Resultado |
|---|---|
| Valores antiguos en la configuración activa (por hash) | 0 en todos los contenedores DRLCards (salvo el entorno de init de `db`), en los 4 ficheros, en el kong.yml cargado, en el tenant de Realtime y en el ajuste de BD |
| anon / service_role ANTIGUAS | REST 401, Storage 400, Auth admin 403, Realtime 401 |
| `sb_secret` por defecto antigua | solo baja a `anon` (0 filas privadas, admin 401) |
| `sb_publishable` por defecto antigua | equivale a NO enviar clave (rol anon de PostgREST; ver deuda) |
| anon / service_role NUEVAS | anon: lectura pública OK, 0 filas privadas, admin 403. service: REST/Storage/Auth admin OK, Realtime 202 |
| Sesión ES256 previa a la rotación | sobrevive: `/user`, `/api/game/me`, REST, refresh y operación (`pre.json` / `post.json`) |
| RLS y escalada | `post.json` + `smoke.json` (74/74) |
| Navegador | `public-url.json` + `responsive-*.json` (29/29) |
| Producto | ranked enqueue/cancel, PvE start + jugada + abandon con plazo del servidor; me, collection, state (sobres), missions, crafting, competitive, duels, daily-loop: 200 |
| Escaneo público | 0 secretos privilegiados en `.next/static`, `public/`, 56 assets servidos, respuestas de la API y logs; source maps 404 |
| `production:check --app --vps` | 24 PASS · 1 WARN (SMTP, F77) · 1 FAIL (off-site, F78) |

Dos FAIL de `post.json` eran expectativas mal escritas del instrumento, no regresiones. Ya están corregidas en `scripts/_f77s1-qa.ts`:

1. **Nombre de usuario.** El trigger `handle_new_user` añade `_<id4>` al nombre. La BD tiene el nombre original con el sufijo, no el atacado.
2. **Sobres.** `/api/game/packs` solo admite POST. El inventario de sobres se lee en `GET /api/game/state` (`unopenedPacks`), y responde 200.

## Rollback

- **De la app:** usar solo releases `*-f77s1` o posteriores. Las releases previas llevan la anon antigua, que el stack ya rechaza. Reactivarlas rompe la app, pero NO reintroduce el secreto.
- **De credenciales:** `bash /opt/nexus/backups/supabase-drlcards/f77s1-20261001T171503Z/rollback.sh --yes`. Restaura la configuración PRE-F77-S1, y por tanto **vuelve a dejar el secreto público**. Usarlo solo en emergencia.
