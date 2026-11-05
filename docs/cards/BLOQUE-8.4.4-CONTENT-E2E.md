# BLOQUE 8.4.4 — El plano de contenido, de punta a punta

> **Estado: NOT READY.** La cadena funciona entera en el servidor —un administrador crea una
> carta, la publica, la mete en un pool, le pone peso, sale de un sobre real, se acuña con su
> serie, se congela en su versión, y publicar una versión nueva no la toca— pero **el jugador no
> la ve**. La colección, el inventario y el mercado se pintan desde el catálogo compilado en el
> bundle, no desde `content_cards`, y descartan en silencio lo que no encuentran ahí.
> `content-e2e:verify` **150/150** · `content-e2e:qa` **88/90** · `npm test` **773/773** ·
> typecheck **PASS** · build **PASS** · **P0 0 · P1 1 abierto · P1 1 corregido**.
> **Sin commit, sin push, sin deploy.**

---

## 0. Resumen ejecutivo

Este bloque no añade arquitectura. Recorre la que hay y comprueba si aguanta entera.

**Lo que aguanta.** La cadena completa, medida contra el servidor real y por las rutas reales:

```
ADMIN crea aspas__emea-winner        →  DRAFT v1, OVR 87 derivado del trío 77/66/86
publica                              →  PUBLISHED, checksum a9ddef68…, source vlr
entra al pool con peso 1             →  r6, junto a tres comunes de pesos 10/20/5
el pool se activa y se vincula       →  sobre «estandar», en solitario
40 SOBRES REALES por /api/game/packs →  200 cartas, TODAS del pool
                                        aaaay 31,2 % · abo 53,5 % · absol 15,3 %
                                        (esperado 28,6 / 57,1 / 14,3)
                                        y 30 ejemplares de la carta nueva
ACUÑACIÓN                            →  series #1…#30 de 500, sin repetir, minted_version 1
ADMIN publica v2                     →  OVR 87 → 93
LOS 30 EJEMPLARES ANTIGUOS           →  siguen en v1, OVR 87, mismo uid, misma serie
19 EJEMPLARES NUEVOS                 →  v2, OVR 93
las dos versiones resuelven a la vez →  49 ejemplares del MISMO card_id, 30 en v1 y 19 en v2
RETIRED                              →  0 apariciones en 125 cartas más
                                        y los 49 ejemplares siguen resolviendo
                                        y no se puede purgar mientras exista uno
```

**Lo que no aguanta.** La misma carta —`content-e2e:qa` la crea igual, en su propia ejecución y
con sus propias cifras— mirada desde la pantalla de su dueño:

```
/api/game/state    →  35 ejemplares de aspas__emea-winner, con su versión
/coleccion         →  48 casillas pintadas · NINGUNA es esa carta
                      3 cartas marcadas «en posesión» de las 4 que el servidor le atribuye
```

Y la pantalla **se contradice a sí misma sin decirlo**, que es lo peor de todo. La cabecera
cuenta lo que devuelve el servidor (`own.distinctCount()`); la rejilla pinta lo que el catálogo
compilado sabe resolver. En `docs/cards/qa/844/04-coleccion-jugador-1440.png`:

```
cabecera:  «CONSEGUIDAS 4 / 772»   ·   «325 copias en posesión»
rejilla:   AAAAY ×66   ABO ×159   ABSOL ×45   ← tres cartas en color, y ninguna más
           (de ASPAS aparecen ICON SERIES, CHAMPIONS MVP, PRIME y CHAMPIONS WINNER,
            todas bloqueadas; EMEA WINNER —la que tiene— no está)
```

Cuatro conseguidas arriba, tres pintadas abajo. Y el denominador es **772**, el tamaño del
catálogo compilado, mientras `content_cards` tiene 774 en ese momento.

El álbum no sale del servidor: sale de `engine.views()`, un `CollectionEngine` construido sobre
`CARDS` —el catálogo **compilado** desde `src/data/players.ts`—. Una carta que solo existe en
`content_cards` no está en ese conjunto, y la rejilla no puede pintarla ni en gris. El mismo
`getCard()` compilado gobierna `/inventario`, `/mercado`, `/cuenta` y la portada, y todos
descartan lo que no encuentran con un `return []` o un `.filter(x => !!x.def)` mudo.

No es una regresión de este bloque: es la deuda **D-2**, declarada en 8.1 y repetida en 8.2
—«el cliente sigue renderizando la colección desde el catálogo generado en TypeScript… se cierra
cuando 8.3/8.4 sirvan la colección desde el servidor»—. Lo que cambia es que **ya se puede
disparar**: hasta 8.4.2 nadie podía crear una carta que no estuviera en el código, así que la
deuda solo significaba «estadísticas de hoy en vez de las de tu versión». Desde 8.4.2 significa
**una carta invisible para quien la tiene**. Nadie lo había medido.

Y un segundo hallazgo, este sí corregido, que es exactamente el que la Fase 21 del encargo manda
buscar: **el panel se tragaba los errores**. `useAsync` marcaba su `alive` a `false` en la
limpieza del efecto y nunca lo volvía a poner a `true`; con `reactStrictMode` —que está
activado— React monta, desmonta y vuelve a montar, así que a partir del segundo montaje ni
`setError` ni `setRunning(false)` se ejecutaban nunca. Medido: `/admin/pools/no-existe-844`
responde **404 en 83 ms** y la pantalla seguía diciendo «Cargando el pool…» **ocho segundos
después**, con el `ErrorBar` que nunca llegó a aparecer. Un fallo de servidor convertido en un
spinner eterno: el «estado optimista permanente» del §21, encontrado y cerrado.

