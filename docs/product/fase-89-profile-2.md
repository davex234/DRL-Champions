# F89 — PROFILE 2.0 / PLAYER IDENTITY · Informe final

Fecha: 2026-10-03 · Rama `arch/stabilization` · Sin commit ni push.

Evidencias: `docs/product/qa/f89-profile/` (QA del arnés a 1440/1024/390, normal y reducido) y
`docs/product/qa/f89-profile/prod/` (QA en producción, ensayo y aplicación de 0063, frontera de la release, capturas reales).

---

## A. INITIAL PRODUCTION STATE
Comprobado antes de tocar nada: release `drl-0.1.1-1-d3973448` (F82), `/api/health` 200, `/api/ready` `ready` con
cabeza `0062_collection_sets`, contenedor `healthy`, túnel con 4 conexiones. Coincide con el prompt. Árbol de trabajo:
1.6k entradas sucias/sin seguimiento (trabajo histórico y F78 local), tratado con frontera por hashes (§BJ).

## B. PROFILE AUDIT
El perfil ya era un sistema rico y único (F31 → F56 → F82): ruta `/jugador/[id]` (+ `/jugador/me`), una foto
`PlayerIdentitySnapshot` construida en servidor (`buildPlayerIdentity`) con proyección SELF/PUBLIC, un endpoint
`/api/game/player` (GET agregado + POST con cuerpo cerrado), vitrina de 3 instancias reales (0049), logros destacados,
insignias destacadas (0062), avatar de conjunto cerrado, ranked F55 (puesto/colocación, sin rangos con nombre), temporada,
cara a cara, Pick'ems y actividad. **F89 lo extiende**; no hay segundo sistema. Faltaba: equipo favorito, «miembro desde»,
estadísticas de TODAS las partidas (solo había ranked), historial paginado de todos los modos, colecciones F82 en el perfil,
momentos destacados, cartas en el héroe y separación explícita propietario/público.

## C. EXISTING DATA MODEL
- `profiles`: id, username (único, editable por el propio usuario vía REST: columnas avatar/region/username), avatar,
  xp, equipped, packs_opened, created_at… (anon sin acceso; authenticated solo 6 columnas públicas desde 0058).
- `player_profile_customization` (0049/0062): showcase_card_uids, featured_achievement_ids, featured_badge_ids,
  version, updated_at. RLS sin políticas; ningún grant a anon/authenticated (verificado en producción).
- `duel_matches`: modos reales PVE (131), PVP (58), PVP_PRIVATE (101), DRAFT_GAUNTLET (16); winner A/B; closed_reason.
- `duel_pvp_ratings` / `duel_pvp_rating_events`: rating real (no hay rangos con nombre).
- `user_cards`, `user_achievements`, `user_cosmetics`, `user_collection_completions` + `collection_sets` (F82).
- Equipos esports: identidades canónicas del catálogo (`TEAM_IDENTITIES`, equipo impreso en carta) + 25 logos reales del
  producto (`/hints/teams`). La tabla esports `teams` (37 filas) no tiene logos y usa otro espacio de ids.

## D. NEW DATA MODEL
| Dato | Vive en | Fuente de verdad |
|---|---|---|
| Equipo favorito | `player_profile_customization.favorite_team_id` (0063) | id de identidad de equipo del catálogo; logo resuelto por el servidor |
| Miembro desde | `profiles.created_at` | se publica solo el mes |
| Estadísticas / rachas / momentos / historial | `duel_matches` (lectura ligera) | reglas del competitivo (`outcomeFor`/`letterOf`/`winrate`) |
| Colecciones y equipos completados | `user_collection_completions` + `collection_sets` (F82) | F82, sin recálculo |
| Insignias | `user_cosmetics` + `featured_badge_ids` (F82) | F82 |
| Copias / distintas | `user_cards` | inventario (Fase 27) |
| Cartas destacadas | `showcase_card_uids` (0049) | instancia poseída |
Nada se duplica: el perfil solo LEE de esas fuentes.

