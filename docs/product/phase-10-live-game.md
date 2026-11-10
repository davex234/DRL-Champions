# FASE 10 — NEXUS COMO PRODUCTO DE JUEGO VIVO

> De un conjunto de sistemas correctos y aislados a **un ciclo de juego conectado**.
>
> Estado: **entregada y verificada**. `npm test` 396/396 · typecheck ✅ · build ✅ ·
> `security:verify` ✅ · `ux:verify` ✅ · `audit:stability` **P0 0 · P1 0** ·
> `audit:interactions` ✅ · `duel:e2e` ✅ · `test:e2e` ✅ · `sw:verify` ✅ ·
> **`loop:verify` ✅ (nuevo)**.

---

## 1 · AUDITORÍA INICIAL

Método: leer el esquema (18 migraciones, 65 tablas, 37 funciones), los seis servicios de
servidor, los trece dominios y las pantallas. No se ha modificado nada hasta terminarla.

### El diagnóstico en una frase

**NEXUS tenía todas las piezas y ninguna sabía de las otras.**

No faltaba funcionalidad: faltaban las **flechas** entre sistemas que sí funcionaban. Y en
tres sitios la flecha no es que estuviera mal — es que no existía en producción.

### Los cinco estados que pedía el encargo

| Estado | Sistemas |
|---|---|
| **1 · Completamente funcional** | Sincronización competitiva (VLR+mock) · corrector de Pick'ems · cierre server-side de predicciones · duelos + Combat Resolver · repeticiones · apertura de sobres · pase de temporada · logros · rangos · colección · mazos |
| **2 · Parcialmente funcional** | `app_grant_reward` entregaba 4 de los 7 campos de `Reward` · los cosméticos se escribían fuera de la transacción · `serverProgressFor` solo resuelve 3 de 7 logros |
| **3 · Visual solamente** | Nada. No se encontró ninguna pantalla que fingiera un sistema inexistente |
| **4 · Preparado pero desconectado** | **Mercado completo y apagado** · `scorePickemEvent` solo lo llamaban tests · generación de preguntas solo en `seed-demo` · `user_cosmetics` se llena y no se puede ver ni equipar · `duel_matches.winner` indexado y sin consumidor de progresión |
| **5 · Marcado como pendiente** | `GLOBAL_MARKET_ENABLED = false` · venta rápida deshabilitada online · `PAYMENTS_ENABLED = false` · materiales de crafteo sin ruta de servidor |

### Los cuatro huecos que rompían el ciclo

**A · Nadie abría ni corregía predicciones.** La sincronización traía partidos y
resultados; el corrector repartía puntos y recompensas; **entre los dos, nada**. Las
preguntas solo las creaba `scripts/seed-demo.ts` y `scorePickemEvent` solo lo llamaban
`demo-flow-test`, `demo-resolve` y `pickems-integration-test`. En producción, un torneo
real entraba, se jugaba, terminaba y ninguna predicción se abría ni se corregía jamás.

**B · Los duelos no daban nada.** Ni un crédito, ni XP, ni un punto. `services/duels.ts`
no tenía una sola llamada a recompensas. Y `profiles.points` —de donde salen el rango, la
escalera de ocho escalones y la clasificación— solo la escribía el corrector de Pick'ems:
**el rango de NEXUS era un ranking de pronosticadores**, y la pantalla lo decía.

**C · Las recompensas se repartían por tres sitios.** `pickems.ts` llamaba a la RPC con
cuatro campos; `progression.ts` llamaba a la RPC y **después** escribía los cosméticos
fuera de su transacción (si esa segunda escritura fallaba, la puerta de idempotencia ya
estaba cerrada y el reintento no daba nada); y `useEventsStore` concedía en el navegador.

**D · Ninguna pantalla sabía de las otras.** El jugador tenía que recordar que le quedaban
sobres, que había predicciones cerrando y que tenía niveles sin reclamar.

---

## 2 · SISTEMAS QUE YA EXISTÍAN (y no se han tocado)

Sincronización competitiva · Combat Resolver · CombatPlan · reglas de duelo · bots · RNG ·
OVR · estadísticas · generación de cartas · CardRegistry · reglas de mazo · RLS · auth ·
service worker · APIs seguras · repeticiones · motor táctico · motor del pase ·
`app_score_pickem_event` · `app_submit_pick` · `app_buy_pack` · `app_apply_pack_open` ·
motor de torneos y su generación de cartas.

---

## 3 · SISTEMAS QUE ESTABAN INCOMPLETOS

| Sistema | Qué le faltaba |
|---|---|
| `app_grant_reward` | Puntos, cartas y cosméticos: tres de los siete campos de `Reward` |
| Ciclo de Pick'ems | Todo el tramo intermedio (generar y resolver) |
| Duelos | Cualquier conexión con la economía y la progresión |
| Eventos | Autoridad de servidor: su economía vive en `localStorage` |
| Mercado | Portar de `public.inventory` a `user_cards` |

