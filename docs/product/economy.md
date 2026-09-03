# LA ECONOMÍA DE NEXUS

> Fuentes, sumideros, libro mayor, idempotencia, duplicados y modelo de monetización.
>
> Estado: **Fase 12**. Verificado por `npm run economy:verify` (61 comprobaciones contra la
> base de datos real), medido por `npm run economy:model` (20.000 aperturas por sobre con el
> motor real) y modelado por `npm run economy:simulate` (7 / 30 / 84 días).
>
> **La Fase 12 corrigió una medición de la Fase 11.** La ratio «7–15×» que aparecía en §6
> medía `instanceValue`, no `marketValue`. La decisión que se tomó con ella seguía siendo la
> correcta; la alarma sobre el ancla del mercado, no. Está todo en §6.
>
> **No hay pasarela de pago** (§12) y **no se venden créditos**. El porqué está abajo, con
> las cifras que lo sostienen.

---

## 1 · LAS TRES MONEDAS

| Moneda | Qué es | Quién la escribe | Sumidero |
|---|---|---|---|
| **DRL Credits** (`profiles.credits`) | La moneda principal | Solo el servidor, y **solo** por `_ledger_apply` | Sobres · comisión del mercado |
| **Fichas de evento** (`profiles.tokens`) | Moneda blanda | Solo el servidor | Carril de aspecto del pase (1.200) |
| **Puntos competitivos** (`profiles.points`) | **No es moneda: es una puntuación.** No se gasta | `app_score_pickem_event` y `app_grant_reward` | — |

Las tres están cerradas al cliente por el trigger guardián de `profiles` (0012): un
`UPDATE` desde el navegador se rechaza con `SEC-02`.

---

## 2 · EL LIBRO MAYOR

`public.credit_transactions`. Una fila por movimiento, con el saldo resultante.

```
id · user_id · delta · reason · ref · balance_after · kind · counterparty_id · created_at
```

**Responde a las seis preguntas** que la Fase 11 exige:

| Pregunta | Columna |
|---|---|
| ¿De dónde salieron? | `reason` (`starter_grant`, `duel_win`, `pickem_reward:analista`, `market_sell:…`, `salvage`…) |
| ¿Dónde se gastaron? | `reason` (`buy_pack:premium`, `market_buy:…`, `market_fee`) |
| ¿Quién los recibió? | `counterparty_id` |
| ¿Cuándo? | `created_at` |
| ¿Por qué? | `ref` — la operación exacta que los movió |
| ¿Cuánto? | `delta`, y `balance_after` para auditar sin recorrer |

**Es completo desde el minuto cero:** `handle_new_user` escribe el asiento `starter_grant`
con los 6.000 iniciales, así que **la suma de todos los deltas ES el saldo**. Lo comprueba
`economy:verify` sobre una cuenta real.

**`kind`** (Fase 11) distingue `credit` · `debit` · `transfer_in` · `transfer_out` ·
`reversal`. Una venta en el mercado son **tres** asientos: cargo al comprador
(`transfer_out`), abono al vendedor (`transfer_in`) y comisión (`debit`).

**Una sola puerta.** `_ledger_apply` es el único sitio del sistema que escribe
`profiles.credits`. Antes cada RPC hacía su propio `update`, y las del mercado (0004) ni
siquiera dejaban asiento.

---

## 3 · IDEMPOTENCIA

`public.economy_ops(ref, user_id, kind, result, created_at)` no guarda solo *que* algo
pasó: guarda **qué devolvió**. Por eso un reintento responde lo mismo en lugar de fallar o
de ejecutar otra vez.

