# FASE 11 — ECONOMÍA, MERCADO Y BASE DE MONETIZACIÓN

> De una economía que funcionaba por suerte a una economía **auditable, idempotente y con
> sumideros**.
>
> Estado: **entregada y verificada**. `npm test` 405/405 · typecheck ✅ · build ✅ ·
> `security:verify` ✅ (**+26 comprobaciones nuevas**) · `economy:verify` ✅ **(nuevo, 61
> comprobaciones)** · `loop:verify` ✅ · `ux:verify` ✅ · `audit:stability` **P0 0 · P1 0** ·
> `audit:interactions` ✅ · `duel:e2e` ✅ · `test:e2e` ✅ · `sw:verify` ✅.

---

## 1 · AUDITORÍA ECONÓMICA INICIAL

Antes de tocar código: el esquema (21 migraciones), los servicios de servidor, el motor de
sobres, `Reward`, `user_cards` vs `inventory`, `profiles` y todas las rutas que mueven
valor.

### Los cuatro hallazgos

**A · La idempotencia era teórica.** `app_buy_pack` aceptaba una clave *opcional*, la ruta
la leía del cuerpo… y `lib/game/client.ts` **no la enviaba nunca**. La única operación que
gasta créditos del juego no era idempotente.

**B · Abrir un sobre no tenía clave ni dejaba rastro.** Y `buy_and_open` reintentado
**saltaba la compra** (por su clave) y **volvía a abrir** (sin clave): el jugador pagaba un
sobre y perdía dos.

**C · El libro mayor no sabía contar transferencias.** Sin contraparte y sin tipo de
movimiento. Y las RPC del mercado (0004) escribían `profiles.credits` **directamente**, sin
dejar un solo asiento.

**D · Los sobres son una impresora de dinero.** Medido con el motor real sobre 4.000
aperturas por tipo: el valor de mercado de lo que sale está entre **7 y 15 veces** el
precio del sobre. Un Premium cuesta 2.500 y produce 36.771 en valor. Que la venta rápida
estuviera apagada nos salvó **por accidente** — se apagó por un problema de autoridad, no
porque nadie hubiera hecho esta cuenta.

---

## 2 · FUENTES DE CRÉDITOS

| Fuente | Cantidad | Freno |
|---|---|---|
| Saldo inicial | 6.000 | Una vez, con asiento `starter_grant` |
| Carril libre del pase | 15.900 + 6 sobres | 30 niveles |
| Carril competitivo | 26.000 + 6 sobres | Se abre en Oro |
| Misiones de temporada e hitos | 9.500 | No repetibles |
| Logros permanentes (7) | 67.500 | Una vez en la vida |
| **Duelos** | 220 / 100 / 40 (NORMAL) | **Tope de 20 partidas pagadas al día** |
| Misiones repetibles | 200–1.800 | Exigen avanzar la métrica real |
| Pick'ems | 500 / 1.500 / 3.000 / 6.000 | Uno por torneo, hay que acertar |
| **Desguace** (nuevo) | 30–1.600 por carta | Solo duplicados, nunca la última copia |

**Total no repetible por temporada: 124.900.** El carril de aspecto no da un solo crédito.

---

## 3 · SUMIDEROS

| Sumidero | Estado |
|---|---|
| Comprar sobres | ✅ 750 – 20.000 |
| **Comisión del mercado** | ✅ **nuevo** — 5 % quemado en `market_config.total_burned` |
| Venta rápida al valor de mercado | ❌ **descartada por el hallazgo D** |
| Materiales / crafteo | ❌ decidido que no (§9) |

---

## 4 · BALANCE

`npm run economy:simulate`, una temporada completa con el motor de sorteo real:

| Perfil | Ganado | Gastado | Desguace | Sobres | Distintas | Duplicados |
|---|---|---|---|---|---|---|
| Casual | 83.624 | 105.000 | 15.870 | 140 | **453** (59 %) | 35 % |
| Activo | 255.208 | 342.500 | 83.130 | 137 | **418** (54 %) | 49 % |
| Intensivo | 728.752 | 1.102.500 | 368.610 | 441 | **698** (90 %) | 74 % |

**Tres lecturas, y una no la esperábamos:**

1. **El sobre caro NO completa colección más rápido.** El perfil Activo gasta 3,3× más que
   el Casual y acaba con **menos** cartas distintas (418 vs 453): Premium empuja a buckets
   de rareza alta, que tienen menos cartas, así que repite más. Sirve para perseguir
   rareza, no para completar — y **la tienda no lo dice**.