---

## 4 · QUÉ SE HA CONECTADO

```
CIRCUITO REAL → PICK'EM → RESULTADO → PUNTOS → RECOMPENSA → PROGRESIÓN
     ▲                                                            │
     │                                                            ▼
«QUÉ HACER AHORA» ← RANGO ← DUELO ← MAZO ← COLECCIÓN ← SOBRES ────┘
```

1. **Torneo → predicción → resultado → recompensa.** `pickemLifecycle` corre dentro de la
   sincronización competitiva. Genera una pregunta por partido predecible, fija el
   resultado de los terminados y corrige. Idempotente de arriba abajo.
2. **Duelo → puntos + créditos + XP → rango.** `awardMatchOutcome` paga al terminar, con
   la partida como clave de idempotencia, y la pantalla de resultado enseña las tres
   cifras.
3. **Una sola ruta de recompensa.** `services/rewards.award()` es la única forma de
   conceder algo. Los siete campos de `Reward` en una transacción; lo que no se puede
   entregar se declara.
4. **El ciclo, visible.** `getLoop` → `GET /api/game/loop` → la tira «Qué hacer ahora» del
   vestíbulo.
5. **Los eventos dicen la verdad.** Con cuenta, el evento local queda en solo lectura con
   su motivo escrito y señala dónde está la progresión real.

---

## 5 · ARQUITECTURA NUEVA

| Pieza | Qué es | Puro |
|---|---|---|
| `supabase/migrations/0018_game_loop.sql` | `app_grant_reward` extendido a 7 campos + índices | — |
| `server/services/rewards.ts` | **La ruta única de recompensa** | no |
| `server/services/pickemLifecycle.ts` | Los cuatro pasos del ciclo de Pick'ems | no |
| `server/services/loop.ts` | «Qué hacer ahora», calculado en servidor | no |
| `domain/progression/duelRewards.ts` | Tabla de pago del duelo + tope diario | **sí** |
| `domain/pickems/questions.ts` | Partidos → preguntas; resultados → respuestas | **sí** |
| `app/api/game/loop/route.ts` | Lectura del ciclo (GET, exige sesión) | — |
| `lib/game/loop.ts` · `components/loop/NextUp.tsx` | Cliente y presentación | — |
| `scripts/game-loop-verify.ts` | Verificación de la cadena entera | — |
| `scripts/pickem-lifecycle.ts` | Herramienta de operación | — |

