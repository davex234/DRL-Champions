# BLOQUE 8.3 — Pools de cartas, distribución de sobres y sorteo ponderado

> **Estado: READY.** H-3 y H-4 cerrados. 378 aperturas comparadas contra el motor anterior,
> **0 divergencias**. **Sin commit, sin push, sin deploy.**

---

## 0. Resumen ejecutivo

La probabilidad por carta ya existe, es administrable desde base de datos, y **el sorteo no
ha cambiado**.

Antes de este bloque la pertenencia de una carta a un sobre no estaba declarada en ningún
sitio: se *deducía* evaluando `isEligible()` contra las 772 cartas (H-4), y dentro de un
bucket todas las cartas eran igual de probables (H-3). Ahora la pertenencia es una fila, el
peso es una columna, y «¿en qué sobres sale esta carta?» es un `select`.

**Lo que cambia del motor: una línea.** `rng.pick(candidates)` pasa a
`pickWeighted(candidates, weightOf, rng)`. Y no es una sustitución aproximada:

```
rng.pick(arr)  =  arr[ floor( next() · n ) ]

pickWeighted, con wᵢ = 1:
  total = n ; roll = next()·n ; primer i con roll < i+1
  ⟺ next()·n < i+1  ⟺  i = floor( next()·n )                          ∎
```

Misma aritmética, **misma tirada consumida**. Comprobado sobre el generador real en 12.000
casos: mismo elemento y mismo estado del RNG después.

**Tres hallazgos que este bloque destapó y corrigió**, todos ellos de bloques anteriores:

1. **La prueba de determinismo de 8.1 y 8.2 solo recorría el camino fácil.** Ningún sobre
   real usa `pity`, `guarantees`, `antiDuplicate`, `repeatable:false`, `pool`,
   `allowedVariants`, `excludeVariants`, `series` ni `serializedOnly`. La rama `filtered()`,
   la de pity y las cuatro políticas anti-duplicado **nunca se habían comparado**. 8.3 añade
   15 sobres sintéticos que las recorren todas.
2. **Editar una carta no invalidaba la caché del catálogo del servidor** (fallo de 8.2). Un
   administrador retiraba una carta, la base de datos decía `RETIRED`, y el proceso seguía
   sirviéndola indefinidamente. Lo destapó la QA de 8.3 al abrir sobres contra un servidor
   real; no se vio en 8.2 porque sus comprobaciones llamaban a `resetServerCatalog()` antes
   de mirar — se saltaban justo la parte rota.
3. **La huella del catálogo usaba un byte NUL invisible como separador**, imposible de
   reproducir en SQL (`text` no admite NUL). Al calcular la misma huella del otro lado para
   invalidar la caché, se comparaban dos números que no podían coincidir nunca.

**Y una corrección a mis propios informes**: hay **12 sobres**, no 13. Los informes de 8.1 y
8.2 dicen «13 sobres» en la etiqueta; el cálculo (60 aperturas = 12 × 5) siempre fue
correcto.

---

## 1. Auditoría del motor (Fase 1)

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Dónde se construye cada pool? | `buildPool(registry, pack)` en `domain/packs/pool.ts`. Recorre `registry.cards` y filtra con `isEligible`. Cacheado en `WeakMap<CardRegistry, Map<packId, BuiltPool>>`. |
| 2 | ¿Cómo se decide la elegibilidad? | `isEligible()`: `pack.pool`, `allowedVariants`, `excludeVariants`, `restrictGroups`, `serializedOnly`, `series`, `restrictRegion`/`region`. |
| 3 | ¿Cómo se ordenan las cartas? | **No se ordenan**: se conserva el orden de `registry.cards`, que es `content_cards.ordinal` (8.1). |
| 4 | ¿Cómo se selecciona por índice? | `rng.pick(arr) = arr[Math.floor(next() * arr.length)]`. **Aquí vive la probabilidad por carta.** |
| 5 | ¿Dónde se aplica el azar? | Dos puntos por hueco: `rollBucket` (bucket) y `rng.pick` (carta). Y uno más en `resolveAntiDup` cuando reemplaza. |
| 6 | ¿Cómo se usan las semillas? | `makeRng(ctx.seed)`, mulberry32. Un solo generador por apertura; **el consumo importa**. |
| 7 | ¿Cómo se aplican las garantías? | `slotRequirements()` asigna requisitos a los ÚLTIMOS huecos; `guaranteedMin` al último. Elevan `minIdx`. |
| 8 | ¿Y el anti-duplicado? | `resolveAntiDup` tras elegir: `allow`, `compensate`, `avoid`, `replace`, `upgrade`. |
| 9 | ¿Qué depende de la rareza? | `bucketForRank(variant.rank)` → bucket; `pack.weights` por bucket; `minIdx` de garantías y pity. |
| 10 | ¿Qué depende de la variante? | Rareza, grupo, serie, `serialized`, `serialLimit`, `statBoost`. Todo vía `registry.variant()`. |
| 11 | ¿Qué depende del ciclo de vida? | Desde 8.2, el registro de sorteo solo lleva `PUBLISHED` (`DROPPABLE_LIFECYCLES`). |