---

## 1. Auditoría inicial (Fase 1)

Se midió antes de tocar nada. Lo que se comprobó, y con qué resultado:

| # | Qué | Medido |
|---|---|---|
| 1 | Tablas del plano de contenido | `content_players` 379 · `content_cards` 773 · `content_card_versions` 773 · `content_pools` 12 · `content_pool_entries` 6.864 · `content_pack_pools` 12 · `content_audit_log` 78 |
| 2 | Nombres del encargo que no existen | No hay `content_distributions` ni `content_distribution_entries`: la distribución vive en `content_pools` + `content_pool_entries` + `content_pack_pools`, y su contador en `content_distribution_version` |
| 3 | RLS | Las 6 tablas de contenido: RLS activo y **cero políticas** |
| 4 | Concesiones | **Ninguna** a `anon` ni a `authenticated` sobre `content_*` ni sobre `v_pool_admin`. No hace falta confiar en una política si no hay un `SELECT` que conceder |
| 5 | RPC | Las **14** `app_content_*` son `security definer` con `execute` solo para `postgres` y `service_role` |
| 6 | Auditoría | **10** de las 14 llaman a `_audit()` — las 10 que un administrador puede disparar desde el panel. De las otras cuatro, tres no son mutaciones de contenido (`distribution_snapshot` es lectura, `validate_version_fk` valida, `materialize_legacy` es del migrador) y una sí: **`app_content_purge_card`** borra una definición sin dejar rastro (ver P2-4) |
| 7 | Congelación | Dos disparadores: `trg_user_cards_stamp_version` (BEFORE INSERT, sella `minted_version`) y `trg_content_versions_immutable` (BEFORE UPDATE OR DELETE, rechaza reescribir el histórico y borrar una versión con ejemplares) |
| 8 | Escalada de privilegios | `authenticated` solo puede actualizar `avatar`, `region` y `username` de `profiles`. `is_admin` no está concedida |
| 9 | `max_rows` de PostgREST | **1.000**, y no avisa: `content_pool_entries` tiene 6.864 filas y una consulta sin acotar devuelve 1.000 con un 200 OK |
| 10 | Deriva de la línea base | `user_cards` 53 → 63 desde 8.4.3: **dos sobres que la cuenta demo abrió el 2026-09-09 a las 23:02**. Ajeno a este bloque |
| 11 | Errores silenciosos en `src/` | 2 `.catch(() => {})`, los dos sobre `syncFromServer()` en pantallas de jugador; ninguno en el plano de contenido |
| 12 | Estado de la interfaz admin | `adminPost` lanza con el mensaje del servidor, `useAsync` lo recoge, `ErrorBar` lo enseña, `WeightInput` no es optimista. El diseño era correcto; **la implementación de `useAsync` estaba rota** (§7) |

**Nada se dio por cerrado porque un bloque anterior dijera READY.** Se volvió a ejecutar la línea
base entera antes de escribir una línea: `content-catalog:verify` 62/62 · `content-version:verify`
66/66 · `content-pools:verify` 73/73 · `admin-cards:verify` 102/102 · `pools-admin:verify` 60/60.
Y ahí apareció el primer hallazgo: **`pools-admin:qa` daba 56/58**, con dos fallos que no eran del
producto (§8.2).

---

## 2. Arquitectura validada

```
   /admin/cartas ─┐                            ┌─ /admin/pools
   /admin/cartas/nueva                         ├─ /admin/pools/nueva
   /admin/cartas/[id](/editar)                 └─ /admin/pools/[id]
        │                                            │
        ▼                                            ▼
   POST /api/admin/cards                        POST /api/admin/pools
   verifyAdmin → actor del TOKEN                verifyAdmin → actor del TOKEN
        │                                            │
        ▼                                            ▼
   deriveDefinition()  ← la única autoridad     adminPools · pageAll
   de lo derivado (8.4.2)                            │
        │                                            │
        ▼                                            ▼
   app_content_create_card                      app_content_pool_upsert
   app_content_update_draft                     app_content_pool_entry_upsert
   app_content_publish_version                  app_content_pool_entry_remove
   app_content_set_lifecycle                    app_content_pool_set_entries
        │        (security definer, _audit)     app_content_pool_publish
        │                                       app_content_pack_bind
        ▼                                            │
   content_cards ── content_card_versions            ▼
        │                _bump_catalog()        content_pools ── content_pool_entries
        │                                            │        _bump_distribution()
        ▼                                            ▼
   serverCatalog()  ←── TTL 5 s ──→  serverDistribution()  ←── app_content_distribution_snapshot()
        │                                            │              (una sola función `stable`)
        └──────────────► PackEngine ◄────────────────┘
                             │  buildPool, clave = pack.id@poolFingerprint(contenido)
                             ▼
                        openPack()  ──►  app_apply_pack_open  ──►  user_cards
                                                                    │ trg_stamp_minted_version
                                                                    ▼
                                                            minted_version = definition_version
```

**Una sola fuente de verdad en cada eslabón**, y ninguna nueva:

- la **existencia** de una carta la decide `content_cards`;
- **cómo se construye** la decide `cardsForPlayer()` / `deriveDefinition()`;
- **qué sale de un sobre** lo decide `PackDef` ∩ pool;
- **qué tiene un jugador** lo decide `user_cards`, y **qué es lo que tiene**, `minted_version`.

Lo que este bloque encontró es que hay **un sitio donde esa cadena se rompe**, y es el último: el
navegador (§6).

---

## 3. El flujo E2E

`content-e2e:verify` — **150 comprobaciones**, servidor real, rutas reales, sobres reales.

