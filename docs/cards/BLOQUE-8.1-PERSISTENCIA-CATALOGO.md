# BLOQUE 8.1 — Persistencia real del catálogo, migración segura y admin auth

> **Estado: READY.** 772 cartas persistidas, 0 card_id perdidos, 0 instancias perdidas,
> V-1 cerrada. **Sin commit, sin push, sin deploy.**

---

## 0. Resumen ejecutivo

Una carta ha dejado de ser el resultado de una función y ha pasado a ser una fila.

Antes de este bloque, la respuesta a *«¿existe esta carta?»* la daba `cardsForPlayer()` en la
memoria del proceso que la ejecutara. Ahora la da `content_cards`, y el servidor —sobres,
colección, mazos, duelos, mercado y tasación— la consulta ahí. La **generación** sigue exactamente
donde estaba: `PLAYERS × VARIANTES × cardsForPlayer()` es la única fuente de *cómo* se construye
una carta, y por eso la migración no puede introducir un error de transcripción: no hay
transcripción, hay ejecución.

Las 772 cartas están migradas con sus identidades intactas (`playerId__variantId`), y el esquema
lo hace cumplir con un `CHECK`, no con una convención. Las 53 instancias de jugadores reales, el
mazo, el listado de mercado y las 4 partidas están donde estaban, comprobado con huellas por fila
y no con recuentos.

**V-1 queda cerrada**: `/admin/*` ya no se protege con `ADMIN_ENABLED` —una constante pública del
bundle— sino con una comprobación de servidor contra `profiles.is_admin`, en un solo sitio.

**Un hallazgo que merece destacarse porque cambió el diseño:** la primera versión de la migración
pasó todas las comprobaciones de contenido y **falló la de determinismo**. El sorteo de sobres
elige por *índice* dentro del pool, y leer las filas ordenadas por `card_id` daba el mismo conjunto
de cartas en otras posiciones: la misma semilla entregaba otra carta en 3 de los 13 sobres. De ahí
sale la columna `ordinal`. Sin esa prueba, el bloque habría cambiado silenciosamente qué carta te
toca al abrir un sobre.

---

## 1. Arquitectura implementada

```
   src/data/players.ts  ──┐
                          ├── cardsForPlayer()  ← LA GENERACIÓN, intacta
   domain/cards/variants ─┘         │
                                    │  content-catalog:migrate (ejecuta, no copia)
                                    ▼
                     content_players + content_cards   ← LA EXISTENCIA, nueva
                                    │
                                    │  server/catalog  (caché + versión)
                                    ▼
              ┌─────────────────────┴─────────────────────┐
        PackEngine (sobres)   CardRegistry (mazos, duelo)  card()/player() (mercado, desguace)
```

**El principio, en una línea:** la generación se conserva; la existencia se persiste.

**Piezas nuevas:**

| Fichero | Qué es |
|---|---|
| `supabase/migrations/0037_content_catalog.sql` | el esquema: 2 tablas, 1 fila de versión, 1 vista de integridad |
| `src/server/catalog/rows.ts` | proyección `CardDef ⇄ fila`, checksums, ida y vuelta sin pérdida |
| `src/server/catalog/index.ts` | la autoridad de existencia en runtime: caché, versión, repliegue |
| `scripts/content-catalog-migrate.ts` | migración generadora e idempotente |
| `scripts/content-catalog-integrity.ts` | instantáneas antes/después y comparación automática |
| `scripts/content-catalog-verify.ts` | 59 comprobaciones en 7 familias |
| `scripts/content-catalog-qa.ts` | QA real jugando contra el servidor |
| `src/app/api/admin/session/route.ts` | la autoridad de «¿es admin?» (V-1) |
| `src/components/layout/AdminGuard.tsx` | la puerta de `/admin/*`, obedece al servidor |
| `src/app/admin/layout.tsx` | un solo punto de decisión para las 10 páginas |
| `src/middleware.ts` | rechazo en el borde + `no-store`/`noindex` |

---

## 2. Migración

`npm run content-catalog:migrate` — **generadora, no un volcado**. No existe en ningún sitio una
lista de 772 cartas: el script llama a `cardsForPlayer()` sobre `PLAYERS` y persiste el resultado.

