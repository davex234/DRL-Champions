# FASE 35.2 — LOCAL LIVE INTEGRATION

Fecha: 2026-09-15 · App local (`next start`, :3005) → API real → Supabase del VPS por túnel SSH · Cuenta QA controlada · Sin deploy, sin commit, sin push.
Evidencia: `docs/product/qa/fase35-2/` (`e2e-matrix.md`, `economy-evidence.md`, `database-evidence.md` y capturas reales).

## Resultado

**GO.** Se recorrió el circuito completo sin mocks ni fixtures:

APP LOCAL REAL → AUTH REAL (formulario de `/cuenta`) → SUPABASE DEL VPS → EQUIPO ACTIVO REAL (constructor) → CAMPAÑA REAL (`rtc-1`) → PARTIDA PvE REAL (10 turnos, clics legales) → RESULTADO AUTORITATIVO (winner A) → LIQUIDACIÓN REAL → PROGRESO REAL (c1-n1 COMPLETED, c1-n2 AVAILABLE) → PRIMERA VICTORIA REAL (+50, una fila) → LIBRO MAYOR REAL → UI ACTUALIZADA → REJUGAR SIN DUPLICAR (0 de campaña, solo el pago PvE canónico).

Ningún bug de producto impidió el flujo: no hubo que tocar código de la app, esquema ni migraciones.

## Cuenta QA

`QA-8c326e52` (`qa-campaign-fase352-…@example.invalid`, dominio reservado, sin persona real). Creada con la API de administración desde Node (nunca desde el navegador); contraseña aleatoria solo en el scratchpad de la sesión. No admin. Estado de partida por el mecanismo real: `handle_new_user` (6.000 créditos + 4 sobres), 4 sobres abiertos y 1 estándar comprado (−750) por `/api/game/packs`, equipo construido y activado en el constructor. **Se conserva** como evidencia QA (progreso, libro mayor, 2 equipos).

## Cifras clave

| Medida | Valor |
|---|---|
| Créditos antes de la campaña | 5.250 |
| Tras la primera victoria | 5.420 (= +120 `duel_win` PvE + **50** `campaign_first_clear`) |
| Tras rejugar | 5.540 (= +120 `duel_win`; **0** de campaña) |
| Filas `campaign_first_clear` | **1** (`campaign:road-to-champions:c1-n1`) durante y después de rejugar y de 2 `sync` |
| Intentos | 2 SETTLED (1 con primera victoria y recompensa) + 1 ABANDONED |
| Partidas | 2 PVE/EASY COMPLETED winner A (8-2 y 9-1) |
| Rating | 0 eventos; fila QA 1000/0 |
| Otros usuarios | libro mayor 47 → 47; progreso 0 |
| `schema_migrations` | 25 (0025), intacto |

## Pruebas de contrato y concurrencia (API real)

`userId`, `reward`, `completed`, `difficulty`/`opponent` → 400 FIELD_NOT_ALLOWED · `c9-n9` → 404 · `c3-n5` bloqueado → 409 LOCKED · `../x` → 400 · sin token → 401 · `GET ?userId=` → 400 · doble clic en UI → 1 partida · dos pestañas en paralelo → 200 + 409 ACTIVE_ATTEMPT · abandonar → ABANDONED sin intento contado ni recompensa · `sync` ×2 → sin cambios.

## Smokes

- **Equipo activo:** nuevo «Equipo 2» activado en la UI → la pre-partida de campaña lo selecciona como activo → API `activeDeck=f7739fa5`.
- **Perfil (0049):** guardar vitrina con carta propia → SAVED v1; carta falsa → 403 NOT_OWNED; `userId` → 400; revertido → SAVED v2 (vacía).
- **Social (0048):** `GET /api/game/social` 200 sin degradar; sin mutaciones (no hay segunda cuenta QA).

## Tests y gates (túnel CERRADO durante los gates)

`npm test` 2111/2111 · tsc web 0 · tsc scripts 0 · `next build` exit 0 · ESLint 0 (instrumentos nuevos) · security 201/0 · combat 5/0 · campaign 33/0 · campaign-security 13/0 · campaign-economy 11/0 · campaign-content 9/0 · deck 34/0 · social 33/0 · season 21/0 · competitive 27/0 · replay 25/0. No existe verificador de perfil en `package.json`. Suites que requieren BD aislada: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.

## Problemas encontrados (todos del instrumento o del entorno, no del producto)

1. Matar Chrome tras el login no persistía localStorage → cada ejecución repite el login por el formulario real.
2. El arnés esperaba «Elige una carta» habilitado (lo está solo tras elegir carta) → se detecta el estado de decisión y las cartas pulsables.
3. Git Bash reescribía `/api/...` como ruta de Windows → `MSYS_NO_PATHCONV=1`.
4. El timeout de 1 h de las tareas en segundo plano mató la app y el túnel a mitad de prueba → relanzados como procesos independientes.
5. El túnel SSH se cayó una vez (ECONNRESET) durante el smoke de perfil → relanzado con `ServerAliveInterval=15`/`CountMax=8`; el smoke se repitió completo.
6. En la fase `prematch` del instrumento, `\\d` doblemente escapado marcó «capítulo/nodo=false»; la captura confirma el contexto correcto.

## P2

1. `GET` de meta/loop crea `duel_pvp_ratings` al leer (`ensureRating`): escritura en lectura preexistente (fila 1000/0, sin eventos).
2. La app local depende del túnel SSH al VPS: no hay despliegue ni procedimiento de túnel persistente.
3. Telemetría `campaign` sigue no-op (`FLOWS` = 4).
4. `schema_migrations` sigue sin reflejar 0026–0051.
5. Camino de derrota y empate no ocurrieron en vivo (2 victorias de 2); cubiertos por T55/T56 y verificadores.
6. Smoke social con mutación pendiente de una segunda cuenta QA.
7. La cuenta QA y su fila vacía de personalización quedan en la BD (decisión: evidencia QA).
8. `profiles` preexistente legible por REST (`last_seen_at` incluido), de la Fase 35.1.

## Archivos creados/modificados

- Nuevos (instrumentos `_`, fuera de CI): `scripts/_fase35-2-qa-account.ts`, `scripts/_fase35-2-api.ts`, `scripts/_fase35-2-live-e2e.ts`.
- Nuevos (evidencia): `docs/product/qa/fase35-2/` (3 documentos + capturas), este informe.
- Sin cambios en código de producto, migraciones, configuración ni `.env*`.

## No tocado

Motor, bots, rating, cola, liquidación ranked, economía (salvo la recompensa QA legítima), Marketplace (OFF), worker/cron/autosync/importer VLR, Caddy, Kong/Auth/Storage/Realtime, compose/contenedores (sin restart), firewall/SSH config, `schema_migrations`, Docker local, deploy, git.