## E. MIGRATION
`0063_profile_favorite_team.sql` (cabeza real previa = 0062, comprobada por estado): una columna nullable con CHECK de
forma `^[a-z0-9-]{1,48}$` + RPC `player_profile_set_favorite_team(user, team, expected_version)` SECURITY DEFINER,
`search_path` fijo, EXECUTE solo `service_role`, mismo contrato de versión que 0049/0062. Aplicada **una vez** en
producción el **2026-10-03T21:19:11Z** como `postgres`, una transacción, 158 ms, sha256 `a731bb51…a0d2`; recuentos y
huellas idénticos antes/después (`prod/apply-0063.log`). Sin registrar en `schema_migrations` (como 0026–0062).
Rollback: `docs/operations/rollback/0063_profile_favorite_team.ROLLBACK.sql` (probado en el ensayo).

## F. PROFILE HEADER
Héroe nuevo (`PlayerHero`): avatar con marco, nombre (h1), título/banderín reales, **equipo favorito** (logo + nombre),
nivel, **miembro desde**, ranked F55 (emblema de puesto o colocación X/10; rating), **insignias destacadas** a tamaño de
trofeo, XP (solo propio), acciones, y en escritorio las **cartas destacadas en abanico** (CardArt). Sin 600 px vacíos.

## G. AVATAR
Se reutiliza el sistema existente (conjunto cerrado de emojis, validado en servidor, `safeAvatar`). Sin subidas.

## H. USERNAME / DISPLAY NAME
No se ha tocado su semántica: `profiles.username` es único (sensible a mayúsculas; índice por `lower`), lo crea el
alta y el usuario puede cambiarlo desde `/cuenta`. El perfil muestra `publicName` (nunca un correo; corte a 40). No
existe «display name» separado y no se ha creado.

## I. BIO
**No implementada (decisión).** No existe hoy, no hay herramientas de moderación para texto libre público y el contrato
del perfil (F31) prohíbe explícitamente sistemas nuevos de texto (`bio`, enlaces…). Queda como extensión futura con
moderación.

## J. FAVORITE TEAM
Elegible desde «Editar perfil → Equipo favorito» (búsqueda, logos, «Sin equipo favorito»). Opciones = identidades
canónicas **impresas en cartas reales** (mismo criterio que F82), excluidas las `raw:` y las que la auditoría 20.2 dejó sin
fijar (DRX, EDward Gaming, Gen.G, Sentinels). Servidor: id exacto o `null`; nombre, URL, logo, número o id desconocido →
400 sin llegar al RPC; RPC con versión (UNCHANGED/CONFLICT/SAVED). Un id guardado que deje de ser válido no se enseña.

## K. TEAM LOGO
El logo NUNCA viene del cliente: `hintTeamLogoSrc(id)` (los 25 logos reales del producto), pintado tal cual con `alt`.
Sin logo real → sigla del equipo (lenguaje propio); si la imagen falla → sigla. Tratamiento sutil: sello pequeño; el
perfil no se recolorea con colores del equipo (no hay paleta oficial fiable).

## L. F82 BADGES
Integradas en el héroe (antes, sección aparte bajo la vitrina): insignias destacadas con el escudo F82 y el logo real.
Público: solo las elegidas y poseídas. Sin cambios en F82 (sets, reclamo, sala, panel); `ProfileBadges.tsx` se retira
porque su contenido vive ahora en el héroe.

## M. BADGE MANAGEMENT
«Gestionar insignias» (héroe del propio perfil) abre la pestaña existente del editor: equipar, quitar, reordenar (≤3) con
el RPC F82 (`player_profile_set_badges`, propiedad en la misma transacción). Producción: insignia bloqueada → 403.

## N. FEATURED CARDS
Se reutiliza la vitrina 0049 (3 instancias): en escritorio, abanico en el héroe; en móvil/tableta, carrusel detallado.
CardArt real (el asset es la carta; profundidad con `drop-shadow` de la silueta).

## O. CARD OWNERSHIP VALIDATION
Forma (UUID, ≤3, sin repetidos) → propiedad en servidor → propiedad otra vez en el RPC. Producción: copia de otra cuenta
→ 403 NOT_OWNED; uid inventado → 403; mal formado → 400; repetido → 400; copia propia → SAVED y visible al anónimo. Una
copia que desaparece (desguace/crafteo) se salta en público y se avisa en el propio. No protege cartas: F79 sigue siendo
la regla canónica.

## P. SHOWCASE
Vitrina + insignias + equipo favorito = la identidad elegible. Sin «perfil completado al X %».

