# EL MERCADO ENTRE JUGADORES

> Ciclo de vida, atomicidad, propiedad y comisión.
>
> Estado: **portado y verificado** en la Fase 11; **criterios de apertura escritos y
> evaluados** en la Fase 12.
>
> **El interruptor sigue apagado** (`GLOBAL_MARKET_ENABLED = false`). Nueve de los diez
> criterios de §7 se cumplen; el que falta no es técnico.

---

## 1 · POR QUÉ ESTUVO CERRADO TRES FASES

El mercado se construyó entero en las migraciones 0001 y 0004 —listados, ofertas,
impuesto, banda de precio, límite de frecuencia, detección de *wash trading*, auditoría— y
la Fase A lo cerró en la base de datos (0010) por un motivo que no era ninguno de esos
sistemas:

**Había dos tablas de propiedad.** Las RPC del mercado movían `public.inventory`; el juego
usa `public.user_cards` desde la Fase B. Con la propiedad viviendo en dos sitios sin
reconciliar salían tres fallos reales:

| Fallo | Qué pasaba |
|---|---|
| **BUG-01** | Comprar salía gratis: la RPC descontaba en el servidor y `CloudSync` subía el saldo local sin descontar |
| **BUG-02** | Publicar → cancelar duplicaba cartas: la RPC la devolvía al inventario y el cliente añadía otra copia |
| **SEC-01** | `deposit_card` permitía acuñar cualquier carta desde la consola del navegador |

---

## 2 · QUÉ HA HECHO LA FASE 11

**No se ha borrado nada de 0004.** Aquellas RPC siguen ahí, revocadas, con su antifraude
intacto. Lo que se ha escrito (migración 0020) es la versión que opera sobre la propiedad
real:

| Antes (0004) | Ahora (0020) |
|---|---|
| Mueve `public.inventory` | Opera sobre `public.user_cards` |
| Al publicar, **borra** la carta del inventario | Al publicar, **la marca** (`locked = true`). La carta no se mueve |
| Escribe `profiles.credits` a mano, sin asiento | Todo por `_ledger_apply`: tres asientos por venta |
| `auth.uid()` — pensada para llamada directa del cliente | El usuario llega como parámetro desde una ruta que lo saca del token |
| Listado por `(card_id, serial)` | Listado por `card_uid` → un EJEMPLAR concreto |
| Estados: activo / vendido / cancelado | + **caducado**, con `updated_at` y `cancelled_at` |
| Sin idempotencia | Publicar y comprar exigen clave |

### El depósito en garantía es un bloqueo, no un traslado

Es la decisión que cierra BUG-02. La carta **nunca deja de ser del vendedor** mientras está
publicada: se marca `locked`. Se le sigue viendo en su colección, y no se puede desguazar,
ni meter en un mazo, ni publicar dos veces. Cancelar es quitar la marca.

No existe ningún instante en el que la carta esté en dos sitios ni en ninguno — que es
exactamente lo que el viaje de ida y vuelta anterior no podía garantizar.

---

## 3 · CICLO DE VIDA DE UN LISTADO

```
                    app_market_list
                          │
                          ▼
                      ┌────────┐
                      │ ACTIVE │  card_uid bloqueado
                      └───┬────┘
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   app_market_buy   app_market_cancel  app_market_expire
          │               │               │
          ▼               ▼               ▼
      ┌──────┐     ┌───────────┐     ┌─────────┐
      │ SOLD │     │ CANCELLED │     │ EXPIRED │
      └──────┘     └───────────┘     └─────────┘
   carta al          desbloqueada      desbloqueada
   comprador
```

| Campo | Cuándo se escribe |
|---|---|
| `created_at` | Al publicar |
| `updated_at` | En cada cambio de estado |
| `sold_at` | Al vender |
| `cancelled_at` | Al cancelar |
| `expires_at` | Opcional, al publicar |
| `buyer_id` | Al vender |

Un ejemplar no puede estar en dos listados vivos: índice único parcial
`market_listings(card_uid) where status = 'active'`. Es la red bajo el `locked`.

---

## 4 · LA COMPRA, PASO A PASO

El orden **no** es casual: de él dependen todas las garantías.

