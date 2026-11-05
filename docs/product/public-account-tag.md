# TAG PÚBLICO DE CUENTA (0068)

**Release:** `drl-0.1.1-1-c2ccec7f` (2026-10-05 ~11:25Z) · **Cabeza BD:** `0068_public_account_tag` · **Rollback código:** `bin/deploy.sh --activate drl-0.1.1-1-239fb814` (después, si hiciera falta, `docs/operations/rollback/0068_public_account_tag.ROLLBACK.sql`). Evidencia: `docs/product/qa/account-tag/` y `docs/product/qa/profile-identity/` (arnés con tag).

## A. INITIAL STATE
Producción en `drl-0.1.1-1-239fb814` (perfil = identidad), cabeza `0067_admin_management`, 40 cuentas, un admin (la cuenta personal). F86 no existe ni en el árbol ni en producción (se interrumpió tras la auditoría). Suite 5979/5979.

## B. EXISTING IDENTITY MODEL
`auth.users` (GoTrue) → disparador `on_auth_user_created` → `handle_new_user` crea `profiles` (+ estado, sobres de bienvenida, asiento inicial). `profiles.id → auth.users(id) ON DELETE CASCADE`. Nombre = metadatos o parte local del correo + `_` + 4 hex del id (`DAVEX_234_3BEF`). El cliente solo puede actualizar `username`, `avatar` y `region` (privilegios de columna, 0058) y nunca lee columnas privadas. Borrado de cuentas: no existe en la app; solo `auth.admin.deleteUser` en scripts de QA (cascada al perfil).

## C. INTERNAL ID
`auth.users.id` = `profiles.id` (UUID): sigue siendo la clave técnica de TODAS las relaciones y de la auditoría (`entity_id`). No se ha tocado ninguna FK.

## D. DISPLAY NAME
`profiles.username`: sin cambios (único, editable por su dueño). El tag no depende de él.

## E. PUBLIC TAG DESIGN
`profiles.public_tag`: canónico en MAYÚSCULAS y SIN «#» en la BD; la UI lo presenta como `#7K4M92X`. Único, permanente, público, no sensible, no secuencial y nunca reutilizado.

## F. ALPHABET
`23456789ABCDEFGHJKMNPQRSTUVWXYZ` — 31 símbolos: sin `0`/`O` ni `1`/`I`/`L`.

## G. TAG LENGTH
**7.** Decisión por adivinabilidad, no por colisiones (esas las resuelve el registro): con 6 y 10 M de cuentas, 1 de cada 89 tags al azar sería real; con 7, 1 de cada 2.751. 8 no aporta nada necesario.

## H. CAPACITY MATH
| longitud | combinaciones | bits |
|---|---|---|
| 6 | 887.503.681 | 29,7 |
| **7** | **27.512.614.111** | **34,7** |
| 8 | 852.891.037.441 | 39,6 |

## I. COLLISION ANALYSIS (7 símbolos)
| cuentas | colisión sin reintento (cumpleaños) | ocupación = prob. de reintentar un alta = acertar un tag al azar | fallar 10 intentos seguidos |
|---|---|---|---|
| 1.000 | 0,0018 % | 1 de 27.512.614 | 4·10⁻⁷⁵ |
| 10.000 | 0,18 % | 1 de 2.751.261 | 4·10⁻⁶⁵ |
| 100.000 | 16,6 % | 1 de 275.126 | 4·10⁻⁵⁵ |
| 1.000.000 | ~100 % | 1 de 27.513 | 4·10⁻⁴⁵ |
| 10.000.000 | ~100 % | 1 de 2.751 | 4·10⁻³⁵ |
Sin reintento habría choques a partir de ~10⁵ cuentas: por eso el registro con clave única + reintento es imprescindible. (Con 6 símbolos, a 10 M: 1 de 89.)

