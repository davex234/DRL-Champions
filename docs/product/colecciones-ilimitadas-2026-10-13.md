# Colecciones ilimitadas y escalabilidad — candidata `drl-0.1.1-1-4b1f4c01`

Fecha: 2026-10-13. Rama local `feat/collection-pagination` (desde `77db065`, la release publicada `b48d76af`).
**Desplegado en producción el 2026-10-13 a las 16:38 UTC, con la migración 0074 aplicada (§13).** Sin push.

## 1. Causa exacta

PostgREST corta cada respuesta en `max_rows` (1.000; `supabase/config.toml`) y responde 200, sin avisar. El estado de
juego (`loadGameState`, `src/server/services/inventory.ts`) leía `user_cards` de una vez, sin rango, sin orden y sin
mirar el error. Con más de 1.000 cartas:

- La cuenta recibía 1.000 cartas **arbitrarias** (sin `order`, el subconjunto puede cambiar entre dos llamadas).
- Un fallo de lectura parecía un inventario vacío.
- No era solo la pantalla: cuatro decisiones económicas del servidor usaban lecturas con el mismo corte.

Medido en el stack de QA con la release publicada (`b48d76af`) y cuentas sintéticas:

| Cartas reales | Cartas en el estado | Repetidas que ve el desguace | Repetidas reales |
|---:|---:|---:|---:|
| 999 | 999 | 800 | 800 |
| 1.000 | 1.000 | 801 | 801 |
| 1.001 | **1.000** | **801** | 802 |
| 5.000 | **1.000** | **801** | 4.801 |
| 50.000 | **1.000** | **801** | 49.801 |

## 2. Consultas afectadas

| Lectura | Qué alimentaba | Efecto con más de 1.000 cartas |
|---|---|---|
| `inventory.ts` `loadGameState` | estado de juego y **apertura de sobres** | pantalla parcial; el antiduplicados y «es nueva» ignoraban cartas poseídas |
| `economy.ts` `previewSalvage` | vista previa y conjunto permitido del **desguace** | repetidas fuera de la ventana imposibles de desguazar; recuentos por carta falsos |
| `economy.ts` tasación del desguace | importe pagado | no miraba el error: una lectura fallida pagaba **0 créditos** por cartas borradas |
| `progression.ts` `loadFacts` | **misiones, logros** (pagan créditos), metas | «cartas» se quedaba en 1.000; logros de colección sin ver cartas; «cartas nuevas» podía contar de más |
| `starter.ts` `readStarterStatus` | elegibilidad del **Sobre Inicial gratis** | podía creer que no había plantilla posible |
| `mastery.ts` | maestría | paginaba sin orden estable (filas repetidas o saltadas) |
| `duels.ts` `loadOwned` | equipos, arranque de partida, constructor | leía toda la colección en cada validación, con techo silencioso de 50.000 |
| `collection.ts`, `playerIdentity.ts` | álbum, perfil | techo de 20.000 (una marca `truncated` que nadie leía) |
| `packs.ts` (reintento de apertura) | «es nueva» al repetir una apertura | más de 1.000 copias de las cartas del sobre cortaban la respuesta |
| `liveEvents.ts`, `market.ts` | «la tengo» en eventos, versión en listados | truncado por trozo; 600 UUID en una URL |
| `adminCards.ts`, `api/admin/cards`, `admin/users.ts` | fichas de administración | «a cuánta gente afecta» y cartas distintas, cortos |
| `pageAll` | lecturas de tablas completas | al llegar a su tope devolvía un parcial como si fuera completo |

Además, en el cliente: la colección entera se guardaba en memoria y en `localStorage` (≈9 MB con 50.000 cartas, por
encima de la cuota del navegador), se volvía a descargar tras cada acción y al volver a la pestaña, y el desguace
enviaba todas las repetidas en una operación que el servidor rechazaba a partir de 500.

## 3. Arquitectura

**Principio:** nadie decide ni enseña con una colección parcial, y nada crece con la colección si no hace falta.

### Servidor

