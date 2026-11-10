# NEXUS Event Taxonomy

> FASE 14, bloque 2. **Documento de diseño. No se ha escrito código, ni SQL, ni migración.**
> 2026-09-06 · continúa de [`AUDIT.md`](AUDIT.md)

---

## 1. Principios

**P1 · La pregunta es «¿qué hace el jugador?», no «¿qué transacción hizo el sistema?».**
La segunda ya está resuelta, y mejor de lo que la resolvería una herramienta externa.

**P2 · Regla de derivación.** Antes de almacenar un evento se comprueba si puede
reconstruirse de forma fiable desde una fuente existente. Si puede: **DERIVED**, y no se
almacena. Un dato derivado tiene dos ventajas que un evento nuevo nunca tendrá:
**funciona retroactivamente** sobre los usuarios que ya existen, y **no puede
desincronizarse** de la verdad.

**P3 · Una sola fuente de verdad para el dinero.** Ni un solo evento de telemetría
representa un movimiento económico. Si alguien quiere saber cuántos créditos se gastaron,
la respuesta está en `credit_transactions` y en ningún otro sitio.

**P4 · Telemetría nunca es autoridad.** No decide nada de economía ni de juego. Si se
perdiera entera, el producto seguiría siendo correcto.

**P5 · Ninguna precisión falsa.** Si un dato no se puede conocer con fiabilidad (cuándo
termina exactamente una sesión), no se inventa un evento que finja conocerlo.

**P6 · Menos nombres, más atributos.** Tres eventos que se diferencian en un adjetivo
son un evento con un campo. Fragmentar nombres fragmenta las consultas.

---

## 2. Fuentes autoritativas existentes

| source | qué representa | namespace / discriminador |
|---|---|---|
| `credit_transactions` | **todo** movimiento económico, idempotente | `ref`: `starter:` · `pack:buy:` · `pack:open:` · `duel:` · `pickem:` · `pass:` · `mission:` · `achievement:` · `mastery:` · `drlc:` · `refund:` |
| `economy_ops` | cada operación económica y su resultado | `kind`: `buy_pack` · `open_pack` · `salvage` · `market_buy` · … |
| `market_audit` | cada acción de mercado | `action`: `list` · `buy` · `cancel` · `offer` · `accept_offer` · `cancel_offer` |
| `profiles` | alta de cuenta y acumulados | `created_at`, `packs_opened`, `points`, `xp`, `credits`, `market_volume` |
| `user_cards` | posesión de cartas | `obtained_at` |
| `duel_decks` | mazos | `created_at`, `updated_at` (trigger `touch_updated_at`) |
| `duel_matches` | **cada partida**, con resultado | `status`, `winner` (`A`/`B`), `difficulty`, `deck_id`, `state->>'turn'`, `created_at`, `updated_at` |
| `pickem_submissions` / `pickem_answers` | predicciones y su corrección | `is_correct`, `points_award`, `scored_at`, `created_at` |
| `market_listings` | anuncios | `created_at`, `sold_at` |
| `user_strats` | estrategias guardadas | `created_at`, `updated_at` |
| `user_achievements` | logros | `claimed_at` |
| `user_pass` | pase de temporada | `created_at`, `updated_at` |
| `auth.users` (GoTrue) | autenticación | `last_sign_in_at` (**solo el último**, no un histórico) |

**Índices ya presentes que sirven directamente para los embudos:**
`duel_matches (user_id, status)`, `(user_id, status, winner)`, `(user_id, updated_at desc)`;
`credit_transactions (user_id, created_at desc)` + único `(user_id, ref)`;
`economy_ops (user_id, created_at desc)`; `market_audit (user_id, action, created_at desc)`.

---

## 3. Eventos BEHAVIORAL

**Cuatro. Ninguno más.**