## J. GENERATION ALGORITHM
En la BD: `_account_tag_random()` con `extensions.gen_random_bytes(16)` (pgcrypto, CSPRNG) y muestreo por rechazo (solo bytes < 248 = 31·8: sin sesgo de módulo). `_account_tag_claim(user)`: si la cuenta ya tiene fila en el registro, ESE tag; si no, inserta uno nuevo y, ante `unique_violation`, distingue «chocó el usuario» (otra transacción ya le dio tag → ese) de «chocó el tag» (otro intento). Tope 10 → `ACCOUNT_TAG_EXHAUSTED`.

## K. DB MODEL
`profiles.public_tag text NOT NULL` + `CHECK` de formato + `UNIQUE`; `account_tag_registry(tag PK, user_id UNIQUE, assigned_at)`.

## L. UNIQUE CONSTRAINT
`profiles_public_tag_key UNIQUE (public_tag)` y `account_tag_registry.tag PRIMARY KEY`: unicidad real en la BD, no «miro si existe».

## M. TAG REGISTRY / NON-REUSE
`account_tag_registry` SIN clave foránea a `auth.users`: borrar una cuenta borra su perfil (cascada) pero no su fila del registro, y la clave primaria impide volver a repartir ese tag. Append-only para cualquier rol (disparador rechaza UPDATE/DELETE). Clientes sin ningún privilegio; solo lo escribe `_account_tag_claim` (SECURITY DEFINER).

## N. IMMUTABILITY
Disparador `profiles_account_tag_immutable` (BEFORE UPDATE, todos los roles, también service_role/postgres): el tag solo puede pasar de NULL a SU tag del registro y solo con la bandera `drl.account_tag_writer` (el backfill). Cualquier otro cambio → `ACCOUNT_TAG_IMMUTABLE`. No hay procedimiento de cambio (no se pidió).

## O. EXISTING USER BACKFILL
En la propia migración, `where public_tag is null`, con `profiles_touch` suspendido DENTRO de la transacción: no se mueve `updated_at` ni ninguna otra columna. Producción: 40/40 cuentas con tag, 0 nulos, 0 duplicados, huellas de 20 tablas + perfiles (sin el tag) idénticas antes/después.

## P. NEW USER GENERATION
Disparador `profiles_account_tag_insert` (BEFORE INSERT): el tag lo pone SIEMPRE la BD; un valor que venga en el INSERT (o en los metadatos del alta) se sustituye. Ni el navegador ni `handle_new_user` lo eligen.

## Q. IDEMPOTENCY
Reaplicar 0068 no cambia ningún tag (ensayo: md5 de id→tag igual). Un perfil recreado para la misma cuenta recupera su tag del registro.

## R. COLLISION RETRY
Ensayo: generador forzado a devolver un tag VIVO en el primer intento → el alta reintenta y recibe otro. Ensayo con 100.000 tags crudos: apareció 1 colisión real (esperado ≈ 0,18) y las 100.000 asignaciones por el registro terminaron con 0 duplicados.

## S. CONCURRENCY
100 altas simultáneas en la copia → 100 perfiles, 100 tags distintos y válidos. 20 asignaciones simultáneas para la MISMA cuenta → un único tag.

## T. DELETION / NON-REUSE
Ensayo: cuenta borrada → perfil fuera, registro conserva (tag → cuenta borrada); generador forzado a proponer ese tag → la cuenta nueva recibe OTRO. Producción: alta QA desechable creada y borrada → su tag sigue en el registro. Política de borrado sin cambios.

## U. PROFILE
`ProfileIdentityCard`: `#TAG` bajo el nombre (monoespaciado, tono secundario), antes de rango/equipo/miembro desde/acciones. El perfil sigue siendo identidad (sin XP, estadísticas, temporada ni colección).

## V. PUBLIC PROFILE
Igual: el tag es público. Producción: el perfil de A visto por B trae el mismo tag y nada privado.

