# Colecciones por equipo · cierre (2026-10-14)

> **Actualización (auditoría final, mismo día):** candidata vigente `drl-0.1.1-1-fe98c81a` y plan de despliegue en
> `colecciones-auditoria-despliegue-2026-10-14.md`; `ea82a9f8` queda sustituida.

**Estado: terminado en local y en el stack de QA aislado, con candidata preparada. Sin push, sin desplegar, sin tocar
producción salvo lecturas (`BEGIN READ ONLY … ROLLBACK`).**

Sigue a `colecciones-equipos-insignias-2026-10-13.md` (cambio 1). El informe de cierre de la sesión del 13 no llegó a
escribirse; este lo sustituye y cubre todo lo que hay en la rama: 0075 (XP, insignias permanentes, perfil, Prestigio
fuera) y lo nuevo de hoy, 0076 (equipos nuevos desde el panel, logos, equipos sin región bloqueados).

Leyenda: **[V]** verificado (pruebas o QA reales) · **[L]** solo en local · **[QA]** solo en el stack de QA ·
**[P]** pendiente · **[B]** bloqueado.

## 1. Estado inicial comprobado

| Qué | Encontrado |
|---|---|
| Rama | `feat/team-collections`, 10 commits sobre `feat/collection-pagination` (= producción `4b1f4c01`) |
| Último commit | `ebf16e9` (la sesión anterior ya había hecho XP, insignias permanentes, perfil y Prestigio) |
| Candidata vigente | `drl-0.1.1-1-aafeeb21` (no `5dc9da1e`, que el encargo daba por vigente y estaba obsoleta) |
| Producción | `current` = `drl-0.1.1-1-4b1f4c01`; 0075 y 0076 **no** aplicadas (comprobado) |
| Árbol sin confirmar | trabajo ajeno: F78 (copias off-site: `scripts/ops/backup-*`, `src/domain/ops/backup*.ts`, `src/instrumentation.ts`), capturas `docs/product/qa/0x-*.png`, `.claude/settings.local.json`. **No se ha tocado ni confirmado** |
| Informe de cierre del 13 | no existía en disco ni en git (la memoria lo citaba) |
| Pruebas al empezar | PC: 6.577/6.577 · tipos 0 errores · lint 0 errores (30 avisos) |
| Los «8 fallos conocidos» | reales: la puerta de `aafeeb21` terminó en `GATE FALLIDA` (6.527/6.535) |

## 2. Qué se ha hecho hoy

1. **Los 8 fallos de la puerta, arreglados de raíz** (§9). Ahora 6.578/6.578 sobre la fuente de la release. [V]
2. **0076 · equipos nuevos con identidad desde el panel.** Una carta publicada desde el CMS con un equipo impreso que el
   registro de código no conoce ya no aparece «a medias»: queda **bloqueada** (ni colección, ni XP, ni insignia) y
   listada en `/admin/teams`, donde un admin le da clave, nombre, etiqueta y región. Desde ese momento es una colección
   más, cuenta para su región y paga sus 300 XP. [V]
3. **Logos desde el CMS.** Colecciones pinta el logo `team_logo` vigente subido al CMS (derivado de 256 px; si hay dos,
   gana el último), la ficha de cada equipo en `/admin/teams/<id>` tiene la subida, y la limpieza de huérfanos del CMS ya
   no puede borrar un logo en uso. No se ha añadido ningún logo (§8). [V]
4. **Datos incompletos visibles en el panel**: columna «Logo» y «Datos» (sin logo / sin cartas) en la tabla de equipos,
   y aviso de equipos con cartas pero sin región. [V]
5. **Pruebas nuevas**: fallo a mitad de la liquidación contra Postgres real, 0076 contra Postgres real, servicio y ruta
   del panel, resolutor de identidades, logos. [V]
6. **QA en el stack aislado** sobre `drl-0.1.1-1-078f28f9` y la candidata final `drl-0.1.1-1-ea82a9f8` (§12). [QA]

## 3. Reglas (las que mandan en el código)