| event | category | trigger | client/server | metadata | product_question | funnel | privacy |
|---|---|---|---|---|---|---|---|
| `session_started` | session | Primera actividad tras ≥30 min de inactividad o carga sin sesión activa. **Una vez por sesión** | **client** | `entry_zone`, `referrer_kind` (`direct`\|`internal`\|`external`), `viewport` (`mobile`\|`desktop`) | DAU/WAU · ¿cuántos vuelven? · ¿por dónde entran? | **Todos** (denominador) | Sin PII. `referrer_kind` es una etiqueta cerrada, **nunca la URL de origen** |
| `zone_entered` | navigation | Cambio de zona dentro de la aplicación. **Una abstracción, no tres** (§7) | **client** | `zone` (enum cerrada), `from_zone`, `is_first_of_session` | ¿qué modos se usan de verdad? · ¿dónde abandona? | **Todos** (denominador de cada paso) | `zone` es un enum, no una ruta libre: no puede filtrarse un identificador por la URL |
| `flow_started` | flow | Se abre un flujo cuyo **inicio no cambia la ruta** y por tanto no deja rastro (§8) | **client** | `flow` (enum cerrada: `deck_builder` · `pack_ceremony` · `pickem_form` · `market_listing_form`), `context` (enum corta) | ¿cuántos empiezan y no acaban? | FTUE · Duelo · Pick'ems · Mercado | Sin PII |
| `error_captured` | error | Error no controlado en cliente, fallo de ruta de servidor, o fallo de un flujo crítico (§9) | **ambos** | `severity`, `source`, `zone`, `flow?`, `code`, `message` **saneado**, `fingerprint` | ¿está roto algún flujo crítico? · ¿podemos detectarlo sin mirar la consola? | — (debugging) | §11. Mensaje saneado y truncado, **nunca stack con secretos, nunca cabeceras, nunca cuerpo de petición** |

### Por qué exactamente estos cuatro

- **`session_started`** es el ancla. Sin él no existen DAU, WAU, retorno, sesiones,
  acciones por sesión ni duración — y el audit confirmó que **no hay ningún concepto de
  sesión en el producto** (0 coincidencias de `session_id`, `last_seen`, `activity`).
- **`zone_entered`** es el **denominador universal**. Todas las fuentes existentes
  registran lo que se *completó*; ninguna registra quién *llegó y no lo hizo*. Con este
  evento, cualquier abandono se calcula como «entró en la zona X y no aparece la huella
  autoritativa Y», sin necesitar un evento de abandono (§8).
- **`flow_started`** existe **solo** para los flujos cuyo inicio no cambia la URL. El caso
  comprobado: pulsar «Crear mi primer mazo» en `/duelos/mazos` abre el constructor **sin
  cambiar de ruta** (verificado en la Fase 13). Sin este evento no se puede distinguir
  «miré mi lista de mazos» de «abrí el constructor y me rendí», que es justo la pregunta
  del embudo FTUE.
- **`error_captured`** porque hoy un flujo roto solo se descubre mirando la consola a mano.

---

## 4. Eventos DERIVED

**No se almacenan.** Cada uno indica de dónde sale.

