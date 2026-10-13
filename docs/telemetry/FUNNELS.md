# NEXUS — Embudos

> FASE 14, bloque 5. Cuatro embudos, con su fuente paso a paso y sus límites.
> Verificación: `npm run analytics:verify` (48/48).

**La idea que sostiene los cuatro:** un embudo aquí no sale de una tabla de eventos. Sale
de **cruzar** la telemetría conductual con las tablas que ya eran autoritativas. Por eso
funcionan para los jugadores que ya existían antes de que hubiera telemetría, y por eso no
pueden discrepar del dato real: no hay copia.

Leyenda: **A** = fuente autoritativa (retroactiva) · **T** = `telemetry_events` (desde la
Fase 14).

---

## FUNNEL 1 — Primera experiencia (FTUE)

`analytics_ftue_funnel(p_from, p_to)` → `ftueFunnel(sb, window)`

**Cohorte:** usuarios **creados** en la ventana. No los activos: un embudo de primera
experiencia se mide sobre quien acaba de llegar.

| # | paso | fuente | tabla | retro |
|---|---|---|---|---|
| 1 | `user_created` | **A** | `profiles.created_at` | ✅ |
| 2 | `ftue_started` | **T** | `telemetry_events` | ❌ |
| 3 | `welcome_pack_opened` | **A** | `economy_ops.kind = 'open_pack'` | ✅ |
| 4 | `first_card` | **A** | `user_cards` con `origin = 'pack'` | ✅ |
| 5 | `deck_created` | **A** | `duel_decks.created_at` | ✅ |
| 6 | `duel_started` | **A** | `duel_matches.created_at` | ✅ |
| 7 | `duel_completed` | **A** | `duel_matches.status = 'COMPLETED'` | ✅ |

**Seis de siete pasos son retroactivos.**

### Tres decisiones que no son obvias

**`profiles.created_at` como identidad.** Lo escribe el disparador `handle_new_user` en el
mismo instante que `auth.users`, y se comprobó contra los datos: las dos fechas coinciden
(±5 s) en las 58 cuentas existentes. Se usa `profiles` porque vive en `public` y se puede
cruzar; es un espejo fiel, no una segunda verdad.

**`economy_ops`, no el libro mayor.** La taxonomía del bloque 2 decía
`credit_transactions.ref like 'pack:open:%'`. **Es incorrecto:** abrir un sobre no cuesta
créditos, así que no deja asiento. Comprobado: 11 filas `open_pack` en `economy_ops`, cero
refs `pack:open:` en el libro mayor.

**`origin = 'pack'`.** `user_cards.origin` tiene tres valores reales: `pack`, `market`,
`admin`. Una carta concedida por un administrador o comprada en el mercado no es el momento
de «mi primera carta».

### Cómo se cuenta, y qué significa

Cada paso cuenta usuarios que **alguna vez** hicieron eso, no que lo hicieran en orden. Es
la interpretación estándar y la única honesta: nadie garantiza que un jugador construya el
mazo antes de abrir el segundo sobre.

Consecuencia: una etapa puede, en teoría, superar a la anterior. **Si pasa, es información,
no un error** — significa que la gente llega a ese paso por otra vía.

### Límites

- `ftue_started` es 0 para cohortes anteriores a la Fase 14. **No significa que nadie
  empezara**: significa que no se estaba midiendo. El campo `source` de cada fila lo dice
  en el propio dato.
- Sobre datos reales (60 días): 58 usuarios en la cohorte, `ftue_started` 0, y los pasos 3-7
  con sus cifras verdaderas.

---

## FUNNEL 2 — Duelo

`analytics_duel_funnel(p_from, p_to, p_stale_hours)` → `duelFunnel(sb, window, staleHours)`

| paso | fuente | tabla | retro |
|---|---|---|---|
| `duel_started` | **A** | `duel_matches` | ✅ |
| `duel_completed` / `drawn` / `unresolved` | **A** | `duel_matches.status` | ✅ |
| `in_progress` | **A** | `duel_matches.status` | ✅ |
| `abandoned_estimate` | **A**, *inferido* | `IN_PROGRESS` + `updated_at` antiguo | ✅ |
| duración | **A** | `updated_at − created_at` | ✅ |

**Embudo totalmente retroactivo.** Ni un paso necesita telemetría.

### El abandono es una inferencia, y se dice

**No existe —ni existirá— un evento `duel_abandoned`.** El bloque 2 lo descartó y el bloque
5 lo mantiene: el abandono no es un hecho que ocurra, es la **ausencia** de un hecho
posterior.

Se infiere: partida `IN_PROGRESS` cuya `updated_at` lleva más de `p_stale_hours` sin
moverse. Funciona porque el disparador `touch_updated_at` sella la fila **en cada turno**,
así que la fecha es la del último turno jugado.

**Es una inferencia, no un dato.** Un jugador puede volver mañana. La ventana es un
parámetro: verificado que con 24 h la partida de prueba cuenta y con un año no.

### Duración: aquí sí es exacta

A diferencia de la sesión, el duelo empieza y acaba con escrituras en la fila, así que
`updated_at − created_at` es la duración real. Se devuelven mediana y media: en los datos
reales salen 71 s y 670 s, y esa diferencia delata una partida larga.

---

## FUNNEL 3 — Pick'ems