1. **Colección de un equipo** = todas las cartas **publicadas** del catálogo del servidor (`content_cards`) que llevan
   ese equipo **impreso**. Cada edición de cada jugador es un requisito; las copias no sustituyen a otra carta. Una carta
   retirada ya no se exige; un borrador no existe.
2. **Qué equipo tiene una carta**, en este orden: la etiqueta impresa exacta (`PRINTED_TEAM_IDENTITY`, 41 etiquetas) →
   los alias del registro de código → si nada de eso la resuelve, la identidad dada de alta en el panel (0076) para ese
   texto impreso → si tampoco, el equipo queda **sin identidad**. El equipo impreso es histórico: un fichaje no mueve
   cartas de colección.
3. **Un equipo sin región no es una colección del jugador** (nuevo hoy). Antes se enseñaba sin región; ahora no se
   enseña ni liquida nada hasta tener identidad. Así no se pagan XP con una clave provisional ni cambia la meta de una
   región a escondidas.
4. **El registro de código manda**: una fila del panel nunca cambia un equipo que el código conoce ni puede tomar una de
   sus claves; una fila con clave mal formada o región inválida se ignora (y el equipo sigue en el aviso).
5. **La clave de un equipo es inmutable** una vez creada: es la de su primera compleción guardada (0075). Cambiarla
   permitiría cobrar dos veces.
6. **Primera compleción** = la primera vez que el servidor ve el equipo completo (al entrar en Colecciones). 300 XP de
   temporada, una vez por cuenta y equipo, para siempre. Sin temporada activa se guarda la compleción y los XP quedan
   pendientes; se cobran una vez cuando haya temporada.
7. **Insignia regional** = todas las cartas de todos los equipos de la región, a la vez. Una vez guardada es permanente
   (no se pierde al desguazar ni cuando la región crece). Una región sin equipos no se concede.
8. **Equipo nuevo en una región**: quien ya tenía la insignia la conserva; quien no, necesita también el equipo nuevo.

## 4. Archivos

Hoy (`ebf16e9..HEAD`, 5 commits):

| Tipo | Archivos |
|---|---|
| Migración | `supabase/migrations/0076_team_identities_admin.sql`, `docs/operations/rollback/0076_team_identities_admin.ROLLBACK.sql` |
| Dominio | `src/domain/teamCollections/model.ts` (resolutor `teamResolver`, equipos sin región fuera de `teams`), `src/data/teamIdentities.ts` (`TEAM_CANONICAL_IDS`) |
| Servidor | `src/server/services/teamCollections.ts` (identidades del panel y logos del CMS en el modelo), `src/server/cms/teams.ts` (nuevo), `src/server/cms/handlers.ts`, `src/server/cms/assets.ts` (derivado de 256 px y logo en uso), `src/server/admin/overview.ts`, `src/app/api/admin/cms/teams/route.ts` (nuevo) |
| Panel | `src/components/admin/cms/TeamIdentitiesPanel.tsx` (nuevo), `src/app/admin/teams/page.tsx`, `src/app/admin/teams/[id]/page.tsx` |
| Idiomas | `src/i18n/messages/*/admin.json` (35 textos × 7 idiomas), `scripts/_team-collections-i18n.mjs` |
| Pruebas | `src/server/cms/teams.test.ts` (nuevo), `src/domain/teamCollections/teamCollections.test.tsx`, 11 pruebas que fijan la cabeza de migraciones (0075 → 0076) |
| Puerta y QA | `scripts/ops/release-test-fixtures.mjs`, `scripts/ops/_team-collections-rc-stage.sh`, `scripts/ops/i18n-qa-stack/team-collections-0076.sh` + `.sqltest.sql`, `team-collections-0075.sh` (`txfail`) + `.txfail.sql`, `team-collections.sh` (`catalog`, `identities`), `chain12.sh` (de la sesión anterior, sin versionar), `chain13.sh`, `scripts/_team-identities-ui.ts`, `scripts/_qa-catalog-materialize.ts` |

De la sesión anterior (ya en la rama): 0075 y su rollback, `teamCollections` (modelo, servicio, ruta con `settle`),
pantallas de Colecciones y detalle, `RegionBadge`/`RegionEmblem`, perfil con insignias destacadas, retirada de
`PrestigePanel.tsx` y `lib/game/prestige.ts`, `teamCollectionsRewards.service.test.tsx`.