2. **El coste por carta nueva se dispara**: 232 créditos (Casual) → 1.580 (Intensivo).
3. **Con la colección hecha no hay dónde gastar.** Los tres acaban a cero *porque el modelo
   compra sobres mientras puede*. El problema real llega cuando el jugador deja de querer
   sobres.

---

## 5 · LEDGER

`credit_transactions` gana `kind` (`credit`/`debit`/`transfer_in`/`transfer_out`/
`reversal`) y `counterparty_id`. **Una venta deja tres asientos**: cargo al comprador,
abono al vendedor y comisión.

**`_ledger_apply` es ahora el único sitio del sistema que escribe `profiles.credits`.**

Y el libro es **completo desde el minuto cero**: `handle_new_user` escribe el asiento de
apertura, así que **la suma de todos los deltas ES el saldo** — verificado sobre una cuenta
real.

---

## 6 · IDEMPOTENCIA

`economy_ops(ref, user_id, kind, result)` no guarda solo *que* algo pasó: guarda **qué
devolvió**. Un reintento responde lo mismo en lugar de repetir o fallar.

| Operación | Antes | Ahora |
|---|---|---|
| Comprar sobre | clave opcional, nunca enviada | **clave obligatoria** en la RPC |
| Abrir sobre | sin clave | clave + resultado guardado (**las mismas cartas**) |
| Comprar y abrir | rota (perdía un sobre) | un gesto → dos claves derivadas |
| Desguace | — | clave consultada **antes** de validar el inventario |
| Publicar / comprar en el mercado | — | clave obligatoria |

---

## 7 · REWARDS

Sin cambios de contrato: siguen pasando por `services/rewards.award()`, la ruta única de la
Fase 10. Lo que cambia es que ahora **todo** lo económico pasa por `_ledger_apply`, así que
una recompensa y una compra dejan el mismo tipo de rastro.

**Las recompensas de duelo no se han retocado.** El encargo pedía auditarlas y no cambiarlas
por intuición: la tabla (8/14/22 puntos, 120/220/350 créditos, tope de 20/día) se ha
revisado contra la simulación y **aguanta** — un Activo saca 3.038 créditos/día de duelos,
que es un goteo, no una manguera.

---

## 8 · PACKS

| Sobre | Precio | Valor de lo que sale | Ratio | Desguace | Recuperación |
|---|---|---|---|---|---|
| Estándar | 750 | 7.899 | 10,5× | 354 | 47 % |
| Premium | 2.500 | 36.771 | **14,7×** | 1.006 | 40 % |
| Champions | 8.000 | 99.839 | 12,5× | 2.265 | 28 % |
| Prime | 10.000 | 107.682 | 10,8× | 2.107 | 21 % |
| Icon | 20.000 | 180.481 | 9,0× | 3.060 | **15 %** |

**No se han cambiado los precios ni las probabilidades.** Reconciliar `marketValue` con
ellos es un cambio de balance que afecta también al mercado entre jugadores: está
documentado como decisión pendiente, no improvisado.

---

## 9 · DUPLICADOS — DESGUACE, Y **NO** MATERIALES

**Cuántos hay** (medido): 25 % con 300 cartas, 43 % con 500, 100 % con la colección hecha.

**La tabla:** común 30 · poco común 70 · rara 200 · épica 600 · legendaria 1.600. Anclada
al **precio del sobre**, no al valor de la carta. Hay un test que comprueba que desguazar
un sobre entero devuelve menos de lo que costó, y otro que comprueba que la recuperación
baja con la rareza del sobre (si no, comprar Icon para desguazar sería una estrategia).

**Solo duplicados, y siempre se conserva un ejemplar** — el de número de serie más bajo.

**Materiales: NO.** No tendrían fuente propia (sería la misma que la del desguace),
ni sumidero (no hay crafteo de servidor), ni objetivo distinto. Dos monedas de la misma
fuente son una moneda con dos nombres. `Reward.materials` sigue declarándose como
`unsupported` en lugar de tragarse.

---

## 10 · MARKETPLACE

**No se ha construido: se ha PORTADO.** Estaba entero desde 0004 y cerrado desde 0010
porque había **dos tablas de propiedad**.

| Antes | Ahora (0020) |
|---|---|
| Mueve `public.inventory` | Opera sobre `public.user_cards` |
| Al publicar **borra** la carta | **La bloquea** (`locked`). La carta no se mueve |
| Escribe `profiles.credits` a mano | Todo por `_ledger_apply` |
| `auth.uid()` (llamada directa del cliente) | Usuario como parámetro, desde una ruta con token |
| Listado por `(card_id, serial)` | Listado por `card_uid` — un ejemplar concreto |
| activo/vendido/cancelado | **+ caducado**, con `updated_at` y `cancelled_at` |
| Sin idempotencia | Publicar y comprar la exigen |

