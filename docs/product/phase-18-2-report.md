# F18.2 REPORT — CIERRE DE LA DEUDA DE TOKENS

**Fecha:** 2026-09-03 · **Rama:** `arch/stabilization` · **Estado:** sin commit, sin push, sin deploy.

Las tres decisiones aprobadas están ejecutadas en el código. La parte SQL está **escrita pero
no aplicada**: esta máquina no tiene ninguna vía de DDL (ni `psql`, ni Supabase CLI, ni URL
de base en `.env.local`), así que las migraciones 0026 y 0027 las tienes que ejecutar tú.
El detalle y el riesgo están en §5.

**DRL Cards tiene ahora UNA sola moneda económica: los DRL Credits.**

---

## 1 · DECISIÓN 1 — EL FIXTURE DE `economy:verify` §4

Arreglado con la mínima modificación: `scripts/economy-verify.ts`, sección 4. Se **mide** lo
que Alice ya tiene antes de conceder, en vez de suponer que no tiene nada.

```ts
const { count: hadBefore } = await admin.from("user_cards")
  .select("uid", { count: "exact", head: true }).eq("user_id", alice).eq("card_id", cheapCard);
const copies = (hadBefore ?? 0) + 3;

await grant(alice, cheapCard, 3);
…
check("y conserva SIEMPRE un ejemplar", line?.salvageable === copies - 1 && line?.copies === copies, …);
```

Ni el motor de desguace, ni el precio, ni la economía se han tocado. Solo la aserción.

**Verificado en el camino que fallaba**, no solo en el común — que seis pasadas verdes no
demuestran nada cuando el fallo aparece el 1,85 % de las veces:

```
Camino comun (el sobre NO soltó la carta):
  sobres previos: 0 → "✓ y conserva SIEMPRE un ejemplar — 2 de 3"
Camino que ANTES fallaba (el sobre SÍ la soltó):
  sobres previos: 1 → "✓ y conserva SIEMPRE un ejemplar — 3 de 4"
Y por si cayeran dos:
  sobres previos: 2 → "✓ y conserva SIEMPRE un ejemplar — 4 de 5"
```

Más 6 pasadas completas consecutivas de `economy:verify`, todas verdes.

---

## 2 · DECISIÓN 2 — `unlockPremiumWithTokens` RETIRADA

No reparada y no convertida a DRL Credits, como pediste.

| Capa | Qué se ha quitado |
|---|---|
| Servicio | `unlockPremiumWithTokens` entera (`src/server/services/progression.ts`) |
| Ruta | `case "unlockPremium"` de `POST /api/game/progression` |
| Cliente | `unlockPremiumWithTokens()` de `src/lib/progression/client.ts` |
| UI | El botón «🎟️ 1.200 fichas» de `/logros` |
| Vista | `ProgressionView.tokens` y `ProgressionView.premiumTokenCost` |
| Config | `PASS_TOKEN_COST = 1200` de `src/config/monetization.ts` |

`PremiumOffer` conserva **solo** el precio anunciado en euros, deshabilitado con su motivo
(§12: no hay pasarela). Queda escrito en el propio componente por qué desapareció el
segundo botón: no era una alternativa que funcionase, era un 409 garantizado.

### 2.1 Auditoría de promesas rotas

Barrido de todo texto, botón y recompensa que prometiera obtener o gastar fichas:

| Sitio | Qué prometía | Resolución |
|---|---|---|
| `/logros` | «🎟️ 1.200 fichas» para abrir el pase | botón eliminado |
| `/eventos` → pestaña **Tienda** | vendía sobres, la carta MVP y 5.000 créditos por fichas | pestaña y `ShopPanel` eliminados |
| `/eventos` → cabecera de tienda | «Tu saldo: 🎟️ N · Tokens de evento» | eliminado |
| `/tienda` | «los sobres de evento… con fichas en lugar de créditos» | texto corregido |
| `/cuenta` | fila «Fichas» | eliminada |
| `GameShell` (barra superior) | contador «🎟️ Fichas de evento» | eliminado |
| `ForgePanel` | saldo «🎟️ N» y coste de receta en fichas | eliminados |
| `RewardChip`, `LiveEventPanel`, `PickemPanel`, `PickemResult`, `PassRail`, `/recompensas`, `lib/collections/format` | chips y líneas «🎟️ N» | eliminados |