`analytics_pickem_funnel(p_from, p_to)` → `pickemFunnel(sb, window)`

| paso | fuente | tabla | retro |
|---|---|---|---|
| `pickem_viewed` | **T** | `telemetry_events` zona `pickems` | ❌ |
| `prediction_created` | **A** | `pickem_answers.created_at` | ✅ |
| `prediction_scored` | **A** | `pickem_answers.is_correct is not null` | ✅ |
| `prediction_correct` | **A** | `pickem_answers.is_correct` | ✅ |
| `reward_claimed` | **A** | `credit_transactions.ref like 'pickem:%'` | ✅ |

**Este es el mejor ejemplo de por qué hacía falta la telemetría:** el primer paso —«miré la
pantalla»— no existe en ninguna tabla autoritativa, y **sin él no hay denominador**. Se
podía saber cuánta gente predijo; no cuánta llegó a la pantalla y no lo hizo.

### Límite, declarado en el propio dato

`viewers_telemetry` solo existe desde la Fase 14. Para ventanas anteriores devuelve 0, y
entonces `view_to_predict_pct` **no significa nada**.

La función devuelve un campo `source_note` con ese aviso escrito. No es decoración: quien
lea una conversión del 0 % tiene el motivo en la misma fila.

---

## FUNNEL 4 — Mercado

`analytics_market_funnel(p_from, p_to)` → `marketFunnel(sb, window)`

| paso | fuente | tabla | retro |
|---|---|---|---|
| `market_viewed` | **T** | `telemetry_events` zona `market` | ❌ |
| `listing_created` | **A** | `market_audit.action = 'list'` | ✅ |
| `listing_purchased` | **A** | `market_audit.action = 'buy'` | ✅ |
| `listing_cancelled` | **A** | `market_audit.action = 'cancel'` | ✅ |

`market_audit` ya registraba las seis acciones del mercado con fecha, usuario y precio, y
con índice `(user_id, action, created_at desc)`. **Lo único que faltaba era la vista.**

Sobre datos reales (60 días): 186 anuncios, 96 compras, **51,6 %** de anuncios que acaban
en venta — todo retroactivo, sin un solo evento de telemetría.

Cifras devueltas: `sellers`, `buyers`, `listings`, `purchases`, `cancellations`, y las tres
conversiones (`view→list`, `view→buy`, `list→sale`).

---

## Cómo se calcula el abandono, en general

**No hay ningún evento de abandono en NEXUS y no lo habrá.** La forma es siempre la misma:

```
abandono(flujo) = { con la señal de INICIO }  −  { con la huella de FINAL en la ventana }
```

| flujo | inicio | final | ventana |
|---|---|---|---|
| FTUE | primer `session_started` | `duel_matches.status='COMPLETED'` | 7 días |
| Ceremonia de sobre | `zone_entered{pack_ceremony}` | `economy_ops.kind='open_pack'` | misma sesión |
| **Constructor de mazos** | `flow_started{deck_builder}` | `duel_decks.created_at` posterior | misma sesión |
| Duelo | `duel_matches.created_at` | `status ≠ IN_PROGRESS` | ≥ 24 h sin `updated_at` |
| Pick'ems | `zone_entered{pickems}` | `pickem_answers.created_at` | hasta `locks_at` |
| Mercado | `zone_entered{market}` | `market_audit.action='list'` | misma sesión |

Las ventanas son **parámetros de la consulta**, no reglas del producto: cambiarlas no
requiere tocar nada.

El del constructor de mazos está implementado en `analytics_flows` y verificado con el
escenario de prueba: **A guardó mazo, B no → 1 de 2 = 50 %**.

---

## Recorrido de una sesión

`analytics_session_journey(p_session)` → `sessionJourney(sb, sessionId)`

Reconstruye qué hizo una sesión concreta, entrelazando los eventos conductuales con las
acciones autoritativas de la misma ventana temporal (`economy_ops`, `credit_transactions`,
`duel_matches`). Es la única forma de ver «entró en el inventario → abrió un sobre → miró
la colección».

**Solo para operaciones.** Muestra la actividad de una persona concreta. La ejecución está
revocada a PUBLIC, y el endpoint que un día la use tendrá que pasar por `verifyAdmin(req)`
— no por `ADMIN_ENABLED`, que es una compuerta de interfaz.

---

## Anónimo → autenticado

El `session_id` sobrevive al inicio de sesión, así que una sesión puede tener filas con
`user_id` nulo y filas con usuario. **Ninguna fila se reescribe** —la tabla es de
solo-anexado— y las consultas lo entienden:

```sql
-- Sesión MIXTA: empezó anónima y siguió autenticada.
count(*) filter (where usuarios > 0 and anonimos > 0)
```

`analytics_sessions` devuelve `authenticated_sessions`, `anonymous_sessions` y
**`mixed_sessions`** por separado. La última es la que permite ver el tramo previo al
registro, que es la mitad del embudo de primera experiencia.

Verificado en el escenario de prueba: la sesión de A empieza sin usuario y sigue con él, y
se clasifica como mixta.

---

*Métricas y sus límites: [`METRICS.md`](METRICS.md) · auditoría previa:
[`ANALYTICS-AUDIT.md`](ANALYTICS-AUDIT.md).
No hay dashboard, ni endpoint, ni consola de operaciones: eso es el bloque siguiente.*