## Q. PLAYER STATS
Bloque «Estadísticas»: anillo de % de victorias, partidas, victorias, derrotas, empates, racha actual, mejor racha de
victorias y desglose por modo (Ranked, Contra la IA, Draft Gauntlet; Duelos privados solo en el propio).

## R. MATCHES PLAYED
= partidas TERMINADAS con desenlace (victoria/derrota/empate, incluidos abandono y tiempo agotado asignados por el
competitivo). En curso y sin resolver no cuentan. Público: PVP + PVE + DRAFT_GAUNTLET. Propio: además PVP_PRIVATE.

## S. WINS / LOSSES
`outcomeFor` del competitivo (bando A/B, abandono = derrota de quien abandona). Producción (QA K): API = BD en
jugadas/V/D/E, tanto en público como en propio (`prod/prod-qa.json`).

## T. WIN RATE
`winrate(V, D, E)` = round(V / (V + D + E) × 100). El denominador se escribe en pantalla («% de victorias sobre N
partidas terminadas (modos…)»). Lectura acotada a 5.000 partidas; si se alcanza, la API lo dice y la UI lo indica.

## U. MATCH HISTORY
Filas reales: letra W/L/E en texto + color, resultado (incl. «el rival abandonó»), rival (nombre y avatar PÚBLICOS; IA con
dificultad), modo, día, marcador. Enlaces solo en el propio perfil y solo a vistas ya autorizadas (detalle ranked de
participante, repetición PvE). Público: sin duelos privados, sin enlaces a partidas ajenas; el rival enlaza a su perfil.

## V. HISTORY PAGINATION
Primera página (10) dentro de la foto; «Cargar más» con cursor (`?id=…&history=1&before=<ms>`), una fila de más para saber
si hay siguiente, sin repetidos (test 10+10+5 y prueba en producción). Parámetros ajenos (`userId`) o cursor inválido → 400.

## W. RANK
Se muestra el rango REAL que existe: puesto en la escalera / colocación X de 10 / rating (F55). No se ha inventado un rango
con nombre (no existe sistema persistente de tiers).

## X. COLLECTION SUMMARY
Bloque «Colección»: copias, cartas distintas (de 331), colecciones completadas **de las publicadas** (numerador =
compleciones de sets publicados; denominador = sets publicados hoy), equipos completos, insignias desbloqueadas, barra de
progreso con ese numerador/denominador y distribución por rareza (cartas distintas). Producción: API = BD.

## Y. COMPLETED SETS
Rejilla «Colecciones completadas» con el escudo F82 + logo real, nombre y día; cada una enlaza a
`/coleccion/trofeos/<set>`. Las retiradas que completó siguen siendo suyas.

## Z. TROPHY ROOM INTEGRATION
Propio: «Sala de Trofeos» en el héroe y «Ver Sala de Trofeos» en Colección. Público: solo lo completado; el progreso de
sets no completados nunca viaja a un perfil ajeno.

## AA. ACHIEVEMENTS
Se mantiene la sección real (logros del catálogo reclamados, destacados o últimos conseguidos). Las insignias F82 no se
duplican como logros.