## W. COPY TAG
Botón (teclado) con `aria-label="Identificador de cuenta #TAG. Pulsa para copiarlo"`; copia `#TAG` y anuncia «Tag copiado» (`role="status"`), o «No se pudo copiar». Sin modal. Producción (1440/1024/390): escribe exactamente `#TAG` y avisa (el navegador sin interfaz no tiene portapapeles real: se captura lo que la app escribe).

## X. PLAYER SEARCH · Y. EXACT TAG SEARCH · Z. F85 INTEGRATION
`/social` busca por nombre (igual que antes, ahora con el tag como dato secundario en cada fila) o, si empieza por `#`, por **tag EXACTO** (minúsculas normalizadas; un trozo, un símbolo ambiguo o un formato inválido → 400; nunca prefijo ni difuso). Mismas reglas de privacidad: no salen el propio buscador, quien me bloqueó (indistinguible de un tag sin cuenta) ni cuentas sancionadas. Amistades, retos y bloqueos sin cambios.

## AA. ADMIN SEARCH
`/admin/admins` y `/admin/users` (la entrada a sanciones) aceptan `#TAG` exacto; listas y ficha 360 muestran el tag junto al nombre. Sin correos en `/admin/admins`.

## AB. ADMIN CONFIRMATION
**Migrada a tag.** El diálogo enseña «Cuenta: nombre · Tag: #TAG» y exige escribir `#TAG`; el servidor lo vuelve a comparar (mayúsculas y `#` normalizados). El nombre ya NO confirma; el tag de otra cuenta tampoco. (Una cuenta sin tag —antes de 0068— caería al nombre; tras el backfill no existe ninguna.)

## AC. ADMIN SECURITY
Sin cambios en la autorización (runAdmin/verifyAdmin, RPC solo service_role, guardia de `is_admin`, suelo de admins, cerrojo). Usuario normal buscando `#TAG` en el panel → 401. Último admin y NOT_ADMIN siguen protegidos (ensayo).

## AD. BAN/SANCTION READINESS
Existe sistema de sanciones (F58). Sin cambiar sus reglas: `#TAG` en `/admin/users` identifica la cuenta exacta → ficha 360 (donde se sanciona) con su tag visible. La auditoría de admins guarda `target_tag` como instantánea humana; `entity_id` sigue siendo el id interno.

## AE. PRIVACY
Resolver un tag devuelve solo identidad pública (nombre, avatar, tag, rango, equipo, relación). Ni correo, IP, proveedor, sesiones, inventario, grafo social privado ni datos del registro.

## AF. UUID EXPOSURE
No se añade ningún UUID nuevo al navegador. Las respuestas de búsqueda conservan el `userId` que ya llevaban (lo exigen la ruta `/jugador/[id]` y las acciones sociales existentes); cambiar esas rutas queda para otra fase (como se pidió).

## AG. ENUMERATION PROTECTION
Espacio de 2,75·10¹⁰; la búsqueda por tag usa la misma cubeta que la de nombre (30/min por cuenta → 429; producción: la 31.ª da 429); la BD no deja leer `public_tag` ni el registro a clientes (403). No hay endpoint público de resolución sin sesión.

## AH. RLS
`account_tag_registry`: RLS activada, sin políticas, privilegios revocados a anon/authenticated. `profiles.public_tag`: sin privilegio de columna para clientes (lectura solo por el servidor).

## AI. DIRECT DB ATTACK
Producción: la propia cuenta por REST (`PATCH public_tag`) → 403; anónimo → 401; leer tags en masa / leer o insertar en el registro → 403. Ensayo: superusuario, service_role, authenticated (su fila), anon y «con la bandera pero otro tag» → rechazados; tag a NULL → rechazado.

## AJ. PROFILE EDIT ATTACK
`POST /api/game/player` con un campo extra `public_tag` → 400 (cuerpo estricto) y el tag no cambia (producción).

## AK. SIGNUP ATTACK
Producción: alta con metadatos `public_tag=AAAAAAA` → la BD le da otro tag válido (`NUEQHMN`); ensayo: INSERT directo de un perfil con tag → sustituido.