## 5. Migraciones

| | 0075 `team_collections` | 0076 `team_identities_admin` |
|---|---|---|
| Tablas | `user_team_completions` (PK usuario+equipo), `user_region_badges` (PK usuario+región) | `content_team_identities` (PK texto impreso; `team_id` único) |
| Función | `app_team_collections_settle(uuid, jsonb, jsonb, text, int)` | `app_team_identity_save(uuid, text, text, text, text, text, int)` |
| Seguridad | RLS sin políticas; `revoke` a anon/authenticated; SECURITY DEFINER, `search_path` fijo, EXECUTE solo service_role | igual; además comprueba `profiles.is_admin` y audita con `app_admin_audit` (0055) en la misma transacción |
| Concurrencia | `pg_advisory_xact_lock` por cuenta + PK + clave única del libro de XP (0064) | cerrojo por texto impreso + `FOR UPDATE` + revisión optimista + `team_id` único |
| Índices | usa `user_cards(user_id, card_id)` (0011) | PK y único de `team_id` |
| Datos al aplicar | ninguno (sin backfill) | ninguno |
| Toca | solo lee `user_cards`; escribe sus tablas, `season_*` vía `app_season_apply` y `user_cosmetics` (insignia) | solo su tabla y la auditoría |
| Rollback | archiva en `ops_rollback_0075_*`, no retira XP ni cosméticos | archiva en `ops_rollback_0076_*`; los equipos del panel vuelven a quedar bloqueados; sus compleciones siguen |
| Compatibilidad | código nuevo sin 0075: todo lo derivado funciona, `settle` 503 | código nuevo sin 0076: el panel avisa «Falta la migración 0076» y no deja guardar; nada más cambia |

`MIGRATION_HEAD` de `/api/ready` sigue en 0073 a propósito: 0075 y 0076 son opcionales para que el código arranque.

## 6. Recompensa de 300 XP

- La pantalla lee (`GET`, sin escrituras) y, si el servidor dice `pending`, pide `POST {action:"settle"}`. El cuerpo es
  cerrado: cualquier campo además de `action` → 400. El usuario sale del Bearer.
- El servidor calcula el plan (equipos completos sin compleción guardada, o con XP pendientes si hay temporada) y llama
  a `app_team_collections_settle`, que **vuelve a comprobar las cartas en la misma transacción**, inserta la compleción
  y concede con `app_season_apply` (clave `team-collection:<equipo>`, fuente `COLLECTION`).
- Una sola vez por cuenta y equipo, aunque cambie la temporada (lo decide la fila de 0075, no el libro de la temporada).
- Desguazar después no quita nada; volver a completar no paga de nuevo.
- No hay XP retroactivo masivo: no hay backfill. En producción (lectura de hoy) ninguna de las 2 cuentas tiene un equipo
  completo con la regla nueva (30 y 26 en progreso), no hay compleciones del sistema F82 ni XP de fuente COLLECTION.
  No hay nada que reconciliar y no se ha preparado ningún ajuste.

## 7. Insignias regionales

- Se guardan en `user_region_badges` y se conceden como cosmético `insignia:regional:<región>` en `user_cosmetics`, que
  es lo que ya usa el perfil para «insignias destacadas» (0062). No hay un segundo sistema de insignias.
- Destacar: el servidor solo acepta insignias que la cuenta posee (cosmético propio); una bloqueada o ajena → 4xx.
- Permanentes: ni desguazar ni crecer la región las retira. Un rollback de 0075 tampoco retira el cosmético.

Datos recalculados hoy desde el catálogo (idénticos a los del día 13):

| Región | Equipos | Cartas |
|---|---|---|
| Americas | 12 | 99 |
| EMEA | 12 | 101 |
| Pacific | 12 | 97 |
| China | 5 | 34 |
| **Total** | **41** | **331** (0 sin equipo, 0 sin región, 0 imposibles de conseguir) |