| Familia | Qué demuestra | Comprobaciones |
|---|---|---|
| 1 · Autoridad | Ni anónimo ni jugador leen contenido; las RPC están revocadas | 3 |
| 2 · Alta | La carta nace en DRAFT v1 con todo lo derivado por el dominio | 8 |
| 3 · Publicación | Lifecycle, checksum, `source`, diario, y el rechazo de publicar dos veces | 9 |
| 4 · Pool | Alta de entradas, pesos exactos, diario acotado y conflicto de revisión | 11 |
| 5 · Probabilidad | 10/20/5 = 28,571 / 57,143 / 14,286 contra `effectiveProbabilities` | 4 |
| 6 · Sobre real | 40 aperturas, 200 cartas, todas del pool, con los pesos configurados | 8 |
| 7 · Acuñación | `user_cards`, `card_mints`, serie, dueño, fecha, `minted_version` | 8 |
| 8 · Versión nueva | La definición cambia; la instancia histórica no | 10 |
| 9 · Convivencia | v1 y v2 del mismo `card_id`, y las dos resuelven | 5 |
| 10 · Colección | El servidor entrega cada ejemplar con SU versión | 2 |
| 11 · Mercado | El escaparate anuncia lo que se vende, no lo que dice el catálogo hoy | 5 |
| 12 · Retirada | Fuera de los sobres, dentro de la historia; purga imposible | 7 |
| 13 · Diario | Actor, acción, entidad, momento — en UNA sola tabla | 3 |
| 14 · Seguridad | 22 intentos por ruta + 16 escrituras directas + escalada | 13 |
| 15 · Concurrencia | Carta y pool: uno gana, el otro se entera | 5 |
| 16 · Caché | Pertenencia, pesos, versión publicada y huellas — sin reiniciar | 8 |
| 17 · Determinismo | Peso 1 ≡ camino histórico, 12 semillas, 0 divergencias | 3 |
| 18 · Paginación | Pool de 300, se cambia una entrada, las otras 299 intactas | 7 |
| 19 · Recuperación | Doble envío de apertura, de edición y de publicación | 6 |
| 20 · Economía | Precio, cargo único, libro mayor, `user_packs`, saldo insuficiente | 5 |
| 21 · PvP | Cada ejemplar entra al duelo con SU trío | 4 |
| 22 · Rendimiento | Catálogo, ficha, probabilidad, apertura, carga en frío, resolución | 6 |
| 23 · Integridad | Huella idéntica y toda diferencia de recuento declarada | 8 |

---

## 4. Probabilidad: dos números que no se pueden mezclar

El pool de la prueba tiene **cuatro** entradas a propósito, y la razón no es de cobertura sino de
aritmética: **el peso solo compite dentro de un bucket**. `effectiveProbabilities` normaliza por
bucket, igual que el sorteo. Con una carta por bucket, cada una valdría el 100 % del suyo y
«20 sale más que 10» sería una frase sin contenido.

```
tres comunes:  10 / 20 / 5   →  28,571 %  57,143 %  14,286 %   (dentro del bucket común)
la nueva:      rare, peso 1  →  100 %                          (única rare del pool)
```

Y ahí está la confusión más cara que este panel puede provocar. La carta nueva vale el **100 %**
de su bucket. Si esa cifra se enseñara como «probabilidad de que te toque», el panel estaría
prometiendo una carta segura donde la de verdad es:

```
P(bucket rare) 12,698 %  ×  P(carta | bucket) 100 %  =  12,698 % por hueco
                                                        49,288 % «al menos una» en 5 huecos
```

`cardOdds` la devuelve **descompuesta** y la verificación comprueba las tres cosas: que el
producto cuadra, que `pBucket < 1` (o sea, que la descomposición no es trivial), y que
`pPorHueco ≠ pEnBucket`. La ficha del panel, además, enseña **peso total 36** y una cuota por
entrada que es `peso ÷ 36` — un número **del pool**, no del sobre —, y `content-e2e:qa` comprueba
que la pantalla nombra las dos capas («bucket» y «hueco») después de pulsar *Calcular
probabilidad*.

---

## 5. Caché: los cuatro cambios, sin reiniciar

Se prueba cada capa por separado, cambiando **solo una cosa** y abriendo sobres reales después.
Entre cambio y cambio se esperan 6 s: la caché de distribución declara un TTL de 5 s.

| Qué cambia | Qué se mide | Resultado |
|---|---|---|
| **Pertenencia** — se quita una carta y se mete otra, **dentro del mismo pool**, sin cambiar el número de entradas | 20 sobres | la nueva sale 12 veces, la vieja **0** |
| **Peso** — una entrada de 5 a 500 | 20 sobres | **95,4 %** del bucket común (esperado 94,3 %) |
| **Versión publicada** — se publica una v nueva | ficha por la API | OVR 96 → 97 sin reiniciar |
| **Ciclo de vida** — RETIRED | 25 sobres | **0** apariciones en 125 cartas |

El primero es el que importa: es la regresión que 8.4.3 encontró y cerró (la clave de caché
contaba las entradas en vez de identificarlas). Aquí se vuelve a ejercitar **desde el panel**, con
la sustitución hecha por `entryRemove` + `entryUpsert` sobre el mismo pool.

---

## 6. El hallazgo: la carta que su dueño no ve

**P1-1 · ABIERTO.**

### Qué se midió

`content-e2e:qa`, paso 9, con navegador y sesión del jugador:

```
/api/game/state   →  35 ejemplares de aspas__emea-winner
                     4 cartas distintas en total
/coleccion        →  48 casillas con `aria-label` de carta
                     NINGUNA contiene aspas__emea-winner
                     3 casillas marcadas «Ver …» (en posesión) de las 4 que el servidor atribuye
```

