# EL CICLO DE JUEGO DE NEXUS

> Cómo se conectan las piezas, qué las une y dónde siguen sin unirse.
>
> Estado: **Fase 10**. Verificado por `npm run loop:verify`, que recorre la cadena entera
> contra la base de datos real.

---

## EL CICLO, EN UNA FRASE

**Entro → veo qué está pasando → participo → juego → gano o pierdo → progreso → recibo
recompensas → consigo cartas → mejoro mi mazo → compito → subo de rango → vuelvo al
siguiente evento.**

Y en cada flecha hay un sistema del servidor que la sostiene:

```
  CIRCUITO REAL (VLR / mock)
        │  lib/esports/sync — idempotente
        ▼
  events · matches · standings
        │  server/services/pickemLifecycle  ← FASE 10
        ▼
  PICK'EM: preguntas abiertas por partido
        │  app_submit_pick — el cierre lo decide el reloj de la BD
        ▼
  PREDICCIÓN GUARDADA
        │  el partido termina → correctOptionFor → app_set_correct_option
        ▼
  app_score_pickem_event → profiles.points  (RANGO)
        │  services/rewards.award             ← FASE 10 (ruta única)
        ▼
  CRÉDITOS · XP · FICHAS · SOBRES · CARTAS · COSMÉTICOS
        │
        ▼
  SOBRES → ceremonia de apertura → user_cards (COLECCIÓN)
        │
        ▼
  MAZO (validateDuelDeck, servidor)
        │
        ▼
  DUELO → Combat Resolver
        │  services/duels.awardMatchOutcome   ← FASE 10
        ▼
  PUNTOS + CRÉDITOS + XP  →  RANGO  →  carril competitivo del PASE
        │
        ▼
  services/loop.getLoop → «QUÉ HACER AHORA» → vuelta a empezar
```

---

## LO QUE YA EXISTÍA (y no se ha tocado)

Estas piezas estaban completas antes de la Fase 10 y siguen exactamente igual:

| Pieza | Dónde | Estado |
|---|---|---|
| Sincronización competitiva | `lib/esports/sync` | VLR + mock, idempotente, con recálculo de clasificaciones |
| Corrector de Pick'ems | `app_score_pickem_event` (0012) | Recalcula desde cero y ajusta por DIFERENCIA |
| Cierre de predicciones | `app_submit_pick` (0012) | El reloj de la base de datos, no el del navegador |
| Escalones de recompensa | `domain/pickems/rewards` | Data-driven, cuatro escalones |
| Motor del pase | `battlepass/` | Puro, con tests, desde la Fase 6 de Colección |
| Progresión server-side | `server/services/progression` | Métricas leídas de las tablas reales, no de contadores propios |
| Duelos | `server/services/duels` + Combat Resolver | Autoridad total del servidor |
| Repeticiones | `getReplay` | Deterministas; solo se sirven al terminar |
| Apertura de sobres | `app_buy_pack` / `app_apply_pack_open` | Tirada decidida en servidor |
| Mercado jugador↔jugador | `0004_market.sql` + `lib/supabase/market` | **Completo y desactivado** — ver `economy.md` |

---

## LO QUE FALTABA — Y LO QUE LA FASE 10 CONECTÓ

### 1 · El eslabón roto: nadie abría ni corregía predicciones

**Lo que había.** La sincronización traía partidos y resultados. El corrector repartía
puntos y recompensas. Y entre los dos, nada: las preguntas de Pick'em solo las creaba
`scripts/seed-demo.ts` y `scorePickemEvent` solo lo llamaban tres scripts de prueba.

En producción, un torneo real entraba, se jugaba, terminaba… y **ninguna predicción se
abría ni se corregía jamás**.

**Lo que hay ahora.** `server/services/pickemLifecycle`, con cuatro pasos idempotentes:

1. `ensurePickemEvent` — un Pick'em por torneo.
2. `syncQuestions` — una pregunta por partido predecible.
3. `resolveFinished` — fija el resultado de los partidos que ya acabaron.
4. `scoreIfReady` — corrige y reparte.

Se llama desde **dentro de la sincronización competitiva** (paso 7 de `syncTournament`),
que corre cada pocos minutos. También hay una acción de administración
(`run_pickem_lifecycle`) y una herramienta (`npm run pickems:lifecycle`).

**Detalles que importan:**