| Operación | Clave | Estado |
|---|---|---|
| Recompensa (duelo, Pick'em, pase, logro) | `duel:<id>` · `pickem:<ev>:<escalón>` · `pass:…` | ✅ desde la Fase 10 |
| **Comprar sobre** | `pack:buy:<user>:<gesto>` | ✅ **Fase 11** — antes era opcional y el cliente no la enviaba nunca |
| **Abrir sobre** | `pack:open:<user>:<gesto>` | ✅ **Fase 11** — antes no tenía ninguna |
| **Comprar y abrir** | mismo gesto para las dos mitades | ✅ **Fase 11** |
| **Desguace** | `salvage:<user>:<gesto>` | ✅ **Fase 11** |
| **Publicar / comprar en el mercado** | `market:list:…` · `market:buy:…` | ✅ **Fase 11** |

### El fallo que esto arregla

Antes de la Fase 11, `buy_and_open` reintentado **saltaba la compra** (por su clave) y
**volvía a abrir** (sin clave): el jugador pagaba un sobre y perdía dos. Ahora las dos
mitades derivan del mismo gesto y un reintento devuelve **las mismas cartas**.

---

## 4 · FUENTES DE CRÉDITOS

### Una vez por temporada (84 días)

| Fuente | Créditos |
|---|---|
| Saldo inicial | 6.000 |
| Carril libre del pase (30 niveles) | 15.900 + 6 sobres |
| Carril competitivo (6 niveles, se abre en Oro) | 26.000 + 6 sobres |
| Misiones de temporada y de hito (6) | 9.500 |
| Logros permanentes (7) | 67.500 |
| **Total no repetible** | **124.900** |

El carril de **aspecto** no da un solo crédito: 15 cosméticos y nada más (§29, con test).

### Repetible, y con su freno

| Fuente | Créditos | Freno contra explotación |
|---|---|---|
| Duelo (victoria/empate/derrota, NORMAL) | 220 / 100 / 40 | **Tope de 20 partidas pagadas al día.** Por encima se juega y cuenta para misiones, pero no paga |
| Misiones repetibles | 200–1.800 | Requieren avanzar la métrica real; se rebaselinan al reclamar |
| Pick'em por torneo | 500 / 1.500 / 3.000 / 6.000 | Uno por torneo del circuito; exige acertar sobre partidos reales |
| **Desguace de duplicados** | 30–1.600 por carta | Solo duplicados; nunca la última copia |

---

## 5 · SUMIDEROS

| Sumidero | Estado |
|---|---|
| **Comprar sobres** | ✅ 750 – 20.000 |
| **Comisión del mercado** | ✅ **Fase 11** — 5 % de cada venta, quemado en `market_config.total_burned` |
| **Prestigio de insignias** | ✅ **Fase 14** — 15.000 / 40.000 / 100.000 por escalón, quemados. El primer sumidero que no es un sobre |
| Venta rápida al valor de mercado | ❌ **descartada** — ver abajo |
| Crafteo con materiales | ❌ no existe ruta de servidor |

---

## 6 · LAS CUATRO CIFRAS DE VALOR (corregido en la Fase 12)

Esta sección decía, en la Fase 11, que los sobres eran una impresora de dinero con una ratio
de 7× a 15×. **La ratio era real pero estaba mal etiquetada, y la conclusión que se sacaba
de ella era demasiado amplia.** La Fase 12 volvió a medir con `npm run economy:model` y esto
es lo que hay.

### Cuatro cifras, cuatro trabajos

| Cifra | Qué representa | Quién la determina | Para qué sirve | Riesgo |
|---|---|---|---|---|
| **Precio del sobre** (`data/packs`) | Lo que cuesta una tirada | Diseño de producto | Es el sumidero principal | Si baja, la economía se inunda |
| **`marketValue(def)`** | Tasación del **TIPO** de carta | `50 × 1,45^(rango-1) × 1,06^(OVR-60)` | **Ancla de referencia** del mercado entre jugadores y de su banda de precio | Su escala (ese 50) nunca se eligió contra nada |
| **`instanceValue(def, serie)`** | Tasación del **EJEMPLAR**: multiplica hasta ×5 por número de serie bajo | La misma fórmula + `serialMultiplier` | Enseñar lo que vale TU copia concreta | **No es un precio de compra**: incluye valor de coleccionista |
| **`salvageValue(def)`** | Lo que el juego paga por un duplicado | Tabla propia anclada al precio del sobre | El sumidero de duplicados | Si sube, aparece la impresora |

### El error de la Fase 11, y su corrección

La tabla que decía «10,5× · 14,7× · 9,0×» medía **`instanceValue`**, no `marketValue`.
Medidas las dos por separado sobre 20.000 aperturas por sobre con el motor real:

| Sobre | Precio | `marketValue` | ratio | `instanceValue` | ratio | Venta rápida (80 %) | ratio |
|---|---|---|---|---|---|---|---|
| Estándar | 750 | 2.568 | **3,4×** | 7.869 | 10,5× | 6.295 | **8,4×** |
| Premium | 2.500 | 8.621 | **3,4×** | 37.978 | 15,2× | 30.382 | **12,2×** |
| Masters | 5.000 | 14.476 | 2,9× | 69.088 | 13,8× | 55.270 | 11,1× |
| Champions | 8.000 | 20.551 | 2,6× | 100.310 | 12,5× | 80.248 | 10,0× |
| Prime | 10.000 | 21.884 | 2,2× | 107.968 | 10,8× | 86.375 | 8,6× |
| Icon | 20.000 | 36.726 | 1,8× | 183.469 | 9,2× | 146.775 | 7,3× |

**Qué se mantiene y qué cambia:**

- ✅ **La decisión de la Fase 11 era correcta.** El desguace no puede usar `quickSellValue`:
  devolvería entre 7,3 y 12,2 veces el precio del sobre. Esa impresora existe y sigue
  cerrada.
- ❌ **La alarma sobre `marketValue` era falsa.** Es 1,8×–3,4×, no 9×–15×.
- ❌ **Y la ratio «valor del sobre / precio del sobre» es, además, la métrica equivocada**:
  compara una tasación **por carta** contra un precio **por sobre**, así que crece sola con
  el número de cartas del sobre y no dice nada sobre si el ancla está bien.

### La cuenta que sí sirve: las tres cotas

Una carta tiene que valer más que su desguace (nadie vende por debajo: siempre tiene esa
alternativa garantizada) y menos que lo que cuesta conseguirla abriendo sobres (nadie paga a
otro más de lo que le costaría él mismo). Medido contra el sobre **Estándar**, que es el de
entrada:

| Rareza | Cartas | Desguace | `marketValue` medio | Coste de sacar una de esa rareza | `mv` / coste |
|---|---|---|---|---|---|
| Común | 299 | 30 | 158 | 271 | **0,58×** |
| Poco común | 423 | 70 | 464 | 431 | **1,08×** |
| Rara | 34 | 200 | 1.693 | 1.882 | **0,90×** |
| Épica | 9 | 600 | 5.097 | 8.532 | **0,60×** |
| Legendaria | 7 | 1.600 | 20.696 | 74.257 | **0,28×** |

**Las cinco rarezas caen entre 0,28× y 1,08× del coste de conseguirlas.** El ancla no está
inflada: está donde tiene que estar. Su escala nunca se justificó, pero el número al que se
llegó por casualidad es defendible, y ahora está medido y con una prueba que lo vigila
(`marketReadiness.test.ts`).

### La respuesta a «¿qué es `marketValue`?»

**Un índice de valor interno** (opción C de las cinco que planteaba el encargo). No es un
precio recomendado, ni un máximo, ni una promesa: es una escala relativa que ordena las
cartas por rareza y OVR, y cuya magnitud absoluta resulta aproximarse al coste de obtención
desde el sobre de entrada. En el mercado entre jugadores se usa como **referencia y ancla de
la banda**, y el precio real lo ponen las personas.

---

## 6 bis · LA ESCALERA DE SOBRES (medida en la Fase 12)

Nadie había comprobado nunca si los once sobres de pago formaban una escalera coherente.
La medición dice que **sí**, y con una excepción:

| Rareza | Vía más barata | Coste por carta |
|---|---|---|
| Común | **Estándar** (750) | 271 |
| Poco común | **Estándar** | 431 |
| Rara | **Premium** (2.500) | 1.552 |
| Épica | **Masters** (5.000) | 3.290 |
| Legendaria | **Icon** (20.000) | 13.343 |

Cada sobre de la escalera principal es la vía barata de exactamente un escalón, en orden de
precio. Eso es diseño de sobres de manual, y estaba bien sin que nadie lo hubiera medido.

**Champions, EWC, Prime y los cuatro regionales no ganan en ninguna rareza.** No es
necesariamente un defecto: los regionales y los de torneo restringen el sorteo, así que
pagan eficiencia a cambio de puntería. `Prime` sí queda dominado sin contrapartida y está
anotado para la Fase 13.

### El defecto del sobre China

El sobre China cuesta **3.000 créditos**, los mismos que EMEA, Americas y Pacific, y declara
un **6 % de épicas y un 1 % de legendarias**. En el catálogo **no existe ni una sola carta
épica o legendaria de un jugador de la región China**, así que esas dos probabilidades son
inalcanzables. Resultado medido: entrega 2.804 de valor frente a los 4.968–5.527 de sus
hermanos, un **44–49 % menos por el mismo precio**.

No se ha tocado ni el precio ni los pesos —es un cambio de balance y el catálogo es
contenido, no código—. Lo que se ha hecho es **dejar de ocultarlo**: la tienda enseña el
reparto real y advierte expresamente que ese sobre no contiene épicas ni legendarias.
Arreglar la causa (añadir cartas de rareza alta de jugadores de China) queda para la Fase 13.

---

## 7 · DUPLICADOS: DESGUACE, NO MATERIALES

### Cuántos hay

Midiendo con el motor real, abriendo sobres Premium:

| Colección | Duplicados |
|---|---|
| 0 cartas | 0 % |
| 50 | 4 % |
| 150 | 13 % |
| 300 | **25 %** |
| 500 | **43 %** |
| 772 (completa) | 100 % |

### La tabla, y cómo se calibró

```
común 30 · poco común 70 · rara 200 · épica 600 · legendaria 1.600
```

Anclada al **precio del sobre**, no al valor de la carta. Desguazar un sobre entero (el
peor caso) devuelve:

| Sobre | Precio | Desguace completo | Recuperación |
|---|---|---|---|
| Estándar | 750 | 354 | 47 % |
| Premium | 2.500 | 1.006 | 40 % |
| Champions | 8.000 | 2.265 | 28 % |
| Prime | 10.000 | 2.107 | 21 % |
| Icon | 20.000 | 3.060 | **15 %** |

La recuperación **baja con la rareza del sobre** a propósito: si el Icon devolviera lo
mismo que el Estándar, comprar Icon para desguazar sería una estrategia. Hay un test que lo
comprueba (`salvage.test.ts`).

En la práctica solo se desguazan duplicados, así que la recuperación real es del **15 % al
33 %** del gasto en sobres según el perfil (ver simulación).

### Por qué desguace y NO materiales (Pilar 14)

**No se introducen materiales.** Añadir una segunda moneda exige que tenga fuente, sumidero
y objetivo propios, y hoy no los tiene:

- **Fuente:** sería la misma que la del desguace (duplicados). Dos monedas de la misma
  fuente es una moneda con dos nombres.
- **Sumidero:** el crafteo. El motor existe en el cliente (`@/craft`) pero **no hay tabla ni
  RPC** que guarde materiales en el servidor, así que hoy se borrarían al sincronizar.
- **Objetivo:** «convertir duplicados en algo útil» — que es exactamente lo que ya hace el
  desguace, con una moneda que ya existe, que ya tiene libro mayor y que ya tiene sumidero.

`Reward.materials` sigue existiendo en el tipo y `services/rewards` lo declara como
`unsupported` en lugar de tragárselo. El día que haya crafteo de servidor, este documento es
el sitio donde justificar la segunda moneda.

---

## 8 · SIMULACIÓN (`npm run economy:simulate`)

Desde la Fase 12 se simulan **tres horizontes** (7 / 30 / 84 días) y se desglosa **de dónde
viene cada crédito**. Una temporada entera esconde el problema del principio: los primeros
días son los que deciden si alguien se queda, y en 84 días quedan diluidos en la media.

### A 7 y 30 días

| Perfil | 7 días | 30 días | 84 días |
|---|---|---|---|
| Casual | 83 cartas distintas (11 %) | 224 (29 %) | **481 (62 %)** |
| Activo | 61 (8 %) | 203 (26 %) | **440 (57 %)** |
| Intensivo | 142 (18 %) | 452 (59 %) | **704 (91 %)** |

El adelantamiento del Casual sobre el Activo **ya se ve a los 7 días**: 83 cartas frente a
61, gastando cuatro veces menos. No es un efecto de fin de temporada, es la mecánica del
sobre caro desde el primer día.

### De dónde vienen los créditos (84 días)

| Perfil | Duelos | Pase | Misiones | Pick'ems | **Eventos** | Desguace |
|---|---|---|---|---|---|---|
| Casual | 11.424 | 28.900 | 42.300 | 1.000 | **9.900 (8,7 %)** | 20.750 |
| Activo | 93.408 | 28.900 | 126.900 | 6.000 | **16.500 (4,5 %)** | 93.050 |
| Intensivo | 417.480 | 28.900 | 264.372 | 18.000 | **16.500 (1,5 %)** | 383.160 |

Los eventos de la Fase 12 aportan entre el **1,5 % y el 8,7 %** de lo que gana un jugador.
Es contenido, no un grifo — que era exactamente la condición para añadirlos.

### El punto de saturación

| Perfil | Catálogo | Coste de la siguiente carta nueva |
|---|---|---|
| Casual | 62 % | 249 cr |
| Activo | 57 % | 841 cr |
| Intensivo | **91 %** | **1.609 cr** |


Una temporada completa (84 días), con el motor de sorteo real:

| Perfil | Ganado | Gastado | Desguace | Sobres | Cartas | Distintas | Duplicados | Saldo final |
|---|---|---|---|---|---|---|---|---|
| **Casual** (2 duelos/día, fácil, Estándar) | 83.624 | 105.000 | 15.870 | 140 | 700 | **453** (59 %) | 35 % | 494 |
| **Activo** (8 duelos/día, normal, Premium) | 255.208 | 342.500 | 83.130 | 137 | 822 | **418** (54 %) | 49 % | 1.838 |
| **Intensivo** (20/día = tope, difícil, Premium) | 728.752 | 1.102.500 | 368.610 | 441 | 2.646 | **698** (90 %) | 74 % | 862 |

### Tres lecturas

**1. El sobre caro NO es mejor para completar colección.** El perfil Activo gasta 3,3 veces
más que el Casual y acaba con **menos** cartas distintas (418 frente a 453). Premium empuja
hacia buckets de rareza alta, que tienen menos cartas distintas, así que repite más. El
sobre caro sirve para **perseguir rareza**, no para completar. Hoy nada en la tienda lo
dice, y debería.

**2. El coste por carta nueva se dispara al final.** 232 créditos por carta nueva para el
Casual; **1.580** para el Intensivo, que ya tiene el 90 % de la colección. Es la curva
esperada y sana.

**3. Con la colección terminada no hay dónde gastar.** Los tres perfiles acaban a cero
**porque el modelo compra sobres mientras puede**. El problema real aparece cuando el
jugador deja de querer sobres: entonces el único sumidero desaparece y los créditos se
acumulan sin destino. El mercado entre jugadores (Fase 11) es la primera respuesta —su
comisión quema créditos de verdad—, pero **el sumidero de fin de juego sigue sin existir**.

---

## 9 · MODELO CRÉDITOS → € (propuesta, NO implementada)

### El ancla

Un sobre Premium cuesta 2.500 créditos. Si se anclara a un precio de mercado habitual para
un sobre (≈ 1,99 €), sale **1 € ≈ 1.256 créditos**.

Con esa referencia, una escalera de paquetes con valor creciente:

| Precio | Créditos | Créditos/€ | Ventaja | Equivale a |
|---|---|---|---|---|
| 1,99 € | 2.500 | 1.256 | — | 1 sobre Premium |
| 4,99 € | 7.000 | 1.403 | +12 % | 2,8 sobres |
| 9,99 € | 15.000 | 1.502 | +20 % | 6 sobres |
| 19,99 € | 32.000 | 1.601 | +27 % | 12,8 sobres |

### Y por qué la recomendación es NO VENDER CRÉDITOS

Contrastando esa escalera con la simulación: un jugador **Activo genera ~4.000 créditos al
día** (3.038 de juego + 990 de desguace). Es decir:

- 1,99 € ≈ **medio día** de juego.
- 19,99 € ≈ **8 días** de juego.

Un paquete de 20 € que equivale a poco más de una semana de jugar **no se vende**, y si se
abarata para que se venda, hunde el valor de jugar. El problema no es el precio: es que
**el grifo de créditos es demasiado generoso para poder venderlos**.

Las tres opciones, con su coste:

| Opción | Qué implica | Riesgo |
|---|---|---|
| **A · No vender créditos** (postura actual) | Se monetiza el pase de aspecto y, en el futuro, cosméticos | Techo de ingresos bajo. **Cero riesgo de pay-to-win** (§29) |
| **B · Cerrar el grifo** | Bajar recompensas de duelo y misiones ~60 % para que 20 € valgan un mes | Cambio de balance grande sobre un juego que ya se disfruta. Hay que medir con jugadores antes |
| **C · Vender solo cosmética y comodidad** | Pase, aspectos, marcos | Compatible con A. Exige que los cosméticos SE VEAN (hoy no se ven) |

**Recomendación: A + C.** Es lo que `config/monetization.ts` ya dice —«los créditos NO se
venden: se ganan jugando»— y la simulación lo respalda con números. B se puede evaluar, pero
no con estos datos: haría falta la distribución real de una base de jugadores, no tres
perfiles modelados.

**Ninguna de las cifras de esta sección está implementada.** `PAYMENTS_ENABLED = false` y el
catálogo de paquetes sigue vacío a propósito.

---

## 10 · PREPARACIÓN PARA DINERO REAL

`public.payments` (migración 0021). **No integra ninguna pasarela.** Crea la frontera:

```
DINERO REAL → PAGO → CONCESIÓN → DRL CREDITS
```

| Invariante | Cómo se garantiza |
|---|---|
| El cliente **nunca** nombra una cantidad de créditos | La tabla guarda `product_id`, no `credits`. `credits_granted` lo escribe el servidor al liquidar |
| Un cobro se liquida **una** vez | Índice único `(provider, provider_tx_id)` — la defensa contra el webhook repetido |
| Una intención de pago se crea **una** vez | Índice único en `idempotency_key` |
| El importe no se corrompe | `amount_cents bigint > 0`, divisa `^[A-Z]{3}$` |
| El estado no lo decide el cliente | `check` sobre `created/paid/granted/failed/cancelled/refunded`; RLS solo permite LEER lo propio |
| Los créditos entran por la ruta normal | `app_grant_reward` con `ref = payment:<id>` |

`economy:verify` prueba los cinco rechazos: clave repetida, importe negativo, divisa
inválida, estado inventado y cobro del proveedor duplicado.

---

## 11 · SEGURIDAD ECONÓMICA — LO QUE SE INTENTA ROMPER

`economy:verify` no comprueba que las cosas funcionen: comprueba que **no se puedan
romper**. Cada línea es un ataque:

| Ataque | Defensa | Verificado |
|---|---|---|
| **Doble gasto** | `for update` sobre el perfil dentro de `_ledger_apply` | ✅ |
| **Saldo negativo** | Corte en `_ledger_apply`, la última línea | ✅ |
| **Doble compra de sobre** | `economy_ops` + clave obligatoria | ✅ |
| **Doble apertura** | Clave + resultado guardado (devuelve las mismas cartas) | ✅ |
| **Doble desguace** | Clave consultada **antes** de validar el inventario | ✅ |
| **Precio falsificado** | El importe del desguace lo calcula el servidor; el cuerpo no admite ninguno | ✅ |
| **Propiedad falsificada** | La RPC valida `user_id` y `locked` bajo bloqueo de fila | ✅ |
| **Desguazar cartas ajenas** | Doble puerta: filtro en Node + comprobación en la RPC | ✅ |
| **Publicar carta ajena** | `user_cards.user_id` comprobado en la RPC | ✅ |
| **Publicar dos veces** | `locked` + índice único parcial sobre listados activos | ✅ |
| **Cancelar listado ajeno** | `seller_id` comprobado en la RPC | ✅ |
| **Comprar tu propio listado** | Rechazo + marca en `market_flags` | ✅ |
| **Doble compra del mismo listado** | `for update` sobre el listado + estado | ✅ |
| **Carrera entre dos compradores** | El bloqueo los serializa: solo uno gana | ✅ probado con dos compras simultáneas |
| **Comprar sin saldo** | `_ledger_apply` corta y deshace la transacción entera | ✅ |
| **Importe negativo / desbordamiento** | `check (price > 0)`, techo de 100.000.000, validación en la ruta | ✅ |
| **Precio fuera de banda** | `_market_check_band` contra el ancla de precio | ✅ (heredado de 0004) |
| **Ráfaga de operaciones** | `_market_check_rate`: 30 publicaciones y 60 compras por hora | ✅ (heredado) |
| **Wash trading** | `_check_wash` deja marca sobre pares repetidos | ✅ (heredado) |
| **Llamar a las RPC desde el navegador** | `revoke execute` a `anon`/`authenticated` en todas | ✅ en `security:verify` |

---

## 12 · LO QUE QUEDA

| Pendiente | Por qué no se ha cerrado |
|---|---|
| **Sumidero de fin de juego** | Con la colección hecha no hay dónde gastar. El mercado ayuda, pero hace falta algo más (mejoras, torneos de entrada, cosmética comprable con créditos) |
| **Reconciliar `marketValue` con los precios de sobre** | Es un cambio de balance grande (afecta al mercado entre jugadores). Documentado, no improvisado |
| **La tienda no explica qué sobre conviene** | La simulación demuestra que el sobre caro NO completa colección más rápido. Es información que el jugador merece |
| **Materiales / crafteo de servidor** | Decidido: **no** hasta que exista sumidero propio |
| **Vender créditos por dinero real** | Requiere cerrar el grifo o aceptar un techo de ingresos bajo. Opciones y cifras en §9 |
| **Cosméticos visibles** | Se conceden y se guardan, pero no hay dónde verlos ni equiparlos |