| event / concepto | source | derivation | why_not_stored |
|---|---|---|---|
| `user_created` | `profiles` | `created_at` | Ya existe con fecha exacta y funciona retroactivamente |
| `login` | `auth.users` | `last_sign_in_at` | GoTrue ya lo mantiene. **Limitación real: solo el último**, no un histórico — la frecuencia de entrada se obtiene de `session_started`, que ya se almacena |
| `last_seen` | `telemetry_events` | `max(occurred_at)` del usuario | Se obtiene **gratis** de los eventos que ya se almacenan. Una columna aparte sería una segunda verdad |
| `welcome_pack_opened` | `credit_transactions` | `ref like 'pack:open:%'` ordenado, el primero del usuario | El libro mayor ya lo registra, con idempotencia |
| `pack_opened` / `pack_open_completed` | `credit_transactions` · `economy_ops` | `ref like 'pack:open:%'` · `kind='open_pack'` | Doble registro autoritativo. Añadir un tercero sería absurdo |
| `pack_purchased` | `credit_transactions` · `economy_ops` | `ref like 'pack:buy:%'` · `kind='buy_pack'` | Ídem |
| `first_card_obtained` | `user_cards` | `min(obtained_at)` por usuario | El encargo lo dice explícitamente. Retroactivo |
| `card_obtained` | `user_cards` | `obtained_at` | Ídem |
| `deck_created` | `duel_decks` | `created_at` | Retroactivo |
| `deck_completed` / `deck_playable` | `duel_decks` + dominio | `validateDuelDeck(card_uids)` — la **misma** función que usa el servidor | Es un cálculo puro sobre datos existentes, no un hecho a registrar |
| `duel_started` | `duel_matches` | `created_at` | Índice `(user_id, status)` ya presente |
| `duel_completed` | `duel_matches` | `status in ('COMPLETED','DRAW','UNRESOLVED')` + `updated_at` | Índice `(user_id, status, winner)` ya presente |
| `duel_won` / `duel_lost` | `duel_matches` | `winner = 'A'` / `'B'` | Ídem |
| **`duel_abandoned`** | `duel_matches` | `status='IN_PROGRESS' and updated_at < now() - interval '<N>'` | **Corrección al encargo (§8.2).** El trigger `touch_updated_at` sella cada turno, así que no solo se sabe *que* abandonó: `state->>'turn'` dice **en qué turno**. Más rico que un evento, y retroactivo |
| `duel_turn_started` | `duel_matches` | `state->>'turn'` | Un evento por turno sería el mayor generador de volumen del sistema a cambio de un dato que ya está en la fila |
| `prediction_created` | `pickem_answers` | `created_at` | Retroactivo |
| `prediction_correct` / `_incorrect` | `pickem_answers` | `is_correct` + `scored_at` | Ídem |
| `pickem_reward_claimed` | `credit_transactions` | `ref like 'pickem:%'` | Libro mayor |
| `listing_created` | `market_audit` · `market_listings` | `action='list'` · `created_at` | Doble fuente autoritativa |
| `market_purchase` / `listing_purchased` | `market_audit` · `market_listings` | `action='buy'` · `sold_at` | Ídem |
| `listing_cancelled` | `market_audit` | `action='cancel'` | Ídem |
| `salvage` | `economy_ops` · `credit_transactions` | `kind='salvage'` | Ídem |
| `credits_earned` / `credits_spent` | `credit_transactions` | `delta > 0` / `delta < 0`, agrupado por prefijo de `ref` | **P3.** Duplicarlo crearía la segunda fuente de verdad que la regla 15 prohíbe |
| `reward_claimed` | `credit_transactions` | `ref like 'pass:%' \| 'mission:%' \| 'achievement:%' \| 'mastery:%'` | Ídem |
| `level_up` | `profiles` | `levelFromXp(xp)` — función de dominio existente | Es una función pura del XP. Registrarlo sería guardar el resultado de una fórmula |
| `mission_completed` / `achievement_completed` | `user_achievements` · `PassState` | `claimed_at` · estado del pase | Retroactivo |
| `strategy_created` / `strategy_saved` | `user_strats` | `created_at` / `updated_at` | **Son la misma acción**: la API tiene un solo `action:"save"` que crea o actualiza |
| `ftue_started` | `telemetry_events` + `profiles` | primer `session_started` del usuario | **No necesita evento propio.** Ya se registra la sesión; «FTUE iniciado» es la primera de ellas (§12) |
| `ftue_completed` | derivación compuesta | primer `duel_matches` con `status='COMPLETED'` | Es el final del embudo, no un hecho aparte |

---

## 5. Eventos REJECTED

| event | reason |
|---|---|
| `session_ended` | **Precisión falsa (P5).** Cerrar el navegador, perder la red o que el móvil mate la aplicación no avisan. `pagehide`/`visibilitychange` es best-effort y se pierde justo en los casos que más importan. La duración se estima con `max(occurred_at) − min(occurred_at)` por `session_id`, y se documenta como **estimación**, no como dato |
| `heartbeat` | Multiplicaría el volumen por la duración de la sesión para afinar un dato que ya se aproxima con el último evento. **Se reconsidera solo si hace falta duración exacta**, no ahora |
| `logout` | Sin pregunta de producto. Nadie decide nada con «cuánta gente cerró sesión» |
| `page_view` · `screen_view` · `route_entered` | **Los tres son el mismo hecho** (P6). Se elige uno: `zone_entered` (§7) |
| `card_viewed` | Volumen altísimo —una rejilla de colección pinta ~40 cartas— para una pregunta que nadie ha formulado. `/coleccion` ya se cubre con `zone_entered` |
| `collection_viewed` · `pack_viewed` · `market_viewed` · `tournament_viewed` · `pickem_viewed` · `trainer_opened` · `duel_hub_viewed` · `profile_viewed` · `ranking_viewed` · `pass_viewed` · `mission_viewed` · `achievement_viewed` · `deck_builder_opened` | **Todos son `zone_entered` con distinto `zone`.** Trece nombres para un evento con un campo (P6). `deck_builder_opened` sobrevive como `flow_started{flow:"deck_builder"}` porque no cambia de ruta |
| `tournament_match_viewed` | `/torneos/[id]` ya es una zona. El partido concreto es un identificador de contenido; guardarlo por vista es volumen sin decisión asociada |
| `strategy_executed` | **No existe esa acción en el producto.** El Entrenador guarda estrategias (`user_strats`) y simula partidos, pero no «ejecuta» una estrategia. Registrarlo sería inventar una funcionalidad para medirla. El uso real del simulador se cubre con `zone_entered{zone:"trainer_match"}`, que hoy **no deja ningún rastro** (`/entrenador/partido` no persiste nada) |
| `first_meaningful_action` | Semántica ambigua (P: «¿tiene un significado inequívoco?» → no). Cada persona lo definiría distinto. Lo que se quiere saber se responde con la secuencia de zonas |
| `client_error` · `server_error` · `critical_flow_error` | Son **un evento con dos campos**: `error_captured` con `source` y `severity` (P6). Tres nombres fragmentarían toda consulta de errores |
| `flow_abandoned` | **El encargo ya advierte del ruido, y tiene razón.** El abandono no es un hecho que ocurra: es la **ausencia** de un hecho posterior. Se calcula, no se registra (§8) |