## AL. ACCOUNT SWITCH
Producción 390: A cierra sesión → B entra → «mi perfil»: muestreo cada 40 ms, aparece `#TAG` de B y NUNCA el de A (la foto va atada a perfil+cuenta).

## AM. ACCESSIBILITY
Tag como botón real con nombre accesible («Identificador de cuenta #…»), foco, aviso `role="status"`; en el panel, «Cuenta/Tag» en una lista de definición y el campo de confirmación etiquetado.

## AN. 1440 QA · AO. 1024 QA · AP. 390 QA
Arnés `/design-system/profile-identity` (con tag): **348/348** (3 anchos × normal/reducido; propio, ajeno, vacío, colocación, nombre largo: tag bajo el nombre, dentro de pantalla, nombre accesible). Producción: perfil propio y ajeno a los tres anchos, búsqueda `/social` y `/admin/admins` a 1440 y 390 (capturas en `account-tag/prod/shots`).

## AQ. MIGRATION
`supabase/migrations/0068_public_account_tag.sql`, aplicada **2026-10-05T11:20:37Z**, una transacción, 203 ms, como postgres, sin registrar (como 0026–0067). Script `scripts/ops/_tag-apply-0068.sh`. Pins «última migración» y cabeza por estado real (`accountTag0068Applied`, `ACCOUNT_TAG_0068`) actualizados.

## AR. BACKUP
`pre-0068/20261005T105750Z` con el script de la release de producción (`BACKUP_OK`). **Off-site NO configurado (F78 abierto): no hay DR off-site.**

## AS. MIGRATION REHEARSAL
`scripts/ops/_tag-dryrun.sh` sobre copia aislada del backup: **DRYRUN_OK 54/54** (primera pasada 52/54: dos fallos del propio ensayo —anon filtrado por RLS en silencio y la copia de la función de 0067 sin sus comentarios—, corregidos). Cubre huellas, idempotencia, altas, inyección, inmutabilidad, registro, borrado sin reutilización, colisiones forzadas, agotamiento (207 ms, sin alta a medias), 100.000 tags, concurrencia, auditoría, último admin y rollback (registro conservado, función de 0067 byte a byte, mismos tags al reaplicar).

## AT. 100K TAG TEST
100.000 tags del generador en ~1,7 s: formato válido en todos, 1 colisión cruda (esperado ≈ 0,18). 100.000 asignaciones por el registro en ~8,7 s: 100.000 tags, 0 duplicados.

## AU. SECURITY HARNESS
Ensayo (BD real) + producción (API/REST/navegador): sin sesión, cuenta normal y anónimo contra el tag; inyección en edición; alta eligiendo tag; duplicado; minúsculas; símbolos inválidos; corto/largo; mutación del registro; búsqueda admin por usuario normal (401); privacidad de la búsqueda pública.

## AV. PRODUCTION QA
`scripts/_tag-prod-qa.mts`: **39/39** tras corregir 3 comprobaciones del propio instrumento (selector de la etiqueta del diálogo, y booleano `true` de psql). A fue admin temporal por operador (auditado) y se retiró él mismo; B se concedió y quitó por tag. Final: único admin = la cuenta personal; QA sin admin. Cuenta QA desechable creada y borrada (su tag queda en el registro).

## AW. MY PUBLIC TAG
**#9KZAWPC** (asignado por el backfill; nada más cambió en tu cuenta: huella del perfil idéntica, `updated_at` intacto, sigue siendo admin).

## AX. F84 REGRESSION
`_f84-prod-qa.mts` (lecturas): 51/52; el único fallo es su pin de cabeza antigua («0065»). El instrumento buscaba el bloque de rango del perfil-dashboard retirado en el cambio de perfil anterior (`hero-ranked`): actualizado a `profile-rank`.

## AY. F85 REGRESSION
Búsqueda por nombre intacta (y con tag), presencia/amistades/retos sin cambios; tests de F85 en verde.

## AZ. ADMIN MANAGEMENT REGRESSION
Conceder/quitar, último admin, cerrojo, auditoría y 401 a cuentas normales intactos; confirmación migrada a tag con tests (ADM-1…ADM-12).

## BA. PROFILE REGRESSION
Perfil simplificado intacto (tests PI-1…PI-6, F56/F89 y TAG-6); solo se añade `#TAG`.

## BB. F83 STATUS
`_f83-prod-qa.mts` 39/40 (solo su pin de cabeza). Temporada 2: **DRAFT**.

## BC. F82 REGRESSION
Sala de Trofeos sin cambios (ningún fichero de F82 en la release; smoke 74/74).

## BD. F86 STATUS
No existe en árbol ni producción (interrumpida tras la auditoría). No se ha tocado.

## BE. F78 EXCLUDED
Los 9 ficheros de F78 = producción en el staging; ninguno viaja.

## BF. MARKETPLACE · BG. PAYMENTS
`GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false` (production:check «flags»).

## BH. RELEASE BOUNDARY
Base `239fb814` + overlay: **added=4 modified=33 removed=0**, `BOUNDARY_OK`, F78 = producción (`account-tag/prod/release-boundary-c2ccec7f.txt`).

## BI. FULL TEST SUITE
**5988/5988.**

## BJ. TYPES · BK. LINT · BL. BUILD
Tipos 0 errores · lint 0 errores (26 avisos = línea base) · build PASS.

## BM. HEALTH · BN. READY
`/api/health` 200 · `/api/ready` ready, cabeza `0068_public_account_tag`, check `account_tag` en verde.

## BO. LOGS
0 líneas de error en `valorosters-app` desde el despliegue. production:check: 27 PASS · 1 WARN (F77) · 4 FAIL (F78 off-site), los mismos de siempre. Smoke 74/74.

## BP. RELEASE · BQ. ROLLBACK
`drl-0.1.1-1-c2ccec7f`. Rollback: `--activate drl-0.1.1-1-239fb814`; la BD con `0068_public_account_tag.ROLLBACK.sql` (quita columna, disparadores y generación; devuelve `app_admin_set_admin` exacta de 0067; CONSERVA el registro: al reaplicar, cada cuenta recupera su mismo tag y ninguno se reutiliza).

## BR. COMMIT/PUSH
Ninguno.

## BS. FUTURE NEXUS ACCOUNT COMPATIBILITY
El tag es de **Valorosters** (columna en `profiles` + registro propio) y NO se asume global. Para una futura NEXUS Account: (1) crear la identidad de plataforma con SU propio identificador y registro; (2) enlazar `auth.users.id` (o la cuenta NEXUS) ↔ cuenta de Valorosters en una tabla de vínculo; (3) el tag de Valorosters puede seguir como identidad de juego, o importarse al registro de plataforma reservando los existentes (el registro de Valorosters ya garantiza que no hay duplicados ni reutilizados que migrar); (4) si se decidiera un único identificador global, el registro permite migrar `tag → cuenta` sin cambiar ninguna FK, porque ninguna relación depende del tag. Nada de esto se ha construido.

## BT. REMAINING RISKS
1. La búsqueda pública sigue devolviendo el `userId` (arquitectura actual de `/jugador/[id]`); ocultarlo es un cambio de rutas pendiente.
2. El portapapeles real solo se ha probado por su llamada (`writeText("#TAG")`): el navegador sin interfaz no tiene portapapeles.
3. Los instrumentos `_f84/_f83-prod-qa` siguen fijando su cabeza antigua (falla solo esa comprobación).
4. No hay procedimiento administrativo de cambio de tag (por diseño).
5. F78 (DR off-site) sigue abierto.

## BU. FINAL VERDICT
Los 47 puntos de la definición de terminado se cumplen con evidencia (ensayo 54/54, producción 39/39, arnés 348/348, suite 5988/5988). La cuenta personal solo cambió por la asignación del tag.

PUBLIC ACCOUNT TAG = GO