Equipos del registro sin cartas (no se enseñan): GEN, BLG, TE, JDG, G2 Gozen, KRX. Producción: 331 cartas publicadas,
0 creadas desde el panel, ningún equipo impreso desconocido.

## 8. Panel de administración y logos

- `/admin/teams`: «Equipos nuevos del catálogo» lista los textos impresos sin identidad con un formulario (clave sugerida,
  nombre, etiqueta, región obligatoria) y los ya dados de alta (clave bloqueada, revisión, subida de logo). Tabla con
  logo y datos incompletos. `/admin/teams/<id>`: subida del logo oficial.
- Validación en servidor y en base: clave `[a-z0-9-]` de 2–32 sin parecerse a `raw…` ni a `team-x-v1`, no reservada por el
  código; nombre 2–48; etiqueta 1–6; región de las cuatro; texto impreso existente; revisión.
- **Logos: siguen faltando los 16** (All Gamers, DetonatioN FocusMe, DRX, EDward Gaming, FULL SENSE, GE, Gen.G, NS,
  Paper Rex, Rex Regum Qeon, T1, Team Secret, TYL, VL, XLG, ZETA DIVISION). Ni el repositorio ni la biblioteca local los
  tienen y no se descargan marcas de internet sin licencia. Se pintan con su etiqueta y el acento de su región. Desde hoy
  un admin puede subir el oficial desde la ficha del equipo sin desplegar. [B: falta el fichero oficial]

## 9. Los 8 fallos de la puerta

Causa exacta: las releases excluyen `docs/` y `personajes/` por política (`OUT_OF_RELEASE` de `_i18n-rc-overlay.mjs`) y
ocho pruebas leen ficheros de ahí. No afecta al producto: afecta a la puerta, que ejecuta `npm test` sobre la fuente de
la release.

| Prueba | Lee |
|---|---|
| `goldPool.test.ts` (fichero entero) | `docs/product/qa/fase58-1-gold-pool/pool-snapshot-after.json` |
| `tierIdentity.special.test.ts` (fichero entero) | `docs/product/qa/pack31/prod-distribution-snapshot.json` |
| F89-S2 | `docs/operations/rollback/0063_profile_favorite_team.ROLLBACK.sql` |
| F69 · 0058 v3 y PRE-F70 · 0058 | `docs/operations/proposals/0058_hardening_grants.*.sql` |
| agentArt C, D, G | `personajes/cara`, `personajes/entero` (en `.gitignore` a propósito desde F59) |

Arreglo: `scripts/ops/release-test-fixtures.mjs` saca la lista de las propias pruebas (más `docs/operations/` y
`personajes/`) y la puerta la extrae **después** del build y del typecheck. La release no cambia y ninguna prueba se
excluye. Reproducido en local sobre un árbol con forma de release: 8 fallos sin los datos, 54/54 con ellos.
Pendiente de higiene, fuera de esta tarea: las tres de `agentArt` dependen de una carpeta que no está en git, así que
fallan en cualquier clon limpio.

## 10. Idiomas

35 textos nuevos del panel en los 7 idiomas (245 entradas), 21 podadas (los textos sustituidos). Auditor: 13.825/13.825
por idioma, 0 ausentes, 0 vacíos, 0 variables, 0 plurales, 0 huérfanas: «sin problemas». Nombres de equipo y de
región sin traducir. [V]

## 11. Pruebas

| Suite | Resultado |
|---|---|
| Pruebas del proyecto en el PC (incluye el trabajo F78 sin confirmar de la copia) | **6.588/6.588** |
| Puerta de la candidata (contenedor, fuente de la release: `npm ci` + `next build` + `tsc` + pruebas) | **6.578/6.578, 0 fallos · GATE_OK** · antes: 6.527/6.535 |
| 0075 contra Postgres real (QA) | 44/44: permisos, incompleto, sin temporada, 300 XP una vez, 24 y 16 sesiones a la vez, insignias, permanencia, entradas inválidas, aislamiento |
| 0075 fallo a mitad (QA, nuevo) | sin compleción, evento, asiento ni progreso; el reintento cobra 300 una vez y el siguiente 0 |
| 0076 contra Postgres real (QA, nuevo) | aplicada en 197 ms sin cambiar filas ni funciones; 6 grupos de comprobaciones; base idéntica tras el ROLLBACK |