- `src/server/db/keyset.ts` — lectura **por cursor** (`uid > último`, orden ascendente), sin tope de páginas. Si una
  página falla lanza `IncompleteReadError`. Adopta el tamaño de página real del servidor, así que una página corta
  nunca se confunde con la última.
- `src/server/services/userCards.ts` — único punto de lectura de `user_cards` por cuenta:
  - `loadCollectionSummary`: **una línea por carta** (copias, en venta, numeradas, primera obtención y el mejor
    ejemplar). Su tamaño lo acota el catálogo (331 cartas), no la colección.
  - `readUserCards`: todas las filas, por cursor, para quien necesita ejemplares concretos.
  - `readUserCardsByUid`: ejemplares por `uid`, troceados y siempre filtrados por usuario.
- Estado de juego, apertura de sobres, misiones y logros, Sobre Inicial, maestría, sets, perfil, eventos y equipos
  usan el resumen. Desguace, crafteo y forja siguen leyendo cada ejemplar (lo necesitan), ahora por cursor.
- Desguace: la vista previa lee todo o falla; responde por **tandas de 500** (`uids` es la siguiente tanda,
  `salvageable` el total). La operación recalcula solo sobre las copias de las cartas elegidas.
- `GET /api/game/cards` — copias **paginadas por cursor**: filtros en servidor (carta, en venta, numeradas), orden
  estable (por `uid`, o por serie dentro de una carta), 1 a 100 por página, `hasMore` y `nextCursor`.
- Forja y crafteo: la foto ya no lleva cada copia libre de cada carta, solo las que una receta puede consumir.

### Base de datos (migración 0074, opcional y aditiva)

- Índices `(user_id, uid)` y `(user_id, card_id, uid)`.
- `app_collection_summary(p_user)`: el resumen en una consulta, como `jsonb`. Solo `service_role`.

Sin la 0074 el servidor calcula lo mismo recorriendo por cursor. El orden entre desplegar el código y aplicar la
migración no importa; con colecciones pequeñas no se nota la diferencia.

### Cliente

- El estado trae **un ejemplar por carta** más `ownedCounts` y `ownedTotal`. Lo que se guarda en el navegador deja de
  crecer con la colección.
- Álbum, equipos de la colección, perfil, cuenta y apertura («ahora tienes N») cuentan con los recuentos del servidor.
- Ficha de carta y vitrina: copias **cargadas por páginas** de 48 con scroll infinito, indicador, error con reintento,
  una sola petición a la vez y descarte de respuestas viejas (`useCardInstances`, `LoadMore`).
- Inventario: una ficha por carta repetida y desguace **por tandas** con progreso.
- Los `uid` de los equipos del entrenador y de un sobre recién abierto se piden aparte.

## 4. Endpoints y componentes

| Tipo | Elemento | Cambio |
|---|---|---|
| Nuevo | `GET /api/game/cards` | copias paginadas (`card`, `sort`, `locked`, `numbered`, `limit`, `cursor`) o por `uids` (máx. 60) |
| Contrato | `GET /api/game/state` | `ownedCards` = un ejemplar por carta; nuevos `ownedCounts`, `ownedTotal`, `lockedCounts` |
| Contrato | `GET /api/game/collection` | `instances` acotado; nuevos `holdings` y `total`; desaparece `truncated` |
| Contrato | `POST /api/game/economy` `salvagePreview` | `uids` = tanda (≤ 500); nuevos `salvageable`, `batchTotal`, `protectedTotal` |
| Contrato | `GET /api/game/duels` | `collection` = un ejemplar por carta con `copies` |
| Contrato | `GET /api/game/crafting`, `GET /api/game/forge` | listas de copias recortadas a lo que la receta consume |
| Cliente | `useGameStore`, `lib/game/sync`, `lib/game/instances`, `lib/game/useCardInstances`, `ui/LoadMore` | recuentos, carga por páginas |
| Pantallas | ficha de carta, inventario, vitrina del perfil, mercado (formulario de venta), álbum, cuenta, apertura | adaptadas a recuentos y páginas |

Todos los consumidores de los contratos cambiados están actualizados. Límite de frecuencia nuevo: `cards_read`,
120 peticiones por minuto y cuenta.

## 5. Cambios de base de datos