- **Idempotente**: `upsert` por PK. Un segundo pase no duplica ni reordena, y la versión del
  catálogo **solo sube si la huella global cambió** — así un pase inocuo no invalida los catálogos
  en memoria de los procesos que estén sirviendo.
- **Reproducible, demostrado**: se borraron las tablas, se reaplicó el esquema y se remigró. Las
  huellas salieron **byte a byte idénticas** (`content_cards` `5df28d9f146df666`,
  `content_players` `e269814cbb25d685`).
- **`--dry-run`** calcula y compara sin escribir. **`--prune`** borra definiciones que el generador
  ya no produce, y **se niega a borrar** cualquiera que un usuario posea.
- Aborta antes de escribir si alguna carta no cumple `card_id = playerId__variantId` o apunta a un
  jugador que no está en el roster.

---

## 3. Tablas, claves, índices, constraints

### `content_cards` — la fila que no existía

| Columna | Tipo | Por qué |
|---|---|---|
| `card_id` | `text` **PK** | la identidad actual, preservada literal |
| `player_id` | `text` **FK → content_players** | la primera clave ajena real del catálogo |
| `variant_id` | `text` | la otra mitad de la identidad |
| **`ordinal`** | `int` **UNIQUE**, `not null` | el orden de generación. **No es cosmético** (§7) |
| `ovr`, `stats`, `combat`, `stat_boost` | `int/jsonb` | el resultado del generador, para reconstruir sin rederivar |
| `rarity_rank`, `rarity_bucket` | `int/text` | materializados para poder indexar por rareza (cierra parte de H-4) |
| `data_version`, `source`, `generated_at`, `origin` | `text/timestamptz` | procedencia y determinismo |
| `lifecycle`, `definition_version`, `published_at`, `retired_at` | | estado administrativo mínimo. **En 8.1 solo se usa `PUBLISHED`** |
| `checksum` | `text` | huella de lo que afecta al juego; compara 772 cartas en O(n) |

**Constraints**

- `content_cards_identity`: `check (card_id = player_id || '__' || variant_id)` — la identidad deja
  de depender de que nadie se equivoque.
- `check (ovr between 1 and 99)`, `check (stat_boost in (0,2,4,6,9,12))` — la escalera cerrada del
  dominio, en el esquema.
- `check (rarity_bucket in (...))`, `check (source in ('vlr','editorial'))`, `check (lifecycle in (...))`.
- `check (ordinal >= 0)` + índice único.

**Índices**: `player_id`, `variant_id`, `rarity_bucket`, `lifecycle`, `ordinal` (único), y el
parcial `(rarity_bucket, variant_id) where lifecycle='PUBLISHED'` — que es literalmente lo que
pregunta el sorteo de sobres.

### `content_players` — el roster (379)

Se persiste **entero**, no solo los 353 que generan carta: un jugador sin carta no es un jugador
inexistente, es uno cuyo motivo de exclusión hay que poder auditar. `region` y `role` con `CHECK`
contra las uniones de TypeScript.

**No tiene `ordinal`**, y la asimetría es deliberada: en las cartas el orden cambia el resultado
del sorteo; los jugadores solo se consultan por id contra un `Map`. Añadirla «por simetría» habría
sido inventar una restricción que estorba al alta desde el panel a cambio de ninguna propiedad.

### `content_catalog_version` — una fila, un entero

Cerrojo de fila única (`id boolean primary key check (id)`). Es la señal barata de caducidad: cada
proceso compara su versión con esta como mucho una vez cada 5 s en vez de traerse 772 filas.
`catalog_checksum` responde «¿mi copia es exactamente la publicada?» con una comparación de cadena.

### `v_content_card_orphans` — vigilar en vez de bloquear

Vista `security_invoker`. Cero filas cuando todo está anclado; cuando no, dice qué tabla apunta a
qué carta inexistente.

---

## 4. RLS y permisos

Las tres tablas: **RLS activo, CERO políticas, `revoke all` a `anon` y `authenticated`**. El cliente
no puede ni leer. Mismo patrón que `market_audit`/`market_flags` (0004) y las tablas PvP
(0031-0036); no se inventa uno nuevo. La lectura la hace el servidor con `service_role`.