**Estado medido de los 12 sobres:** ninguno usa pity, garantías, anti-duplicado, no-repetible
ni restricciones de pool/variante/serie. Solo `restrictGroups` (3 sobres) y
`restrictRegion` (4). Pools: 772 / 744 / 204 / 182 / 197 / 189 según el sobre.

---

## 2. Probabilidad multicapa (Fase 4)

**La estructura ya existía; no se ha inventado ninguna.** Auditado en `openPack.ts`:

```
PACK ──► SLOT      requisitos del hueco (garantías, guaranteedMin, pity) → minIdx
      ──► BUCKET   P(bucket) = pack.weights[b] renormalizado sobre los buckets
                   CON STOCK e índice ≥ minIdx                    ← `rollBucket`
      ──► CARD     HOY:  1 / |candidatos|                          ← `rng.pick`  (uniforme)
                   8.3:  weight(carta) / Σ pesos del bucket        ← `pickWeighted`
```

Es exactamente `P(rareza) × P(carta | rareza)`. **La capa de bucket se conserva intacta**:
ni un peso de `pack.weights` se ha tocado, ni la renormalización sobre buckets con stock.

Se descartó una capa `SLOT → POOL` adicional: los requisitos por hueco ya seleccionan
subconjuntos (`filtered()`), y añadir un pool por hueco sería una tercera autoridad de
elegibilidad para un caso que nadie ha pedido.

---

## 3. Modelo de datos

### Lo que **no** se ha movido a base de datos

`PackDef` sigue en `src/data/packs.ts`: precio, `cardCount`, pesos por bucket, garantías,
pity, anti-duplicado, `retired`, arte. El encargo es explícito —*«sustituir únicamente la
FUENTE DE CONFIGURACIÓN DEL POOL»*— y migrar además las reglas del sobre sería cambiar las
reglas del juego, no quién controla el contenido.

### `content_pools` — el conjunto elegible con nombre

`id` · `name` · `mode` (`RULE` | `EXPLICIT` | `MIXED`) · `rules jsonb` (mismo vocabulario que
`PackDef`, no uno nuevo) · `lifecycle` (`DRAFT` | `ACTIVE` | `RETIRED`) ·
`available_from`/`available_to` · `season_id` · `event_id` · `revision` · `checksum` ·
auditoría.

### `content_pool_entries` — pertenencia y peso, y nada más

PK `(pool_id, card_id)` → **los duplicados son imposibles por esquema**.
`weight numeric(12,4) check (weight > 0 and weight <= 1000000)`.
`mode` (`INCLUDE` | `EXCLUDE`).
**FK real a `content_cards`** — la primera del plano de contenido: un pool es configuración
nueva, no historia heredada, así que no arrastra el caso que impidió la FK en `user_cards`.

**No llevan `ordinal`**, y es la decisión más importante del esquema (§5).

### `content_pack_pools` — sobre ↔ pool

`pack_id text` **sin FK** (los sobres siguen en código; se valida contra `PACKS` en el
servidor) · `pool_id` · `priority` · `enabled`. Muchos-a-muchos, porque el encargo pide las
dos direcciones.

### `content_distribution_version` — una fila, un entero

Mismo patrón que `content_catalog_version`. Sube en la MISMA transacción que cualquier
cambio (`_bump_distribution`).

### `v_pool_health` — diagnóstico

Por pool: includes, excludes, **includes que apuntan a cartas no publicadas**, peso total y
número de sobres.

---

## 4. Pesos y probabilidad efectiva (Fase 3)

