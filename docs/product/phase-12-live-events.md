# FASE 12 — EVENTOS EN VIVO Y CALIBRACIÓN ECONÓMICA

> Medir antes de decidir. Y decidir con lo medido, aunque lo medido diga que la fase
> anterior se equivocó.
>
> Estado: **entregada y verificada**. `npm test` **447/447** · typecheck ✅ · build ✅ ·
> `security:verify` ✅ (**+16**) · `economy:verify` ✅ · **`events:verify` ✅ (nuevo, 32
> comprobaciones)** · `loop:verify` ✅ · `ux:verify` ✅ · `audit:stability` **P0 0 · P1 0** ·
> `audit:interactions` ✅ · `duel:e2e` ✅ · `duel-gameplay` ✅ · `progression` ✅ · `strats` ✅ ·
> `sw:verify` ✅ · `test:integration` ✅ · `test:pickems` ✅ · `test:e2e` ✅.

---

## 1 · EL TITULAR

**La Fase 11 midió la función equivocada, y esta fase lo ha corregido con datos.**

Aquella tabla que decía «los sobres devuelven entre 7 y 15 veces su precio» medía
`instanceValue` —que multiplica hasta ×5 por número de serie— y no `marketValue`, que es el
ancla del mercado. Con la función correcta, la ratio es de **1,8× a 3,4×**. Y esa ratio,
además, es la métrica equivocada: compara una tasación por CARTA contra un precio por SOBRE.

La cuenta buena —lo que vale una carta frente a lo que cuesta conseguir una de su rareza— da
entre **0,28× y 1,08×** en las cinco rarezas. **El ancla nunca estuvo rota.**

Lo que sí era cierto de la Fase 11 se mantiene: usar `quickSellValue` para el desguace
devolvería entre 7,3 y 12,2 veces el precio del sobre. Esa impresora existe y sigue cerrada.
**La decisión era correcta; la justificación estaba mal medida.**

---

## 2 · LAS HERRAMIENTAS NUEVAS

| Herramienta | Qué responde |
|---|---|
| **`npm run economy:model`** | «¿Cómo están calibradas las piezas?» — 7 secciones, 20.000 aperturas por sobre con el motor real, semilla fija |
| `npm run economy:simulate` (v2) | «¿Cómo le va a un jugador?» — ahora a **7 / 30 / 84 días** y con el desglose de **de dónde viene cada crédito** |
| **`npm run events:verify`** | «¿Se puede romper la capa de eventos?» — 32 ataques contra la base de datos real |

`economy:model -- --emit` escribe `src/data/packStats.ts`, que es lo que la tienda enseña. Un
test vuelve a medir con una muestra pequeña y compara: si alguien toca los pesos, los precios
o el catálogo, cae.

---

## 3 · LO QUE LA MEDICIÓN ENCONTRÓ

**a) La escalera de sobres es coherente, y nadie lo había comprobado.** Cada sobre de la
escalera principal es la vía más barata de exactamente un escalón de rareza, en orden de
precio: Estándar → común y poco común · Premium → rara · Masters → épica · Icon →
legendaria.

**b) El catálogo está muy escorado.** 299 comunes, 423 poco comunes, **34 raras, 9 épicas y
7 legendarias**. Por eso un sobre caro repite tanto: concentra el sorteo en 50 cartas.

**c) El sobre China está roto.** Cuesta 3.000 —lo mismo que sus tres hermanos regionales— y
declara un 6 % de épicas y un 1 % de legendarias. **No existe ni una sola carta épica o
legendaria de un jugador de China**, así que esas probabilidades son inalcanzables. Entrega
un **44–49 % menos de valor** por el mismo precio.

**d) La banda de precio superior es enorme.** `max_price_mult = 10` permite listar una
legendaria por 206.964 créditos: **276 sobres Estándar**.

---

## 4 · QUÉ SE HA HECHO CON ESO

**Nada de cambiar números por intuición.** No se ha tocado ni un precio, ni un peso, ni una
probabilidad, ni la tabla de desguace, ni las recompensas de duelo. Lo que se ha hecho es
**dejar de ocultar lo medido**:

La tienda enseña ahora el **reparto REAL** (medido, no los pesos declarados: el Premium
declara 30 % de comunes y entrega 25,2 %, porque la garantía ocupa una casilla), el **coste
por carta de cada rareza**, y **para qué sirve cada sobre** — con su advertencia cuando
procede:

> *Sobre Premium — La vía más barata para conseguir una rara: unos 1.552 créditos por carta.*
> *Para AMPLIAR colección sale caro: cada carta común cuesta unas 6 veces más que en el sobre barato.*

> *Sobre China — No contiene ninguna carta épica ni legendaria: no hay jugadores de esta
> selección con esa rareza.*

Ninguna de esas frases está escrita a mano: las calcula `domain/packs/guidance` sobre lo
medido. Si el catálogo cambia, cambian solas y no pueden quedarse mintiendo.

---

## 5 · EL MERCADO: CRITERIOS, NO OPINIONES

Hasta hoy, abrir el mercado era cambiar un `false` por un `true`. Ahora hay **diez criterios
escritos** (`domain/economy/marketReadiness.ts`), cada uno con lo que se rompería sin él y
quién lo decide.

**Nueve de diez se cumplen.** El que falta es la masa de jugadores, y **no se puede decidir
desde el repositorio**: depende de cuánta gente esté jugando. Se declara `unknown`, y
**`unknown` no cuenta como cumplido**.

**Veredicto: NO ABRIR TODAVÍA.** No por un problema técnico —la infraestructura está lista y
verificada— sino porque un mercado con cuatro personas no descubre precios: los inventa el
primero que publica.