`supabase/migrations/0074_collection_scale.sql` y su rollback `docs/operations/rollback/0074_collection_scale.ROLLBACK.sql`.
No cambia tablas, filas, políticas ni funciones existentes. **No aplicada en producción.** Aplicada, revertida y vuelta
a aplicar solo en la base del stack de QA. La función se comparó con una consulta de referencia independiente en las
nueve cuentas sintéticas: resultado idéntico.

## 6. Pruebas con colecciones sintéticas (stack de QA aislado)

Nueve cuentas `coll-<n>@example.invalid` con 0, 100, 999, 1.000, 1.001, 5.000, 10.000, 50.000 y 60.000 cartas (40 %
de las copias en una sola carta, para probar «las copias de una carta»). 126 comprobaciones por pasada.

| Colección | Estado y álbum | Recorrido completo por cursor | Desguazables | Abrir un sobre |
|---:|---|---|---:|---|
| 0 | vacío correcto | 1 página, sin siguiente | 0 | +5, total exacto |
| 100 | 100 | 100 leídas, 0 repetidas | 39 | correcto |
| 999 | 999 | 999 leídas | 800 | correcto |
| 1.000 | 1.000 | 1.000 leídas | 801 | correcto |
| 1.001 | **1.001** | **1.001 leídas, la última accesible** | **802** | correcto |
| 5.000 | 5.000 | 5.000 leídas en 50 páginas | 4.801 | correcto |
| 10.000 | 10.000 | 10.000 leídas en 100 páginas | 9.801 | correcto |
| 50.000 | 50.000 | 50.000 leídas en 500 páginas | 49.801 | correcto |
| 60.000 | 60.000 | 60.000 leídas en 600 páginas | 59.801 | correcto |

Resultado: **126 / 126 sin la 0074 y 126 / 126 con ella.** No hay límite artificial: 60.000 se comporta como 50.000.

## 7. Rendimiento medido

VPS de 16 núcleos, app de QA con 2 GB y 4 CPU, PostgREST con `max_rows = 1000`. Cada celda es la mediana de la
latencia medida desde dentro de la red de QA y el número de sentencias SQL sobre la colección.

**Con la 0074** (candidata `4b1f4c01`):

| Petición | 0 | 1000 | 1001 | 5000 | 10.000 | 50.000 | 60.000 | Respuesta a 50.000 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GET /api/game/state | 191 ms · 2 | 195 ms · 2 | 195 ms · 2 | 193 ms · 2 | 187 ms · 2 | 241 ms · 2 | 241 ms · 2 | 41 KB |
| GET /api/game/collection | 217 ms · 2 | 212 ms · 2 | 224 ms · 2 | 219 ms · 2 | 211 ms · 2 | 268 ms · 2 | 267 ms · 2 | 31 KB |
| GET /api/game/cards (1.ª página, 100) | 192 ms · 1 | 195 ms · 1 | 200 ms · 1 | 175 ms · 1 | 185 ms · 1 | 177 ms · 1 | 180 ms · 1 | 16 KB |
| GET /api/game/cards?card= (copias de una carta, por serie) | 210 ms · 2 | 210 ms · 2 | 175 ms · 2 | 193 ms · 2 | 233 ms · 2 | 233 ms · 2 | 215 ms · 2 | 8 KB |
| GET /api/game/cards (carta + libres + numeradas) | 182 ms · 1 | 180 ms · 1 | 184 ms · 1 | 189 ms · 1 | 188 ms · 1 | 220 ms · 1 | 187 ms · 1 | 8 KB |
| POST economy salvagePreview | 214 ms · 2 | 251 ms · 3 | 253 ms · 3 | 337 ms · 7 | 444 ms · 12 | 1441 ms · 52 | 1555 ms · 62 | 36 KB |
| GET /api/game/duels (equipos y constructor) | 209 ms · 3 | 200 ms · 3 | 218 ms · 3 | 257 ms · 3 | 241 ms · 3 | 302 ms · 3 | 269 ms · 3 | 70 KB |
| GET /api/game/meta (misiones y logros) | 364 ms · 8 | 385 ms · 8 | 358 ms · 8 | 348 ms · 8 | 399 ms · 8 | 472 ms · 8 | 452 ms · 8 | 14 KB |
| GET /api/game/crafting | 188 ms · 2 | 276 ms · 3 | 235 ms · 3 | 293 ms · 7 | 449 ms · 12 | 1094 ms · 52 | 1336 ms · 62 | 80 KB |
| GET /api/game/forge | 242 ms · 2 | 229 ms · 3 | 243 ms · 3 | 331 ms · 7 | 363 ms · 12 | 1174 ms · 52 | 1458 ms · 62 | 131 KB |
| GET /api/game/collection-sets | 231 ms · 1 | 209 ms · 1 | 194 ms · 1 | 221 ms · 1 | 210 ms · 1 | 227 ms · 1 | 232 ms · 1 | 283 B |
| POST packs buy_and_open (sobre Estándar) | 443 ms · 3 | 356 ms · 3 | 319 ms · 3 | 313 ms · 3 | 359 ms · 3 | 367 ms · 3 | 431 ms · 3 | 879 B |