## AB. RECENT ACTIVITY
Se mantiene la actividad existente (resultados ranked, logros, Pick'ems corregidos; fechas al día). Nuevo: **Momentos
destacados** (primera partida, primera victoria, hitos 10/25/50/100/250/500/1000 partidas, colecciones completadas), solo
con hechos fechados; si la lectura se acota, los «primeros» no se emiten. Sin compras ni créditos.

## AC. OWNER PROFILE
`ProfileOwnerView`: Editar perfil, Copiar enlace, Sala de Trofeos, Cuenta y ajustes, Editar equipo (mazos), Gestionar/
Equipar insignias, Elegir equipo favorito, Editar vitrina; XP y duelos privados solo aquí.

## AD. PUBLIC PROFILE
`PublicProfileView`: identidad, equipo, rango, insignias, cartas, estadísticas públicas, colecciones completadas,
historial público, logros, actividad, acciones sociales F29 y Copiar enlace. No recibe ningún manejador de edición.

## AE. PRIVACY
La foto PÚBLICA no contiene correo, créditos, XP exacta, versión, uids guardados, lista de insignias propias, duelos
privados, `createdAt` exacto (solo mes), sobres abiertos ni progreso de colecciones; el anónimo recibe la misma foto
pública. Nota: el id público del perfil sigue siendo el UUID de la cuenta (diseño desde F31, ver §BY).

## AF. PUBLIC API PAYLOAD
~4,8 KB (1,5 KB gzip) para el perfil público real de QA K; página de historial ~2,4 KB. Lo privado no se envía (no se
esconde con CSS): lo decide `buildPlayerIdentity` + `modesFor` en servidor.

## AG. PROFILE EDIT
Editor existente ampliado: Vitrina, Logros, Insignias, **Equipo favorito**, Avatar. Estadísticas no editables. Todo por
`/api/game/player` (cuerpo cerrado, usuario del token, versión optimista).

## AH. SECURITY
Mutaciones solo sobre uno mismo (usuario del token; `userId`/campos extra → 400), rate limit existente
(`profile_read`/`profile_write`), 404 uniforme para inexistentes y bloqueados, sin trazas ni ids internos en errores.

## AI. RLS
Sin cambios de RLS. `player_profile_customization` sigue con RLS sin políticas; en producción, tras 0063,
anon/authenticated sin SELECT de tabla ni de columna y sin EXECUTE del RPC (`prod/apply-0063.log`). El perfil público se
construye en servidor con service role, sin abrir lecturas de cliente.

## AJ. CROSS-ACCOUNT TESTS
Producción: QA no puede cambiar el equipo de K (su mutación solo tocó su fila; K intacto en BD), no puede destacar copias
ajenas (403) ni equipar insignias bloqueadas (403). Tests: A no altera B.

## AK. DIRECT API ABUSE
Producción: ids de equipo inventados/nombre/URL/logo/número/identidad sin fijar → 400; uid ajeno/inventado/mal
formado/repetido → 403/400; `?userId=` en historial → 400; cursor inválido → 400; id mal formado → 400; anónimo muta → 401.

## AL. XSS
Nombre `<img onerror>`/`<script>` pintado como texto escapado (test de render), ningún `dangerouslySetInnerHTML` en el
perfil, nombres largos con `line-clamp`/`overflow-wrap:anywhere`/`truncate`. Sin bio = sin superficie de texto libre nuevo.

## AM. RACE TESTS
Postgres real (ensayo): 10 «equipo favorito» con la misma versión → 1 SAVED; equipo + insignias simultáneos con la misma
versión → 1 SAVED + 1 CONFLICT y solo el ganador escrito; 20 primeras escrituras simultáneas → 1 fila. Producción: dos
pestañas de K → 1 SAVED + 1 CONFLICT, BD con solo el ganador.

## AN. AUTH HYDRATION
F81.2 preservado: el editor de vitrina sigue eligiendo solo entre cartas de la cuenta confirmada por el servidor
(`ownedReady ? storeOwned : []`); el perfil muestra esqueleto neutro hasta la foto del servidor; ningún dato demo.

## AO. ACCOUNT SWITCHING
La foto queda atada a (perfil pedido, cuenta que mira); una respuesta tardía de otra cuenta se descarta; el historial
paginado no mezcla perfiles. Producción: K abre su perfil → logout → login QA → enlace del menú (sin recargar): el perfil
es el de QA y un observador cada 20 ms nunca vio datos de K.

## AP. EMPTY PROFILE
Propio: «Sin partidas registradas todavía…», «Completa una colección de equipo…», «Elegir equipo favorito», «Elegir
cartas». Ajeno: líneas discretas («Sin partidas registradas», «Aún no ha completado ninguna colección»), sin botones.

## AQ. PROFILE NOT FOUND
Pantalla existente «Jugador no encontrado» (+ buscar jugadores); API 404 sin datos ni ids.

## AR. PERFORMANCE
Una sola petición por carga de perfil (más una por «Cargar más»). En servidor, todas las lecturas en dos tandas en
paralelo; las nuevas (carrera ligera sin `state`, equipo, colecciones) van en el MISMO `Promise.all`; sin N+1 (test). TTFB
medido desde el PC: 0,19–0,30 s (perfil), 0,13 s (página de historial).

## AS. REQUEST COUNT
Cliente: 1 (perfil) + 1 por página de historial. Servidor: ~16 consultas acotadas en 2 tandas paralelas + 1 de rivales.

## AT. PAYLOAD SIZE
4.766 B (1.520 B gzip) perfil público real; 2.413 B página de historial.

## AU. CACHE
Sin caché de perfil (`no-store` en la API y `cache: "no-store"` en el cliente): no hay invalidación que fallar ni datos
cruzados. La única «caché» es el estado de la página, atado a (perfil, cuenta).

## AV. 1440 QA · AW. 1024 QA · AX. 390 QA
Arnés `/design-system/fase89` (escenas propio, público, anónimo, sin insignias, equipo sin logo, vacío propio/público,
textos largos, XSS, editores): **315/315** en 3 anchos × normal/reducido (desbordamiento, consola, h1 único, alt,
táctil ≥ 44 px, controles solo en el propio, cartas en el héroe solo ≥ 1024, «Cargar más», teclado, editor de equipo).
Producción: perfil propio de K a 1440/1024/390 y vista pública desde QA a 1440/390 sin desbordamiento.

## AY. ACCESSIBILITY
h1 único, secciones con títulos enlazados (`aria-labelledby`), W/L/E con letra y texto, marcador con `aria-label`, logos e
imágenes con `alt`, botones de 44 px, foco visible, opciones del editor con `aria-pressed`, búsqueda con etiqueta.

## AZ. REDUCED MOTION
El único movimiento nuevo (elevación de cartas al pasar) se anula con `motion-reduce`; sin información perdida.

## BA. LONG TEXT
Nombres de 48+ caracteres, equipos largos («Dragon Ranger Gaming») e insignias con corte seguro; sin desbordamiento.

## BB. REAL PRODUCTION QA
`scripts/_f89-prod-qa.mts` con QA K y QA (f45) contra `https://valorosters.com`: **82/83**. El único fallo fue la
restauración final de K: la prueba de cambio de cuenta hace logout y eso revocó las sesiones de K, así que el token ya no
servía. Restaurada después con una sesión nueva y **verificada en BD** (K: sin equipo, vitrina vacía, como al empezar;
QA: sin equipo). El instrumento ya usa una sesión nueva para restaurar.

## BC. PERSONAL ACCOUNT UNTOUCHED
Ni se usó ni se modificó (sin equipo favorito, sin cambios de vitrina/insignias; verificado en BD).

## BD. F82 REGRESSION
Sala de Trofeos, sets, reclamo y panel sin cambios de código; `/coleccion/trofeos` 200 y `/api/game/collection-sets` 200
en producción; tests F82 en verde.

## BE. F81 REGRESSION
Apertura, héroe, `localEconomy`, sync y store fuera del delta; tests F81/F81.1/F81.2 en verde.

## BF. ECONOMY REGRESSION
Ningún fichero de economía/sobres/tienda/forja/crafteo en el delta. Precios 2.500/6.000/12.000/20.000/35.000/60.000
intactos; pins de economía en verde.

## BG. MARKETPLACE OFF · BH. PAYMENTS OFF
`GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false` (production:check).

## BI. F78 EXCLUDED
Release = fuente de producción + overlay F89. Los ficheros F78 de la release son byte a byte los de producción
(`prod/stage-boundary.log`). El backup pre-0063 se hizo con el script de la release de producción y off-site forzado a
«no configurado»: nada de F78 se tocó ni se declara cerrado.

## BJ. RELEASE BOUNDARY
Staging en el VPS: base `drl-0.1.1-1-d3973448` (3.575 ficheros) + overlay (41) − 1 borrado = 3.584. Comprobado por sha256:
**añadidos (10) + modificados (31) = overlay exacto; borrados = `ProfileBadges.tsx`**. Cada fichero modificado se comparó
contra la copia de producción: sus diffs son solo F89. Fuera de la release a propósito: instrumentos `_f89-qa.ts`,
`_f89-prod-qa.mts`, `ops/_f89-*.sh`.

## BK. BACKUP
`/opt/nexus/backups/supabase-drlcards/pre-0063/20261003T205301Z` (COMPLETE + SHA256SUMS, 3,58 MB, 7 s). Backup local en
el VPS: no cierra F78.

## BL. MIGRATION REHEARSAL
Postgres desechable restaurado del backup pre-0063 (`--network none`): **DRYRUN_OK 34/34** — aplica en una transacción,
huellas de 16 tablas idénticas, usuarios existentes intactos, contrato del RPC, CHECK de forma, privilegios, carreras A/B/C,
rollback, re-aplicación e idempotencia (`prod/dryrun-0063.log`).

## BM. FULL TEST SUITE
`npm test`: **5835/5835** (5797 previas + 38 nuevas). Una pasada intermedia tuvo un fallo de carga de módulo en un test
ajeno (`draftScreen.render`), que pasa solo y en la pasada completa siguiente.

## BN. F89 TESTS
38 nuevos: 24 de dominio/render/contrato (`f89.profile.test.tsx`), 13 de servicio sobre MemorySupabase
(`f89.profile.service.test.ts`, con soporte nuevo de `or()` estilo PostgREST y orden multicolumna en el doble de pruebas)
y 1 de cabeza de migración (ops). Pins de fases anteriores reescritos a su intención (proyección de `profiles`, «última
migración», acciones sociales en la vista pública, estadísticas en `ProfileCareer`).

## BO. TYPES
`npm run typecheck` (app + scripts): 0 errores.

## BP. LINT
`eslint src`: 0 errores, 9 avisos (los mismos de base).

## BQ. BUILD
Build local de producción OK y build de la release en el VPS OK (`logs/build-drl-0.1.1-1-fd07721d.log`, `BUILD_ID` =
nombre de la release).

## BR. HEALTH · BS. READY
`/api/health` 200; `/api/ready` `ready`, cabeza `0063_profile_favorite_team`, todos los checks en verde (incluido el nuevo
`profile`).

## BT. SMOKE
`production:check --app --vps`: 27 PASS · 1 WARN (auth-email, F77) · 4 FAIL (F78 off-site, externos y conocidos).
Páginas `/`, `/coleccion`, `/coleccion/trofeos`, `/tienda`, `/misiones/crafting`, `/competitivo`, `/progresion`, perfil →
200; APIs state/me/competitive/forge/missions/crafting/collection-sets → 200 con QA. No se compraron ni abrieron sobres
(sin saldo QA y sin cambios en esa área).

## BU. LOGS
`valorosters-app`: 0 errores desde el despliegue. Postgres: solo el aviso antiguo de `profiles` del precheck de admin
(anterior a F82).

## BV. RELEASE
**`drl-0.1.1-1-fd07721d`**, activa desde 2026-10-03 ~21:22Z.

## BW. ROLLBACK
Código: `bin/deploy.sh --activate drl-0.1.1-1-d3973448` (la app anterior no usa la columna; compatible con 0063).
BD (solo si hiciera falta, tras el código): `0063_profile_favorite_team.ROLLBACK.sql` (pierde los equipos favoritos).

## BX. COMMIT/PUSH
Ninguno.

## BY. REMAINING RISKS
1. **UUID como id público del perfil**: desde F31 la URL y los enlaces de escalera/social usan el UUID de la cuenta. No es
   una credencial y no da acceso a nada, pero el prompt pedía no exponer ids internos. Un «handle» público estable exige
   migración y tocar escalera/social; queda propuesto, no hecho.
2. **Marcas de los 25 logos** (F72.3/F82): siguen sin resolver para una release pública; ahora también aparecen como equipo
   favorito.
3. **Bio** no implementada (sin moderación de texto libre).
4. La analítica de perfil usa los contextos existentes; no se abrieron eventos nuevos (`favorite_team_changed`…).
5. Recolorear el perfil con colores del equipo: no hecho (no hay paleta oficial fiable).
6. `username` es editable por REST por el propio usuario (diseño anterior); no se ha tocado.

## BZ. FINAL VERDICT
Definición de hecho: 1 ✔ · 2 ✔ · 3 ✔ · 4 ✔ · 5 ✔ · 6 ✔ · 7 ✔ · 8 ✔ · 9 ✔ · 10 ✔ · 11 ✔ · 12 ✔ · 13 ✔ · 14 ✔ · 15 ✔ ·
16 ✔ · 17 ✔ · 18 ✔ · 19 ✔ · 20 ✔ · 21 ✔ (82/83 + restauración verificada) · 22 ✔ · 23 ✔ · 24 ✔ · 25 ✔ · 26 ✔ · 27 ✔.

**F89 PRODUCTION = GO**