Pruebas nuevas o reescritas hoy: `teams.test.ts` (8: validación, alta+auditoría+Colecciones, conflicto/clave
inmutable/corrección, textos inexistentes y sin 0076, ruta con anónimo/usuario/campos de más, región que crece con
insignia permanente, logos, migración) y en `teamCollections.test.tsx` (equipo sin región bloqueado, equipo con
identidad del panel, el registro de código manda y filas inválidas ignoradas; servidor con `content_team_identities`).

Cobertura de la lista del encargo: colección incompleta/completa, normal sin especial y especial sin normal, duplicados,
varios jugadores, equipo sin cartas, equipo nuevo con cartas, equipo nuevo sin región, catálogo que cambia, sin sesión,
datos ajenos, inventarios grandes · XP: 300 al completar, repetición, concurrencia, fallo a mitad, sin completar,
manipular equipo/usuario/XP en la petición, persistente tras desguazar, sin doble abono · insignias: incompleta,
completa, región inválida, repetición, concurrencia, permanencia, equipo nuevo en la región, destacar una bloqueada ·
perfil: destacar desbloqueada, bloqueada, ajena, insignias antiguas conservadas · seguridad: RLS, permisos, aislamiento,
índices, rollback.

## 12. QA en el stack aislado

**Candidata final: `drl-0.1.1-1-ea82a9f8`** (sha256 `861f2554…73e97`, en `valorosters-i18n-qa/rc/`, NO en `incoming/`) =
fuente de producción `4b1f4c01` + 145 ficheros de la rama − 2 borrados; frontera exacta, F78 idéntico a producción, dos
migraciones aditivas con rollback, economía intacta. La regresión larga se hizo sobre `drl-0.1.1-1-078f28f9`; entre las
dos solo cambian **dos ficheros** (comprobado por huellas): `TeamIdentitiesPanel.tsx` (alineación del formulario) y
`teamCollections.test.tsx` (una prueba nueva). Sobre `ea82a9f8` se repitieron la puerta, Colecciones (es) y el alta
desde el panel en 8 idiomas.

Servida como `vrqa_app` desde la build de la puerta. Cuentas sintéticas (`coll-tc*`, `coll-50000/60000`,
`qa-*-i18n@example.invalid`), solo en la base del stack aislado.

| Pasada | Resultado |
|---|---|
| Colecciones: API + navegador, 8 idiomas × 390/1440 px (`team-collections.sh ui`) | **896 PASS · 0 FAIL** [QA] |
| Permanencia (se borran de la base las cartas de China de `tcchina`) | **6 PASS · 0 FAIL**: insignia y destacada siguen [QA] |
| Visual de pantallas tocadas y vecinas, 8 idiomas × 390/768/1440 | **576 pantallas**: 0 en otro idioma, 0 desbordes, 0 cortados, 0 restos de español, 0 claves, 0 errores de consola, 0 de hidratación [QA] |
| Humo de invitado, 8 idiomas | **132 PASS · 0 FAIL** [QA] |
| QA autenticada de todo el juego, 8 idiomas (sobres, compra ICON, crafteo, WALKOUT, equipos, tienda, cuenta, idioma entre dispositivos…) | **1.293 PASS · 0 FAIL** tras arreglar el entorno (abajo); igual que la versión publicada [QA] |
| Colecciones (es) con el catálogo servido desde la base, como producción | **212 PASS · 0 FAIL** [QA] |
| Equipo nuevo desde el panel, API + panel en 8 idiomas + Colecciones (`_team-identities-ui.ts`) | **84 PASS · 0 FAIL** sobre `ea82a9f8` [QA] |
| Candidata final `ea82a9f8`: puerta | **6.579/6.579 · GATE_OK** |
| Candidata final `ea82a9f8`: Colecciones, 8 idiomas × 2 anchos + API | **896 PASS · 0 FAIL** [QA] |