---

## 6. Session model

### Definición

Una **sesión** es una ventana de actividad de un mismo usuario o visitante separada de la
anterior por al menos **30 minutos de inactividad**. El `session_id` es un UUID generado
en el cliente y guardado en `sessionStorage` junto con la marca de la última actividad.

```
carga / actividad
   └─ ¿hay session_id y última actividad < 30 min?
        sí → se reutiliza, no se emite nada
        no → nuevo session_id + session_started
```

### Por qué no hay `session_ended`

Porque no se puede saber. El navegador se cierra, el móvil mata la pestaña, se cae la red.
Emitir `session_ended` solo cuando el cierre es «limpio» produce un dato **sesgado**: se
registrarían las salidas ordenadas y se perderían justo las abruptas, que son las
interesantes. Eso es peor que no tenerlo, porque parece un dato.

### La alternativa elegida

**Ninguna pieza nueva.** La duración se estima por sesión como
`max(occurred_at) − min(occurred_at)` sobre los eventos que ya se almacenan, y
`last_seen` de un usuario es `max(occurred_at)` de todos sus eventos.

Se reporta siempre como **cota inferior**: no se sabe cuánto estuvo mirando la última
pantalla. Un heartbeat lo afinaría; se documenta como deuda y **no se implementa**, porque
multiplicaría el volumen por la duración media de sesión a cambio de precisión que ninguna
decisión de producto necesita todavía.

### Visitantes sin cuenta

`user_id` es nullable. NEXUS funciona sin sesión en `/inventario` y `/coleccion` (modo
local de un jugador, verificado en la Fase 13), así que un visitante anónimo puede generar
`session_started` y `zone_entered` con `user_id = null`. Cuando se autentica, los eventos
posteriores llevan `user_id` y **comparten el mismo `session_id`**, lo que permite atribuir
la sesión completa sin reescribir nada.

---

## 7. Navigation model

**Un solo evento: `zone_entered`.** No `page_view`, no `screen_view`, no `route_entered`.

### La zona no es la ruta

`zone` es un **enum cerrado** que agrupa las 33 rutas de jugador en **30 zonas** de
producto (`home`, `inventory`, `store`, `pack_ceremony`, `collection`, `collections`,
`market`, `duel_hub`, `deck_list`, `duel_play`, `duel_replay`, `tournaments`,
`tournament_detail`, `pickems`, `pass`, `rewards`, `ranking`, `account`, `events`,
`trainer`, `trainer_maps`, `trainer_strats`, `trainer_match`, `trainer_teams`, `career`,
`news`, `world`, `manager`, `launcher`, `other`).

> **Corregido en el bloque 3.** Al mapear las 33 rutas reales contra esta lista aparecieron
> tres zonas que faltaban: `duel_replay` (`/duelos/replay/[matchId]`), `manager`
> (`/manager`) y `launcher` (`/launcher`). Es la única desviación que la implementación
> reveló respecto a la taxonomía aprobada. La restricción de la base de datos
> (`telemetry_events_zone_check`, migración 0029) contiene las 30.

Tres razones, en orden de importancia:

1. **Privacidad y seguridad.** Una ruta libre puede llevar identificadores en el camino o
   en la consulta. Un enum cerrado **no puede filtrar nada**, por construcción.
2. **La pregunta es «¿qué zonas usa el jugador?»**, no «¿qué URLs visitó».
   `/colecciones/champions-paris` y `/colecciones/ewc-2026` son la misma respuesta.
3. **Estabilidad.** Renombrar una ruta no rompe el histórico.

### Cuándo se emite

En un **cambio de zona** dentro de la aplicación, no en cada render. Reglas explícitas,
todas pensadas para no medir a React:

- Navegación SPA (`next/link`, que es lo que usa `GameShell`) y carga inicial.
- **Se ignora** un cambio que no altera la zona (paginación, filtros, cadena de consulta,
  ancla, o volver a la misma zona consecutivamente dentro de la sesión).
