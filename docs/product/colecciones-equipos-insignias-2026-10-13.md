# Cambio 1 · Colecciones por equipo e insignias regionales (2026-10-13)

**Estado: implementado en local, probado y con candidata preparada. Sin push, sin desplegar, sin tocar producción ni su base.**

- Rama: `feat/team-collections` (sale de `feat/collection-pagination`, que es la versión publicada `drl-0.1.1-1-4b1f4c01`).
- Candidata: `drl-0.1.1-1-5dc9da1e` — fuente de producción + los 73 ficheros de `src/` de esta rama. Sin migraciones.
  `valorosters-i18n-qa/rc/drl-0.1.1-1-5dc9da1e.tar`, sha256 `e3f0e7fa7c43499fbb9c597a5904a226beca6714f30f09abfd36ace2c31f35dd`.
  No está en `incoming/`: no se puede desplegar por accidente.

## 1. Qué cambia para el jugador

Colección → Colecciones (`/coleccion/trofeos`):

| Antes | Ahora |
|---|---|
| 6 colecciones publicadas a mano, con requisitos congelados: «una carta cualquiera de cada jugador» (cinco cartas) | Una colección por cada equipo con cartas en el catálogo: hoy **41 equipos y 331 cartas** |
| Completar = una carta por jugador | Completar = **todas** las cartas del equipo. Cada edición de cada jugador es un requisito; las copias repetidas no sustituyen a otra edición |
| Progreso sobre un número fijo (5/5) | Progreso `tienes/total` calculado del catálogo y de tu inventario (G2: `5/20`) |
| Todas las tarjetas de golpe | 3 equipos al entrar; **«Ver más equipos»** añade 6 cada vez; al salir el último, el botón desaparece |
| Bloque «Insignias» (las de cada set, destacar en el perfil), «Completadas recientemente», Maestría y Prestigio | Retirados de la pantalla. En su lugar, **cuatro insignias regionales**: Americas, EMEA, Pacific y China |
| Botón «Reclamar insignia» | No hay nada que reclamar: el estado es el de tu inventario |

Detalle de un equipo (`/coleccion/trofeos/<equipo>`): todas sus cartas, las que te faltan delante, las tuyas marcadas y
con sus copias anotadas («×4 copias»), y en qué sobres puede salir cada una que falta. Los enlaces antiguos a un set
(`…/team-g2-v1`) llevan al mismo equipo.

Se conserva el diseño: mismas tarjetas, mismo escudo con el logo del equipo, misma barra de progreso, búsqueda, filtro
por estado y orden. Los equipos sin logo en el producto (16) se pintan con su etiqueta dentro del escudo, nunca con un
logo inventado.

## 2. Reglas

1. **Colección de un equipo** = todas las cartas **publicadas** que llevan ese equipo impreso (`canonicalCardTeam`, la
   misma regla que agrupa Team Packs, maestría y logros). Una carta retirada ya no se puede conseguir y no se exige.
   Un borrador no existe.
2. **Sin listas ni cantidades fijas.** Equipos, cartas y totales salen del catálogo publicado del servidor
   (`content_cards`, lo que administra el panel) en cada lectura. Una carta nueva mueve la meta; un equipo nuevo aparece
   solo.
3. **Insignia regional** = todas las cartas de todos los equipos de la región, equipo a equipo. Falta una carta →
   bloqueada.
4. **Región de un equipo** = la de su identidad en el registro de equipos (el que enseña `/admin/teams`). Un equipo sin
   identidad no tiene región: se enseña en Colecciones, no cuenta para ninguna insignia y se avisa en `/admin/teams`
   («Equipos con cartas pero sin región»). No se le adjudica ninguna por parecido.
5. **Sin insignias vacías.** Una región sin equipos o sin cartas no se desbloquea nunca y la pantalla lo dice.
6. **Todo es estado derivado.** No se escribe nada: ni compleciones, ni insignias, ni créditos. No hay migración.

## 3. Datos medidos (catálogo actual)

| Región | Equipos | Cartas |
|---|---|---|
| Americas | 12 | 99 |
| EMEA | 12 | 101 |
| Pacific | 12 | 97 |
| China | 5 | 34 |
| **Total** | **41** | **331** |