Lo que comprueba la pasada de Colecciones (por cuenta: sin cartas, 5 cartas de G2 con copias, China completa, todo):
progreso = dominio en las 4 cuentas; G2 con una carta por jugador no está completo; varias ediciones y copias; primera
compleción +300 una vez; 12 peticiones simultáneas después → 0; 8 liquidaciones simultáneas de `tcchina` → 4.800 XP
exactos (16 equipos × 300); EMEA a falta de una carta bloqueada; China guardada una vez; una cuenta no ve compleciones de
otra; sin sesión/token falso → 401; parámetros, equipo repetido o inválido → 400/404; cuerpos manipulados (otro usuario,
equipo, XP, acción, lista, no JSON, enorme) → 400; PUT/PATCH/DELETE → 405; inventario intacto; destacar una insignia
bloqueada o ajena → 403 `LOCKED`; y en el navegador, en cada idioma y ancho: título, 3 → +6 → todos sin repetir, insignias
con su estado del servidor, sin bloque antiguo ni llamadas a Maestría/Prestigio/sets, detalle, enlace antiguo de set,
equipo inexistente, equipo sin logo, cuenta sin Prestigio, perfil propio y ajeno con la insignia destacada.

Rendimiento medido (API real del stack): 50.000 cartas → lectura 209–218 ms en caliente (443 ms en frío), 11,95 KB,
liquidación 308 ms · 60.000 cartas → 194–239 ms (400 ms en frío), 11,95 KB, liquidación 362 ms.

**Primera QA autenticada: 64 fallos, todos del entorno, no del producto.** La cuenta sintética `qa-player-i18n` estaba sin
saldo (1.000 créditos; el último gasto, de pasadas anteriores, es del 13/10 a las 22:23) y todas las comprobaciones de
compra, apertura, crafteo y WALKOUT (que necesitan comprar un sobre de 2.500) fallaron en cadena; y la temporada
sintética que crean los instrumentos de 0075 se llamaba «Temporada de QA», que el detector marcaba como «resto de
español» en /temporada/pase. Arreglo, solo en el stack de QA: saldo sintético repuesto (misma convención que
`collection-scale.sh`) y la temporada sintética renombrada a «QA-TC» (también en el script). Repetida entera: 1.293 · 0.

**Alta de un equipo nuevo, de punta a punta** (catálogo de QA llevado a la base con `catalog up` y retirado con
`catalog down`; datos sintéticos: dos jugadores y dos cartas «QA Nuevo Equipo» en el inventario de `tcall`): sin identidad
no es colección, ni su clave en bruto tiene detalle, ni paga XP; el panel lo lista como pendiente; la ruta del panel
rechaza anónimo y jugador (401), región inválida o vacía, clave del código, mal formada o de set antiguo, etiqueta larga
(400), texto impreso inexistente o de un equipo del código (404) y campos de más (400); alta → 200 rev 1; repetir → 409;
cambiar la clave → 409; con identidad aparece con clave, nombre, etiqueta y región y sin logo inventado; 6 liquidaciones a
la vez → 300 XP una sola vez; Pacific sube un equipo y dos cartas en la meta y la insignia ya conseguida sigue; otra cuenta
lo ve bloqueado 0/2; corrección → rev 2; el panel en 8 idiomas (1440) y en 390, la ficha con la subida de logo, el detalle
del equipo nuevo y la búsqueda. Al terminar se borró solo lo sintético y la base de QA volvió a 0 cartas, 0 jugadores y
0 identidades en `content_*`.

Tropiezos de la QA, todos del entorno o de los instrumentos (corregidos y repetidos): los datos sintéticos del equipo
nuevo no cumplían `content_cards_identity` ni tenían la presentación de una carta del CMS (la base y el cargador del
catálogo los rechazaron: mientras duró, la QA dio 500 en ese stack); el `down` chocaba con la inmutabilidad de versiones;
la cuenta de admin estaba guardada en japonés y el instrumento cambiaba el idioma de cuenta de `tcall` (la preferencia de
cuenta manda sobre el navegador, como debe): ahora se fija y se deja sin preferencia al terminar.