```
1. ¿Ya se hizo esta compra?        economy_ops[ref]        → devuelve lo mismo, no repite
2. Límite de frecuencia             _market_check_rate      → 60 compras/hora
3. BLOQUEO DEL LISTADO              select … for update     → aquí se serializan las carreras
4. Comprobaciones sin dinero        existe · activo · no es tuyo · tiene card_uid
5. Cobro al comprador               _ledger_apply(-precio)  → corta si no llega el saldo
6. Abono al vendedor                _ledger_apply(+precio)
7. Comisión                         _ledger_apply(-fee)     → quemada en market_config
8. Traspaso de la carta             user_cards → comprador, locked=false, origin='market'
9. Cierre del listado               status='sold'
10. Registro                        transactions · market_audit · economy_ops
```

**Todo en una transacción.** No existe un estado en el que el comprador haya pagado y la
carta siga siendo del vendedor: si algo falla en cualquier punto, se deshace entero.

**El paso 3 es el que impide la doble compra.** Dos peticiones simultáneas se serializan en
el `for update`, y la segunda encuentra el listado ya en `sold`. Está verificado lanzando
dos compras a la vez sobre el mismo listado: **una gana, la otra recibe «ya no está
disponible», y solo se registra una transacción**.

---

## 5 · LA COMISIÓN

Hoy: **5 %** (`market_config.tax_bps = 500`), quemada — sale de la economía, no va a nadie.

El comprador paga el precio entero; el vendedor recibe el precio menos la comisión.

### Modelo de opciones

Sobre un mercado hipotético de 1.000 ventas/día a 2.000 créditos de media (2.000.000 de
volumen diario):

| Comisión | Quemado/día | Vendedor recibe | Efecto |
|---|---|---|---|
| **5 %** | 100.000 | 1.900 | Sumidero suave. Máximo incentivo a listar. Es lo que hay hoy |
| **7,5 %** | 150.000 | 1.850 | Sumidero un 50 % mayor. El vendedor apenas lo nota en piezas caras |
| **10 %** | 200.000 | 1.800 | Sumidero fuerte. Empieza a desincentivar la reventa rápida y las piezas baratas |

**Recomendación: mantener el 5 % hasta que haya volumen real.** El motivo no es cariño por
la cifra: es que **la comisión solo es un sumidero si hay ventas**, y una comisión alta en
un mercado vacío no quema nada — solo espanta a los primeros vendedores, que son justo los
que hacen que el mercado arranque.

La regla para subirla, escrita para no improvisarla después: **si el mercado supera el 20 %
de la circulación diaria de créditos, la comisión pasa a ser una palanca de inflación real
y toca revisarla con datos.** `market_config.tax_bps` es una fila, no código: se cambia sin
desplegar.

### Sobre la banda de precio (revisado en la Fase 12)

La Fase 11 avisaba aquí de que, «con `marketValue` 7-15 veces por encima del precio de los
sobres», la banda permitida era enorme. **Aquella medición era de `instanceValue`, no del
ancla** (`economy.md` §6): el ancla está calibrada.

Lo que sí sigue en pie es el tamaño de la banda en sí. `min_price_mult` 0,2 y
`max_price_mult` **10** sobre el ancla significa que una legendaria (referencia media 20.696)
se podría listar por hasta **206.964 créditos: 276 sobres Estándar**. La banda protege de
precios absurdos por abajo, pero por arriba es tan ancha que apenas restringe.

No se ha tocado —`max_price_mult` es una fila de `market_config`, y estrecharla sin ventas
reales sería elegir un número por intuición—, pero queda anotado: **el día que se abra el
mercado, la banda superior es lo primero que hay que revisar con datos de ventas.**

---

## 6 · QUÉ SE INTENTA ROMPER Y QUÉ LO IMPIDE

Todo esto está en `npm run economy:verify`, contra la base de datos real:

| Ataque | Defensa |
|---|---|
| Publicar carta ajena | La RPC compara `user_cards.user_id` con el usuario del token |
| Publicar dos veces el mismo ejemplar | `locked` + índice único parcial |
| Cancelar el listado de otro | La RPC compara `seller_id` |
| Cancelar dos veces | Comprobación de estado |
| Comprar tu propio listado | Rechazo + marca `self_trade` |
| Comprar sin saldo | `_ledger_apply` corta; la transacción entera se deshace |
| Comprar un listado ya vendido | Estado bajo bloqueo de fila |
| **Dos compradores a la vez** | El `for update` los serializa |
| Repetir la misma compra | `economy_ops` devuelve el resultado guardado |
| Precio cero o negativo | `check (price > 0)` + validación en la ruta |
| Desbordamiento de precio | Techo de 100.000.000 en la RPC y en la ruta |
| Precio fuera de banda | `_market_check_band` |
| Ráfaga de operaciones | `_market_check_rate` |
| Desguazar una carta publicada | La vista previa excluye las bloqueadas; la RPC también |
| Llamar a las RPC desde el navegador | `revoke execute` a `anon`/`authenticated` |

---

## 7 · POR QUÉ EL INTERRUPTOR SIGUE APAGADO (Fase 12: ahora con criterios)

`GLOBAL_MARKET_ENABLED = false`.

Hasta la Fase 12, encenderlo era **cambiar un `false` por un `true`**: una decisión de una
persona, un martes, sin nada que la contrastara. Ahora hay una lista escrita, comprobable y
comprobada: `domain/economy/marketReadiness.ts`.

### Los diez criterios

| # | Criterio | Lo decide | Hoy |
|---|---|---|---|
| 1 | Propiedad en una sola tabla | `economy:verify` | ✅ |
| 2 | Transacciones atómicas | `economy:verify` | ✅ |
| 3 | Idempotencia al publicar y comprar | `economy:verify` | ✅ |
| 4 | El saldo no puede quedar negativo | `economy:verify` | ✅ |
| 5 | El precio lo valida el servidor | `economy:verify` | ✅ |
| 6 | La comisión se cobra y se quema | `economy:verify` | ✅ |
| 7 | Dos compradores simultáneos no rompen nada | `economy:verify` | ✅ |
| 8 | **El precio de referencia está calibrado** | `economy:model` | ✅ **(la Fase 11 lo daba por roto: no lo estaba)** |
| 9 | **El desguace no explota con el mercado abierto** | medición | ✅ |
| 10 | **Hay jugadores suficientes para descubrir precios** | telemetría de producción | ❓ **no se sabe** |

### La regla que hace que esto valga algo

**Un criterio `unknown` no cuenta como cumplido.** Es la diferencia entre «no lo sabemos» y
«está bien», y confundirlas es exactamente como se abren los mercados rotos. El criterio 10
no se puede decidir desde el repositorio: depende de cuánta gente esté jugando. Se declara
desconocido y se dice por qué, en lugar de fingir que un dato que no tenemos está a favor.

### Los dos criterios que la Fase 12 midió

**8 · El ancla.** La Fase 11 concluyó que estaba inflada entre 7 y 15 veces. Aquella cuenta
medía `instanceValue` (que multiplica hasta ×5 por número de serie) y además comparaba una
tasación **por carta** contra un precio **por sobre**. La comparación correcta —lo que vale
una carta frente a lo que cuesta conseguir una de su rareza— da entre **0,28× y 1,08×** en
las cinco rarezas. El ancla estaba bien. Detalle y tabla en `economy.md` §6.

**9 · El desguace.** Con el mercado cerrado, la pregunta era «¿desguazar un sobre devuelve
menos de lo que cuesta?» y la respuesta era sí. Con el mercado abierto aparece otra: si el
desguace pagara más que la referencia de una carta, **comprarla barata y desguazarla sería
un beneficio garantizado y repetible**. Medido contra la carta más barata de cada rareza —el
peor caso, no la media—, el desguace se queda como mucho en el **60 %** de la referencia.

### El cerrojo

`marketReadiness.test.ts` afirma que, **si `GLOBAL_MARKET_ENABLED` estuviera en `true`**,
todos los criterios evaluables sin base de datos tendrían que estar cumplidos. El día que
alguien encienda el mercado con la economía sin calibrar, `npm test` cae y dice cuál falta.

La lista deja de ser documentación y pasa a ser un cerrojo.

### El veredicto de la Fase 12

**NO ABRIR TODAVÍA.** Nueve de diez criterios cumplidos; el que falta —masa de jugadores—
no es técnico y no se puede resolver escribiendo código. La infraestructura está lista y
verificada; encenderla es una decisión de operaciones que necesita un dato que hoy no
existe.