- Las opciones son **el lado del partido** (`a` / `b`), no el nombre del equipo: un
  rebranding no invalida las respuestas ya guardadas.
- Cada pregunta cierra **cuando empieza su partido**, no cuando cierra el torneo.
- Acertar una final vale 30 puntos; un partido de grupos, 10. Es una tabla de patrones
  (`domain/pickems/questions`), no una cadena de `if`.
- **No se abre predicción sobre un partido ya empezado.**
- Se corrige EN CUANTO hay algo que corregir, sin esperar al final del torneo: el jugador
  ve sus puntos el mismo día que acierta.

### 2 · El modo propio del juego no daba nada

**Lo que había.** Terminar un duelo no daba ni un crédito, ni XP, ni un punto. Y
`profiles.points` —de donde salen el rango, la escalera de ocho escalones y la
clasificación entera— solo la movía el corrector de Pick'ems. El rango de NEXUS era un
ranking de pronosticadores, y la pantalla lo decía: «Los mejores pronosticadores».

**Lo que hay ahora.** `domain/progression/duelRewards`: una tabla de nueve celdas (tres
resultados × tres dificultades) y el pago en `awardMatchOutcome`.

| | EASY | NORMAL | HARD |
|---|---|---|---|
| **Victoria** | 8 pts · 120 🪙 · 60 XP | 14 pts · 220 🪙 · 110 XP | 22 pts · 350 🪙 · 180 XP |
| **Empate** | 3 pts · 60 🪙 · 30 XP | 5 pts · 100 🪙 · 50 XP | 8 pts · 160 🪙 · 80 XP |
| **Derrota** | 0 pts · 25 🪙 · 15 XP | 0 pts · 40 🪙 · 25 XP | 0 pts · 60 🪙 · 40 XP |

**Perder no resta rango**, y el motivo está escrito en el módulo: `profiles.points` es una
moneda compartida con los Pick'ems, y restar ahí significaría que perder contra un bot
borra puntos ganados acertando sobre partidos reales. Eso es un cambio de balance
competitivo y el encargo prohíbe improvisarlo. La constante `LOSS_SUBTRACTS` deja la puerta
abierta y `app_grant_reward` ya acepta puntos negativos con suelo en cero.

**El tope diario.** Veinte partidas pagadas al día (`DAILY_DUEL_AWARD_CAP`). Por encima se
sigue jugando, se guarda, cuenta para las misiones y sale en el historial — pero no paga.
Sin tope, un duelo contra un bot es una granja de créditos y de rango. Ver `economy.md`.

**El jugador lo ve.** La pantalla de resultado enseña los tres números y enlaza a la
clasificación. Antes ahí no había nada que enseñar.

### 3 · Las recompensas se repartían por tres sitios

**Lo que había.** `Reward` declara siete campos y `app_grant_reward` sabía entregar cuatro.
Los cosméticos los escribía `progression.ts` **fuera de la transacción** de la RPC: si esa
segunda escritura fallaba, la puerta de idempotencia ya estaba cerrada y al reintentar no
se concedía nada. Las cartas no se concedían nunca. Los puntos no eran una recompensa.

**Lo que hay ahora.** `server/services/rewards.award()` es **la única forma de conceder
algo en NEXUS**, y por debajo `app_grant_reward` (migración 0018) entrega en UNA
transacción: créditos · XP · fichas · sobres · puntos · cartas · cosméticos.

Lo que todavía no se puede entregar —`materials`— **se declara** (`unsupported`) en vez de
tragarse en silencio.

Convención de claves de idempotencia:

```
duel:<matchId>                        pickem:<pickemEventId>:<escalón>
pass:<temporada>:<carril>:<nivel>     mission:<temporada>:<id>:<ts>
achievement:<id>
```

### 4 · Ninguna pantalla sabía de las otras

**Lo que hay ahora.** `server/services/loop.getLoop` recorre el estado real y devuelve los
pasos disponibles, ordenados por una prioridad que codifica una idea del ciclo:

1. Lo que está **a medias** (una partida en curso).
2. Lo que **caduca** (una predicción abierta sin responder).
3. Lo que ya te has **ganado** y no has recogido (niveles, misiones, logros, sobres).
4. Lo que **desbloquea** el resto (construir un mazo).
5. Lo que **siempre** se puede hacer (jugar un duelo).
6. Lo que está **pasando** (el circuito).