**Sin la 0074** (mismo código de servidor; medido sobre la primera candidata):

| Petición | 0 | 1000 | 1001 | 5000 | 10.000 | 50.000 | 60.000 | Respuesta a 50.000 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GET /api/game/state | 194 ms · 2 | 178 ms · 2 | 191 ms · 3 | 258 ms · 7 | 449 ms · 12 | 1183 ms · 52 | 1368 ms · 62 | 40 KB |
| GET /api/game/collection | 209 ms · 2 | 182 ms · 2 | 252 ms · 3 | 275 ms · 7 | 478 ms · 12 | 1175 ms · 52 | 1390 ms · 62 | 31 KB |
| GET /api/game/cards (1.ª página, 100) | 180 ms · 1 | 197 ms · 1 | 201 ms · 1 | 187 ms · 1 | 163 ms · 1 | 168 ms · 1 | 150 ms · 1 | 16 KB |
| POST economy salvagePreview | 209 ms · 2 | 204 ms · 2 | 223 ms · 3 | 317 ms · 7 | 447 ms · 12 | 1186 ms · 52 | 1376 ms · 62 | 36 KB |
| GET /api/game/duels (equipos y constructor) | 196 ms · 3 | 197 ms · 3 | 233 ms · 4 | 301 ms · 8 | 495 ms · 13 | 1250 ms · 53 | 1553 ms · 63 | 70 KB |
| GET /api/game/meta (misiones y logros) | 307 ms · 9 | 337 ms · 9 | 412 ms · 12 | 568 ms · 24 | 868 ms · 39 | 2588 ms · 159 | 2907 ms · 189 | 14 KB |
| GET /api/game/crafting | 212 ms · 2 | 183 ms · 2 | 245 ms · 3 | 307 ms · 7 | 424 ms · 12 | 1109 ms · 52 | 1270 ms · 62 | 80 KB |
| GET /api/game/forge | 212 ms · 2 | 214 ms · 2 | 206 ms · 3 | 276 ms · 7 | 422 ms · 12 | 1275 ms · 52 | 1424 ms · 62 | 131 KB |
| GET /api/game/collection-sets | 197 ms · 1 | 222 ms · 1 | 205 ms · 2 | 302 ms · 6 | 405 ms · 11 | 1222 ms · 51 | 1348 ms · 61 | 283 B |
| POST packs buy_and_open (sobre Estándar) | 324 ms · 3 | 434 ms · 3 | 340 ms · 4 | 495 ms · 8 | 596 ms · 13 | 1334 ms · 53 | 1953 ms · 63 | 885 B |
| GET /api/game/cards?card= (copias de una carta, por serie) | — | 186 ms · 2 | 183 ms · 2 | 179 ms · 2 | 170 ms · 2 | 196 ms · 2 | 204 ms · 2 | 8 KB |
| GET /api/game/cards (carta + libres + numeradas) | — | 162 ms · 1 | 182 ms · 1 | 158 ms · 1 | 161 ms · 1 | 155 ms · 1 | 173 ms · 1 | 8 KB |