Los pesos son **relativos**. El administrador escribe 10 / 20 / 5 y el sistema calcula
28,571 % / 57,143 % / 14,286 %. No hay que cuadrar una suma a 100 — que es justamente el
error clásico de estos sistemas: publicar una tabla que suma 97 y no verlo.

`effectiveProbabilities()` calcula la distribución **en el servidor**, y `/api/admin/pools`
la expone (`action: "odds"`) descompuesta en las dos capas reales, con `P(bucket)`
renormalizado sobre buckets con stock. La regla del proyecto desde los bloques PvP: la
interfaz muestra, no calcula.

Un peso no válido (0, negativo, `NaN`, `Infinity`) se trata como 1 en vez de propagarse. Sin
eso, un `Infinity` dejaría a todas las demás cartas en probabilidad cero **en silencio**. La
base de datos además lo impide con un `CHECK`; esto es la segunda puerta.

---

## 5. Orden y determinismo (Fase 6)

> **Las entradas de pool NO llevan orden. Es deliberado.**

El bloque 8.1 descubrió por las malas que el motor elige por índice, así que el orden del
pool forma parte del resultado. La lista de candidatos la sigue construyendo `buildPool`
recorriendo el catálogo por `content_cards.ordinal` — **la única autoridad de orden que
existe, y ya demostrada**. Un `ordinal` en las entradas sería una segunda autoridad, y dos
autoridades de orden es exactamente cómo se rompe un sorteo determinista.

Las entradas aportan **pertenencia** y **peso**. El pool puede cambiar *quién* está y
*cuánto pesa*; nunca *en qué posición*.

Comprobado explícitamente (familia 2 del verificador): para los 12 sobres, la lista de
candidatos con pools persistidos es **la misma y en el mismo orden** que sin ellos —
comparada como cadena unida, no como conjunto.

---

## 6. Migración y determinismo (Fase 5)

`content-pools:migrate` convierte la deducción en filas: **un pool por sobre, con la lista
explícita de las cartas hoy elegibles y peso 1**. Ejecuta la MISMA función del motor
(`buildPool`), no una reimplementación de la elegibilidad.

`12 pools · 6.864 entradas · peso 1 en todas`. Es configuración, no tráfico: no crece con
los jugadores ni con las aperturas.

Se eligió **explícito** en vez de reglas: un pool `RULE` que repitiera
`restrictGroups`/`restrictRegion` sería más corto pero dejaría la pertenencia otra vez
deducida —ahora en dos sitios— y H-4 seguiría abierto.

### La prueba de 0 divergencias

| | |
|---|---|
| Sobres | **27** — los 12 reales + **15 sintéticos** |
| Semillas | 7 (`1, 7, 42, 1337, 987654321, 2³⁰, 123456`) |
| Estados de jugador | 2 (sin cartas / con 400 poseídas, para forzar anti-duplicado) |
| **Aperturas comparadas** | **378** |
| **Divergencias** | **0** |

Se compara la firma completa: `cardId`, `serial`, `bucket`, `byPity`, `isNew`, `value`,
`origin` de cada carta, más `pityAfter` y `mintDelta`.

**Los 15 sobres sintéticos existen porque los reales no bastaban.** Cubren `guaranteedMin`,
garantías por bucket / por grupo / por serializada, pity, las cuatro políticas
anti-duplicado, `repeatable:false`, `serializedOnly`, `restrictGroups`, `excludeVariants`,
`series` y `cardCount: 1`. Sin ellos, la ruta `filtered()` y la rama de pity nunca se habrían
comparado — como ocurrió en 8.1 y 8.2.

---

## 7. Ciclo de vida y versiones (Fases 7 y 8)

**Cartas.** La separación de 8.2 se conserva y ahora se apoya en ella:

| Estado | ¿Existe? | ¿Puede tocarme en un sobre? |
|---|---|---|
| `DRAFT` / `REVIEW` / `APPROVED` | no (no resoluble) | **no** |
| `PUBLISHED` | sí | **sí**, si está en un pool activo |
| `RETIRED` | **sí** — colección, mazos, mercado, desguace, partidas | **no** |

Comprobado en QA con una carta retirada en caliente: desaparece de los sobres nuevos y
siguen funcionando colección, inventario, mercado, mazo, duelo en curso y PvP.

**Pools.** `DRAFT` → `ACTIVE` → `RETIRED`, con transiciones validadas. Activar exige que
todas las entradas `INCLUDE` apunten a cartas `PUBLISHED`, y que un pool `EXPLICIT` no esté
vacío.