- Un **refresco** de la misma zona no cuenta como zona nueva; sí actualiza `last_seen`.
- El campo `is_first_of_session` marca la zona de entrada sin necesidad de otro evento.

Se emite **en cliente**: es el único sitio que conoce la navegación SPA. En el servidor no
existe una petición por cada cambio de zona.

---

## 8. Abandonment semantics

**Principio: el abandono no se registra, se calcula.** Es la ausencia de una huella
autoritativa después de una presencia conductual. Por eso no hay ningún evento
`*_abandoned` en la lista.

Forma general:

```
abandono(flujo) = { usuarios con la señal de INICIO }
                  ─ { usuarios con la huella de FINAL dentro de la ventana }
```

| flujo | señal de inicio | huella de final | ventana | fuente del final |
|---|---|---|---|---|
| **FTUE** | primer `session_started` del usuario | `duel_matches.status='COMPLETED'` | 7 días | `duel_matches` |
| **Ceremonia de sobre** | `zone_entered{zone:"pack_ceremony"}` | `credit_transactions.ref like 'pack:open:%'` posterior | misma sesión | libro mayor |
| **Constructor de mazos** | `flow_started{flow:"deck_builder"}` | `duel_decks.created_at` / `updated_at` posterior | misma sesión | `duel_decks` |
| **Duelo** | `duel_matches.created_at` | `status` distinto de `IN_PROGRESS` | **≥ 24 h sin `updated_at`** | `duel_matches` |
| **Pick'ems** | `zone_entered{zone:"pickems"}` o `flow_started{flow:"pickem_form"}` | `pickem_answers.created_at` posterior | hasta `locks_at` | `pickem_answers` |
| **Mercado (publicar)** | `flow_started{flow:"market_listing_form"}` | `market_audit.action='list'` posterior | misma sesión | `market_audit` |

### 8.1 · Por qué la ventana importa

Sin ventana, «abandono» significa «todavía no lo ha hecho», que no es lo mismo. Las
ventanas de arriba son **parámetros de la consulta**, no reglas del producto: cambiarlas no
requiere tocar nada, solo la consulta.

### 8.2 · Corrección al encargo: el duelo no necesita telemetría

El encargo sugiere que `duel_abandoned` «puede necesitar telemetry si actualmente no
existe otra fuente fiable». **La auditoría demuestra que sí existe.**

`duel_matches` tiene el trigger `touch_updated_at`, que sella la fila **en cada turno**.
Por tanto una partida con `status='IN_PROGRESS'` y `updated_at` antiguo es un abandono, y
`state->>'turn'` dice **en qué turno se rindió**. Eso es más información de la que daría un
evento `duel_abandoned`, funciona **para las partidas que ya existen**, y no puede
desincronizarse de la partida real.

### 8.3 · El caso que sí necesita evento

Un jugador que entra en `/duelos/mazos`, pulsa «Crear mi primer mazo» y se va **no deja
ninguna huella**: no se crea fila en `duel_decks` y la ruta no cambia al abrir el
constructor (comprobado en la Fase 13). Es el único abandono del producto invisible desde
las fuentes existentes, y la razón de que `flow_started` exista.

---

## 9. Error telemetry

**Un evento: `error_captured`.** Los tres candidatos del encargo son este evento con
distintos valores.

| campo | valores | significado |
|---|---|---|
| `source` | `client` · `server` | Dónde ocurrió |
| `severity` | `warn` · `error` · `critical` | `critical` **solo** si ocurre dentro de un flujo crítico (§9.2) |
| `zone` | enum de §7 | Dónde estaba el jugador |
| `flow` | enum de §3, opcional | Qué intentaba hacer |
| `code` | texto corto normalizado | `HTTP_500`, `FETCH_FAILED`, `UNHANDLED_REJECTION`, `RENDER_ERROR`… |
| `message` | texto **saneado** y truncado a 300 caracteres | §9.3 |
| `fingerprint` | hash corto de `code` + primera línea normalizada | Agrupa repeticiones para no leer 5.000 filas iguales |

### 9.1 · Encaje con `crash.ts` (diseño; **no se modifica en este bloque**)

`src/platform/crash.ts` ya captura `error` y `unhandledrejection`, compone el informe y
tiene escrito `// TODO(server): POST report al endpoint de crashes cuando exista`. El plan
es **darle ese endpoint**, no escribir un segundo capturador:

```
window error / unhandledrejection
        └─ crash.ts  (ya existe: captura + compone)
              └─ sanea   (§9.3, a añadir)
                    └─ POST endpoint  (bloque posterior)
                          └─ error_captured
```