Lectura de los datos:

- El suelo de cualquier petición en este stack es de unos 170–200 ms (sesión, pasarela y una consulta).
- Con la 0074, **estado, álbum, equipos, misiones y apertura de sobres no dependen del tamaño**: 2–3 consultas y la
  misma latencia con 100 que con 60.000 cartas. El estado ocupa 41 KB con 50.000 cartas (166 KB con la release
  publicada para solo 1.000).
- **Desguace, crafteo y forja** siguen creciendo con la colección (necesitan cada ejemplar): unos 20–25 ms por cada
  1.000 cartas, 1,1–1,5 s con 50.000.
- Sin la 0074 todo lo que usa el resumen crece igual (1,2 s con 50.000; 2,6 s en misiones, que lo pide tres veces).

En la base, con 50.000 cartas: una página por cursor tarda 62 ms sin el índice y 10 ms con él; el resumen, 46 ms
(165 ms en la primera versión con funciones de ventana, descartada). Índices nuevos: 6,3 MB y 9 MB para 129.000 filas.

Objetivos fijados a partir de estas medidas:

| Tipo de petición | Objetivo | Resultado |
|---|---|---|
| Navegación (estado, álbum, página de copias, equipos, misiones, abrir sobre), cualquier tamaño, con 0074 | p95 ≤ 600 ms | cumplido (máx. 533 ms) |
| Gestión (desguace, crafteo, forja) con 50.000 cartas | ≤ 2 s | cumplido (1,1–1,5 s) |
| Tamaño del estado | no crece con la colección | cumplido (41 KB) |
| Memoria de la app | sin crecimiento sostenido | 100 → 224 MB durante la prueba, de 2 GB |

Navegador (Chrome, cuenta de 50.000 cartas, español, japonés e inglés, 390 y 1.440 px): **126 PASS · 0 FAIL**.
Lo guardado en `localStorage` ocupa 42 KB; la ficha de la carta con 20.000 copias pinta 48 y carga de 48 en 48 al
llegar al final; la memoria de la página queda entre 38 y 56 MB.

## 8. Seguridad

23 / 23 en el stack real:

- Sin token o con token falso: 401 en estado, colección, cartas y desguace.
- Un cursor emitido para otra cuenta solo desplaza dentro de las cartas propias: el cursor no es una credencial, la
  consulta filtra siempre por el usuario del token.
- Pedir por `uid` cartas de otra cuenta no devuelve ninguna. Desguazarlas se rechaza y siguen intactas.
- No existe parámetro de usuario; cualquier clave desconocida, límite fuera de 1–100, orden desconocido, carta mal
  formada, cursor basura, cursor con inyección, cursor de otros filtros o lista de `uid` inválida responde 400.
- La respuesta no lleva dueño, correo ni nada ajeno al ejemplar.
- Una ráfaga acaba en 429 con `Retry-After` y no afecta a otra cuenta.

Protección frente a consultas costosas: página máxima de 100, consulta por `uid` máxima de 60, operación de
desguace máxima de 500 y límites de frecuencia por cuenta.

## 9. Economía y regresión

Economía (sin cambios en precios, probabilidades, RNG, recetas ni recompensas):

- Paginar mientras otra sesión abre tres sobres: 0 cartas repetidas, 0 perdidas.
- Dos desguaces simultáneos de las mismas 200 cartas: uno aceptado, otro rechazado; se pagan una sola vez.
- La misma clave enviada tres veces a la vez: una operación.
- Desguace completo de 4.570 repetidas en 10 tandas: pagado 404.465, previsto 404.465; queda una copia de cada carta.
- Cuadre final de la cuenta: saldo = saldo inicial − 3 sobres + suma del libro de desguaces, al crédito. 0 `uid` repetidos.

Regresión:

| Comprobación | Resultado |
|---|---|
| Tests (PC) | 6.528 / 6.528 (49 nuevos) |
| Typecheck de app y scripts | sin errores |
| Lint | 0 errores |
| Auditoría i18n | sin problemas, 13.828 × 7 (28 textos nuevos en los ocho idiomas) |
| `economy:verify` | 60 / 60 |
| Compuerta en contenedor (build + typecheck + tests del artefacto) | build correcto, 6.500 / 6.508: los mismos 8 fallos por diseño que la compuerta de `b48d76af` |
| WALKOUT 3D en los ocho idiomas | 56 PASS · 0 FAIL |
| QA autenticada en los ocho idiomas (sobres, crafteo, equipos, tienda) | 1.293 PASS · 0 FAIL (cuenta de QA con más de 1.000 cartas) |
| Visual de las pantallas tocadas, ocho idiomas | 648 pantallas (81 por idioma, 390 / 768 / 1.440 px): 0 desbordes, 0 textos cortados, 0 claves, 0 errores de consola |
| Humo de invitado, ocho idiomas | 132 PASS · 0 FAIL |

Los dobles de base de datos de los tests ahora cortan en 1.000 filas, ordenan y cuentan como PostgREST. Con el doble
anterior, sin tope, una lectura sin paginar pasaba todos los tests.

La primera pasada de WALKOUT 3D marcó un fallo que resultó ser del instrumento: deducía «la carta nueva» comparando
los ejemplares del estado antes y después, y una copia repetida ya no aparece ahí. Los instrumentos (QA autenticada,
WALKOUT 3D y sonda de rollback) usan ahora los recuentos del servidor; las versiones anteriores quedan en
`qa-scripts-b48d76af/` en el VPS. Evidencias en `logs/collection-scale/` y, en el VPS, `out-4b1f4c01/`.

## 10. Commits locales

Rama `feat/collection-pagination`, sobre `77db065`. Sin push.

| Commit | Mensaje |
|---|---|
| `a7dd16a` | `feat(collection): colecciones ilimitadas — lecturas por cursor, resumen por carta y copias paginadas` |
| `2d93084` | `perf(collection): resumen por carta sin ordenar la colección y lecturas simultáneas compartidas` |
| `9bfd9fc` | `fix(packs): tras abrir un sobre se traen sus ejemplares concretos al cliente` |
| `8e6664a` | `test(collection): instrumentos de carga, seguridad y concurrencia para colecciones grandes` |
| (este) | `docs(collection): informe de colecciones ilimitadas y candidata 4b1f4c01` |

La candidata es el árbol de `9bfd9fc`; los dos commits posteriores solo añaden instrumentos de QA y documentación.

`arch/stabilization` y `wip/f78-offsite-backups` no se han tocado.

## 11. Candidata

`drl-0.1.1-1-4b1f4c01` — `valorosters-i18n-qa/rc/drl-0.1.1-1-4b1f4c01.tar`, sha256
`446901008de8e32fb2ff9584b182024eb40f2868a40edcdedd810e01de066dd9`. **No está en `incoming/`.**

Es la fuente de producción (`b48d76af`) más exactamente los 121 ficheros de los commits (11 nuevos, 110 modificados,
0 borrados). F78 fuera. El commit `9bfd9fc` reproduce el mismo identificador de build.

Candidatas anteriores de esta misma tarea, superadas: `97b026ab` y `b272ddfe`.

Para desplegar (cuando se autorice), en este orden o en el inverso:

1. Código: `bin/deploy.sh drl-0.1.1-1-4b1f4c01`, como siempre. Rollback: `bin/deploy.sh --activate drl-0.1.1-1-b48d76af`.
2. Migración 0074 con backup previo. Rollback: su fichero `ROLLBACK`.

El código viejo no usa nada de la 0074 y el nuevo funciona sin ella. No hay ventana incompatible ni cambio de datos
de jugadores.

## 12. Riesgos pendientes

- **Desguace, crafteo y forja crecen con la colección** (1,1–1,5 s con 50.000 cartas). Correcto, pero mejorable
  llevando la selección de copias libres a la base.
- **Desguazar 50.000 repetidas** son 100 tandas a unas 15 por minuto (límite de frecuencia): unos 7 minutos con la
  pantalla abierta. Si se cierra a medias, lo hecho está pagado y lo demás intacto.
- **Mercado**: el formulario de venta ofrece una copia por carta repetida. Está cerrado por el interruptor y esa
  parte solo se ha probado por tests, no en navegador. La pestaña local antigua de `/mercado` no se ha adaptado.