**Comprobado, no afirmado** — 9 pruebas contra el PostgreSQL real, todas devuelven `42501`:

| Sujeto | `content_cards` | `content_players` | `content_catalog_version` |
|---|---|---|---|
| `anon` leer | denegado | denegado | denegado |
| `authenticated` leer | denegado | denegado | denegado |
| `authenticated` insert / update / delete | denegado · denegado · denegado | — | — |

**Por qué cero lectura pública y no «lectura de lo publicado»:** en 8.1 el cliente todavía renderiza
desde el catálogo generado en TypeScript, que el verificador demuestra idéntico al persistido. Abrir
una superficie de lectura que nadie consume sería ampliar el área de ataque a cambio de nada. La
proyección pública es de 8.2, cuando el panel exista.

---

## 5. Cambios de catálogo · el servidor como autoridad

| Superficie | Antes | Ahora |
|---|---|---|
| `services/packs.ts` (sorteo) | `runtimePackEngine()` sobre `CARDS` | `serverPackEngine(sb)` sobre `content_cards` |
| `services/duels.ts` (mazos, duelo PvE) | `new CardRegistry()` de módulo | registro del catálogo persistido |
| `services/duelsPvp.ts` (mazo PvP) | ídem | ídem |
| `services/market.ts` (escaparate, trades) | `getCard`/`getPlayer` de módulo | `serverCatalog(sb)` por consulta |
| `services/economy.ts` (desguace) | `getCard` de módulo | `serverCatalog(sb)` |
| `api/market/sync-reference` (ancla antifraude) | `CARDS` | catálogo persistido |

**Un único catálogo, no dos.** El generado y el persistido son el mismo contenido: el verificador
compara huella global (`0de98a1ce9c565fa…`) y, carta a carta, los 10 campos de `CardDef`. Si alguna
vez divergen, `content-catalog:verify` falla. Ese es el trinquete que sostiene la afirmación.

**El repliegue, dicho en voz alta.** Sin `SUPABASE_SERVICE_ROLE_KEY` o con `content_cards` vacía, el
servidor sirve el catálogo del código marcado `source: "seed-fallback"` y avisa **una vez** por
proceso. Es explícito (queda en `ServerCatalog.source`), está testeado en los dos sentidos, y **no
puede enmascarar una divergencia**: solo se activa cuando no hay nada persistido; con la tabla
poblada la BD manda siempre, y un fallo de lectura con catálogo ya cargado devuelve el que hay en
memoria, nunca el del código. Existe para que `npm run build` y los tests no exijan Supabase
delante — convertir la migración en requisito de arranque no toca en este bloque.

**`serverCatalogSync()`**, para los ayudantes síncronos de `duels.ts` (`toPublicView` y la
proyección a DTO, llamados desde media docena de sitios y desde las pruebas). El contrato es
explícito: se prepara con `await serverCatalog(sb)` en el punto de entrada asíncrono y se consume
sin `await`. No hay carrera —Node no interrumpe entre el `await` y el uso— y si se usara sin
preparar, se nota en `source`.

---

## 6. TABLA DE INTEGRIDAD · ANTES | DESPUÉS | DIFERENCIA

Medido con `content-catalog:integrity`, que **no cuenta filas: las huella** (sha256 sobre las
columnas que importan, en orden determinista). Un recuento igual con contenido distinto —53
instancias que siguen siendo 53 pero apuntan a otra carta— pasaría un recuento y no pasa esto.

| RECURSO | ANTES | DESPUÉS | DIF | ESTADO |
|---|---:|---:|---:|---|
| `user_cards` | 53 | 53 | +0 | **intacta** (huella idéntica) |
| `card_mints` | 42 | 42 | +0 | **intacta** |
| `duel_decks` | 1 | 1 | +0 | **intacta** |
| `market_listings` | 1 | 1 | +0 | **intacta** |
| `market_offers` | 0 | 0 | +0 | **intacta** |
| `card_reference` | 0 | 0 | +0 | **intacta** |
| `card_price_stats` | 1 | 1 | +0 | **intacta** |
| `card_price_daily` | 5 | 5 | +0 | **intacta** |
| `user_packs` | 10 | 10 | +0 | **intacta** |
| `duel_matches` | 4 | 4 | +0 | **intacta** |
| `content_players` | — | 379 | — | materializada |
| `content_cards` | — | 772 | — | materializada |