- Las cuatro regiones cubren el catálogo entero sin solaparse. Ninguna carta sin equipo, ningún equipo sin región.
- Tamaño de las colecciones: de 2 cartas (ENVY) a 20 (G2). 25 equipos tienen algún jugador con varias ediciones.
- Las 331 cartas pueden salir hoy de algún sobre: ninguna colección es imposible.
- 6 equipos del registro no tienen cartas y no aparecen: GEN, BLG, TE, JDG, G2 Gozen, KRX.
- 16 equipos no tienen logo en el producto: All Gamers, DetonatioN FocusMe, DRX, EDward Gaming, FULL SENSE, GE, Gen.G,
  NS, Paper Rex, Rex Regum Qeon, T1, Team Secret, TYL, VL, XLG, ZETA DIVISION.
- Producción (lectura, 2026-10-13): 331 cartas publicadas, ninguna creada desde el panel; 0 colecciones reclamadas con
  el sistema anterior, así que nadie pierde una insignia ya conseguida.

Repetible: `npx tsx scripts/_team-collections-audit.ts`.

## 4. Cómo está hecho

- **Dominio puro** `src/domain/teamCollections/model.ts`: equipos desde el catálogo, progreso, insignias regionales,
  orden y cuántos equipos se ven tras N pulsaciones. Lo usan el servidor, la pantalla y el arnés con los mismos números.
- **Servidor** `src/server/services/teamCollections.ts` + `GET /api/game/team-collections` (y `?team=<id>` para el
  detalle). Solo lectura, con sesión, límite de peticiones `collection_read`.
- **Carga eficiente.** El progreso se calcula con el resumen por carta de `4b1f4c01` (`loadCollectionSummary`, migración
  0074): una consulta acotada por el catálogo, no por la colección. La pantalla hace **una** petición de ~9,7 KB con las
  41 tarjetas ligeras (sin listas de cartas); «Ver más equipos» no pide nada más y los logos solo se cargan al
  mostrarse. No se lee `/api/game/cards` ni se recorre el inventario. Con 50.000 y 60.000 cartas: ~240 ms, mismo tamaño.
- **Pantallas** `src/components/trophies/`: `TrophyRoomScreen` (rejilla progresiva + insignias), `RegionBadge` (escudo
  de la casa con una silueta geométrica propia de cada región; no es la marca de ninguna liga), `TeamDetailScreen`.
- **Administración** `/admin/teams`: panel nuevo «Colecciones de equipo» con equipos, cartas y regiones del catálogo, y
  avisos de equipos sin región, cartas sin equipo, regiones vacías, equipos sin cartas y equipos sin logo.
- **Idiomas**: 31 textos nuevos en los 8 idiomas; auditor sin ausentes ni huérfanos (13.780 × 7).

Lo que **no** se toca: créditos, sobres, probabilidades, economía ICON, cartas de los jugadores, duelos, torneos,
migraciones, y las tablas y rutas del sistema anterior (`collection_sets`, `user_collection_completions`,
`user_cosmetics`, `/api/game/collection-sets`, `/api/game/mastery`, `/api/game/prestige`), que siguen como estaban.

## 5. Archivos

Nuevos:
`src/domain/teamCollections/model.ts` · `src/domain/teamCollections/teamCollections.test.tsx` ·
`src/server/services/teamCollections.ts` · `src/app/api/game/team-collections/route.ts` ·
`src/lib/teamCollections/client.ts` · `src/components/trophies/RegionBadge.tsx` ·
`src/components/trophies/TeamDetailScreen.tsx` · `src/components/trophies/teamCollectionsModel.ts` ·
`src/app/design-system/colecciones-equipos/page.tsx` (arnés de QA, 404 en producción).

Modificados:
`src/components/trophies/TrophyRoomScreen.tsx` · `src/components/trophies/TrophyBadge.tsx` (etiqueta para equipos sin
logo) · `src/app/coleccion/trofeos/page.tsx` · `src/app/coleccion/trofeos/[setId]/page.tsx` ·
`src/app/admin/teams/page.tsx` · `src/server/admin/overview.ts` · `src/app/design-system/fase82/page.tsx` ·
`src/components/collectionRoom/collectionScreen.test.tsx` · 56 catálogos de `src/i18n/messages/`.

Instrumentos (fuera de la release): `scripts/_team-collections-audit.ts`, `_team-collections-i18n.mjs`,
`_team-collections-qa-prep.ts`, `_team-collections-ui.ts`, `scripts/ops/_team-collections-rc-stage.sh`,
`scripts/ops/i18n-qa-stack/team-collections.sh`, `chain11.sh`.