### Por qué pasa

`/coleccion` construye la rejilla con `engine.views()`, y `engine` es un `CollectionEngine` sobre
`CARDS`, el catálogo **compilado** que produce `buildCatalog(PLAYERS)` al importar
`src/data/catalog.ts`. La carta creada desde el panel existe en `content_cards` y en
`content_card_versions`, pero **no** en `PLAYERS × cardsForPlayer()`, así que no está en `CARDS`.

El mismo `getCard()` compilado gobierna el resto de pantallas de jugador, y todas descartan lo que
no encuentran **sin decirlo**:

| Fichero | Línea | Cómo lo descarta |
|---|---|---|
| `src/app/coleccion/page.tsx` | 173-177 | `return def ? [ … ] : []` |
| `src/app/inventario/page.tsx` | 112, 274 | `if (!def) return null` |
| `src/app/mercado/page.tsx` | 256, 424, 511 | `.filter((x) => x.def)` |
| `src/app/cuenta/page.tsx` | 190 | `.filter(x => !!x.def)` |
| `src/app/page.tsx` | 196 | `.filter(x => !!x.def)` |
| `src/app/colecciones/[slug]/page.tsx` | 121 | `getCard(cardId)` sin respaldo |

Y el cliente además tiene una **segunda** fuente para el catálogo: `useRosterStore` reconstruye
`CARDS` con `rebuildCatalog(effectiveRoster())` a partir de `PLAYERS` más lo que haya en
**`localStorage`**. Ni siquiera esa vía puede producir la carta, porque `rebuildCatalog` deriva
cartas de jugadores y la variante nueva no es una que el generador produzca para ese jugador.

### Qué NO está roto

Conviene decirlo con precisión, porque limita el daño:

- **El servidor es correcto en todo**: valor, desguace, mercado, mazos y duelos resuelven por
  `minted_version` y ven la carta perfectamente. Verificado en las familias 7-11 y 21.
- **El constructor de mazos y el PvP no usan `getCard()`**: reciben `DuelDeckCardDTO` del
  servidor. La carta se puede jugar.
- **No hay pérdida de datos.** La instancia, su serie y su versión están intactas; el día que el
  cliente lea del servidor, aparecerán.

### Por qué no se arregla aquí

Cerrarlo es servir el catálogo de la colección desde el servidor: una capa nueva entre
`/api/game/state` y el `CollectionEngine` del cliente, que toque `src/data/catalog.ts` y las seis
pantallas de arriba. Es literalmente lo que 8.2 aplazó en **D-2** («se cierra cuando 8.3/8.4
sirvan la colección desde el servidor») y lo que el §29 de este encargo prohíbe: *«NO quiero
añadir una nueva capa de arquitectura»*.

Se deja **abierto y medido**, no reclasificado. El §27 es explícito: no convertir un P1 en P2 para
declarar READY.

---

## 7. El otro hallazgo: el panel se tragaba los errores

**P1-2 · CORREGIDO.**

`useAsync` (en `src/components/admin/cards/shared.tsx`) es el único sitio por el que el panel
entero informa de un fallo. Tenía:

```ts
const alive = useRef(true);
useEffect(() => () => { alive.current = false; }, []);   // ← nadie lo vuelve a poner a true
...
catch (e)  { if (alive.current) setError(…); }
finally    { if (alive.current) setRunning(false); }
```

`next.config.mjs` declara `reactStrictMode: true`, así que React **invoca los efectos dos veces al
montar**: monta, desmonta, vuelve a montar. La limpieza del primer ciclo pone `alive.current` a
`false` y ya no vuelve a subir. A partir de ahí, en desarrollo, **ningún error del panel se
enseña y ningún indicador de carga se apaga**.

Se veía así, y así se midió:

```
POST /api/admin/pools {action:"sheet", poolId:"no-existe-844"}  →  404 en 83 ms
la pantalla, 8 s después                                        →  «CARGANDO EL POOL…»
el ErrorBar                                                     →  nunca aparece
```

Con el éxito no se notaba —`setSheet` vive fuera del `useAsync`—, así que el panel «funcionaba».
Solo fallaba al fallar, que es cuando hace falta.

La corrección es la línea que `usePvpQueue` ya tenía desde el bloque 7.3:

```ts
useEffect(() => {
  alive.current = true;
  return () => { alive.current = false; };
}, []);
```

Comprobado después: `/admin/pools/no-existe-844` enseña el estado de error con salida, y un trío
fuera de escala devuelve *«stronghold está fuera de la escala 0-99»* en pantalla en vez de un
spinner.

---

## 8. Lo demás que se corrigió

### 8.1 · Truncado silencioso de PostgREST (P2, cuatro lecturas)

`supabase/config.toml` fija `max_rows = 1000`, y PostgREST **no avisa** cuando lo aplica. Medido:

```
select card_id from content_pool_entries          →  6.864 filas en la tabla
GET /rest/v1/content_pool_entries?select=card_id   →  1.000 filas, 200 OK
```

Cuatro lecturas del plano de contenido pedían «todas» sin acotar:

| Dónde | Qué se hace con las filas | Qué pasaría al truncarse |
|---|---|---|
| `adminPools.poolSheet` | **suma** los pesos para calcular la cuota de cada entrada | el panel enseñaría un porcentaje distinto del que reparte, como un hecho |
| `adminCards.listCards` (filtro por pool) | `in(...)` sobre los `card_id` del pool | cartas del pool ausentes del listado |
| `/api/admin/pools` acción `inspect` | promete la configuración **entera** | media configuración devuelta como si fuera toda |
| `inventory.loadGameState` (`card_mints`) | **de aquí sale el número de serie** | series repetidas: el #1 de una serie ya repartida |