Y **instalarlo también en la app de jugador**: hoy `initPlatform()` —que es quien llama a
`installCrashHandler()`— solo se invoca desde `BootGate.tsx`, es decir, únicamente en
`/launcher`.

### 9.2 · Qué es «crítico»

`severity = 'critical'` **solo** cuando el error impide completar uno de estos flujos, que
son los que el encargo enumera y los que el mapa del ciclo señala como estructurales:

`login` · `ftue` · `pack_ceremony` · `inventory` · `deck_builder` · `duel_play` ·
`pickem_form` · `market_listing_form` · `reward_claim`

Fuera de esos, `error` o `warn`. La distinción existe para que la consola de operaciones
pueda responder «¿está roto algo que impide jugar?» sin leerlo todo.

### 9.3 · Sanitización (obligatoria, antes de salir del cliente)

1. **Se elimina cualquier URL con consulta**: se conserva el origen y la zona, se descarta
   la cadena de consulta entera.
2. **Se redacta por patrón**: cualquier subcadena que parezca JWT (`ey[A-Za-z0-9_-]{10,}`),
   `Bearer …`, clave de API, correo electrónico, UUID de sesión o cabecera de
   autorización se sustituye por `[REDACTED]`.
3. **No se envían cabeceras, ni cookies, ni cuerpo de petición, ni `localStorage`.**
4. **El stack no se envía en `metadata`**: solo la primera línea normalizada, sin rutas
   absolutas del sistema de ficheros del usuario.
5. **Truncado duro** a 300 caracteres tras la redacción.
6. `recentLogs` de `crash.ts` **no se envía**: puede contener cualquier cosa que alguien
   haya pasado a `log()` en el futuro. Se queda en el dispositivo, como hasta ahora.

---

## 10. Metadata contract

### Columnas de primer nivel (no van en `metadata`)

| campo | tipo | nullable | justificación |
|---|---|---|---|
| `id` | uuid | no | Clave |
| `event_name` | text | no | Enum cerrado de cuatro valores (§3) |
| `user_id` | uuid | **sí** | Se deriva **siempre del token en el servidor** (§11), nunca del cuerpo. Nullable porque hay uso sin cuenta |
| `session_id` | uuid | **sí** | Sin él no hay sesiones ni duración ni abandono. Nullable por robustez |
| `occurred_at` | timestamptz | no | Momento del hecho. Se sella en el **servidor**; el reloj del cliente no es de fiar |
| `zone` | text | **sí** | Enum de §7. De primer nivel porque **casi toda consulta filtra por él** — dentro del jsonb obligaría a indexar el jsonb |
| `severity` | text | **sí** | Solo para `error_captured`. De primer nivel para poder indexar «dame los críticos de la última hora» |
| `environment` | text | no | `development` · `production`. Sin él, las pruebas locales contaminan las métricas |
| `app_version` | text | no | De `platform/version.ts`, fuente única ya existente. Sin él no se puede decir «esto se rompió en la 0.1.2» |
| `metadata` | jsonb | no (`{}`) | Lo específico de cada evento |

**Campos deliberadamente ausentes:**

| campo | por qué no |
|---|---|
| `route` (ruta literal) | Sustituido por `zone` (§7): un enum no puede filtrar identificadores |
| `ip` | PII, y no responde ninguna pregunta de la lista |
| `user_agent` completo | Huella digital. Si hiciera falta, `viewport: mobile\|desktop` basta |
| `referrer` (URL) | Puede llevar identificadores de terceros. Se guarda `referrer_kind` |
| `device_id` | Identificador persistente entre sesiones = seguimiento. No hay pregunta que lo requiera |
| `country` / `geo` | Ninguna de las 14 preguntas del encargo es geográfica |

### Contenido de `metadata` por evento

```
session_started  { entry_zone, referrer_kind, viewport }
zone_entered     { from_zone?, is_first_of_session }
flow_started     { flow, context? }
error_captured   { source, code, message, fingerprint, flow? }
```

**Nada más.** Cualquier campo futuro tiene que justificar una pregunta de producto.

---

## 11. Privacy

### Nunca, bajo ninguna circunstancia

Contraseñas · tokens de acceso o refresco · JWT · cookies · cabeceras `Authorization` ·
claves de API · secretos de servidor · correos electrónicos · nombres reales ·
direcciones IP · `user_agent` completo · contenido de `localStorage` ·
cuerpos de petición · rutas absolutas del sistema de ficheros del usuario ·
cadenas de consulta · URL de referencia · identificadores persistentes entre sesiones.

### Reglas estructurales, no solo de intención