Conservados sin montar (código del bloque antiguo; sus traducciones se podaron porque el auditor lo exige):
`SetDetailScreen.tsx`, `CompletionMoment.tsx`, `trophyModel.ts`, `MasteryPanel.tsx`, `PrestigePanel.tsx`.

## 6. Pruebas

Los doce casos del encargo:

| # | Caso | Prueba unitaria / de pantalla | Stack de QA (servidor y navegador reales) |
|---|---|---|---|
| 1 | Equipo con cinco cartas no se completa | G2 con una carta por jugador: `5/20`, en progreso | cuenta `tcfive`: `5/20` en API y en pantalla |
| 2 | Varias ediciones cuentan por separado | falta una edición de un jugador → falta 1 | detalle de G2: 20 cartas de 5 jugadores, varias ediciones de cada uno |
| 3 | Duplicadas no completan ediciones | 40 copias de 5 cartas → 5 | 4 copias de cada una → 5, «×4 copias» |
| 4 | Equipo añadido desde administración | catálogo servido desde `content_cards` con una carta del panel de un equipo nuevo: aparece; borrador no; retirada no se exige | panel `/admin/teams` con el resumen |
| 5 | Carga inicial: tres equipos | 3 tarjetas y recuento «3 de 41» | 3 tarjetas, en 8 idiomas × 2 anchos |
| 6 | «Ver más» añade seis | 3, 9, 15, … | pasos 3·9·15·21·27·33·39·41 |
| 7 | Acaban saliendo todas | hasta el total; sin botón con ≤ 3 | 41 tarjetas, sin repetir, botón fuera |
| 8 | Insignia incompleta: bloqueada | falta una carta → bloqueada | `tcchina`: EMEA `100/101`, bloqueada |
| 9 | Insignia completa: desbloqueada | China completa → solo China | `tcchina`: China `34/34`, desbloqueada |
| 10 | Los cuatro grupos | cada región con sus equipos; las cuatro = catálogo | `tcall`: 4 de 4, 41/41 equipos |
| 11 | El bloque antiguo desaparece | sin sus elementos ni importaciones | solo dos apartados; sin lecturas de Maestría, Prestigio ni sets |
| 12 | Ocho idiomas | auditor limpio | idioma, sin desbordes, sin textos cortados, sin claves, sin errores de consola |

Resultados:

| Qué | Resultado |
|---|---|
| Pruebas del proyecto (PC) | **6.555 / 6.555** (27 nuevas) |
| Tipos (`tsc`) · lint | 0 errores · 0 errores (30 avisos, los de antes) |
| Auditor de idiomas | sin problemas: 13.780 textos × 7 idiomas, 0 ausentes, 0 huérfanos |
| `economy:verify` | 60 ✓ · 0 ✗ |
| Candidata en contenedor aislado (npm ci + build + tsc + tests) | build correcto, 0 errores de tipos, 6.527 / 6.535: los mismos 8 fallos que la versión publicada (ficheros que la release no incluye) |
| Frontera de la candidata | 9 ficheros nuevos + 64 modificados = el overlay exacto; 0 borrados; sin migraciones; no toca economía, sobres ni lectura de inventario |
| API y navegador en el stack de QA, 8 idiomas, 390 y 1440 px | **601 PASS · 0 FAIL** (API 32, administración 1, navegador 568) |
| Seguridad de la ruta | sin sesión 401 · token falso 401 · parámetro desconocido 400 · equipo no válido 400 · inexistente 404 · POST/PUT/PATCH/DELETE 405 · una cuenta no ve el progreso de otra · el inventario no cambia |
| Rendimiento | respuesta de 9,7–9,9 KB; ~240 ms con 50.000 y 60.000 cartas |

Regresión general del juego sobre la candidata, en el stack de QA (`chain11.sh`, 19:03–20:39 UTC):

| Qué | Resultado | Con la versión publicada |
|---|---|---|
| QA autenticada, 8 idiomas (sobres, crafteo, equipos, tienda, cuenta, idioma entre dispositivos…) | **1.293 PASS · 0 FAIL** | 1.293 · 0 |
| Visual de las pantallas tocadas y vecinas, 8 idiomas, 390/768/1440 px | **552 pantallas**: 0 en otro idioma, 0 desbordes, 0 textos cortados, 0 restos de español, 0 claves, 0 errores de consola, 0 de hidratación | — |
| Humo de invitado, 8 idiomas | **132 PASS · 0 FAIL** | 132 · 0 |