Capturas: `docs/product/qa/colecciones-cierre/` (01–21 Colecciones, perfil y permanencia; 30–39 alta de equipo nuevo;
`ui-*.json` con todos los resultados).

## 13. Resultados finales en el PC

| Qué | Resultado |
|---|---|
| `npm test` | **6.588/6.588** (al empezar: 6.577) |
| `npm run typecheck` | 0 errores |
| `npm run lint` | 0 errores · 30 avisos (los mismos de antes) |
| `npm run i18n:audit` | sin problemas: 13.825/13.825 por idioma |
| Árbol con forma de release, las 8 pruebas que fallaban | 8 fallos sin los datos de prueba · 54/54 con ellos |

## 14. Riesgos y problemas conocidos

1. **Liquidación perezosa**: la compleción, los XP y la insignia se guardan al entrar en Colecciones, no al abrir el
   sobre que completa el equipo. Es idempotente y no se pierde nada, pero un jugador que nunca entra no los cobra.
2. **Sin temporada activa** (producción hoy: solo `temporada-2` en DRAFT, empieza 2026-11-30): los XP quedan pendientes
   hasta que haya temporada.
3. **Logos de terceros**: la subida está, los ficheros oficiales no (§8). Los derechos de marca para release pública
   siguen sin resolver (ya lo estaban para los 25 logos de pistas).
4. **Storage fuera de la copia diaria** (F60): un logo subido al CMS no entra en la copia de la base.
5. **Una identidad del panel por texto impreso**: si se publican cartas del mismo equipo con dos textos distintos, son
   dos equipos hasta que se unifique el texto de las cartas.
6. **Si un equipo del panel se pasa después al registro de código**, debe usar la misma clave (`canonicalId` = `team_id`);
   si no, su primera compleción quedaría con otra clave.
7. `/admin/collection-sets` (sets de F82) sigue existiendo y ya no decide lo que ve el jugador; no se ha retirado.
8. Las tres pruebas de `agentArt` dependen de `personajes/`, ignorada en git (§9).

## 15. Despliegue propuesto (requiere autorización; no hecho)

1. Comprobar que `current` sigue en `drl-0.1.1-1-4b1f4c01`.
2. Copia de seguridad de la base de producción (`backup-drlcards.sh`) y comprobación de lectura.
3. Aplicar **0075** y después **0076**, cada una en una transacción (`psql -1`), como se ensayó en QA
   (`team-collections-0075.sh apply` / `team-collections-0076.sh apply`: huella de datos antes/después).
4. Copiar `valorosters-i18n-qa/rc/drl-0.1.1-1-ea82a9f8.tar` (+ `.sha256`) a `incoming/` y `bin/deploy.sh drl-0.1.1-1-ea82a9f8`.
5. Humo: `/api/ready` 200, Colecciones con una cuenta, `/admin/teams` con «Todos los equipos impresos del catálogo
   tienen identidad».

## 16. Rollback

- Código: `bin/deploy.sh --activate drl-0.1.1-1-4b1f4c01` (compatible con 0075/0076 puestas: no las usa).
- Datos (solo si hiciera falta): `0076…ROLLBACK.sql` y después `0075…ROLLBACK.sql`. Archivan las tablas en
  `ops_rollback_007x_*`, no retiran XP ni insignias concedidas y se niegan a repetirse. Para volver a aplicar, restaurar
  primero desde el archivo (ensayado: `restore`).

## 17. Pasos manuales pendientes

1. Autorizar y ejecutar el despliegue (§15).
2. Conseguir los logos oficiales de los 16 equipos y subirlos desde `/admin/teams/<equipo>`.
3. Decidir si `/admin/collection-sets` se retira.
4. Bajar el stack de QA cuando se dé por cerrada la candidata.

## 18. Confirmación

No se ha hecho push, no se ha desplegado, no se ha aplicado ninguna migración en producción ni se ha escrito en su
base: en producción solo se han ejecutado lecturas en transacciones `READ ONLY` terminadas en `ROLLBACK`. Todo lo
escrito en bases ha sido en el stack de QA aislado, con cuentas sintéticas.
