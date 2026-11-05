# F18.1 REPORT — CIERRE DE ECONOMÍA SANDBOX (DRL Credits)

**Fecha:** 2026-09-03 · **Rama:** `arch/stabilization` · **Estado:** sin commit, sin push, sin deploy.

Las tres deudas de la F18 quedan cerradas: el audit de `profiles.tokens` (sin tocar el
dato), el diagnóstico del fallo histórico de `economy:verify` (**reproducido e
identificado**) y la tienda sandbox de DRL Credits (construida y verificada).

---

## 1 · TOKEN AUDIT

### 1.1 Qué funcionalidad representa `p_tokens`

`profiles.tokens` son las **FICHAS DE EVENTO**. Es una segunda moneda, anterior a la
decisión de moneda única de la F18. Su propósito declarado: pagar el carril premium del
pase de temporada y los sobres de evento sin dinero real.

Está declarada en `supabase/migrations/0001_init.sql:20` como
`tokens bigint not null default 0`.

### 1.2 Writers (quién la escribe)

Un único sitio en toda la base de datos:

| Origen | Línea | Sentencia |
|---|---|---|
| `app_grant_reward` (0018, sustituye a 0013) | `0018_game_loop.sql:100` | `tokens = tokens + coalesce(p_tokens, 0)` |

Llamadores de `p_tokens` en el código:

| Fichero | Línea | Uso |
|---|---|---|
| `src/server/services/rewards.ts` | 123 | `p_tokens: clampInt(reward.tokens)` — **concede** (recompensas de Pick'ems, misiones, logros) |
| `src/server/services/progression.ts` | 433 | `p_tokens: -cost` — **único sumidero** |
| `scripts/stability-audit.ts` | 166 | siembra QA (`500`) |
| `scripts/visual-shots.ts` | 152, 166 | siembra QA (`2500`) |

**Defecto encontrado (writer):** a diferencia de `points`, que se escribe con
`greatest(0, points + …)`, `tokens` **no tiene suelo**. Verificado empíricamente en la F18:
con una `ref` nueva, `p_tokens: -5000` deja el perfil a **−5000**. Nada en la base lo
impide.

### 1.3 Readers (quién la lee)

| Fichero | Línea | Uso |
|---|---|---|
| `src/server/services/progression.ts` | 293, 312 | la mete en la vista de progresión |
| `src/server/services/progression.ts` | 424–426 | comprueba el saldo **en Node**, no en la base |
| `src/components/layout/GameShell.tsx` | 250–252 | `const tokens = user && profile ? profile.tokens : localTokens` |
| `src/app/cuenta/page.tsx` | 371 | lo pinta como «Fichas» |

### 1.4 Sinks (quién la gasta) — **EL SUMIDERO ESTÁ ROTO**

El único sumidero de servidor es `unlockPremiumWithTokens`
(`src/server/services/progression.ts:415`), alcanzable por esta cadena completa:

```
/logros (botón)  →  unlockPremiumWithTokens()  (src/lib/progression/client.ts:59)
                 →  POST /api/game/progression { action: "unlockPremium" }   (route.ts:93)
                 →  unlockPremiumWithTokens()  (progression.ts:415)
                 →  rpc("app_adjust_credits", { p_credits, p_tokens, … })    ← ROTO
```

`app_adjust_credits` tiene la firma `(p_user, p_delta, p_reason, p_ref)`
(`0011_server_authority.sql:173`, `0019_economy_ledger.sql:157`). **No existe `p_tokens`, ni
`p_credits`.** Comprobado contra la base real:

```
error: PGRST202 · Could not find the function
       public.app_adjust_credits(p_credits, p_reason, p_ref, p_tokens, p_user)
       in the schema cache
perfil tras la llamada: {"tokens":0,"credits":6000}
```

**Consecuencia:** abrir el pase premium con fichas **siempre falla con 409**. Las fichas se
conceden y no se pueden gastar por ninguna vía de servidor. No es un riesgo hipotético: es
el estado actual.

### 1.5 Ausencia de libro mayor

`credit_transactions` no tiene columna de tokens y `_ledger_apply` solo mueve `credits`. Los
`kind` presentes hoy en la tabla son `credit, debit, transfer_in, transfer_out`. Por tanto
**los movimientos de fichas no se registran en ningún sitio**: no hay historial, no hay
auditoría y no hay forma de reconstruir un saldo. Es exactamente lo contrario del modelo que
la F18 impuso a los DRL Credits.

### 1.6 `profiles.tokens` **≠** `useEventsStore.tokens`

Son **dos autoridades distintas y no reconciliadas** con el mismo nombre:

| | `profiles.tokens` | `useEventsStore.tokens` |
|---|---|---|
| Dónde vive | Postgres | `localStorage` del navegador |
| Quién escribe | solo `app_grant_reward` | el propio cliente |
| Se gasta | por la vía rota de 1.4 | libremente, en el navegador |
| Auditable | no (sin ledger) | no |

El gasto real ocurre **todo en el cliente**:

- `src/store/useEventsStore.ts:249-251` — comprar en el escaparate de evento
- `src/store/useBattlePassStore.ts:108-112` — abrir el pase
- `src/craft/engine.ts:81,116` — costes de forja
- `src/lib/rewards.ts:20-22` — conceder fichas desde el cliente

Y `GameShell.tsx:252` elige una u otra según haya sesión, así que **el mismo jugador ve dos
saldos distintos según si ha entrado o no**. Las escrituras directas del cliente contra la
tabla están bloqueadas por el trigger `SEC-02` (0009, 0012, 0022), así que la divergencia no
se puede propagar a la base — pero tampoco se reconcilia nunca.

### 1.7 Estado actual del dato (medido hoy)

```
perfiles: 39
suma de profiles.tokens: 0
perfiles con tokens != 0: 0
perfiles con tokens < 0:  0
máximo: 0 · mínimo: 0
```

**Nadie tiene ni una ficha.** El coste de retirar la columna es, hoy, cero en datos.

### 1.8 Recomendación de retirada — **NO IMPLEMENTADA**

Dado que (a) el saldo total es 0, (b) el único sumidero está roto, (c) no hay libro mayor y
(d) la F18 declaró moneda única, la recomendación es **retirar `profiles.tokens`**, no
migrarla. No hay saldo que convertir.

Camino propuesto, en cuatro pasos reversibles:

1. **Congelar la concesión.** `rewards.ts:123` deja de pasar `p_tokens`; las recompensas que
   hoy dan fichas pasan a dar DRL Credits por el ledger, con un factor de conversión que
   decidas tú. Sin este paso el saldo dejaría de ser 0.
2. **Arreglar o retirar el sumidero.** `unlockPremiumWithTokens` se reescribe contra
   `PASS_TOKEN_COST` en DRL Credits (por `_ledger_apply`), o se retira el botón de `/logros`.
   Tal como está hoy es una promesa que el servidor no cumple.
3. **Unificar la autoridad del cliente.** `useEventsStore.tokens` y las tres vías de gasto
   del navegador pasan a leer el saldo del servidor. Esto es lo más caro y lo que más
   superficie de UI toca (eventos, forja, pase).
4. **Eliminar la columna** en una migración, cuando 1–3 estén hechos y verificados, con el
   trigger `SEC-02` y `app_grant_reward` limpiados en la misma migración.

**Nada de esto se ha ejecutado.** La columna, el trigger, la RPC y los cuatro llamadores
siguen exactamente como estaban.

---

## 2 · DIAGNÓSTICO DE `economy:verify` — **REPRODUCIDO E IDENTIFICADO**

### 2.1 Pasadas realizadas

| Campaña | Ejecuciones | Verde | Rojo |
|---|---|---|---|
| `credits:verify` consecutivas | 10 | 10 | 0 |
| `economy:verify` consecutivas | 10 | **9** | **1** (pasada 2) |
| Secuencias intercaladas `credits → economy` × 3 ciclos × 2 | 12 | 12 | 0 |
| **Subtotal primera campaña** | **32** | **31** | **1** |
| Segunda campaña dirigida (`2>&1`, parada al primer fallo) | 5 | 4 | **1** (run 5) |
| Batería final de esta sesión | 3 | 3 | 0 |
| **TOTAL** | **40** | **38** | **2** |

Tasa observada: **2/40 = 5,0 %**.

### 2.2 Por qué la primera campaña dijo «0 fallos»

Dos errores míos, y conviene que queden escritos:

1. **No redirigí `stderr`.** El log solo tenía `stdout`.
2. **Conté la marca equivocada.** Busqué `✗` (U+2717); el script imprime **`✕`** (U+2715).
   `grep -c "✗"` devolvió 0 y el resumen del proceso en segundo plano dijo
   «0 fallos totales en toda la campaña». **Era falso.** El fallo estaba en el log.

En la pasada 2 el bloque terminaba en seco tras `## 8 · MERCADO · LECTURAS` con `EXIT=127`,
83 líneas frente a las 97 de una pasada verde. Con `stderr` capturado, la segunda campaña
dio el fallo completo en el run 5.

### 2.3 La comprobación exacta que falla

`scripts/economy-verify.ts:229`, sección **4 · DESGUACE DE DUPLICADOS**:

```
  ✕ y conserva SIEMPRE un ejemplar — 3 de 4
```

Las otras 82 comprobaciones de esa pasada pasaron, incluida la de pago
(`y paga exactamente lo que dice la tabla — +90`, frente a `+60` en las pasadas verdes).

### 2.4 Causa raíz

```ts
// scripts/economy-verify.ts:222
await grant(alice, cheapCard, 3);
// …
// :229
check("y conserva SIEMPRE un ejemplar", line?.salvageable === 2, …);
```

`cheapCard` es la carta de menor OVR del registro: **`yuran__bronze`**. La aserción está
fijada a `2` porque asume que Alice tiene exactamente los 3 ejemplares que acaba de
conceder. Pero la sección **3** ya ha abierto **dos sobres `estandar` (10 cartas)** con esa
misma cuenta, y esos sobres **pueden soltar `yuran__bronze`**. Cuando ocurre, Alice tiene 4
ejemplares, `salvageable` es 3 y la aserción falla.

Probabilidad medida sobre el sorteo real (`openPack`, 20.000 iteraciones de los dos sobres
de §3):

```
P(yuran__bronze sale en los 2 sobres 'estandar' de §3) = 370/20000 = 1,85 %
```

La tasa observada (5,0 % sobre 40) es del mismo orden; con n=40 y p=1,85 % ver 2 fallos es
perfectamente compatible.

### 2.5 Reproducción determinista

Sin tocar la suite, forzando la única variable:

```
cheapCard = yuran__bronze

Caso A · el sobre de §3 NO soltó la carta (98 % de las veces):
  ejemplares previos del sobre: 0 → "✓ y conserva SIEMPRE un ejemplar — 2 de 3"

Caso B · el sobre de §3 SÍ soltó la carta (~1,85 % de las veces):
  ejemplares previos del sobre: 1 → "✕ y conserva SIEMPRE un ejemplar — 3 de 4"
```

Coincide **carácter por carácter** con la línea del fallo real.

### 2.6 Veredicto

**Es un defecto del fixture, no del producto.** `previewSalvage` se comporta
correctamente en los dos casos: informa de 4 ejemplares, 3 desguazables y conserva 1. Lo
que está mal es la cifra fijada a mano en la aserción.

El fallo **no pertenece a la F18**: es de la Fase 11 y precede a todo este trabajo. Por eso
**no lo he corregido** — ver §9, decisión 1. El arreglo es de una línea: medir el número de
ejemplares antes de conceder, en vez de suponerlo.

### 2.7 Warnings y errores, sin ocultar nada

No hubo ningún otro `✕` en las 40 pasadas. Los mensajes que aparecen en las líneas verdes de
§9 (`duplicate key value violates unique constrain`,
`new row for relation "payments" violates chec`) son el **detalle esperado** de
comprobaciones que exigen que la base rechace: son la prueba de que rechaza. `EXIT=127` en
la primera campaña fue el código con el que el shell reportó la pasada fallida sin `stderr`;
con `stderr` capturado el código es `1`, el que el script escribe en su propio epílogo.

---

## 3 · UI DRL CREDITS STORE

**Ruta nueva:** `/tienda/creditos` (`src/app/tienda/creditos/page.tsx`).

### 3.1 Punto de navegación elegido

La sección **«Tienda»** de `src/design/nav.ts` ya existía con dos entradas (Sobres,
Eventos). Se añade una tercera: **«DRL Credits»**. No hay navegación paralela, no hay sección
nueva, no hay menú propio. Además, la tarjeta «Tu saldo» de `/tienda` —que antes era un dato
muerto: te decía que no te llegaba y ahí acababa— ahora enlaza aquí.

### 3.2 Autoridad del servidor

La pantalla **no contiene ni una cifra económica**. El catálogo, las cantidades, los precios
de referencia, el saldo y el historial llegan en la respuesta de `GET /api/game/credits` y se
pintan tal cual. Lo único que el cliente envía es un `productId` del catálogo que acaba de
recibir y un `ref` que identifica la pulsación. Hay una comprobación automatizada que falla
si alguna de las cinco cantidades del catálogo aparece escrita en el fichero.

Si la respuesta del servidor no trae `sandbox: true`, **la pantalla se niega a pintar el
catálogo** y lo dice. Una tienda que escribe «compra completada» sin saber si cobró es
precisamente lo que no queremos.

### 3.3 Estados cubiertos

`sin servidor` · `sin cuenta` · `cargando` · `error` (con reintento) · `catálogo vacío` ·
`listo` · `confirmación` · `concediendo` (botón bloqueado) · `concedido` · `fallo por
producto` (con reintento) · `devolviendo`.

### 3.4 Idempotencia en la interfaz

El `ref` se fija al abrir la confirmación y **se conserva en el reintento**. Con una
referencia nueva por clic, un corte de red después de que el servidor concediera habría
duplicado la concesión al reintentar; reusándola, el servidor reconoce la operación y
devuelve el resultado que se perdió. Este comportamiento está verificado contra la base.

### 3.5 Historial

Sección «Tus movimientos» con fecha, concepto en español (`KIND_LABEL`), movimiento con
signo y saldo resultante. La fuente es `credit_transactions` — el libro mayor real, no una
segunda contabilidad. La tabla se desplaza dentro de su contenedor en pantallas estrechas.

### 3.6 Marca

**«DRL Credits»**, sin traducir, en toda la pantalla. Hay una comprobación que falla si
aparece «Créditos DRL».

---

## 4 · FICHEROS TOCADOS

| Fichero | Cambio |
|---|---|
| `src/app/tienda/creditos/page.tsx` | **nuevo** — la tienda sandbox |
| `src/lib/game/credits.ts` | **nuevo** — cliente de transporte (`fetch`, cero aritmética) |
| `scripts/credits-ui-verify.ts` | **nuevo** — 80 comprobaciones sobre la frontera HTTP |
| `src/design/nav.ts` | entrada «DRL Credits» en la sección Tienda; `isItemActive` resuelve por especificidad |
| `src/app/tienda/page.tsx` | la tarjeta de saldo pasa a ser un enlace a `/tienda/creditos` |
| `package.json` | script `credits:ui:verify` |
| `docs/product/phase-18-1-report.md` | **nuevo** — este informe |

`isItemActive` se tocó porque `/tienda` y `/tienda/creditos` son el primer par anidado del
menú: la comparación por prefijo a secas marcaba **las dos** entradas como activas.

**No se ha creado ninguna migración.** **No se ha tocado `profiles.tokens`.**

---

## 5 · VALIDACIÓN COMPLETA

| Comprobación | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ sin errores |
| `npm test` | ✅ **480/480** |
| `npm run build` | ✅ compila; `/tienda/creditos` aparece como ruta estática |
| `npm run credits:verify` | ✅ **51/51** |
| `npm run credits:ui:verify` | ✅ **80/80** |
| `npm run economy:verify` | ✅ ×3 (con el 1,85 % de §2 conocido y documentado) |
| `npm run security:verify` | ✅ todas |
| `npm run navigation:verify` | ✅ todas |

Comprobado dentro de `credits:ui:verify`: `PAYMENTS_ENABLED === false`,
`GLOBAL_MARKET_ENABLED === false`, precio del pase intacto (`cents: 599`),
`PASS_TOKEN_COST = 1200` intacto, y las cinco cantidades del catálogo siguen siendo
`1000, 2800, 5000, 13500, 28000`.

---

## 6 · SEGURIDAD

Verificado sobre los manejadores reales de la ruta, con Bearer de Supabase auténtico:

- `GET` y `POST` sin Bearer → **401**. Con un Bearer inventado → **401**.
- Los **11** campos económicos prohibidos (`credits`, `amount`, `balance`, `delta`, `price`,
  `cents`, `kind`, `transactionType`, `userId`, `user_id`, `balanceAfter`) → **400** cada
  uno. Se **rechaza**, no se ignora en silencio.
- Suplantación por `userId` en el cuerpo → **400**, y ni el saldo del suplantado ni el del
  atacante se mueven.
- Producto inexistente → **404**. `productId` con `../../etc/passwd`, vacío, acción
  inventada, sin acción, `ref` vacía o de 300 caracteres → **400**.
- Aislamiento: la misma `ref` en dos jugadores concede a los dos (el prefijo de usuario da a
  cada uno su espacio de referencias); devolver con la referencia de otro no toca el saldo
  ajeno.
- Repetir una compra devuelve la misma respuesta y **no mueve el saldo**; el historial
  conserva **un solo** asiento.
- Ninguna respuesta es cacheable (`cache-control: no-store`).

---

## 7 · LO QUE NO SE HA TOCADO

Precios de sobres · probabilidades · recompensas · salvamento · comisión del mercado ·
equilibrio económico · ratios · economía simulada · Combat Resolver · CombatPlan · bots ·
RNG · OVR · stats · CardRegistry · cartas generadas · duelos · rango · `duelRewards` ·
ledger · RLS · auth · entrenador · pipeline VLR · `profiles.tokens`.

Sin pagos reales. Sin Stripe. Sin PayPal. Sin tarjeta. Sin checkout externo. Sin segunda
moneda. Sin NFT, blockchain, crypto ni monederos externos. Sin conversión a dinero, sin
retirada y sin transferencia entre jugadores. Mercado global cerrado.

---

## 8 · DEUDA PENDIENTE

1. **`unlockPremiumWithTokens` está roto** (§1.4). Vía muerta hoy alcanzable desde
   `/logros`. Fuera del alcance de la F18.1.
2. **`profiles.tokens` admite saldo negativo** (§1.2). Sin consecuencias hoy porque el saldo
   total es 0 y el sumidero no funciona.
3. **Dos autoridades de fichas sin reconciliar** (§1.6).
4. **El fixture de `economy:verify` §4 falla ~2 % de las veces** (§2). Diagnosticado, no
   corregido.
5. **`profiles.tokens` sigue en pie**, tal como pedía la instrucción.

---

## 9 · DECISIONES QUE REQUIEREN TU APROBACIÓN

**Decisión 1 — arreglar el fixture de `economy:verify` §4.**
Una línea: medir los ejemplares que Alice ya tiene antes de conceder los 3, en vez de
suponer que no tiene ninguno. No toca el producto ni la economía; solo la aserción. Pertenece
a la Fase 11, no a la F18, así que no lo he tocado. Mientras no se arregle, la puerta de
economía es roja ~1 vez cada 50.

**Decisión 2 — qué hacer con `unlockPremiumWithTokens`.**
Tres opciones: (a) arreglarlo contra la firma real de `app_adjust_credits`, (b) reescribirlo
en DRL Credits por el ledger, o (c) retirar el botón de `/logros`. Hoy la interfaz ofrece
algo que el servidor no puede cumplir.

**Decisión 3 — retirada de `profiles.tokens`.**
Los cuatro pasos de §1.8. El saldo total es 0, así que la ventana para retirarla sin migrar
saldo está abierta **ahora**; en cuanto se conceda una sola ficha más, se cierra.

**Decisión 4 — factor de conversión fichas → DRL Credits**, si eliges el camino de §1.8
paso 1. No lo he inventado.

---

**Sin commit. Sin push. Sin deploy.**