Cuentas de la QA: sintéticas (`coll-tc*@example.invalid`) y solo en la base del stack aislado.

## 7. Capturas

`docs/product/qa/colecciones-equipos/` (28 ficheros; las 167 capturas completas quedan en
`logs/team-collections/final/ui/`).

| Fichero | Qué enseña |
|---|---|
| `01-es-1440-entrada-3-equipos.png` | Entrada: tres equipos y «Ver más equipos» |
| `02-es-1440-todos-los-equipos.png` | Tras pulsar hasta el final |
| `03` · `04` · `05` | Insignias: todas bloqueadas · China desbloqueada · las cuatro |
| `06-es-1440-cuenta-sin-cartas.png` | Cuenta sin cartas |
| `07-es-1440-detalle-g2-5-de-20.png` | Detalle: una carta por jugador ya no completa |
| `08-es-1440-detalle-equipo-sin-logo.png` | Equipo sin logo: su etiqueta en el escudo |
| `09` · `10` · `11` | Móvil (390 px) |
| `20-<idioma>-1440-entrada.png`, `21-<idioma>-390-insignias.png` | Los otros siete idiomas |
| `30-admin-equipos-resumen.png` | `/admin/teams` con el resumen de colecciones |

## 8. Decisiones pendientes

1. **Prestigio.** Era el único sitio donde se gastaban créditos en mejorar insignias de Maestría; su panel vivía en esta
   pantalla y ya no se pinta. La ruta y los datos siguen. No he comprobado si alguien lo ha comprado en producción (hoy hay 1 insignia
   concedida en total). ¿Se retira del todo o se recoloca?
2. **XP de temporada por colección.** La ruta de temporada da 300 XP al *reclamar* un set de F82. Sin botón de reclamo,
   esa fuente deja de dispararse. Dar XP por completar un equipo con la regla nueva exigiría guardar la compleción
   (migración). ¿Se quiere?
3. **Insignias permanentes o vivas.** Hoy una insignia regional refleja tu inventario: si desguazas una carta, se
   vuelve a bloquear. Hacerla permanente también exige guardarla (migración).
4. **Perfil.** El perfil y su editor siguen ofreciendo «insignias destacadas» del sistema anterior; las regionales, al
   ser derivadas, no se pueden destacar. ¿Se llevan al perfil, o se retira ese apartado?
5. **Colecciones de edición.** El sistema anterior tenía borradores de edición (Champions S, Future Star). Ahora solo
   hay equipos.
6. **`/admin/collection-sets`.** El panel de sets sigue existiendo pero ya no decide lo que ve el jugador. ¿Se retira?
7. **Alta de equipos.** El panel no escribe equipos: las identidades (nombre, etiqueta, región, logo) viven en código.
   Una carta publicada con una etiqueta nueva crea su colección sola, pero sin región ni logo hasta añadir la identidad.
8. **Logos.** 16 equipos sin logo (lista en §3).
9. **Nombre de la pantalla.** El menú dice «Colecciones» y el título, «Sala de Trofeos». No lo he cambiado.

## 9. Cómo reanudar

- Stack de QA: sirve `5dc9da1e` desde `/tmp/tc-rc/gate`. Volver a la publicada: `app-swap.sh /tmp/coll-rc3/gate`.
- QA de esta funcionalidad: `team-collections.sh seed | ui [idiomas] | cleanup` (en `/tmp/tc-rc`).
- Regresión: `chain11.sh` (registro en `out/driver.log`, termina en `FIN`). Registros de esta pasada en
  `logs/team-collections/regresion/`.
- Producción, comprobada al terminar: `current` = `drl-0.1.1-1-4b1f4c01`, `/api/ready` 200, nada nuevo en `incoming/`.
- La candidata intermedia `drl-0.1.1-1-e1fc1005` (anterior al ajuste de móvil) está obsoleta.
- Para desplegar haría falta autorización: tar a `incoming/` y `bin/deploy.sh drl-0.1.1-1-5dc9da1e`. Sin migración; el
  rollback sería `bin/deploy.sh --activate drl-0.1.1-1-4b1f4c01`, sin datos que deshacer.