**Hoy ninguna se puede disparar, y conviene decirlo así en vez de inflar el hallazgo:** la clave
primaria de `content_pool_entries` es `(pool_id, card_id)`, así que un pool no puede tener más
entradas que cartas hay en el catálogo, y hay 773; `card_mints` tiene como mucho una fila por
carta. Lo que cambia con esta familia de bloques es que **el catálogo ya no es una constante**:
desde 8.4.2 un administrador lo hace crecer con un formulario. El día que se creen 228 cartas más,
el resumen de un pool empieza a mentir y el acuñador empieza a repetir series, sin un error y sin
nada que relacione la causa con el efecto.

Se cierra con `src/server/db/pageAll.ts`, un bucle de páginas de 1.000 con orden estable.

### 8.2 · `pools-admin:qa` tenía la línea base escrita a mano (P2)

Comprobaba `uc === 53`, que es lo que había el día que se escribió 8.4.3. Hoy hay 63 —dos sobres
de la cuenta demo el 2026-09-09— así que la QA daba **56/58** con dos fallos que no eran del
producto. Una comprobación que falla siempre deja de decir nada el día que falla de verdad: ahora
se mide al empezar y se compara contra lo medido.

### 8.3 · `npm run typecheck` estaba en rojo (P2)

`tsconfig.scripts.json` no compilaba: 3 errores en `scripts/admin-cards-verify.ts` (una conversión
`PlayerStats` → `Record<string, number>` sin pasar por `unknown`) y `scripts/content-version-qa.ts`
(un tipo de respuesta incompleto). Los dos ficheros están **sin commitear**, de bloques
anteriores. Corregidos: el criterio 30 exige typecheck PASS y estaba fallando antes de empezar.

---

## 9. Seguridad

Tres capas, y las tres se atacaron:

**La puerta.** 11 acciones × (sin sesión, jugador normal) = **22 intentos**, todos **401**.
Suplantar `userId`, `role` e `is_admin` en el cuerpo: **401** — el actor sale del token y el cuerpo
ni se lee. El administrador sí pasa.

**La ventana.** 8 escrituras × 2 clientes (anónimo y jugador autenticado) directamente contra
PostgREST: **16/16 rechazadas**. `update`, `insert` y `delete` sobre `content_cards`,
`content_card_versions`, `content_pools`, `content_pool_entries` y `content_audit_log`.

**La escalada.** Un jugador intentando `profiles.is_admin = true` sobre su propia fila:
*permission denied for table profiles* — la columna no está concedida a `authenticated`, que solo
puede tocar `avatar`, `region` y `username`. Y reescribiendo `minted_version` y `serial` de **su
propio** ejemplar: *permission denied for table user_cards*.

**El cliente no puede ser autoridad.** Enviar un campo derivado no se ignora: **se rechaza
diciendo de dónde sale de verdad**.

```
ovr, stats, stat_boost, rarity_rank, rarity_bucket,
checksum, data_version, generated_at, source                    →  9/9 rechazados, 400
card_id, player_id, variant_id, lifecycle,
definition_version, ordinal, origin                             →  7/7 rechazados, 400
trío fuera de escala / negativo / decimal / incompleto / texto  →  5/5 rechazados, 400
peso 0, -5, 2.000.000, "10", null, NaN                          →  6/6 rechazados, 400
lifecycle inventado                                             →  400
```

---

## 10. Concurrencia

Dos sesiones administrativas distintas, con dos tokens distintos, disparando a la vez.

**Versión de carta.** A y B leen v2, los dos publican con `expectedVersion: 2`:

```
A → 200, v3
B → 409 · «La carta ha cambiado mientras la editabas (esperabas v2, hay v3)» · conflict: true
definition_version: 2 → 3   (sube exactamente una vez)
```

**Entradas de pool.** A y B leen r6, cada uno cambia el peso de una carta distinta:

```
A → 200        B → 409 · conflict: true, current: r7
4 entradas antes, 4 después: ninguna perdida
y el peso que queda es el de A, el que llegó primero
```

**Nunca «último que escribe, gana» en silencio.** El rechazo va marcado (`conflict: true`,
`current`) para que la pantalla pueda distinguir «otro se te adelantó» —que se resuelve
recargando— de «esta operación no es legal» —que no—, sin comparar el texto del mensaje.

Y una revisión obsoleta a secas también se rechaza, sin mover el peso: se comprobó que tras el 409
la entrada seguía en 10.

---

## 11. Determinismo

Con **todos los pesos a 1**, el camino ponderado tiene que ser indistinguible del anterior a 8.3.

```
pool uniforme: las 773 cartas elegibles del sobre, peso 1  →  dist.uniform === true
12 semillas × 2 caminos (sin pool / con pool uniforme)     →  24 aperturas, 0 divergencias
10 semillas × 2 motores independientes, mismo pool         →  10/10 idénticas
```

**Una nota sobre el instrumento, porque falló primero y el fallo era suyo.** La primera versión
comparaba contra `cat.packEngine`, que consulta `currentDistribution()` — y en ese momento la
distribución vigente era el pool de prueba de tres cartas que esta misma verificación acababa de
publicar. Daba 12 divergencias de 12, y no decían nada. La línea base tiene que ser un
`PackEngine` construido con `() => null`.

`content-pools:verify` sigue midiendo lo suyo aparte: 378 aperturas, 0 divergencias.

---

## 12. Paginación