**¿Qué versión referencia un pool? Ninguna: referencia la CARTA.** Un pool responde «¿qué
puede tocarme AHORA?», y lo que toca ahora es la definición vigente. Anclarlo a una versión
haría que los sobres repartieran cartas obsoletas tras cada edición. La congelación ocurre
donde debe: **al acuñar**, con el trigger de 8.2 que sella `minted_version`.

---

## 8. Publicación consistente (Fase 11)

**Una apertura no puede observar una configuración a medias**, y se garantiza por
construcción, no por temporización:

1. **Toda mutación es una RPC transaccional.** `set_entries` reemplaza el conjunto ENTERO en
   vez de aceptar altas y bajas sueltas: una secuencia de operaciones parciales tiene estados
   intermedios observables, y el estado intermedio de un pool es una distribución de
   probabilidad que nadie quiso publicar.
2. **La versión sube en la misma transacción** (`_bump_distribution`). No puede existir un
   estado donde las entradas cambiaron y la versión no.
3. **La lectura es una sola llamada**: `app_content_distribution_snapshot()` devuelve pools,
   entradas, vínculos y versión desde una única transacción. Con tres consultas separadas por
   PostgREST se podría componer una configuración *que nunca existió* — los pools de antes con
   las entradas de después.

---

## 9. Caché e invalidación (Fase 12)

Tres capas, y las tres se cierran:

| Capa | Cómo se invalida |
|---|---|
| Distribución en memoria | Versión comprobada cada ≤ 5 s; recarga si subió |
| Pool cacheado del motor | **La clave de caché lleva la configuración**: `${pack.id}@${dist.key}`. Un pool nuevo produce una clave nueva; el viejo no se puede reutilizar por descuido |
| Catálogo en memoria | `content_catalog_version`, ahora sí actualizada por las ediciones (§10) |

Y un acoplamiento que hubo que resolver a propósito: **catálogo y distribución se cachean por
separado y cambian por separado**. Si el motor capturase el objeto de distribución al
construirse, publicar un pool no le llegaría hasta que cambiara el catálogo. Por eso lee
`currentDistribution()` en cada apertura.

**Demostrado en QA sin reiniciar nada**: se cambia el pool, se esperan los 5 s del TTL, y el
sobre siguiente entrega solo la carta nueva.

---

## 10. El fallo de 8.2 que encontró este bloque

`app_content_publish_version` y `app_content_set_lifecycle` (0038) **no tocaban
`content_catalog_version`**. Consecuencia medida:

```
admin retira una carta  →  la BD dice RETIRED
                        →  el proceso que sirve el juego la sigue creyendo publicada,
                           indefinidamente
```

Es el escenario que la Fase 12 prohíbe, aplicado al catálogo. **No se vio en 8.2** porque sus
comprobaciones llamaban a `resetServerCatalog()` antes de mirar: la verificación se saltaba
justo la parte que fallaba. La QA de 8.3, que abre sobres contra un servidor real, lo destapó
a la primera.

**Corregido** en `0039 §9`: las dos RPC se redefinen añadiendo `_bump_catalog()` en la misma
transacción. Y **con trinquete** en el verificador, que comprueba el número —no el objeto en
memoria— al retirar y republicar.

### Y el separador invisible

`catalogChecksum()` usaba un **byte NUL** como separador —invisible en cualquier editor—.
Funcionó hasta que 8.3 necesitó calcular la misma huella en SQL para invalidar la caché:
PostgreSQL no admite NUL dentro de un `text`, así que era imposible de reproducir. Se
comparaban dos números que no podían coincidir nunca.

Corregido: separador explícito (` `), documentado, y ordenación `collate "C"` en SQL para
que coincida con la comparación de cadenas de JavaScript (`_` y `-` no ordenan igual en la
colación por defecto, y los `card_id` llevan los dos).

---

## 11. Mercado — D-1 (Fase 13)

**El mecanismo exacto de la deuda**: `_check_price_band` llama a `_price_anchor(card_id)`,
que devuelve `card_price_stats.avg_price` y, en su defecto, `card_reference.fair_value`. Esa
segunda tabla la poblaba un endpoint a mano. Publicar una versión cambiaba el OVR —y por
tanto `marketValue`— sin tocarla: a partir de ahí la banda de precio se calculaba contra un
ancla obsoleta.