**Todo data-driven.** Ni un `if tournament === "…"`. Las decisiones viven en tablas:
`PAYOUT` (duelos), `POINTS_BY_ROUND` (preguntas), `REWARD_TIERS` (Pick'ems), `KIND`
(pasos del ciclo). Se reutilizan las entidades existentes —`events`, `matches`,
`pickem_events`, `Reward`— y **no se ha creado ninguna entidad paralela**.

---

## 6 · ARCHIVOS

**Nuevos (13):** los de la tabla de arriba, más `domain/progression/duelRewards.test.ts`,
`domain/pickems/questions.test.ts`, `docs/product/game-loop.md`, `docs/product/economy.md`.

**Modificados (10):**
`server/services/progression.ts` (una llamada en vez de dos) ·
`server/services/pickems.ts` (ruta única) ·
`server/services/duels.ts` (pago + tope) ·
`lib/duel/types.ts` (`DuelAwardView`) ·
`lib/esports/sync/orchestrator.ts` (paso 7) ·
`app/api/admin/tournaments/route.ts` (acción nueva) ·
`app/page.tsx` (tira del ciclo) ·
`app/torneos/page.tsx` (escenario) ·
`app/eventos/page.tsx` (aviso de autoridad) ·
`components/duel/ResultScreen.tsx` (banda «Has ganado») ·
`scripts/security-verify.ts` (10 comprobaciones nuevas) · `package.json`.

---

## 7 · QUÉ **NO** SE HA MODIFICADO

Combat Resolver · CombatPlan · reglas de duelo · bots · RNG · OVR · estadísticas ·
generación de cartas · CardRegistry · OwnershipIndex · reglas de mazo · RLS · auth ·
seguridad · service worker · sistema de replays · motor táctico · `app_score_pickem_event` ·
`app_submit_pick` · `app_buy_pack` · `app_apply_pack_open` · `app_grant_cards` ·
`domain/progression/rank.ts` · el lenguaje visual de la Fase 9.6.

`duel:e2e` juega una partida completa con clics reales y `duel-gameplay:verify`,
`progression:verify`, `strats:verify`, `sw:verify`, `test:integration` y `test:pickems`
pasan sin cambios en ninguno de esos ficheros.

---

## 8–17 · ESTADO POR SISTEMA

| Sistema | Antes | Ahora |
|---|---|---|
| **8 · Torneos** | Listado por estado; tarjetas iguales | **Escenario** del torneo vivo con partido en directo, fechas, equipos y predicciones abiertas; el resto en filas |
| **9 · Pick'ems** | Panel completo; preguntas solo por semilla; nadie corregía | **Ciclo completo y automático** dentro de la sincronización. Cierre por pregunta, puntos por ronda, corrección incremental |
| **10 · Rewards** | Tres rutas; 4 de 7 campos | **Una ruta**, 7 campos, una transacción; lo no entregable se declara |
| **11 · Progresión** | XP solo al reclamar misiones | Además: **cada duelo paga XP y créditos**, y los puntos mueven el rango y abren el carril competitivo |
| **12 · Battle Pass** | Correcto y desconectado del juego | Conectado por dos vías: métricas de duelo (misiones) y puntos (carril competitivo) |
| **13 · Eventos** | Economía local que se borraba en silencio | **Declarado**: solo lectura con cuenta, con motivo y salida. Ruta de migración escrita |
| **14 · Economía** | Sin modelar | **Modelada con cifras reales** (`economy.md`). Un solo sumidero detectado; vía de inflación del duelo cerrada con tope diario |
| **15 · Mercado** | Completo y apagado, sin plan | **Plan escrito**: 4 pasos y 7 riesgos cubiertos (`economy.md`) |
| **16 · Duelos → Rango** | **No existía** | Tabla de 9 celdas, tope de 20 partidas/día, resultado visible en pantalla |
| **17 · Replay** | Funcional | Sin cambios: no hacía falta tocarlo |

---

## 18–24 · VERIFICACIÓN

| | |
|---|---|
| **18 · Tests** | ✅ **396 / 396** (19 nuevos: 11 de duelo, 11 de preguntas) |
| **19 · Typecheck** | ✅ app + scripts |
| **20 · Build** | ✅ `/api/game/loop` incluida |
| **21 · Security** | ✅ + **10 comprobaciones nuevas** sobre la RPC extendida, la ruta del ciclo y el pago del duelo |
| **22 · E2E** | ✅ `duel:e2e` (partida completa con clics) · `test:e2e` (HTTP) · `test:integration` · `test:pickems` |
| **23 · UX** | ✅ 22 pantallas × 5 anchos (390 / 768 / 1024 / 1440 / 1920) |
| **24 · P0 / P1** | ✅ **P0 0 · P1 0** (P2 3: los 401 preexistentes de `/admin` sin token) |
| **Ciclo** | ✅ `loop:verify` — 45 comprobaciones sobre la cadena entera |

### Tres falsos positivos que investigué y descarté

1. **`audit:stability` P1 ×2** en `/mercado → /tienda`. Reproducido: con 2,6 s de espera el
   router no llegaba; con 9 s sí. Era el **`.next` frío** que yo mismo había borrado, no un
   enlace roto. Con las rutas compiladas: P1 0.
2. **`sw:verify` inconcluso**. Causa: un `next start` **mío** olvidado en el puerto 3123
   durante la depuración, que servía un `.next` corrupto. Muerto el proceso: ✅ PASA.
3. **`loop:verify` ×2** tras sembrar la demo. El ciclo elige el torneo en curso más
   antiguo, que pasó a ser el sembrado y no el de la prueba. Era **aislamiento del test**:
   se corrigió la prueba para afirmar sobre su propio torneo, no sobre el orden de la
   semilla.

---

## 25 · CAPTURAS

`docs/product/visual/96-despues/` (Fase 9.6 = antes) → `docs/product/visual/fase10-despues/`.

**Cinco ficheros, no cuarenta y tres**, porque son las cinco pantallas que realmente
cambiaron: inicio (1440 y 390), torneos, eventos y resultado de duelo. Guardar cuarenta
capturas idénticas para enseñar cinco cambios sería llenar el repositorio de ruido.

---

## 26 · QUÉ QUEDA

| Pendiente | Qué exige |
|---|---|
| **Eventos server-side** | Migrar métricas, misiones, tienda y pase de evento a la ruta única. Camino escrito en `game-loop.md` |
| **Reabrir el mercado** | Portar 3 RPC de `public.inventory` a `user_cards` usando `locked` como depósito. Plan y riesgos en `economy.md` |
| **Venta de duplicados online** | Mismo bloqueo: no hay operación de servidor que cambie una carta por créditos |
| **Cosméticos visibles** | `user_cosmetics` se llena y no hay pantalla donde verlos ni equiparlos |
| **Materiales de crafteo** | Sin tabla en servidor; `award()` ya lo declara `unsupported` |
| **Conversión a dinero real** | Requiere cerrar antes el sumidero que falta y medir el ritmo real. §12 sigue vigente: sin pasarela |
| **Descenso de rango** | `LOSS_SUBTRACTS` existe y está en falso. Es una decisión de balance |
| **Notificaciones** | Hoy son la tira in-app del ciclo. Un buzón persistente exigiría una tabla de eventos por jugador |