Comprobado automáticamente: `ninguna pantalla promete fichas de evento` (14 pantallas
auditadas, ignorando comentarios). Las únicas menciones que quedan son **comentarios de
código** que explican la retirada.

### 2.2 Un fallo que introduje y corregí

`RewardChip.tsx` terminaba con:

```tsx
if (chips.length === 0) chips.push({ icon: "🎖️", text: "Cosmético" });
```

Funcionaba mientras la única recompensa sin chips fuese, de hecho, cosmética. Al quedarse
vacías varias recompensas por la retirada, ese descarte las convertía en **la promesa de un
cosmético que nadie iba a entregar** — justo la clase de promesa rota que había que evitar.

Corregido: el cosmético se pinta por `reward.cosmetics`, los materiales por
`reward.materials`, y una recompensa que no da nada dice **«— Sin premio»**.

---

## 3 · DECISIÓN 3 — RETIRADA DE `profiles.tokens`

### 3.1 ¿`useEventsStore.tokens` era la misma moneda? **Sí.**

Prueba directa: el **mismo campo** `Reward.tokens` alimentaba las dos autoridades.

```ts
// src/store/useEventsStore.ts  (cliente, localStorage)
if (reward.tokens) addTokens(reward.tokens);

// src/server/services/rewards.ts:123  (servidor → profiles.tokens)
p_tokens: clampInt(reward.tokens),
```

Y `src/domain/events/types.ts` lo documentaba: `/** Tokens de evento. */`. Eran la misma
moneda con dos libros que nunca se reconciliaban, y `GameShell.tsx:252` elegía uno u otro
según hubiera sesión — el mismo jugador veía dos saldos distintos según hubiera entrado.

**Eliminado también como moneda y como autoridad económica**, tal como indicaste.

### 3.2 Writers eliminados

| Origen | Antes | Ahora |
|---|---|---|
| `src/server/services/rewards.ts:123` | `p_tokens: clampInt(reward.tokens)` | eliminado |
| `src/store/useEventsStore.ts` `grantReward` | `addTokens(reward.tokens)` | eliminado |
| `src/store/useEventsStore.ts` `recordPackOpened` | `+3` por sobre `+ ev.tokensPerPack` | eliminado |
| `src/lib/rewards.ts` `applyReward` | escribía el store | eliminado |
| `scripts/stability-audit.ts`, `scripts/visual-shots.ts` | sembraban fichas de QA | eliminado |
| SQL `app_grant_reward` | `tokens = tokens + coalesce(p_tokens, 0)` | **migración 0026** |

### 3.3 Readers eliminados

`progression.ts` (select, vista, comprobación de saldo) · `GameShell.tsx` ·
`/cuenta` · `ForgePanel` · `useBattlePassStore` · `useGameStore.craft` ·
`lib/supabase/types.ts` (`Profile.tokens`, `ProfileSyncFields.tokens`) · los seis
renderizadores de chips · `scripts/events-verify`, `game-loop-verify`,
`pickems-integration-test`, `content-verify`, `craft-verify`, `battlepass-verify`.

### 3.4 Superficie de tipos eliminada

`Reward.tokens` · `RecipeCost.tokens` · `CraftContext.tokens` · `CraftResult.tokensAfter` ·
`CraftIssueCode "INSUFFICIENT_TOKENS"` · `SeasonDef.premiumCost.tokens` ·
`EventDef.tokensPerPack` · `ShopItemDef` (entero) · `EventDef.shop` ·
`EventsState.tokens` · `EventsState.shopPurchases` · `buyShopItem`.