**Las cuatro afirmaciones del encargo, comprobadas:**

```
[PASS] NO CARD ID LOST              ninguna referencia a carta desaparecida
[PASS] NO USER CARD LOST            53 → 53 instancias, huella idéntica
[PASS] NO DECK BROKEN               10 cartas en mazos, mismas uid
[PASS] NO MARKET REFERENCE BROKEN   1 listado · 0 ofertas
```

Artefactos: `docs/cards/integrity-before.json` y `docs/cards/integrity-after.json`.

**Nota honesta sobre la medición.** Una primera comparación posterior a la batería de verificadores
salió con desvíos (54 instancias, huellas de `card_mints` y `card_price_*` movidas). **No era la
migración**: `economy:verify` crea cuentas de prueba y **no las borra** — hay residuo de sesiones
del 2026-09-03 y 2026-09-08, anterior a este bloque (§13, D-4). Se borró la cuenta que dejó *esta*
sesión y se repitió el experimento en limpio (borrar `content_*` → reaplicar esquema → remigrar),
que es la medición publicada arriba. `card_mints` no se puede revertir por diseño y es correcto que
así sea: es un contador global de seriales, y decrementarlo permitiría reutilizar un número de serie.

---

## 7. Determinismo — el hallazgo que cambió el diseño

**La comprobación**: el MISMO `PackEngine`, con la MISMA semilla y el MISMO estado de jugador,
alimentado desde código y desde base de datos, tiene que entregar exactamente las mismas cartas.
13 sobres × 5 semillas = 60 aperturas, comparando `cardId`, `serial`, `bucket`, `byPity`, `isNew`,
`value`, `pityAfter` y `mintDelta`. El pity se deja una carta por debajo del umbral cuando el sobre
lo tiene, para que la comparación pase también por la rama de compensación.

**Primer resultado: FALLO.** `inicial#1`, `inicial#7`, `inicial#42` divergían — con los pools
idénticos (0 de 65 combinaciones sobre×bucket diferían).

**La causa**: `buildPool()` recorre el catálogo **en orden** y `rng.pick()` elige **por índice**. El
catálogo del código sale de recorrer `PLAYERS` y, dentro de cada jugador, el conjunto de variantes
que compone `cardsForPlayer()` — un orden que **no es alfabético** (empieza en `benjy__silver`, no
en `aaaay__china`). Leer las filas por `card_id` daba el mismo conjunto en otras posiciones.

**La corrección**: la columna `ordinal`, única y no nula, y el servidor leyendo por ella.

**Resultado final**:

```
[PASS] el ORDEN persistido es el de generación       ordinal 0..771 reproduce PLAYERS × variantes
[PASS] pools idénticos en los 13 sobres × 5 buckets  0 de 65 divergen
[PASS] MISMA semilla ⇒ MISMAS cartas                 60 aperturas, 0 divergencias
```

**El motor de sobres no se ha tocado.** Ni pity, ni garantías, ni anti-duplicado, ni selección, ni
la caché del pool, ni el RNG, ni la lógica de apertura. Lo único que cambia es de dónde salen las
cartas elegibles. **No se ha introducido ningún cambio de probabilidad**: no hay peso por carta;
dentro de un bucket el sorteo sigue siendo uniforme, exactamente como antes.

---

## 8. Seguridad · V-1

### El diagnóstico, con precisión

`ADMIN_ENABLED` es `process.env.NEXT_PUBLIC_ADMIN === "1" || NODE_ENV !== "production"`: una
constante **pública** que viaja en el bundle. Diez páginas la repetían. No es una comprobación de
acceso, es una preferencia de compilación.

### Por qué NO es un middleware ni un layout de servidor

Conviene decirlo, porque es la decisión de arquitectura del bloque y tiene una razón medible:
**en este proyecto la sesión de Supabase vive en `localStorage`, no en una cookie**
(`lib/supabase/client.ts` usa el almacenamiento por defecto del SDK; no se usa `@supabase/ssr` y no
hay ni una cookie de auth en el código).