**El depósito en garantía es un bloqueo, no un traslado.** Es lo que cierra BUG-02: no
existe ningún instante en el que la carta esté en dos sitios ni en ninguno.

**El interruptor sigue apagado**, y ahora también en el servidor (las escrituras devuelven
503). Las lecturas funcionan, así que el escaparate se enseña. Encenderlo es cambiar una
constante — lo que falta es reconciliar el precio de referencia (§8), no infraestructura.

---

## 11 · FEES

Hoy **5 %**, quemado. Modelo sobre 1.000 ventas/día a 2.000 créditos:

| Comisión | Quemado/día | Vendedor recibe | Efecto |
|---|---|---|---|
| 5 % | 100.000 | 1.900 | Sumidero suave, máximo incentivo a listar |
| 7,5 % | 150.000 | 1.850 | +50 % de sumidero, apenas se nota en piezas caras |
| 10 % | 200.000 | 1.800 | Desincentiva reventa rápida y piezas baratas |

**Recomendación: mantener el 5 % hasta que haya volumen.** Una comisión alta en un mercado
vacío no quema nada: solo espanta a los primeros vendedores, que son los que lo arrancan.
La regla para subirla queda escrita: **si el mercado supera el 20 % de la circulación
diaria de créditos**, toca revisarla con datos. `tax_bps` es una fila, no código.

---

## 12 · SIMULACIÓN

`npm run economy:simulate` — herramienta de desarrollo, no parte del producto. Usa los
datos reales del juego y el motor de sorteo real; lo único modelado son los tres perfiles,
declarados arriba del fichero para poder discutirlos. Resultados en §4.

---

## 13 · MODELO CRÉDITOS → €

Anclando el sobre Premium (2.500 cr) a 1,99 €: **1 € ≈ 1.256 créditos**.

| Precio | Créditos | Créditos/€ | Ventaja |
|---|---|---|---|
| 1,99 € | 2.500 | 1.256 | — |
| 4,99 € | 7.000 | 1.403 | +12 % |
| 9,99 € | 15.000 | 1.502 | +20 % |
| 19,99 € | 32.000 | 1.601 | +27 % |

**Y por eso la recomendación es no venderlos.** Un Activo genera ~4.000 créditos/día: 20 €
equivaldrían a **8 días de juego**. Un paquete premium que vale una semana no se vende, y
abaratarlo hunde el valor de jugar. El problema no es el precio: **el grifo es demasiado
generoso para poder venderlos**.

Opciones: **A** no vender créditos (postura actual) · **B** cerrar el grifo ~60 % · **C**
vender solo cosmética. **Recomendación: A + C.** B exige la distribución real de una base
de jugadores, no tres perfiles modelados.

**Nada de esto está implementado.** `PAYMENTS_ENABLED = false`.

---

## 14 · PREPARACIÓN PARA PAGOS

`public.payments` (0021). Sin proveedor. Crea la frontera
`DINERO REAL → PAGO → CONCESIÓN → CRÉDITOS`:

- El cliente nombra un **`product_id`**, nunca una cantidad. `credits_granted` lo escribe
  el servidor.
- Índice único `(provider, provider_tx_id)`: el webhook repetido no liquida dos veces.
- Índice único en `idempotency_key`.
- `amount_cents > 0`, divisa `^[A-Z]{3}$`, estados cerrados, RLS de solo lectura.

Verificados los cinco rechazos: clave repetida, importe negativo, divisa inválida, estado
inventado y cobro duplicado.

---

## 15 · COSMÉTICOS

El carril de aspecto repartía 15 cosméticos que se guardaban en `user_cosmetics` y **no se
podían ver ni equipar**: un id en una tabla que ninguna pantalla leía. Eso vaciaba de
sentido al único carril que se pretende monetizar.

**Una columna, no un sistema** (0022): `profiles.equipped`, un objeto FAMILIA → id.
`app_equip_cosmetic` comprueba que lo tienes y que el id pertenece a esa familia; `equipped`
entra en el trigger guardián. La pantalla de Progreso los enseña agrupados por familia y
permite equipar y retirar.

Ciclo cerrado para títulos, marcos, avatares y banderines: **desbloquear → equipar → ver**.
Falta que el avatar/marco equipado se PINTE en la ficha, que es Fase 12.

---

## 16 · MATERIALS

**Decidido: no se introducen.** Razonamiento completo en §9 y en `economy.md`.

---

## 17 · SEGURIDAD

19 ataques probados contra la base de datos real en `economy:verify`, entre ellos:

- **Carrera entre dos compradores** sobre el mismo listado → una compra aceptada, un dueño
  nuevo, una transacción registrada.
- **Doble gasto**, **saldo negativo**, **doble compra**, **doble apertura**, **doble
  desguace**.
- **Precio falsificado** (la ruta no admite ningún importe), **propiedad falsificada**,
  **cancelación ajena**, **publicación de carta ajena**, **compra de tu propio listado**.
- **Importe negativo** y **desbordamiento**.

Más 26 comprobaciones estructurales nuevas en `security:verify`: todas las RPC revocadas al
cliente, `economy_ops` y `payments` no escribibles, el depósito es bloqueo, `deposit_card`
sigue sin reconcederse, y **la ruta de economía no acepta ningún importe del cliente**.

---

## 18 · TESTS

**405 / 405** (+9 nuevos, todos de `domain/economy/salvage`), más los dos verificadores.

---

## 19–20 · VERIFICACIONES · P0 / P1

| | |
|---|---|
| `npm test` | ✅ 405/405 |
| typecheck · build | ✅ · ✅ |
| `security:verify` | ✅ +26 |
| **`economy:verify`** | ✅ **61 comprobaciones** |
| `loop:verify` | ✅ |
| `ux:verify` | ✅ |
| `audit:stability` | ✅ **P0 0 · P1 0** (P2 3: los 401 preexistentes de `/admin`) |
| `audit:interactions` · `duel:e2e` · `duel-gameplay` · `progression` · `strats` · `sw` · `test:e2e` · `integration` · `pickems` | ✅ |

---

## 21 · CAPTURAS

`96-despues/` → `fase11-despues/`, tres ficheros: `10-inventario` (desguace),
`12b-mercado-global` (estado real) y `12c-mercado-escaparate` (con listados creados por la
RPC real y retirados después). Detalle en `docs/product/visual/README.md`.

---

## 22 · ARCHIVOS MODIFICADOS

**Migraciones (4):** `0019_economy_ledger` · `0020_marketplace_v2` · `0021_payments_prep` ·
`0022_cosmetics_equip`

**Dominio (2 nuevos):** `domain/economy/salvage.ts` + su test

**Servidor (3 nuevos):** `services/economy.ts` · `services/market.ts` ·
`api/game/economy/route.ts` · `api/game/market/route.ts`

**Cliente (3 nuevos):** `lib/game/economy.ts` · `lib/game/market.ts` ·
`components/market/PlayerMarket.tsx`

**Modificados (10):** `services/packs.ts` · `services/progression.ts` ·
`api/game/packs/route.ts` · `api/game/progression/route.ts` · `lib/game/client.ts` ·
`lib/progression/client.ts` · `app/inventario/page.tsx` · `app/mercado/page.tsx` ·
`app/logros/page.tsx` · `scripts/security-verify.ts` · `scripts/visual-shots.ts` ·
`package.json`

**Herramientas (2 nuevas):** `scripts/economy-verify.ts` · `scripts/economy-simulate.ts`

**Documentación:** `economy.md` (reescrito) · `marketplace.md` (nuevo) · este informe

---

## 23 · ARCHIVOS **NO** MODIFICADOS

Combat Resolver · CombatPlan · reglas de duelo · bots · RNG · OVR · estadísticas ·
generación de cartas · CardRegistry · motor de sobres (`domain/packs`, `src/pack`) ·
`domain/progression/rank.ts` · `domain/progression/duelRewards.ts` · sistema táctico ·
service worker · auth · Pick'em lifecycle · `services/loop.ts` · `services/rewards.ts` ·
`services/duels.ts` · las RPC de 0004 (siguen revocadas, intactas) · el lenguaje visual de
la Fase 9.6.

---

## 24 · QUÉ QUEDA PARA LA FASE 12

| Pendiente | Qué exige |
|---|---|
| **Reconciliar `marketValue` con los precios de sobre** | Es lo único que separa al mercado de poder abrirse. Cambio de balance con su propia decisión |
| **Sumidero de fin de juego** | Con la colección hecha no hay dónde gastar. El mercado ayuda; hace falta algo más |
| **La tienda debe explicar qué sobre conviene** | La simulación demuestra que el caro no completa colección más rápido |
| **Ofertas del mercado** | `market_offers` sigue en 0004, revocada y sin portar |
| **Caducidad automática** | `app_market_expire()` existe; falta la tarea que la llame |
| **Pintar el cosmético equipado** | Ya se equipa; falta que el avatar/marco se vea en la ficha |
| **Integrar una pasarela** | La frontera está lista. §12 sigue vigente |
| **Eventos server-side** | Heredado de la Fase 10 |