**Resuelto**: publicar una versión recalcula el `fair_value` de esa carta con la MISMA función
que usa el mercado (`marketValue`), en la misma petición. **No se ha cambiado ninguna regla
del mercado**: la banda, los multiplicadores y las RPC siguen intactos; lo único que cambia
es que el número que leen deja de estar viejo. Es idempotente y se autocorrige.

**Lo que NO se ha “arreglado”, porque no está roto**: si la carta tiene historial de ventas,
el ancla sigue siendo `avg_price`, y eso es correcto por diseño — un ancla de mercado debe
decir lo que la carta vale en el mercado, no lo que el catálogo cree. Que ese precio medio
agregue ejemplares de versiones distintas es una propiedad del modelo de mercado (los
listados se indexan por `card_id`, no por versión); separarlo exige cambiar el esquema del
mercado. **Deuda D-1b, declarada para 8.4.**

Comprobado en QA: se borra el ancla, se publica una versión, y la fila reaparece con el OVR
nuevo y el `fair_value` que devuelve la API.

---

## 12. Economía (Fase 14)

Nada tocado: precios de sobres, `marketValue`, `instanceValue`, `salvageValue`,
`quickSellValue`, libro mayor y recompensas siguen idénticos. Los verificadores `economy`,
`marketplace`, `craft`, `loop`, `progression` y `events` pasan sin cambios.

---

## 13. Seguridad (Fases 15 y 18)

Cuatro capas, ninguna confía en el cliente: middleware → `verifyAdmin` → RPC `security
definer` revocadas → constraints de tabla. **El actor sale del token**, nunca del cuerpo.

| Prueba | Resultado |
|---|---|
| `anon` / `authenticated` leer las 4 tablas | denegado `42501` (8 pruebas) |
| `anon` / `authenticated` invocar las 4 RPC | denegado `42501` (8 pruebas) |
| API sin sesión | 401 |
| API con usuario normal | 401 |
| API suplantando `actor` / `role` / `is_admin` | 401 |
| API con admin válido | 200 |
| peso 0 / negativo / enorme (`1e12`) | rechazado |
| carta inexistente / pool inexistente / sobre inexistente | rechazado |
| entrada duplicada | rechazada |
| pool `EXPLICIT` vacío → `ACTIVE` | rechazado |
| pool con cartas no publicadas → `ACTIVE` | rechazado |
| transición ilegal (`DRAFT` → `RETIRED`) | rechazada |
| cambio sin motivo | rechazado |
| el pool real sigue intacto tras los intentos | sí |

---

## 14. Tests, QA y regresión (Fases 16, 17, 19, 21)

| | Resultado |
|---|---|
| `npm test` | **766/766** — sin tocar ni una prueba |
| `npm run typecheck` | limpio |
| `npm run build` | compila; `/api/admin/pools` registrada |
| `content-pools:verify` | **73/73** |
| `content-pools:qa` | **31/31** |
| `content-catalog:verify` (8.1) | **62/62** |
| `content-catalog:qa` (8.1) | **33/33** |
| `content-version:verify` (8.2) | **66/66** |
| `content-version:qa` (8.2) | **28/28** |
| `audit:stability` (producción) | 105 comprobaciones · **P0 = 0 · P1 = 0 · P2 = 0** |

**Verificadores de regresión en verde**: `pack`, `collection`, `deck`, `content`, `economy`,
`security`, `craft`, `marketplace`, `telemetry`, `analytics`, `operations`, `loop`,
`progression`, `events`, `duel-gameplay`, `duel-balance`, `card-generator`, `materializer`,
`catalog-builder`, `publisher`, y los ocho de PvP (573 comprobaciones).

### Comprobación matemática (Fase 16)

| Caso | Resultado |
|---|---|
| 10 / 20 / 5 | 28,571 % · 57,143 % · 14,286 % — al dígito |
| 1 / 1 | 50 % · 50 % |
| 1 / 2 | 33,333 % · 66,667 % |
| 1 / 100 | 0,990 % · 99,010 % |
| una sola carta | 100 % |
| 500 entradas iguales | 0,200 % cada una |
| 37 pesos 1..37 | suman 1 (±1e-12) |
| peso negativo / infinito | tratado como 1; no envenena la distribución |
| pool vacío | lanza, no devuelve `undefined` |

### Simulación estadística (Fase 17)