Se sirve por `GET /api/game/loop` (solo lectura, exige sesión) y se pinta en el vestíbulo
(`components/loop/NextUp`). Cada paso existe porque hay un dato del servidor que lo
justifica y desaparece cuando deja de haberlo.

---

## EVENTOS — LA CAPA QUE SIGUE SIENDO LOCAL

`/eventos` funciona sobre `useEventsStore`: un store de zustand **persistido en
localStorage** con su propia economía —fichas, misiones, pase de evento y tienda— que
concede escribiendo en `useGameStore`, también local.

**Con sesión iniciada eso no se sostiene.** Desde la Fase B la propiedad y el saldo viven
en el servidor y `CloudSync` sobrescribe el store local en cada arranque: **una recompensa
de evento reclamada con cuenta desaparece en la siguiente sincronización.** Es el mismo
fallo que la Fase A documentó para el mercado (BUG-01).

**Qué se ha hecho en la Fase 10:** no se ha borrado nada. El motor, el catálogo
(`data/events.ts`), el pase de evento y la tienda siguen funcionando en el modo local sin
cuenta. Lo que se ha hecho es **decirlo**: con sesión, las acciones que conceden quedan
apagadas con su motivo escrito y la pantalla señala dónde está la progresión que sí es
real. Un botón que paga con dinero que se va a borrar es peor que un botón apagado.

**La ruta de salida** es la misma que se recorrió con el pase de temporada en la Fase 9E:

1. Llevar las métricas del evento a `metricsFor` (leerlas de las tablas reales en vez de
   contarlas en el navegador).
2. Llevar sus misiones y su tienda a `services/rewards.award`, la ruta única.
3. Cambiar `useEventsStore` por una lectura del servidor, como hizo `/logros`.

La infraestructura ya existe. Lo que falta es la migración, no el diseño.

**Y el concepto de «evento» ya tiene dónde vivir:** `public.events` es la entidad del
circuito y `pickem_events` cuelga de ella. Un evento futuro (VCT, torneo propio, temporada,
colaboración) es una fila en `events` con sus partidos, y el ciclo de Pick'ems lo trata
igual que a cualquier otro. **No hace falta una entidad nueva.**

---

## DATOS REALES

La cadena `VLR → NEXUS` existe y está en `lib/esports/sync`:

```
source.getTournaments / getTeams / getStages / getMatches / getMatchDetail
        │  mappers.ts  (normalización)
        ▼
  events · teams · stages · matches · match_maps · map_player_stats · player_stats
        │  RPC de recálculo
        ▼
  standings · team_stats · player_event_stats
        │  FASE 10
        ▼
  pickem_events · pickem_questions
```

- La fuente se elige por configuración: `vlr` si `NEXT_PUBLIC_VLR_API` está definida, si no
  `mock`. La ruta `/api/esports/sync` está protegida por `x-sync-secret`.
- **Los datos DEMO siguen marcados como DEMO**: `events.source = 'demo'` y la interfaz los
  distingue con su distintivo en el circuito, en el vestíbulo y en las filas de torneo.
- **Lo que alimenta las CARTAS es otra cadena**: el motor de torneos
  (`lib/tournaments/engine`) genera cartas al finalizar un torneo o eliminar un equipo, con
  sus reglas de rareza (`card_generation_rules`). No se ha tocado.

---

## LO QUE SIGUE SIN CONECTAR

| Hueco | Por qué no se ha hecho en la Fase 10 |
|---|---|
| **Eventos server-side** | Es una migración de sistema completa (métricas + tienda + pase de evento). Se ha declarado y acotado en lugar de improvisarla |
| **Mercado jugador↔jugador** | Necesita portar las RPC de `public.inventory` a `user_cards`. Ver `economy.md` |
| **Venta de duplicados online** | Mismo motivo: no hay operación de servidor que mueva una carta a cambio de créditos |
| **Cosméticos** | El carril de pago reparte cosméticos que se guardan en `user_cosmetics` y **no se pueden ver ni equipar en ninguna pantalla** |
| **Materiales de crafteo** | `Reward.materials` no tiene tabla en el servidor. `award()` lo declara como `unsupported` |
| **Notificaciones al jugador** | La tabla `notifications` es del motor de datos (incidencias de operación), no del jugador. Lo que hay hoy es la tira «qué hacer ahora», que es in-app y de solo lectura |
| **Descenso de rango** | `LOSS_SUBTRACTS` existe y está en falso. Activarlo es una decisión de balance competitivo |