### 3.5 Un sumidero que hubo que cerrar: el escaparate de evento

`ShopItemDef.cost` estaba denominado en fichas y era su **único sumidero de cliente**.
Vendía sobres, la carta MVP del evento y un paquete de 5.000 créditos.

Se ha retirado entero. No se ha reubicado en DRL Credits porque eso habría sido una
conversión de una moneda en otra —expresamente prohibida— y además habría tocado precios.
Queda escrito en `/eventos` y en `data/events.ts`.

### 3.6 Un regalo que hubo que impedir

Al quitar las fichas, `premiumCost` se quedó **vacío** en las dos temporadas
(`{ tokens: 1200 }` → `{}`, `{ tokens: 950, credits: 0 }` → `{}`). El
`useBattlePassStore.unlockPremium` del cliente leía `cost.credits ?? 0` y comparaba contra
el saldo: con coste 0, **habría regalado el carril de pago a todo el mundo**.

Corregido con un corte explícito: sin precio mayor que cero no hay compra —
*«El pase de esta temporada no está a la venta»*.

### 3.7 Recompensas que se quedaron vacías

Al quitar el componente de fichas **sin conversión**, 8 literales de recompensa quedaron en
`{}`. Siete de ellos siguen entregando XP por otra vía:

| Sitio | Qué daba | Qué da ahora |
|---|---|---|
| `data/events.ts:14/16/17` y `engine/eventGenerator.ts:14/16/17` | 80 / 100 / 70 fichas | los 200 / 250 / 200 de XP del pase de evento (se pintan) |
| `data/seasons.ts:32` (misión diaria «Gana 1 partido») | 20 fichas | los 250 XP de la misión |
| `data/seasons.ts:45` (objetivo comunitario) | 300 fichas | los 2.000 XP de la misión |
| **`domain/events/daily.ts:12` (día 5 de la racha diaria)** | **60 fichas** | **nada — «Sin premio»** |

El día 5 es el único hueco real, y **no lo he rellenado**: poner créditos ahí sería
exactamente la conversión que prohibiste. Está en §7 como decisión tuya. Es contenido de
modo local: con sesión iniciada la reclamación diaria ya está deshabilitada.

---

## 4 · LO QUE NO SE HA TOCADO

`profiles.credits` · `credit_transactions` · `economy_ops` · `_ledger_apply` ·
`app_adjust_credits` · `app_sandbox_purchase` · `app_sandbox_refund` · `payments` ·
precios de sobres · probabilidades · recompensas de DRL Credits · salvamento ·
`marketValue` · marketplace · pagos · `PAYMENTS_ENABLED` (sigue `false`) ·
`GLOBAL_MARKET_ENABLED` (sigue `false`).

**No se ha creado ninguna segunda moneda.** **No se ha creado ninguna conversión.**

Los `token` de **autenticación** no se han tocado: `access_token`, `Bearer`, `getSession`,
`bearerToken`, `adminAuth`, los cubos del *rate limiter* de `platform/cloud/gateway.ts`, los
*design tokens* de `ui-core` y las «fichas» de la pizarra táctica, la carrera de entrenador y
la retransmisión. `credits:ui:verify` sigue autenticando con Bearer reales y comprobando los
401.

---

## 5 · MIGRACIÓN SEGURA — ESTADO

Seguí tu orden: primero las dependencias funcionales, luego la búsqueda exhaustiva, luego
los tests, luego la comprobación de que ningún flujo necesita fichas, luego el saldo.

| Paso | Estado |
|---|---|
| 1. Eliminar dependencias funcionales | ✅ hecho (§2, §3) |
| 2. Búsqueda exhaustiva de referencias | ✅ hecha (§6) |
| 3. Tests | ✅ 480/480 |
| 4. Ningún flujo requiere fichas | ✅ `loop:verify`, `events:verify`, `progression:verify`, `battlepass:verify`, `craft:verify`, `content:verify`, `test:pickems` verdes |
| 5. `profiles.tokens` sigue a 0 | ✅ **43–45 perfiles, suma 0, nadie con saldo, ninguno negativo** |
| 6. Migración | ✍️ **escrita, NO aplicada** |