Las lecturas siguen funcionando, así que el escaparate se puede enseñar sin riesgo.
`deposit_card` **no se reconcede y no se reescribe**: era el vector de acuñación (SEC-01) y
ya no hace falta, porque la propiedad no la declara el cliente.

---

## 7 bis · QUÉ DATOS HARÁN FALTA PARA ABRIRLO (Fase 13)

El único criterio que bloquea la apertura es la masa de jugadores, y no se resuelve
programando. Pero sí se puede dejar escrito **qué habrá que medir cuando la haya**, para que
la decisión no dependa de que a alguien se le ocurra en su momento.

```
MERCADO CERRADO  →  RECOGIDA DE DATOS  →  DESCUBRIMIENTO DE PRECIO  →  MERCADO ABIERTO
```

### Lo que ya se guarda hoy

La infraestructura de la Fase 11 registra todo esto **desde el primer día que se abra**, sin
tocar nada:

| Dato | Dónde |
|---|---|
| Cada publicación, con precio y estado | `market_listings` (`created_at`, `updated_at`, `sold_at`, `cancelled_at`) |
| Cada venta, con comprador y vendedor | `market_listings` + `credit_transactions` (tres asientos: cargo, abono, comisión) |
| Volumen y comisión quemada | `market_config.total_burned` |
| Serie histórica de precios | `card_price_daily` |
| Ancla de referencia | `card_price_stats` |
| Intentos sospechosos | `market_flags`, `market_audit` |

**No hace falta ninguna tabla nueva.** Lo que falta es el análisis.

### Las nueve cifras que decidirán

| Cifra | Cómo se calcula | Para qué |
|---|---|---|
| **Listados activos** | `count(*) where status='active'` | Sin oferta no hay mercado |
| **Ventas por día** | `count(*) where sold_at::date = …` | Es el denominador de todo lo demás |
| **Liquidez** | ventas ÷ listados creados | Cuántas publicaciones acaban en venta. Por debajo de ~0,2 el mercado es un escaparate |
| **Precio medio y MEDIANA** | sobre `price` de las vendidas | La mediana importa más: la media la mueve una legendaria |
| **P25 / P75 por rareza** | percentiles sobre las vendidas | Es lo que define la banda real, frente a la teórica de hoy |
| **Precio por rareza frente al ancla** | mediana ÷ `marketValue` | **La cifra clave**: dice si el ancla acertó |
| **Concentración** | % del volumen del 10 % de ventas más caras | Modelada hoy en **53 %** y estable a cualquier escala |
| **Velocidad de circulación** | volumen diario ÷ créditos en circulación | La regla del 20 % de `§5` se mide con esto |
| **Comisión quemada / créditos creados** | `total_burned` ÷ grifo diario | Dice si el mercado es un sumidero de verdad |

### Los umbrales, escritos antes de tener los datos

Se dejan aquí para no elegirlos a conveniencia cuando lleguen las cifras:

| Umbral | Valor | Por qué |
|---|---|---|
| Jugadores activos | **≥ 200** | Es el criterio `player-mass` de `marketReadiness.ts` |
| Liquidez | **≥ 0,2** | Por debajo, el precio lo pone el primero que publica |
| Ventas acumuladas antes de reajustar el ancla | **≥ 1.000** | La simulación muestra que la mediana se estabiliza en ese orden de magnitud |
| Desviación tolerable del ancla | **mediana entre 0,5× y 2× `marketValue`** | Fuera de esa banda, el ancla no describe el mercado y hay que moverla |

**Y una regla que no se negocia: los precios no se inventan.** Mientras el mercado esté
cerrado, `marketValue` es un índice interno con la escala que la Fase 12 midió, no una
predicción de lo que costará una carta.

---

## 8 · LO QUE QUEDA

| Pendiente | Nota |
|---|---|
| **Ofertas** (`market_offers`) | La tabla y las RPC de 0004 existen y siguen revocadas. No se han portado: la compra directa es suficiente para abrir |
| **Caducidad automática** | `app_market_expire()` existe; falta la tarea periódica que la llame |
| **Precios de referencia reales** | `card_price_stats` se alimenta de ventas. Con el mercado cerrado, el ancla es el valor teórico del catálogo |
| **Reconciliar `marketValue`** | Ver §7.1 |
| **Historial de precios en la interfaz** | Los datos están (`card_price_daily`); la pantalla no los enseña todavía |