Un pool de **300 entradas**, doce veces el tamaño de página del panel (25).

```
ficha, página 1        →  25 de 300
resumen                →  300 entradas · peso total 1.197  (sobre TODAS, no sobre la página)
se cambia UNA entrada de la última página  →  777
después                →  300 de 300 entradas, y 300/300 con su peso exacto
inspect                →  300 entradas, no una página
```

Es la puerta que 8.4.3 cerró dando la operación correcta (`entryUpsert` / `entryRemove`) en vez de
confiar en que nadie reenviara «todas» desde una pantalla que tiene 25 cargadas. Aquí se vuelve a
vigilar desde fuera: **no desaparece ni una entrada fuera de la página visible**.

---

## 13. Integridad

`content-e2e:verify` y `content-e2e:qa` toman su propia huella al empezar y al terminar, sobre
`user_cards`, `card_mints`, `duel_decks`, `market_listings`, `market_offers`, `card_reference` y
`content_cards`, excluyendo lo que ellas mismas crean. Las dos terminan con **huella idéntica**.

Y se censa cada tabla antes y después, clasificando **toda** diferencia:

| Tabla | Diferencia durante la prueba | Clasificación |
|---|---|---|
| `content_cards` | 773 → 774 | **ESPERADA** — la carta que la verificación crea; se purga al limpiar |
| `content_card_versions` | 773 → 778 | **ESPERADA** — las 5 versiones que publica |
| `content_pools` / `content_pool_entries` | 12 → 14 · 6.864 → 7.168 | **ESPERADA** — sus dos pools (4 entradas + 300 del fixture de paginación) |
| `user_cards` | 63 → 748 | **ESPERADA** — los 137 sobres que abre; se borran al limpiar |
| `card_mints` | 48 → 49 | **ESPERADA** — el contador de la carta nueva; se devuelve exactamente a donde estaba |
| `card_reference` | 13 → 14 | **ESPERADA** — el ancla de la carta nueva |
| `market_listings` | 1 → 2 | **ESPERADA** — el listado de prueba |
| resto | 0 | intactas |

Vistas de diagnóstico, después: `v_instance_version_gaps` **0** · `v_content_card_orphans` **0** ·
`v_content_rpc_overloads` **0**.

**Y el resultado de la comparación completa, tomada alrededor de la pasada final**
(`pools-admin:qa` + `audit:stability` + `content-e2e:verify` + `content-e2e:qa`):

```
npm run content-catalog:integrity -- --compare   docs/cards/integrity-844-before.json docs/cards/integrity-844-after.json

user_cards 63 → 63 · card_mints 48 → 48 · duel_decks 1 → 1 · market_listings 1 → 1
market_offers 0 → 0 · card_reference 13 → 13 · card_price_stats 1 → 1
card_price_daily 6 → 6 · user_packs 10 → 10 · duel_matches 4 → 4
15 comprobaciones · 15 PASS · ✓ INTEGRIDAD PRESERVADA
```

**Las quince, con huella idéntica, incluidas las cuatro derivadas.** Es más de lo que 8.4.1, 8.4.2
y 8.4.3 pudieron decir: en esos bloques `card_mints`, `card_reference`, `card_price_stats` y
`card_price_daily` cambiaban siempre, porque los verificadores acuñaban y no devolvían los
contadores. Aquí la limpieza resta **exactamente** lo que cada ejecución acuñó, y el resultado se
puede comparar sin excepciones que haya que explicar.

**Deriva entre bloques, declarada.** `integrity-843-after.json` → `integrity-844-before.json`
enseña `user_cards` 53 → 63. No es de este bloque: son **dos sobres que la cuenta demo abrió el
2026-09-09 a las 23:02:05 y 23:02:58**, cinco cartas cada uno. `card_reference` 12 → 13 y
`card_price_*` cambian por las verificaciones de la línea base que se ejecutaron al empezar — las
cuatro tablas derivadas que 8.4.1 §13 ya documenta como «siempre cambian».

---

## 14. Rendimiento

Medido contra el servidor en desarrollo (`next dev`), 5 repeticiones por operación:

| Operación | Primera pasada | Pasada final | Techo |
|---|---|---|---|
| Lectura del catálogo administrativo (25 filas) | 66,6 ms | **55,0 ms** | 1.200 ms |
| Ficha de un pool de 300 entradas | 84,8 ms | **60,6 ms** | 1.500 ms |
| Probabilidad de una carta en un sobre | 80,4 ms | **48,6 ms** | 1.500 ms |
| Apertura de sobre real (decide + acuña) | 82,0 ms | **63,0 ms** | 2.500 ms |
| Carga en frío del catálogo persistido (774 definiciones) | 51 ms | **38 ms** | 8.000 ms |
| Resolución de versión (20.000 resoluciones) | 0,25 µs/op | **0,20 µs/op** | — |

Las dos columnas son la misma medida antes y después de paginar las cuatro lecturas del §8.1: no
hay degradación, y la diferencia que se ve es ruido de un servidor de desarrollo calentando.

Sin regresión frente a lo registrado en 8.4.3 (ficha de 772 entradas: 4 consultas fijas;
simulación de 25.000 cartas: 286 ms). Paginar no añade una sola consulta mientras los conjuntos
quepan en una página, que es el caso hoy: el bucle sale en la primera vuelta.

---

## 15. Responsive y accesibilidad

Siete rutas administrativas, tres anchos, medidas una a una con
`Emulation.setDeviceMetricsOverride`:

| | 390 × 844 | 768 × 1024 | 1440 × 900 |
|---|---|---|---|
| Desbordamiento horizontal | ninguno | ninguno | ninguno |
| Controles bajo 44 px dentro de `[data-admin-panel]` | **0** | **0** | **0** |