Un middleware y un componente de servidor solo ven cabeceras y cookies. En una navegación a
`/admin` el navegador **no adjunta ningún token**: ahí todo el mundo es anónimo, el administrador
legítimo también. Un `if (!isAdmin) redirect()` en esa capa no protegería — bloquearía a todos por
igual, que es lo mismo que apagar el panel. Y mover la sesión a cookies sería rehacer la
autenticación del producto entero, justo lo que el encargo pide no hacer.

### La solución: la comprobación se hace donde SÍ llega el token

```
navegador  ──Bearer──►  GET /api/admin/session  ──►  verifyAdmin()  ──►  profiles.is_admin
    │                        (SERVIDOR decide)              (el ya existente, reutilizado)
    ▼
AdminGuard: obedece. Falla CERRADO ante 401/403/500/red caída/respuesta rara.
```

1. **`GET /api/admin/session`** — la autoridad. Reutiliza `verifyAdmin`, el mismo que ya protege las
   otras cuatro rutas admin. Nunca distingue «token inválido» de «no eres admin»: eso confirmaría
   al curioso que su sesión sirve para algo aquí.
2. **`app/admin/layout.tsx`** — un único punto de decisión para las **11** rutas del árbol. Cualquier
   página nueva bajo `/admin/` queda protegida por el hecho de estar ahí.
3. **`middleware.ts`** — rechaza en el borde toda petición a `/api/admin/*` sin `Bearer` (con el
   mismo 401 indistinguible), y marca las superficies admin `no-store` + `noindex`. **No es la
   barrera** y el fichero lo dice: la barrera es `verifyAdmin`.
4. **`ADMIN_ENABLED` se conserva, degradado a lo que siempre debió ser**: interruptor de despliegue.
   Cuando está apagado no hay panel para nadie (comportamiento en producción sin cambios); cuando
   está encendido ya no abre la puerta, solo deja llegar hasta ella.

**La UI nunca es la barrera.** Aunque alguien parchee `AdminGuard` en su navegador, no obtiene ni un
dato ni una escritura: obtiene un formulario que recibe 401.

### Las nueve pruebas exigidas, contra el servidor real

| # | Escenario | Resultado |
|---|---|---|
| 1 | usuario sin sesión → `/api/admin/session` | **401** |
| 2 | usuario sin sesión → API admin | **401** (cortado por el middleware) |
| 3 | usuario normal → `/api/admin/session` | **401** |
| 3b | usuario normal → `/api/admin/operations` | **403**, sin cuerpo de datos ¹ |
| 4 | spoofear `userId`/`user_id` en el cuerpo | **401** |
| 5 | spoofear `role`/`is_admin`/`admin` + cabecera `x-admin` | **401** |
| 6 | usar la clave anónima como Bearer | **401** |
| 7 | admin válido → `/api/admin/session` | **200 `{admin:true}`** |
| 7b | admin válido → API que ya funcionaba | **200** (no se ha roto ninguna) |
| 8 | acceso directo a la página `/admin/operations` | HTML **sin datos administrativos** |
| 9 | acceso directo a un artefacto admin (`?download=`) | **401** |
| — | usuario intenta modificar el catálogo | **denegado** por RLS (§4) |

¹ 401 y 403 son ambos correctos y están documentados en esa ruta: sin token «no sé quién eres», con
token válido sin permiso «sé quién eres y no puedes». Lo que se comprueba es que **no hay datos**,
no un código concreto.

**Verificado también en el navegador real** (Chrome, `next dev`, donde antes cualquiera entraba):

- sin sesión de admin → *«ACCESO RESTRINGIDO — Esta zona es solo para administradores»*, panel no
  renderizado;
- con una cuenta `is_admin = true` → el panel completo (379 jugadores · 772 cartas).

**Cambio de comportamiento a declarar:** en desarrollo, `/admin` ya no está abierto por comodidad —
hace falta una cuenta con `profiles.is_admin`. Es más estricto a propósito.

---

## 9. Tests, typecheck, build, regresión