Y hay cerrojo: `marketReadiness.test.ts` afirma que, si `GLOBAL_MARKET_ENABLED` estuviera en
`true`, todos los criterios evaluables sin base de datos tendrían que estar cumplidos. El día
que alguien lo encienda con la economía sin calibrar, `npm test` cae y dice cuál falta.

---

## 6 · EVENTOS EN VIVO

La Fase 10 dejó el hueco escrito: «Eventos server-side». La Fase 12 lo cierra **sin crear ni
una tabla**.

Un evento de NEXUS **ES** un torneo de `public.events`. Lo que faltaba no era una entidad:
era la función que traduce dos marcas de tiempo en una fase, ejecutada en el servidor.

```
UPCOMING → LIVE → ENDING (48 h) → COMPLETED (7 días de plazo) → ARCHIVED
```

**La fecha manda sobre el estado.** `status` lo escribe la sincronización y puede ir
rezagado; `end_date` es un hecho. Si se confiara en `status`, un torneo terminado seguiría
pagando hasta la siguiente pasada.

**Por qué hay plazo de gracia:** los puntos de un Pick'em se corrigen CUANDO acaba el torneo,
así que «acierta 3 predicciones» solo se puede completar después del final. Cerrar la puerta
en el pitido final dejaría sin cobrar a quien lo ganó.

**Seis desafíos**, elegidos por los CAMPOS del evento y nunca por su id. El progreso se
cuenta al vuelo sobre `pickem_scores`, `duel_matches` y `economy_ops`; lo reclamado va a
`user_achievements` con el id `event:<evento>:<desafío>`, que ya trae historial y RLS gratis.

**El cliente envía dos identificadores.** Ni cantidades, ni recompensas, ni fechas, ni
progreso. Lo vigila `security:verify`.

Detalle completo en `events.md`.

---

## 7 · CUÁNTO PESA EL CONTENIDO VIVO

Era la condición para añadirlo: que fuera contenido y no un grifo. Medido sobre 84 días:

| Perfil | Créditos de eventos | % de todo lo que gana |
|---|---|---|
| Casual | 9.900 | **8,7 %** |
| Activo | 16.500 | **4,5 %** |
| Intensivo | 16.500 | **1,5 %** |

Y hay una prueba que falla si un conjunto de desafíos supera el 15 % del grifo de temporada.

---

## 8 · COSMÉTICOS: EL CICLO, POR FIN CERRADO

La Fase 11 dejó equipar. Faltaba verlos. Ahora el **título** aparece bajo el nombre, el
**banderín** junto a él y el **marco** rodea el avatar.

No es un sistema cosmético: es un diccionario de presentación de 15 entradas. Y un cosmético
que se reparta mañana y no esté en él **no desaparece**: se enseña con su nombre derivado del
id y el tono neutro. Un cosmético concedido y no pintado sería otra vez el fallo de la
Fase 10.

---

## 9 · ARCHIVOS

**Nuevos (12):** `domain/events/lifecycle.ts` + test · `domain/events/challenges.ts` + test ·
`domain/packs/guidance.ts` + test · `domain/economy/marketReadiness.ts` + test ·
`domain/cosmetics/catalog.ts` · `data/packStats.ts` (generado) + test ·
`server/services/events.ts` · `app/api/game/events/route.ts` · `lib/game/events.ts` ·
`components/events/LiveEventPanel.tsx` · `scripts/economy-model.ts` ·
`scripts/events-verify.ts` · `docs/product/events.md` · este informe

**Modificados (8):** `app/page.tsx` · `app/cuenta/page.tsx` ·
`components/packs/PackStoreCard.tsx` · `scripts/economy-simulate.ts` ·
`scripts/security-verify.ts` · `scripts/visual-shots.ts` · `package.json` ·
`docs/product/economy.md` · `docs/product/marketplace.md` · `docs/product/visual/README.md`

**Migraciones: ninguna.**

---

## 10 · QUÉ **NO** SE HA MODIFICADO

Combat Resolver · CombatPlan · reglas de duelo · bots · RNG · OVR · estadísticas ·
generación de cartas · CardRegistry · motor de sobres · **precios y probabilidades de
`data/packs`** · `domain/economy/pricing.ts` · `domain/economy/salvage.ts` ·
`domain/progression/rank.ts` · `domain/progression/duelRewards.ts` · `services/rewards.ts` ·
`services/duels.ts` · `services/pickemLifecycle.ts` · `services/market.ts` ·
`services/economy.ts` · RLS · auth · service worker · sistema táctico · replays ·
`useEventsStore` y `/eventos` (el modo sin cuenta sigue intacto) · el lenguaje visual de la
Fase 9.6.

---

## 11 · QUÉ QUEDA PARA LA FASE 13

| Pendiente | Qué exige |
|---|---|
| **Cartas de rareza alta de jugadores de China** | Es contenido, no código. Hoy el sobre China cobra por unas probabilidades que no puede cumplir |
| **Sumidero de fin de juego** | Sigue sin existir. El Intensivo llega al 91 % del catálogo y deja de tener dónde gastar |
| **Estrechar la banda superior del mercado** | `max_price_mult = 10` permite 276 sobres por una carta. Requiere ventas reales para elegir el número con datos |
| **`Prime` está dominado** | No es la vía barata de nada y no restringe el sorteo. O baja de precio o gana una restricción que lo justifique |
| **La tienda de fichas del evento** | Las fichas ya son server-authoritative; la tienda que las gasta sigue siendo local |
| **Desafíos por partido** | Hoy el alcance es el torneo entero |
| **Masa de jugadores** | El único criterio que bloquea el mercado, y el único que no se resuelve escribiendo código |