Accesibilidad, en `/admin/pools/[id]` y `/admin/cartas/[id]/editar`: 0 controles sin nombre
accesible, 0 campos sin etiqueta, todas las tablas con `<caption>`, **0 `div` haciendo de botón**,
y los 12 primeros controles reciben foco por teclado.

Estados de la interfaz, comprobados de verdad y no leídos en el código:

| Estado | Cómo se provoca | Qué se ve |
|---|---|---|
| Carga | navegación normal | «Cargando el pool…», y **se apaga** (§7) |
| Error | `/admin/pools/no-existe-844` | «No se pudo cargar el pool» + «Volver al listado» |
| Vacío | buscar `zzzznoexiste844` | «Sin resultados» |
| Conflicto | dos administradores a la vez | «Otro administrador se ha adelantado» + revisión vigente + recargar |
| Validación | trío fuera de escala | *«stronghold está fuera de la escala 0-99 (llegó 500)»* |

Capturas en `docs/cards/qa/844/`.

---

## 16. Resultados

| Comprobación | Antes de empezar | Después |
|---|---|---|
| `content-e2e:verify` | — | **150 / 150** |
| `content-e2e:qa` | — | **88 / 90** — los 2 fallos son el P1-1 del §6 |
| `npm test` | 773 / 773 | **773 / 773** |
| `npm run typecheck` | **FAIL** (3 errores) | **PASS** |
| `npm run build` | — | **PASS** — 59 páginas, las 7 del panel incluidas |
| `content-catalog:verify` | 62 / 62 | 62 / 62 |
| `content-version:verify` | 66 / 66 | 66 / 66 |
| `content-pools:verify` | 73 / 73 | 73 / 73 |
| `admin-cards:verify` | 102 / 102 | 102 / 102 |
| `pools-admin:verify` | 60 / 60 | 60 / 60 |
| `pools-admin:qa` | **56 / 58** | **58 / 58** |
| `pack` · `collection` · `deck` · `craft` · `marketplace` · `economy` · `progression` | pasan | pasan |
| `audit:stability` | — | **105 comprobaciones · P0 0 · P1 0 · P2 9** — los mismos 9 que 8.4.3: el 401 de `/admin/*` sin sesión |

---

## 17. P0 / P1 / P2

### P0 — ninguno

Nada compromete la seguridad, la integridad ni la pérdida de contenido. La cadena servidor está
completa, el histórico es inmutable por disparador, y ningún cliente puede escribir en el plano de
contenido ni convertirse en administrador.

### P1

| id | Hallazgo | Estado |
|---|---|---|
| **P1-1** | **Una carta creada desde el panel es invisible para su dueño.** `/coleccion`, `/inventario`, `/mercado`, `/cuenta` y la portada resuelven con el catálogo COMPILADO y descartan en silencio lo que solo existe en `content_cards`. Medido: 35 ejemplares según el servidor, 0 casillas en la rejilla. | **ABIERTO** — cerrarlo es servir la colección desde el servidor, que el §29 prohíbe y que 8.2 dejó declarado como D-2 |
| **P1-2** | **El panel administrativo se tragaba todos los errores** en desarrollo: `useAsync` no rearmaba su `alive` y, con `reactStrictMode`, ni `setError` ni `setRunning(false)` volvían a ejecutarse. Un 404 de 83 ms se veía como un spinner eterno. | **CORREGIDO** |

### P2

| id | Hallazgo | Estado |
|---|---|---|
| **P2-1** | Truncado silencioso de PostgREST (`max_rows = 1000`) en cuatro lecturas: resumen de pool, filtro por pool del catálogo, `inspect` y `card_mints`. Latente: hoy no se puede disparar con 773 cartas. | **CORREGIDO** (`pageAll`) |
| **P2-2** | `pools-admin:qa` comparaba contra `53` ejemplares escrito a mano: 2 fallos permanentes ajenos al producto. | **CORREGIDO** |
| **P2-3** | `npm run typecheck` fallaba antes de empezar (3 errores en dos scripts sin commitear). | **CORREGIDO** |
| **P2-4** | `app_content_purge_card` es la única RPC mutadora que **no** escribe en `content_audit_log`. Hoy no la expone ninguna ruta —solo la usa la limpieza de los verificadores— pero borra una definición sin dejar rastro. | ABIERTO |
| **P2-5** | `previewSalvage` tasa un grupo entero con `copies[0].minted_version`; `salvageCards` cobra por ejemplar. Hoy no pueden divergir —la rareza sale de la variante, que es parte de la identidad— pero enseñar y cobrar usan criterios distintos. | ABIERTO |
| **P2-6** | `loadGameState`, `economy` y `duels` leen `user_cards` por usuario **sin paginar**: un jugador con más de 1.000 cartas se truncaría en silencio. `mastery.ts` ya lo pagina, así que es una inconsistencia, no un descuido de diseño. Fuera del plano de contenido. | ABIERTO |
| **P2-7** | `composeDistribution` marca `restringe` para un pool `MIXED` pero solo rellena `members` con los `EXPLICIT`: un sobre con los dos tipos dejaría fuera las cartas del `MIXED`. **No hay ningún pool `MIXED`**, así que la combinación no está ejercitada por nadie. | ABIERTO |
| **P2-8** | Quedan **3 cuentas `econ-*` con 5 ejemplares** de `economy:verify` (04 y 09 de septiembre). Es la deuda D-6 de 8.2, que 8.4.3 §18 dio por cerrada; el arreglo evita crear nuevas, pero no limpió las que ya había. | ABIERTO |
| **P2-9** | `audit:stability` cuenta **9 P2**, uno por cada `/admin/*` que responde 401 sin sesión. Es el guardia trabajando; el número es idéntico al de 8.4.3. | ABIERTO (heredado de 8.4.3) |