| | Resultado |
|---|---|
| `npm test` | **766/766** |
| `npm run typecheck` | **limpio** (web + scripts) |
| `npm run build` | **compila**; middleware y `/api/admin/session` registrados |
| `content-catalog:verify` | **59/59** |
| `content-catalog:integrity` | **INTEGRIDAD PRESERVADA** |
| `content-catalog:qa` | **33/33** |
| `audit:stability` | **105 comprobaciones · P0 = 0 · P1 = 0 · P2 = 9** (§12) |

**Verificadores ejecutados, todos en verde:** `pack`, `collection`, `deck`, `card-generator`,
`materializer`, `catalog-builder`, `publisher`, `content`, `economy`, `security`, `craft`,
`marketplace`, `telemetry`, `analytics`, `operations`, `loop`, `progression`, `events`,
`duel-balance`, `duel-gameplay`, `strats`, `battlepass`, y los ocho de PvP: `pvp` (41),
`pvp-sync` (48), `pvp-matchmaking` (111), `pvp-rating` (103), `pvp-rating-settlement` (77),
`pvp-timeout` (76), `pvp-arena` (66), `pvp-ratelimit` (51).

**No se ha eliminado ni silenciado ningún test.** Las dos aserciones que se ajustaron durante el
trabajo eran mías y estaban mal escritas, no del producto: esperaban `status: "valid"` donde el
dominio dice `READY_FOR_DUEL`, y exigían 401 donde la ruta responde 403 a propósito.

---

## 10. QA real (servidor arrancado, cuenta nueva, todo por HTTP)

| # | Paso | Resultado |
|---|---|---|
| 1 | aplicación arrancada, catálogo del servidor desde BD | 772 definiciones · versión 2 |
| 2 | catálogo público | conteo y versión cuadran con las filas |
| 3 | muestra de cartas reales | `benjy__silver` 79 · `nobody__masters-winner` 76 · `guang__silver` 76 · `septem7__china` 70 — OVR y trío de combate idénticos |
| 4 | colección | 5 cartas jugables, con nick y OVR del catálogo (`Derke 86`) |
| 5 | inventario | estado real: cartas, sobres y créditos |
| 6 | mercado | escaparate resuelve `Bai (AG) OVR 70 — bai__bronze`; escritura → **503 por `GLOBAL_MARKET_ENABLED=false`**, que es lo correcto ² |
| 7 | mazos | mazo legal `READY_FOR_DUEL`, suma OVR 901, 10 cartas resueltas |
| 8 | duelo | partida iniciada, mano de 10 cartas con nick y OVR (`trexx 90 — trexx__emea`) |
| 9 | apertura de sobres | 5 cartas, **todas existen en `content_cards`**, acuñadas en `user_cards` (incluida una serializada `derke__prime#2`) |
| 10 | admin auth | normal 401 · admin 200 · sin sesión cortado por el middleware |

² El interruptor está en `false` desde antes de este bloque y su cabecera lo explica: lecturas
abiertas, escrituras cerradas. Encenderlo para que la QA quedase bonita habría sido cambiar una
decisión de producto. Para probar igualmente que el escaparate resuelve contra el catálogo
persistido se usó un **fixture identificado, insertado con `service_role` y borrado en el mismo
paso** (comprobado: `quedan 0`).

**Cierre**: 772 definiciones antes y después; el mercado real conserva su único listado.

---

## 11. Datos de prueba — creados y eliminados

| Qué | Dónde | Estado |
|---|---|---|
| jugador y carta `zz-test-*` en `DRAFT` | `content_players` / `content_cards` | **borrados** (`content_cards=0 · content_players=0`) |
| cuentas `catalog-normal-*` / `catalog-admin-*` | `auth.users` | **borradas** (0 residuales) |
| cuentas `qa81-jugador-*` / `qa81-admin-*` | `auth.users` | **borradas** (0 residuales) |
| cuenta `qa81-browser-admin@nexus.test` (QA de navegador) | `auth.users` | **borrada** |
| listado de mercado (fixture de lectura) | `market_listings` | **borrado** |

Además se comprobó que **una carta en `DRAFT` no entra en el catálogo del servidor** (772 servidas,
todas `PUBLISHED`) — la propiedad que hará falta en 8.2.