### 5.1 `supabase/migrations/0026_retire_event_tokens_rpc.sql` — NO destructiva

Elimina el parámetro `p_tokens` de `app_grant_reward` y con él la última vía de escritura.
El cuerpo de la función se reproduce **carácter por carácter** salvo esa línea: mismos
créditos, mismo XP, mismos puntos con su suelo, mismo asiento, mismos sobres, cartas y
cosméticos, misma idempotencia. Reversible reaplicando 0018.

**No rompe nada si tardas en aplicarla.** Comprobado: el código ya no envía `p_tokens`, y la
firma actual (que lo tiene con `default 0`) resuelve igual la llamada. `loop:verify` pasa
ahora mismo contra la base sin migrar — *«una recompensa completa se concede en una sola
llamada»*, *«créditos, XP y puntos se mueven juntos»*.

### 5.2 `supabase/migrations/0027_drop_profiles_tokens.sql` — **DESTRUCTIVA**

Contenido exacto, en una sola transacción:

1. `create or replace` de `profiles_guard_protected_columns()` **sin** la línea de `tokens`.
2. Un bloque `do $$` que **aborta la migración entera** si `sum(tokens) <> 0` o si algún
   perfil tiene saldo.
3. `alter table public.profiles drop column tokens;`

**El riesgo, sin adornos:**

- `DROP COLUMN` **no es reversible**. Volver a añadir la columna la devuelve con todos los
  saldos a 0 y sin forma de saber cuáles eran. Hoy da igual —son 0— y por eso la ventana es
  ahora; en cuanto se conceda una ficha más, deja de darlo.
- **El trigger tiene que ir en la misma transacción.** El cuerpo de una función plpgsql no se
  valida al crearla: si se borrase la columna dejando el guardián como está, la migración
  pasaría sin queja y **todo `UPDATE` sobre `profiles` empezaría a fallar en caliente**. Por
  eso van juntos y por eso hay `begin`/`commit`.
- El bloque de aborto del paso 2 es el cinturón: si entre mi medición y tu ejecución alguien
  recibiera fichas, la migración se niega en vez de destruir un saldo.
- Tras aplicarla, `PROTECTED_COLUMNS` de `security:verify` ya no incluye `tokens` (pedirle a
  la base que rechace una escritura sobre una columna inexistente no prueba nada), y
  `supabase/tests/0009_0010_security_test.sql` ya está actualizado. **Ambos cambios ya están
  hechos en el repo**, así que aplica 0027 y la suite de seguridad seguirá cuadrando.

**No la he ejecutado.** Además de que pediste explicártela antes, esta máquina no tiene
forma de ejecutar DDL.

---

## 6 · BÚSQUEDAS RESIDUALES

| Búsqueda | Resultado |
|---|---|
| `profiles.tokens` en código | 0 (solo el propio verificador, que comprueba que está a 0 o ya no existe) |
| `p_tokens` | 0 en código ejecutable; 2 comentarios que explican por qué se fue |
| `unlockPremiumWithTokens` | 0 en código; solo las comprobaciones que verifican su ausencia |
| `useEventsStore.tokens` | **0 apariciones de `tokens` en todos los stores** |
| moneda de fichas de evento (`Reward.tokens`, `RecipeCost.tokens`, `tokensPerPack`, `ShopItemDef`) | 0 |
| botón o texto que prometa fichas | 0 en 14 pantallas auditadas |
| tokens de autenticación | intactos y verificados |

---

## 7 · VALIDACIÓN

