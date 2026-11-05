# FASE 35.2 · Matriz E2E real

App local (`next start`, :3005) → API real de la app → Supabase del VPS por túnel SSH (`127.0.0.1:54521` → Kong del VPS). Cuenta QA `QA-8c326e52` (`@example.invalid`, sintética). Chrome headless con el formulario real de `/cuenta`. Sin mocks, sin fixtures, sin sesión fabricada, sin resultados forzados. Horas en UTC, 2026-09-15.

| # | PASO | ESPERADO | REAL | RESULTADO | EVIDENCIA |
|---|---|---|---|---|---|
| 1 | Target Supabase | La app apunta a la BD real del VPS | `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521` = túnel SSH al VPS; REST 200, GoTrue v2.196.0; anon sobre `campaign_progress` → 42501 (la tabla existe, RLS activa) | PASS | salida de consola |
| 2 | App local | 200, sin error fatal, API accesible | `/api/game/state` 401 (JSON sin sesión), `/` 200, `GET /api/game/campaign` 200 `rtc-1` | PASS | — |
| 3 | Cuenta QA | Cuenta controlada, no admin | Creada con la API de administración desde Node (no desde el navegador); contraseña aleatoria solo en el scratchpad; `is_admin=false`; alta real con `handle_new_user` | PASS | database-evidence.md |
| 4 | Auth real | Sesión por el formulario | `session_via_real_form=true`, `admin_links_visible=false` | PASS | 01-login.png, 01b-logged-in-account.png |
| 5 | Secretos en el navegador | Ni service key ni SYNC_SECRET | 60–100 recursos del mismo origen analizados por ejecución: 0 fugas; localStorage sin secretos | PASS | salida de consola |
| 6 | Cartas reales | Sin cartas inventadas | 4 sobres de bienvenida abiertos por `/api/game/packs` + 1 sobre estándar comprado con créditos QA (−750): 25 cartas reales | PASS | economy-evidence.md |
| 7 | Equipo activo | 10 cartas, 2 por rol, legal, activo | Constructor real: Crear → Autocompletar → Guardar → Activar → `Equipo 1` READY_FOR_DUEL Σ813, 2 por rol, activo | PASS | 00-deck-builder-autocomplete.png, 00-deck-active.png |
| 8 | Game Modes Hub | 4 modos reales con estado real | Road to Champions DISPONIBLE · Partida rápida DISPONIBLE · Competitivo PROVISIONAL · Retar a un amigo DISPONIBLE | PASS | 02-game-modes.png |
| 9 | Road to Champions | Sin MIGRATION_PENDING | `available=true`, `reason=null`, `rtc-1`, 0/15 | PASS | 03-campaign-map-initial.png |
| 10 | Estado inicial | c1-n1 AVAILABLE, resto LOCKED | c1-n1=AVAILABLE, 14 LOCKED (UI y API) | PASS | 03-campaign-map-initial.png |
| 11 | Detalle de nodo | Rival, dificultad, objetivo, equipo, recompensa, CTA | NAVI (7 del roster + 3 refuerzos EMEA, Σ756) · Novato/bot Fácil · objetivo · Equipo 1 Σ813 Listo · +50 una vez · JUGAR | PASS | 04-node-detail.png |
| 12 | Autoridad del cliente | El cliente no elige rival/dificultad/recompensa/completado | `userId`/`reward`/`completed`/`difficulty`+`opponent` → 400 FIELD_NOT_ALLOWED | PASS | salida de consola |
| 13 | Start / reserva | Intento real + partida PvE canónica | Intento `02f84d32` STARTED → partida `c22067c0` PVE/EASY/`duel-combat-2`, rival NAVI | PASS | database-evidence.md |
| 14 | Doble clic (UI) | Una sola partida | Dos clics síncronos en «Rejugar nodo» → 1 intento + 1 partida (`d7dabceb`/`ec074e24`) | PASS | database-evidence.md |
| 15 | Dos pestañas (API) | Un 200 y un rechazo | c1-n2 en paralelo: pestaña 1 409 ACTIVE_ATTEMPT, pestaña 2 200 (LOUD/EASY); abandon → ABANDONED, partida borrada, sin progreso ni recompensa | PASS | database-evidence.md |
| 16 | Pre-partida de campaña | Contexto Road to Champions | «ROAD TO CHAMPIONS · CAPÍTULO 1 · NODO 1-2», EQUIPO 1 VS BOT · LOUD · FÁCIL, LOUD 7+3 Σ737, +50, «Jugar nodo», sin selector de dificultad | PASS | 05-prematch.png |
| 17 | Match Experience 3.0 | Arena canónica real | MatchBoard / línea de turnos / revelación; «Partida recuperada» al retomar; cartas del rival ocultas hasta jugarse | PASS | 06-match.png, 06b/11b arena retomada |
| 18 | Motor canónico | 10 turnos, en servidor | Turnos 1→10 resueltos por el servidor; las acciones de la UI son legales (carta propia, estadística, confirmar) | PASS | log de turnos |
| 19 | Victoria real | ≥1 victoria legal | Partida 1: VICTORIA 8-2 (c1-n1) | PASS | 07-match-result-win.png |
| 20 | Resultado autoritativo | winner=A en BD | `c22067c0` COMPLETED winner A, 10 turnos | PASS | database-evidence.md |
| 21 | Liquidación | Intento SETTLED + progreso | `02f84d32` SETTLED WIN first_clear=t reward_granted=t; progreso c1-n1 COMPLETED | PASS | database-evidence.md |
| 22 | Primera victoria en UI | NODO COMPLETADO +50 | Banner «NODO COMPLETADO · Primera victoria en «Primer contacto»: +50 créditos» | PASS | 08-first-clear.png |
| 23 | Recompensa exacta | +50 de campaña | 1 fila `campaign_first_clear` +50 (`campaign:road-to-champions:c1-n1`) | PASS | economy-evidence.md |
| 24 | Siguiente nodo | c1-n2 AVAILABLE | Mapa: c1-n1 COMPLETED, c1-n2 AVAILABLE | PASS | 09-map-completed-node.png, 10-next-node-available.png |
| 25 | Persistencia (recarga) | Sobrevive a recargar | Recarga completa del mapa: 1/15 igual | PASS | 09-map-completed-node.png |
| 26 | Persistencia (reinicio de app) | Sobrevive a reiniciar la app local | Proceso de la app parado y relanzado: 1/15, c1-n1 COMPLETED (CTA REPLAY), c1-n2 AVAILABLE | PASS | 12-map-after-replay.png, 12-node-detail.png |
| 27 | Rejugar | Funciona | Partida 2 en c1-n1: VICTORIA 9-1 | PASS | 11-replay.png |
| 28 | Sin duplicar primera victoria | 0 recompensa nueva de campaña | Banner «VICTORIA · NODO YA COMPLETADO · Rejugar no vuelve a dar la recompensa»; intento `d7dabceb` first_clear=f reward_granted=f; filas de campaña siguen en 1 | PASS | 11-replay.png, economy-evidence.md |
| 29 | Reintento de liquidación | Sin segunda recompensa | `POST {action:"sync"}` ×2 → intentos, progreso, filas y créditos idénticos | PASS | salida de consola |
| 30 | Nodo inexistente | Rechazado | `c9-n9` → 404 UNKNOWN_NODE | PASS | salida de consola |
| 31 | Nodo bloqueado | Rechazado | `c3-n5` → 409 LOCKED | PASS | salida de consola |
| 32 | Nodo mal formado / sin auth | Rechazado | `../x` → 400 INVALID_NODE; sin token → 401; `GET ?userId=` → 400 | PASS | salida de consola |
| 33 | Equipo activo desde la app | La campaña lee el nuevo equipo activo | Constructor: nuevo `Equipo 2` → Activar; la pre-partida selecciona «Equipo 2 · Activo»; API `activeDeck=f7739fa5` | PASS | 13-prematch-after-active-deck-switch.png |
| 34 | Smoke de perfil | 0049 funciona desde la app | `set_showcase` con carta propia → SAVED v1; carta falsa 403 NOT_OWNED; `userId` 400; revertido → SAVED v2 (0 cartas) | PASS | database-evidence.md |
| 35 | Smoke social | Sin degradar | `GET /api/game/social` 200 con snapshot; sin mutación (no hay segunda cuenta QA) | PASS | salida de consola |
| 36 | Camino de derrota | Verificar si ocurre | No ocurrió (2 victorias de 2) | N/A | cubierto por T55 / verificadores |
| 37 | Camino de empate | No forzar | No ocurrió | N/A | cubierto por T56 / verificadores |
| 38 | Consola | Sin errores propios | 0 en todas las ejecuciones con la app arriba; los únicos errores (`ERR_CONNECTION_*`) fueron cuando la app murió por el timeout de la herramienta, antes de relanzarla | PASS | salida de consola |
| 39 | Rating / Ranked | Sin afectar | 0 `duel_pvp_rating_events`; fila QA 1000/0 creada por el `ensureRating` preexistente al leer meta | PASS | database-evidence.md |