1. **`user_id` no se acepta del cliente.** Se deriva del Bearer con `getSession(req)`, que
   es la primitiva que ya usa todo el producto. Un `user_id` en el cuerpo es exactamente
   el vector que permite escribir en nombre de otro.
2. **`event_name`, `zone`, `flow`, `severity` y `source` son enums cerrados**, validados en
   el servidor. Un valor desconocido se **rechaza**, no se almacena.
3. **`metadata` se filtra por lista blanca** en el servidor: cualquier clave no prevista
   para ese evento se descarta antes de escribir.
4. **`zone` en vez de `route`** hace que sea imposible por construcción filtrar un
   identificador por la URL.
5. **Telemetría nunca es autoridad** (P4). Ningún dato enviado por el cliente puede influir
   en economía, recompensas, rango ni reglas.

---

## 12. Funnel coverage

Qué fuente aporta cada paso. **`T` = `telemetry_events` (nuevo) · `A` = fuente autoritativa
(ya existe).**

### FUNNEL 1 — FTUE

| paso | fuente | de dónde |
|---|---|---|
| `user_created` | **A** | `profiles.created_at` |
| `ftue_started` | **T** | primer `session_started` del usuario |
| llegada al inventario | **T** | `zone_entered{zone:"inventory"}` |
| `welcome_pack_opened` | **A** | `credit_transactions.ref like 'pack:open:%'` (el primero) |
| `first_card_obtained` | **A** | `min(user_cards.obtained_at)` |
| apertura del constructor | **T** | `flow_started{flow:"deck_builder"}` |
| `deck_created` | **A** | `duel_decks.created_at` |
| `duel_started` | **A** | `duel_matches.created_at` |
| `duel_completed` | **A** | `duel_matches.status='COMPLETED'` |

**6 de 9 pasos ya existen y funcionan retroactivamente.** Solo 3 son nuevos, y los tres son
conductuales.

### FUNNEL 2 — DUELO

| paso | fuente | de dónde |
|---|---|---|
| entrada al modo | **T** | `zone_entered{zone:"duel_hub"}` |
| `duel_started` | **A** | `duel_matches.created_at` |
| primer turno / turno medio | **A** | `duel_matches.state->>'turn'` |
| `duel_completed` | **A** | `status` + `updated_at` |
| ganado / perdido | **A** | `winner` |
| abandonado + **en qué turno** | **A** | `status='IN_PROGRESS'` + `updated_at` antiguo + `state->>'turn'` |
| `reward_claimed` | **A** | `credit_transactions.ref like 'duel:%'` |

**Solo el primer paso es nuevo.** El resto ya está, y con índices.

### FUNNEL 3 — PICK'EMS

| paso | fuente | de dónde |
|---|---|---|
| `pickem_viewed` | **T** | `zone_entered{zone:"pickems"}` |
| `prediction_created` | **A** | `pickem_answers.created_at` |
| correcto / incorrecto | **A** | `is_correct` + `scored_at` |
| `reward_claimed` | **A** | `credit_transactions.ref like 'pickem:%'` |
| abandono parcial | **A** | submissions con menos respuestas que preguntas abiertas |

**Solo el primero es nuevo.**

### FUNNEL 4 — MERCADO

| paso | fuente | de dónde |
|---|---|---|
| `market_viewed` | **T** | `zone_entered{zone:"market"}` |
| `listing_created` | **A** | `market_audit.action='list'` |
| `listing_purchased` | **A** | `market_audit.action='buy'` + `market_listings.sold_at` |
| `listing_cancelled` | **A** | `market_audit.action='cancel'` |

**Solo el primero es nuevo.**

---

## 13. Final event inventory