**Estado final de la base de datos:** `content_cards` 772 · `content_players` 379 · `user_cards` 53 ·
`duel_decks` 1 · `market_listings` 1 · `card_mints` 42 · huérfanos 1 (el declarado). **Ninguna carta
ficticia publicada.**

---

## 12. Rendimiento

- **Sorteo**: sin cambio medible. El pool sigue cacheado (`WeakMap` por registro → `Map` por pack) ⇒
  O(1) por apertura. `pack:verify` mantiene la escala lineal medida: 10M decisiones, ratio 2.01.
- **Carga del catálogo**: 772 filas (~1 MB) una vez por proceso, paginado de 1000.
- **Coste por petición**: una consulta a `content_catalog_version` (una fila, un entero) como mucho
  **una vez cada 5 s**, amortizada entre todas las peticiones de esa ventana. Las peticiones
  concurrentes durante una carga comparten un único vuelo, no N.
- **Comparación de catálogos**: O(1) por huella global en vez de 772 comparaciones.

**Los 9 P2 nuevos de `audit:stability`** (0 antes → 9 después) son todos el mismo hecho: una sesión
**no administradora** abre `/admin/*`, el guarda pregunta al servidor y recibe 401, y el navegador
registra ese 401 en consola. Es el guarda funcionando. Se podría silenciar devolviendo `200
{admin:false}`, y **no se ha hecho**: 401 es la semántica correcta de un endpoint de autorización y
es coherente con el resto de `/api/admin/*` y con el middleware. Cambiar códigos de estado para que
una métrica quede limpia es el instinto equivocado. **P0 = 0, P1 = 0.**

---

## 13. Deudas restantes (documentadas, no arregladas)

| id | Deuda | Por qué no en 8.1 |
|---|---|---|
| **D-1** | **Sin FK `user_cards.card_id → content_cards.card_id`** | No es prudencia genérica, es un dato medido: `card_mints` contiene `derke__champions-mvp`, un id que el generador **no** produce (galardón retirado del roster). Este sistema **ya ha acuñado cartas fuera del catálogo semilla**; una FK convertiría ese hecho histórico en un error de escritura y podría bloquear el pipeline de torneos. Se vigila con `v_content_card_orphans` y con el trinquete del verificador. **Resolver en 8.2**, cuando el ciclo de vida diga qué hacer con una carta acuñada y luego retirada del generador. |
| **D-2** | El **cliente** sigue renderizando desde el catálogo generado en TypeScript | No hay divergencia —está demostrada la igualdad campo a campo y hay trinquete— pero la lectura pública de lo publicado es de 8.2, con el panel. |
| **D-3** | El pipeline de torneos (`/api/admin/tournaments`) lee el **roster** con `allPlayers()` del código | Es una búsqueda de roster, no de existencia de cartas, y `content_players` está demostrado idéntico a `PLAYERS`. Migrarlo pertenece al bloque de torneos. |
| **D-4** | **`economy:verify` no borra sus cuentas de prueba** | Preexistente: hay residuo del 2026-09-03 y del 2026-09-08. Ensucia las mediciones de integridad. No se ha tocado ese verificador en este bloque; se borró solo la cuenta que dejó esta sesión. |
| **D-5** | `npm run lint` está **roto** (`next lint` eliminado en esta versión de Next) | Preexistente, ajeno a este bloque. |
| **D-6** | La migración 0037 se aplica **a mano con `psql`**, como 0026–0036 | `supabase_migrations.schema_migrations` solo registra hasta 0025; registrar únicamente la 0037 dejaría el estado inconsistente. Se sigue la convención vigente del repositorio. |
| **D-7** | `lifecycle`, `definition_version`, `published_at`, `retired_at` existen y **nadie los mueve** | Están en el esquema para que 8.2 no tenga que migrar la columna. No hay transición, ni UI, ni RPC. Declarado también en el tipo. |
| **H-2** | Editar una definición seguiría mutando retroactivamente las instancias | **Es el objetivo de 8.2** (inmutabilidad de lo publicado + `minted_definition_version`). 8.1 no lo cierra y no pretende hacerlo. |

---

## 14. Hardcodes afectados