- **Elegir una copia concreta para un equipo**: el constructor ofrece el mejor ejemplar de cada carta. Los equipos ya
  guardados con otra copia siguen siendo válidos.
- **Sin la 0074** el juego es correcto pero lento con colecciones muy grandes. Conviene aplicarla con la release.
- **La cabeza que anuncia `/api/ready` sigue en 0073**: la 0074 es opcional y no se ha añadido a la sonda.
- Las cuentas sintéticas y la 0074 siguen en la base de QA; el stack de QA sirve ahora esta candidata
  (para volver a la publicada: `app-swap.sh /tmp/i18n-rc/gate`).

## Instrumentos

- `scripts/ops/_collection-rc-stage.sh` — prepara y compila la candidata.
- `scripts/ops/i18n-qa-stack/collection-scale.sh` — siembra, mide, aplica y revierte la 0074 en QA, seguridad,
  concurrencia, navegador y limpieza.
- `scripts/_collection-scale-qa.mjs` — sonda HTTP.
- `scripts/_collection-scale-ui.ts` — pantallas en Chrome.
- `scripts/ops/i18n-qa-stack/chain10.sh` — regresión de navegador sobre la candidata.

## 13. Despliegue en producción (2026-10-13) — DESPLEGADO Y VERIFICADO

Con autorización expresa del propietario para desplegar `drl-0.1.1-1-4b1f4c01` y aplicar la 0074. Registros de cada paso
en `logs/collection-scale/deploy-4b1f4c01/`.

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Puerta de entrada | 16:23 | `current` = `b48d76af`, `ready`, 0 errores; candidata íntegra (`4469…6dd9`); la 0074 del repositorio, la del tar y la ensayada en QA son el mismo fichero (`b9d285c4…0e05`); el rollback también (`ee35ac9b…f2b1`) |
| Compatibilidad en QA | 16:24–16:28 | 6 de 6 (ver abajo) |
| Backup | 16:29 | `BACKUP_OK` · `pre-0074-colecciones/20261013T162920Z` · `db.dump` 2.934.225 B, sha256 `9afad5fe0bfac44794d9aea1f48396d8bd978de45a8ee29d3a64499d9b734286` · 7/7 huellas |
| Restauración | 16:30 | base desechable en QA: `pg_restore` 0 errores, 34/34 tablas, 2 cuentas, 83.671 créditos, 113 cartas, 2 equipos, receta 3:1 v2 |
| Copia fuera del VPS | 16:30 | `C:\NEXUS-CENTRAL\DRLCards-backups\pre-0074-colecciones\20261013T162920Z`, 7/7 huellas |
| Ensayo del guion sobre copia de datos reales | 16:33 | ensayo, aplicado, rechazo de un segundo intento y rollback, todo correcto |
| 0074: ensayo en producción | 16:34:05 | `ENSAYO_OK` (ROLLBACK): índices válidos, función solo para `service_role`, resumen = referencia en las 2 cuentas, ninguna fila cambiada |
| 0074: aplicar | 16:34:25 | `APPLY_OK`, 177 ms, una transacción. `DATOS_INTACTOS`; las 236 funciones anteriores y los 6 índices anteriores, intactos. PostgREST recargó su esquema (200 RPC) y `b48d76af` siguió `ready` con la migración puesta |
| Código | 16:34:39 → 16:38:15 | tar a `incoming/` (sha256 comprobado), `bin/deploy.sh` → `ACTIVA drl-0.1.1-1-4b1f4c01`, `ready` |
| Salud | 16:38 | `healthy`, 0 reinicios, 0 errores; un único fallo del túnel a las 16:38:12, durante el cambio de contenedor |
| Humo y comprobaciones | 16:39–16:54 | ver abajo |

Compatibilidad y rollback, comprobados en el stack de QA antes de tocar producción:

| Comprobación | Resultado |
|---|---|
| La versión anterior funciona con la 0074 aplicada | lee estado, equipos, desguace, crafteo, forja, misiones y temporada, y compra y abre un sobre (+5 cartas, −2.500) |
| El rollback del código no pierde cartas ni créditos | cambiar de build en los dos sentidos no altera ni una fila (huella de cartas, créditos, sobres, equipos y libro) |
| Los endpoints nuevos no dejan operaciones a medias | `/api/game/cards` es solo lectura: recorrerlo no escribe nada; el desguace por tandas es una operación atómica e idempotente por tanda |
| Los equipos existentes siguen siendo válidos | un equipo creado con la anterior usando 10 de 10 copias que no son el mejor ejemplar es válido y activable con la nueva, y a la inversa. En producción, los 2 equipos tienen sus 20 cartas en propiedad |
| Los ejemplares numerados conservan su identidad | serie ↔ `uid` idénticos antes y después de quitar y poner la migración, y la API devuelve exactamente lo de la base |
| Contratos de API y sesiones abiertas | el estado cambia de forma (un ejemplar por carta más recuentos). Un navegador con la versión anterior cargada lo mostraría así hasta su siguiente navegación; ninguna operación económica depende de ello. No había sesiones activas al aplicar la migración |

Verificación en producción:

| Comprobación | Resultado |
|---|---|
| Código publicado = tar verificado | 4.975 ficheros, 0 diferencias |
| Endpoints nuevos | `/api/game/cards` responde 401 sin sesión y con token falso (local y público); no es accesible sin autenticar |
| Humo de invitado, 8 idiomas | **132 PASS · 0 FAIL** |
| Invitado ampliado, 8 idiomas | **168 PASS · 0 FAIL** |
| `production:check -- --app --vps` | 25 PASS · 1 WARN · 6 FAIL: los cinco conocidos y uno nuevo y esperado, «migrations» (el repositorio tiene la 0074 y `MIGRATION_HEAD` sigue en 0073 a propósito) |
| Economía ICON | las 22 definiciones económicas (precios, probabilidades, pools, recetas, valor de desguace, interruptores) son byte a byte las de `b48d76af`; receta 3:1 v2 y pool `pack-icon-single` ACTIVE con 331 entradas, sin cambios |
| WALKOUT 0.9 | interruptor en «all»; `public/` idéntico; sus 23 ficheros se sirven con 200 |
| 0074 en uso | 78 llamadas a `app_collection_summary`, 5,8 ms de media |

**Actividad real tras el despliegue (no ejecutada por esta intervención).** A las 16:38:05 la cuenta `b7ccff02` inició sesión
desde un navegador y, entre las 16:39 y las 16:47, abrió un sobre (6 cartas), reclamó una misión (+200), compró un sobre
Team Heretics (−3.500), lo abrió (5 cartas), reclamó un logro (+4.000) y entró en la Forja. Todo cuadra: 74.960 + 200 −
3.500 + 4.000 = 75.660 créditos; 35 + 6 + 5 = 46 cartas, las 11 en inventario; suma del libro = suma de saldos (84.371);
0 `uid` repetidos; 0 errores en la app. La otra cuenta no cambia (8.711 créditos, 78 cartas). Hasta ese momento, la foto
posterior al despliegue era idéntica a la previa.

Otros servicios NEXUS: sin tocar. `nexus-crm` aparece recreado a las 16:41:52 con una imagen nueva (`nexus-crm:20261013-1`);
no forma parte de esta intervención ni comparte red con Valorosters.

No ejecutado por esta intervención: ninguna compra, apertura, crafteo, desguace ni transferencia, ni pantallas con sesión.

Rollback, disponible y sin usar: `bin/deploy.sh --activate drl-0.1.1-1-b48d76af` (la anterior funciona con la 0074 puesta)
y, si se quisiera, `0074_collection_scale.ROLLBACK.sql` (no cambia ninguna fila). El backup de las 16:29 es anterior a la
actividad de las 16:39: **no debe restaurarse encima de ella**.

Sin commits adicionales: quedan sin versionar esta sección, `scripts/ops/_collection-apply-0074.sh`,
`scripts/ops/i18n-qa-stack/collection-compat.sh`, `collection-compat-teams.sh` y `scripts/_collection-compat-probe.mjs`.