400.000 tiradas con pesos 10/20/5/1/64: error relativo máximo **0,64 %** (tolerancia 5 %).
Declarado explícitamente como **sanidad**, no como sustituto de la comprobación determinista.

### QA real (Fase 19)

Con servidor de producción y cuentas reales: crear pool → añadir cartas → pesos 10/20/5 →
publicar → vincular → **abrir 60 sobres reales** (solo entregan las 3 cartas configuradas;
observado 26,3 / 57,7 / 16,0 frente a 28,6 / 57,1 / 14,3) → modificar → republicar →
**invalidación de caché sin reiniciar** → retirar una carta → fuera de nuevos drops mientras
colección, inventario, mercado, mazo, duelo en curso y PvP siguen funcionando → D-1.

Datos de prueba: cuentas borradas, pools borrados, vínculos restaurados, definiciones
restauradas, anclas de prueba eliminadas. **Estado final: 53 instancias · 773 cartas · 12
pools · 6.864 entradas · 12 vínculos · 0 huecos · 0 huérfanas.**

---

## 15. Integridad ANTES / DESPUÉS

| RECURSO | 8.2 | 8.3 | DIF | ESTADO |
|---|---:|---:|---:|---|
| `user_cards` | 53 | 53 | +0 | **intacta, huella idéntica** |
| `duel_decks` · `market_listings` · `market_offers` | 1 · 1 · 0 | iguales | +0 | intactas |
| `user_packs` · `duel_matches` | 10 · 4 | iguales | +0 | intactas |
| `content_players` · `content_cards` · `content_card_versions` | 379 · 773 · 773 | iguales | +0 | sin cambios |
| `content_pools` / `_entries` / `_pack_pools` | — | 12 / 6.864 / 12 | — | materializadas |
| `card_mints` | 43 | 48 | +5 | ver nota ¹ |
| `card_reference` | 0 | 0 | +0 | ver nota ² |
| `card_price_stats` / `_daily` | 1 / 5 | 1 / 5 | +0 | ver nota ¹ |

```
[PASS] NO USER CARD LOST · NO CARD ID LOST · NO DECK BROKEN · NO MARKET REFERENCE BROKEN
```

**¹** `card_mints`: **0 perdidas**, 5 nuevas — cartas salidas de los sobres que abre la QA.
Contador global de seriales que **por diseño no se decrementa**. `card_price_*`: mismos
`card_id`, valores movidos por la venta real que ejecuta `economy:verify`.
La migración de 8.3 **no contiene ni un `insert` ni un `update`** sobre esas tablas.

**²** `card_reference` acabó con 5 filas de las publicaciones de prueba —**D-1 funcionando**—
que quedaron con el OVR editado después de que la limpieza restaurara las cartas. Se
eliminaron: el ancla vuelve a 0 filas, como estaba. Queda anotado como deuda D-4: una
restauración de definición debería re-sincronizar su ancla.

---

## 16. Rendimiento (Fase 20)

| Medida | Resultado |
|---|---|
| Cargar la distribución completa | **54 ms** (12 pools · 6.864 entradas, **una** llamada) |
| Segunda llamada | **0 ms** (caché) |
| 2.000 aperturas sin pools | 310 ms |
| 2.000 aperturas con pools | 474 ms |
| Coste por apertura | **0,237 ms** — el pool sigue cacheado, O(1) |
| Invalidación | la versión sube y la siguiente lectura la ve |

El sobrecoste (~1,5×) es el `pickWeighted` recorriendo la lista para sumar pesos, frente a un
acceso directo por índice. Sobre 0,24 ms por apertura es irrelevante; si algún día lo fuera,
la optimización evidente es cachear la suma de pesos junto al pool.

---

## 17. Deudas restantes