| Comprobación | Resultado |
|---|---|
| `npm test` | ✅ **480/480** |
| `npm run typecheck` (app + scripts) | ✅ sin errores |
| `npm run build` | ✅ 51 páginas |
| `npm run security:verify` | ✅ todas |
| `npm run credits:verify` | ✅ **51/51** |
| `npm run economy:verify` | ✅ (+6 pasadas seguidas verdes) |
| `npm run credits:ui:verify` | ✅ **91/91** |
| `npm run navigation:verify` | ✅ todas |
| `events:verify` · `loop:verify` · `progression:verify` · `battlepass:verify` · `craft:verify` · `content:verify` · `ui-core:verify` · `test:pickems` | ✅ todas |

`credits:ui:verify` incorpora una **sección 13 · UNA SOLA MONEDA** con 11 comprobaciones que
fallan si la segunda moneda vuelve por cualquier vía: el tipo, el escaparate, el coste de
forja, el store, la RPC, el servicio, la ruta, el cliente, las pantallas y el dato.

---

## 8 · FICHEROS TOCADOS

**Nuevos (2):** `supabase/migrations/0026_retire_event_tokens_rpc.sql`,
`supabase/migrations/0027_drop_profiles_tokens.sql`.

**Modificados (44):** `scripts/economy-verify.ts` · `scripts/credits-ui-verify.ts` ·
`scripts/{battlepass,content,craft,events,game-loop,security}-verify.ts` ·
`scripts/{pickems-integration-test,stability-audit,visual-shots}.ts` ·
`src/domain/events/{types,daily,pass,challenges}.ts` + su test ·
`src/domain/collections/{achievements,local}.ts` · `src/domain/pickems/rewards.ts` ·
`src/domain/collection/{mastery,prestige}.test.ts` ·
`src/domain/progression/duelRewards.test.ts` ·
`src/craft/{types,engine,recipes}.ts` · `src/battlepass/types.ts` + `tracks.test.ts` ·
`src/data/{events,season,seasons}.ts` · `src/engine/eventGenerator.ts` ·
`src/store/{useEventsStore,useGameStore,useBattlePassStore}.ts` · `src/lib/rewards.ts` ·
`src/lib/collections/format.ts` · `src/lib/supabase/types.ts` ·
`src/lib/progression/client.ts` · `src/server/services/{progression,rewards,mastery}.ts` ·
`src/app/api/game/progression/route.ts` · `src/app/api/admin/tournaments/route.ts` ·
`src/app/{eventos,logros,cuenta,recompensas,tienda}/page.tsx` ·
`src/app/admin/data-engine/page.tsx` · `src/components/layout/GameShell.tsx` ·
`src/components/craft/ForgePanel.tsx` · `src/components/events/{RewardChip,LiveEventPanel}.tsx` ·
`src/components/pickems/{PickemPanel,PickemResult}.tsx` ·
`src/components/progression/PassRail.tsx` · `src/config/monetization.ts` ·
`supabase/tests/0009_0010_security_test.sql`.

---

## 9 · DECISIONES QUE REQUIEREN TU APROBACIÓN

**A — Aplicar 0026** (no destructiva). Corta la última vía de escritura. Puede aplicarse hoy
sin ventana de riesgo: el código ya funciona con y sin ella.

**B — Aplicar 0027** (destructiva, §5.2). Borra la columna. Segura **hoy** porque el saldo es
0 y lleva su propio cinturón de aborto; deja de serlo en cuanto se conceda una ficha.

**C — El día 5 de la racha diaria** (`domain/events/daily.ts`), que daba 60 fichas y ahora no
da nada. Rellenarlo con créditos sería la conversión que prohibiste, así que no lo he hecho.
Puedes: dejarlo así, darle un sobre, reducir el ciclo a 6 días, o autorizar un valor en DRL
Credits.

**D — La tienda de evento retirada** (§3.5). Vendía sobres, la carta MVP del evento y un
paquete de créditos. Si quieres recuperarla algún día habrá que denominarla en DRL Credits,
lo cual es una decisión de precios que no he tomado.

---

**Sin commit. Sin push. Sin deploy.**