| event | status | source | stored? |
|---|---|---|---|
| `session_started` | **BEHAVIORAL** | cliente | **sí** |
| `zone_entered` | **BEHAVIORAL** | cliente | **sí** |
| `flow_started` | **BEHAVIORAL** | cliente | **sí** |
| `error_captured` | **BEHAVIORAL** | cliente + servidor | **sí** |
| `user_created` | DERIVED | `profiles.created_at` | no |
| `login` | DERIVED | `auth.users.last_sign_in_at` | no |
| `last_seen` | DERIVED | `max(telemetry_events.occurred_at)` | no |
| `ftue_started` | DERIVED | primer `session_started` | no |
| `ftue_completed` | DERIVED | primer duelo `COMPLETED` | no |
| `welcome_pack_opened` | DERIVED | `credit_transactions` `pack:open:` | no |
| `pack_open_completed` / `pack_opened` | DERIVED | `credit_transactions` · `economy_ops` | no |
| `pack_purchased` | DERIVED | `credit_transactions` `pack:buy:` · `economy_ops` | no |
| `first_card_obtained` | DERIVED | `min(user_cards.obtained_at)` | no |
| `deck_created` | DERIVED | `duel_decks.created_at` | no |
| `deck_completed` / `deck_playable` | DERIVED | `duel_decks` + `validateDuelDeck` | no |
| `duel_started` | DERIVED | `duel_matches.created_at` | no |
| `duel_completed` | DERIVED | `duel_matches.status` | no |
| `duel_won` / `duel_lost` | DERIVED | `duel_matches.winner` | no |
| `duel_abandoned` | DERIVED | `IN_PROGRESS` + `updated_at` + `state->>'turn'` | no |
| `duel_turn_started` | DERIVED | `duel_matches.state->>'turn'` | no |
| `prediction_created` | DERIVED | `pickem_answers.created_at` | no |
| `prediction_correct` / `_incorrect` | DERIVED | `pickem_answers.is_correct` | no |
| `listing_created` | DERIVED | `market_audit.action='list'` | no |
| `market_purchase` | DERIVED | `market_audit.action='buy'` | no |
| `listing_cancelled` | DERIVED | `market_audit.action='cancel'` | no |
| `salvage` | DERIVED | `economy_ops.kind='salvage'` | no |
| `credits_earned` / `credits_spent` | DERIVED | `credit_transactions.delta` | no |
| `reward_claimed` | DERIVED | `credit_transactions.ref` | no |
| `pickem_reward_claimed` | DERIVED | `credit_transactions` `pickem:` | no |
| `pass_reward_claimed` | DERIVED | `credit_transactions` `pass:` | no |
| `level_up` | DERIVED | `levelFromXp(profiles.xp)` | no |
| `mission_completed` | DERIVED | estado del pase | no |
| `achievement_completed` | DERIVED | `user_achievements.claimed_at` | no |
| `strategy_created` / `strategy_saved` | DERIVED | `user_strats` | no |
| `session_ended` | **REJECTED** | — | no |
| `heartbeat` | **REJECTED** | — | no |
| `logout` | **REJECTED** | — | no |
| `page_view` / `screen_view` / `route_entered` | **REJECTED** | → `zone_entered` | no |
| `card_viewed` | **REJECTED** | — | no |
| `collection_viewed` · `pack_viewed` · `market_viewed` · `tournament_viewed` · `pickem_viewed` · `trainer_opened` · `duel_hub_viewed` · `profile_viewed` · `ranking_viewed` · `pass_viewed` · `mission_viewed` · `achievement_viewed` | **REJECTED** | → `zone_entered{zone}` | no |
| `deck_builder_opened` | **REJECTED** | → `flow_started{flow:"deck_builder"}` | no |
| `tournament_match_viewed` | **REJECTED** | — | no |
| `strategy_executed` | **REJECTED** | la acción no existe en el producto | no |
| `first_meaningful_action` | **REJECTED** | semántica ambigua | no |
| `client_error` / `server_error` / `critical_flow_error` | **REJECTED** | → `error_captured{source,severity}` | no |
| `flow_abandoned` | **REJECTED** | se calcula, no se registra (§8) | no |

**Recuento: 4 almacenados · 30 derivados · 21 rechazados.**

---

## Anexo · Volumen estimado

Con la sesión medida en la Fase 13 (un recorrido realista toca ~18 zonas):

| evento | por sesión | a 100 sesiones/día | a 2.000 sesiones/día |
|---|---|---|---|
| `session_started` | 1 | 100 | 2.000 |
| `zone_entered` | ~15-25 | ~2.000 | ~40.000 |
| `flow_started` | ~1-2 | ~150 | ~3.000 |
| `error_captured` | ~0 | decenas | cientos |
| **total/día** | | **~2.300** | **~45.000** |
| **total/mes** | | **~70 K filas** | **~1,4 M filas** |

A ~200 bytes por fila: **~14 MB/mes** en el escenario realista de hoy, **~280 MB/mes** en
el optimista. Postgres absorbe ambos sin despeinarse.

`zone_entered` es el 90 % del volumen. Las mitigaciones ya están en el diseño (§7):
no emitir en cambios de consulta ni en zonas repetidas consecutivas. **Se decide una
retención de 90 días para el detalle**; agregados si algún día hiciera falta. No se
optimiza más sin medir (regla del encargo: «mide primero»).

---

*Siguiente: bloque 3 — modelo de datos (`telemetry_events`), solo cuando esta taxonomía se
haya revisado.*