| Qué | Clasificación de la auditoría | Qué se ha hecho |
|---|---|---|
| 379 jugadores (`src/data/players.ts`) | MIGRATE | **migrados** a `content_players`; el fichero **sigue siendo la fuente de generación** |
| Derivación de cartas (`src/data/catalog.ts`) | KEEP | intacto — es el generador, no contenido |
| 37 variantes (`domain/cards/variants.ts`) | KEEP (v1) | intacto |
| 5 buckets de rareza | KEEP | intacto; se **materializan** en la fila para poder indexar |
| 13 sobres (`src/data/packs.ts`) | MIGRATE | **no** en 8.1 — es 8.3 |
| Fórmulas de economía | KEEP | intactas |
| `CATALOG_GENERATED_AT` | KEEP | intacta; se persiste como procedencia |
| `rebuildCatalog()` desde el cliente | REMOVE al final | **no se ha tocado** — el encargo exige demostrar antes que nadie depende de él |
| `ADMIN_ENABLED` como barrera | — | **degradado** a interruptor de despliegue; la barrera es el servidor |

---

## 15. Criterio READY

| # | Criterio | |
|---|---|---|
| 1 | representación persistente real del catálogo | ✅ `content_cards`, 772 filas |
| 2 | las 772 cartas migradas | ✅ |
| 3 | no se pierde ningún `card_id` | ✅ conjunto exacto + `NO CARD ID LOST` |
| 4 | generado = persistido | ✅ 10 campos × 772, huella `0de98a1ce9c565fa…` |
| 5 | `user_cards` intacta | ✅ 53 → 53, huella idéntica |
| 6 | propiedad intacta | ✅ |
| 7 | mazos intactos | ✅ 10 uid, mismas |
| 8 | mercado intacto | ✅ |
| 9 | sobres funcionales | ✅ QA: comprado, abierto, acuñado |
| 10 | duelos funcionales | ✅ QA: partida con mano de 10 |
| 11 | PvP funcional | ✅ 8 verificadores, 573 comprobaciones |
| 12 | el servidor usa el catálogo persistido como autoridad de existencia | ✅ `source: "db"` |
| 13 | no hay dos catálogos divergentes | ✅ con trinquete que lo mantiene |
| 14 | V-1 resuelta server-side | ✅ |
| 15 | usuario normal no accede ni altera administración | ✅ 12 pruebas |
| 16 | admin válido conserva acceso | ✅ HTTP y navegador |
| 17 | RLS/permisos correctos | ✅ 9 pruebas, `42501` |
| 18 | tests pasan | ✅ 766/766 |
| 19 | typecheck pasa | ✅ |
| 20 | build pasa | ✅ |
| 21 | QA real pasa | ✅ 33/33 |
| 22 | no hay P0 | ✅ |
| 23 | no hay P1 nuevo | ✅ (9 P2 explicados en §12) |
| 24 | **no se ha hecho commit** | ✅ |
| 25 | **no se ha hecho push** | ✅ |
| 26 | **no se ha hecho deploy** | ✅ |

---

## 16. Cómo reproducirlo

```bash
# 0. Supabase local (Docker) + app en 3005
npx supabase start
npx next dev -p 3005

# 1. Esquema (convención del repo: a mano, como 0026-0036)
docker cp supabase/migrations/0037_content_catalog.sql supabase_db_DRLCards:/tmp/0037.sql
docker exec supabase_db_DRLCards psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/0037.sql

# 2. Antes
npm run content-catalog:integrity -- --capture docs/cards/integrity-before.json

# 3. Migrar (--dry-run primero si quieres verlo sin escribir)
npm run content-catalog:migrate

# 4. Después + comparación automática
npm run content-catalog:integrity -- --capture docs/cards/integrity-after.json
npm run content-catalog:integrity -- --compare docs/cards/integrity-before.json docs/cards/integrity-after.json

# 5. Verificación y QA real
BASE_URL=http://127.0.0.1:3005 npm run content-catalog:verify
BASE_URL=http://127.0.0.1:3005 npm run content-catalog:qa
```

**Reversión**: borrar la vista y las tres tablas `content_*`. Ni una fila de `user_cards`,
`card_mints`, `duel_decks` o `market_listings` se toca, y el catálogo derivado sigue existiendo en
código — el servidor repliega solo.