| id | Deuda | Por qué no ahora |
|---|---|---|
| **D-1b** | La banda antifraude sigue anclada por `card_id`, no por versión, cuando la carta tiene historial de ventas. | Es una propiedad del modelo de mercado (los listados se indexan por `card_id`). Separarlo exige cambiar el esquema del mercado, que el encargo pide no tocar. **8.4.** |
| **D-2** | Un pool solo puede **estrechar y reponderar**, no ensanchar más allá de las restricciones del `PackDef`. | Mientras `PackDef` viva en código, sus restricciones son la única barrera que impide que una configuración administrativa contradiga lo que el sobre dice ser. Ensanchar exige que el sobre entero sea administrable. **8.4.** |
| **D-3** | El anti-duplicado reemplaza **uniformemente** entre las candidatas frescas, sin aplicar pesos. | Es una corrección, no un sorteo, y ya se desvía de la distribución por diseño. Aplicar pesos ahí exige cambiar la firma de `antidup.ts` — cirugía del motor sin necesidad demostrada. |
| **D-4** | Restaurar una definición (fixture de prueba) no re-sincroniza su `card_reference`. | Solo afecta a caminos de prueba: en producción una definición no «se restaura», se publica una versión nueva —y esa sí sincroniza. Un `sync-reference` lo corrige. |
| **D-5** | `economy:verify` y `pvp-rating-settlement:verify` **no borran sus cuentas de prueba**. | Preexistente (D-6 de 8.2). Ensucia las mediciones de integridad; se limpiaron las de esta sesión (19 cuentas). |
| **D-6** | La migración 0039 se aplica **a mano con `psql`**, como 0026-0038. | Convención vigente del repositorio. |
| **D-7** | No hay UI de pools ni editor visual. | Es 8.4. `/api/admin/pools` es la superficie de servicios mínima para configurar, verificar y probar. |
| **D-8** | `content_pool_entries` guarda 6.864 filas para reproducir lo que `isEligible` deduce. | Es el precio de cerrar H-4: la pertenencia declarada se puede consultar; la deducida no. Un pool `RULE` sería más corto y dejaría la pregunta sin respuesta. |

---

## 18. Criterio READY

| # | Criterio | |
|---|---|---|
| 1 | modelo persistente de pools | ✅ 3 tablas + versión |
| 2 | los packs usan pools persistidos | ✅ 12 de 12 |
| 3 | una carta en varios pools | ✅ `benjy__silver` en 9 |
| 4 | pesos relativos | ✅ 10/20/5 → 10/35, 20/35, 5/35 |
| 5 | probabilidades correctas | ✅ 11 casos matemáticos + simulación |
| 6 | las cartas draft no aparecen | ✅ |
| 7 | las retiradas no aparecen en nuevos drops | ✅ y siguen resolviéndose |
| 8 | instancias históricas intactas | ✅ 53 → 53, huella idéntica |
| 9 | determinismo conservado | ✅ **378 aperturas, 0 divergencias** |
| 10 | orden/ordinal conservado | ✅ comprobado como cadena, no como conjunto |
| 11 | garantías funcionan | ✅ 4 sobres sintéticos |
| 12 | pity funciona | ✅ sobre sintético con pity |
| 13 | anti-duplicado funciona | ✅ las 4 políticas |
| 14 | la caché funciona | ✅ 3 capas, invalidación demostrada en caliente |
| 15 | publicación consistente | ✅ transaccional + lectura atómica |
| 16 | sin estados parcialmente publicados | ✅ |
| 17 | seguridad server-side | ✅ 4 capas |
| 18 | RLS correcta | ✅ 16 pruebas `42501` |
| 19 | D-1 resuelta o encauzada | ✅ resuelta la parte rota; D-1b declarada |
| 20 | tests matemáticos pasan | ✅ |
| 21 | test estadístico pasa | ✅ error máx. 0,64 % |
| 22 | migración con 0 divergencias | ✅ |
| 23 | QA real pasa | ✅ 31/31 |
| 24 | rendimiento aceptable | ✅ 0,237 ms/apertura |
| 25 | no P0 | ✅ |
| 26 | no P1 nuevo | ✅ |
| 27 | **no commit** | ✅ |
| 28 | **no push** | ✅ |
| 29 | **no deploy** | ✅ |

---

## 19. Cómo reproducirlo

```bash
npx supabase start
npm run build && npx next start -p 3005

docker cp supabase/migrations/0039_card_pools.sql supabase_db_DRLCards:/tmp/0039.sql
docker exec supabase_db_DRLCards psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/0039.sql

npm run content-pools:migrate           # --dry-run para verlo sin escribir
BASE_URL=http://127.0.0.1:3005 npm run content-pools:verify
BASE_URL=http://127.0.0.1:3005 npm run content-pools:qa
```

**Reversión**: la cabecera de `0039_card_pools.sql` la documenta. Sin pools activos el motor
vuelve solo a la elegibilidad de `PackDef` y al sorteo uniforme — el comportamiento exacto
anterior a este bloque. Ni una fila de `user_cards`, `card_mints`, `content_cards` o
`content_card_versions` se toca.