---

## 18. Deudas

1. **D-2 sigue abierta, y ahora tiene consecuencia visible.** El cliente renderiza desde el
   catálogo compilado. Hasta 8.4.2 eso significaba «estadísticas de hoy en vez de las de tu
   versión»; desde 8.4.2 significa **una carta invisible**. Es el P1-1 y es lo que impide declarar
   READY. Cerrarlo es un bloque: servir la colección desde el servidor.
2. **`useRosterStore` usa `localStorage` como fuente del catálogo del cliente** (`customPlayers`,
   `overrides`, `removed` → `rebuildCatalog`). Preexistente y ortogonal al plano de contenido,
   pero es exactamente lo que el §29 prohíbe introducir, y hoy ya está introducido.
3. **`user_cards.card_id` sigue sin clave ajena** contra `content_cards` (D-5 de 8.2).
   `v_content_card_orphans` sigue en 0, así que el camino está abierto.
4. **`variant.serialLimit` sigue en código y no se congela en la versión** (D-3 de 8.2). Se
   comprobó que las series respetan el límite (#1…#30 de 500), no que el límite sea estable.
5. **La banda antifraude del mercado sigue siendo ciega a la versión** (D-1 de 8.2). Publicar
   resincroniza `card_reference` —comprobado— pero `card_price_stats.avg_price` sigue agregando
   ejemplares de versiones distintas por `card_id`.
6. **Un pool no puede ENSANCHAR lo que un sobre reparte** (deuda 2 de 8.4.3). Deliberado mientras
   `PackDef` viva en código.
7. **Las migraciones 0037–0042 están aplicadas a mano.** Convención vigente del repositorio.
8. **No hay arte.** `public/players` y `public/teams` siguen vacíos; los 404 de retratos se
   admiten explícitamente en la QA.
9. **La cabecera global tiene dos controles bajo 44 px** (`GameShell`). Sale en todas las
   pantallas; las medidas se acotan a `[data-admin-panel]`.

---

## 19. Ficheros

**Nuevos**

```
scripts/content-e2e-verify.ts        150 comprobaciones · 23 familias · sobres reales
scripts/content-e2e-qa.ts             90 comprobaciones · navegador, sesión y sobres reales
src/server/db/pageAll.ts             lectura paginada contra el `max_rows` de PostgREST
docs/cards/BLOQUE-8.4.4-CONTENT-E2E.md
docs/cards/integrity-844-before.json
docs/cards/integrity-844-after.json
docs/cards/qa/844/*.png
```

**Modificados**

```
src/components/admin/cards/shared.tsx   useAsync rearma `alive` al montar        (P1-2)
src/server/services/adminPools.ts       el resumen del pool se lee paginado      (P2-1)
src/server/services/adminCards.ts       el filtro por pool se lee paginado       (P2-1)
src/app/api/admin/pools/route.ts        `inspect` devuelve la configuración entera (P2-1)
src/server/services/inventory.ts        `card_mints` se lee paginado             (P2-1)
scripts/pools-admin-qa.ts               la línea base se mide, no se escribe     (P2-2)
scripts/admin-cards-verify.ts           typecheck                                (P2-3)
scripts/content-version-qa.ts           typecheck                                (P2-3)
package.json                            content-e2e:verify · content-e2e:qa
```

---

## 20. Cómo reproducirlo

```bash
npx supabase start                       # 54521, con Docker Desktop en marcha
npx next dev -p 3005                     # o npm run build && npx next start -p 3005

export BASE_URL=http://127.0.0.1:3005 E2E_BASE_URL=http://127.0.0.1:3005

npm run content-e2e:verify               # 150/150
npm run content-e2e:qa                   # 88/90 — los 2 fallos son el P1-1
npm test                                 # 773/773
npm run typecheck                        # PASS
npm run build                            # PASS

npm run content-catalog:integrity -- --compare \
  docs/cards/integrity-844-before.json docs/cards/integrity-844-after.json
```

---

## 21. Decisión final

**BLOQUE 8.4.4 — NOT READY.**

La cadena que el §30 exige demostrar está demostrada, entera, con sobres reales:

```
ADMIN CREA CARTA        ✅   PUBLICA                    ✅
AÑADE AL POOL           ✅   CONFIGURA PESO             ✅
PACK REAL LA SACA       ✅   MINT REAL                  ✅
INSTANCIA CONGELADA     ✅   ADMIN PUBLICA NUEVA VERSIÓN ✅
LA ANTIGUA NO CAMBIA    ✅   NUEVO MINT USA LA NUEVA    ✅
AMBAS SIGUEN RESOLVIENDO ✅  RETIRED BLOQUEA DROPS      ✅
HISTÓRICO SIGUE FUNCIONANDO ✅
```

Y aun así el bloque no se cierra, porque el §30 pide **P1: 0** y queda uno: la carta que el
administrador acaba de crear y que un jugador acaba de conseguir **no aparece en su colección**.
Está en su cuenta, vale lo que tiene que valer, se puede jugar y se puede vender por el servidor
—pero la pantalla no la enseña—. Declararlo READY exigiría reclasificar ese P1 como P2, que es
exactamente lo que el §27 prohíbe.

El trabajo que falta está acotado y nombrado: **servir el catálogo de la colección desde el
servidor**, cerrando D-2. Es un bloque, no un parche, y no cabe en las restricciones del §29.
