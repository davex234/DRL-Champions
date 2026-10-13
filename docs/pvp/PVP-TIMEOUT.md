# NEXUS — PvP Turn Timeout

> BLOQUE 7.4.3. Vencimiento del turno: cómo una partida PvP se cierra sola cuando alguien deja de
> jugar sin abandonar, quién lo decide y por qué el cliente no puede provocarlo ni falsearlo.
> **Sin arena, sin UI, sin WebSocket, sin cron, sin recompensas.**
> 2026-09-08 · rama `arch/stabilization`

Resuelve **D-PVP-6**, abierta desde el bloque 7.2: *«el reloj se sincroniza y se pinta, pero no
vence solo»*.

---

## 1. El problema, dicho con precisión

`turn_deadline_at` existía desde 7.2 y `guardAction` ya rechazaba una acción tardía con
`TURN_EXPIRED`. Pero ahí se acababa: **nadie cerraba nada**. Si alguien dejaba de jugar sin pulsar
«abandonar», la partida se quedaba `IN_PROGRESS` para siempre.

Y no era solo una fila colgada: por la **guarda de partida activa** del bloque 7.4, esa partida
dejaba **a los dos jugadores** sin poder volver a entrar en cola. Uno se iba y bloqueaba al otro.

---

## 2. Duración del turno

**90 segundos.** No es una cifra nueva: es `PVP_TURN_MS = 90_000`, definida en el bloque 7.2 y
**reutilizada sin tocarla**. El verificador comprueba que el plazo de un turno recién abierto es
exactamente `turn_started_at + PVP_TURN_MS`, para que la constante y la fila no puedan divergir.

No se ha añadido configuración por partida, por usuario ni por modo. Eso es un problema que hoy
nadie tiene.

---

## 3. Autoridad temporal — solo PostgreSQL

**Ninguna** de las funciones de este bloque acepta una marca de tiempo por parámetro. Todas
comparan contra `now()`, el reloj de la base de datos.

| quién | qué NO puede hacer |
|---|---|
| el navegador | nada: no existe ninguna acción HTTP de vencimiento (verificado: `400`), y `expired`/`timeout` en el cuerpo no significan nada |
| el servidor de Next | no puede afirmar que algo ha vencido; solo puede *preguntar* |
| el cliente autenticado | no puede escribir `turn_deadline_at`, ni `turn_started_at`, ni `closed_reason`/`closed_by` (verificado: `42501` en los tres) |

El reloj de Node aparece en **un** sitio y con **un** propósito: evitar trabajo inútil. El sondeo
no lee la fila entera ni llama a la base de datos si el plazo obviamente no ha llegado. Si ese
reloj fuera por delante, la llamada se hace y Postgres responde `NOT_DUE`; si fuera por detrás, el
vencimiento ocurre en el siguiente sondeo — y en el peor caso lo recoge el barrido global, que no
mira ese reloj en absoluto.

---

## 4. Vocabulario: se reutiliza `EXPIRED`, no se inventa `TURN_TIMEOUT`

La migración 0031 ya declaró `closed_reason in ('ABANDONED','EXPIRED')` y dejó `EXPIRED`
**reservado exactamente para esto**. `PvpClosedReason` ya lo tenía, `lifecycleOf` ya lo traducía y
el bloque 7.4.2 ya devolvía `EXPIRED_NOT_SETTLED` esperando a que existiera este barrido. Añadir
un tercer valor con el mismo significado habría sido un duplicado semántico.

Y siguen siendo cosas distintas, que es lo que importa:

| causa | qué significa |
|---|---|
| `ABANDONED` | alguien pulsó «abandonar». **Acto deliberado.** |
| `EXPIRED` | se acabó el tiempo. **Hecho del reloj, sin voluntad.** |

El rating trata ambos como derrota del que se fue, pero la causa queda diferenciada en la fila
para siempre — y la liquidación la devuelve en su campo `cause`.

---

## 5. El barrido

Dos piezas, y el reparto entre ellas es la decisión de diseño del bloque:

```
PostgreSQL  decide SI ha vencido  y  SI este intento gana la carrera
TypeScript  decide QUIÉN perdió
```

**Por qué TypeScript decide el perdedor:** el bando que debía actuar sale de `actingSide()`, que
lo deriva de `status`, `attacker` y `phase` del motor. Reimplementar eso en SQL sería un segundo
motor de duelo. Se **reutiliza `expectedPlayer`**, la misma función que decide de quién es el turno
en cada acción; no hay una segunda regla que pueda divergir.

| función | qué hace |
|---|---|
| `duel_pvp_expired_candidates(limit)` | SQL. Partidas `PVP` + `IN_PROGRESS` + sin cierre + `turn_deadline_at <= now()`, ordenadas por plazo y acotadas. |
| `duel_pvp_expire_turn(match, version, loser)` | SQL. **Un solo `UPDATE` condicionado.** Cierra con `EXPIRED` y `closed_by = loser`. |
| `expireTurnIfDue(sb, matchId)` | TS. Lee la fila, deriva el perdedor con `expectedPlayer`, llama al `UPDATE`, y si cerró, liquida. |
| `sweepExpiredPvpTurns(sb, limit)` | TS. Pide candidatos y cierra cada uno. Acotado. |

### El `UPDATE` que arbitra todo

```sql
update duel_matches
   set closed_reason='EXPIRED', closed_by=p_loser, closed_at=now(),
       state_version = state_version + 1
 where id = p_match
   and state_version = p_version        -- ¿alguien escribió antes que yo?
   and closed_reason is null            -- ¿ya se cerró (abandono simultáneo)?
   and mode = 'PVP' and status = 'IN_PROGRESS'
   and turn_deadline_at <= now()        -- ¿de verdad venció, según el reloj que manda?
```

Las cuatro condiciones son las cuatro formas de perder la carrera y las evalúa Postgres en la
misma sentencia. **No hay un `SELECT` previo del que fiarse**: leer y decidir en dos pasos es
justo la carrera que había que eliminar.

---

## 6. Quién dispara el barrido

No hay `cron`, ni worker, ni temporizador — el mismo patrón con el que el bloque 7.4 caduca las
entradas de cola. Tres disparadores, y cada uno cubre un caso distinto:

| disparador | caso que cubre |
|---|---|
| **`syncPvpMatch`** (sondeo) | **El caso principal.** El que se va deja de mandar peticiones, pero **su rival sigue sondeando**, y ese sondeo cierra la partida. |
| **`applyPvpAction`** con `TURN_EXPIRED` | El que llega tarde. Antes solo recibía un `409` y la partida seguía abierta; ahora su propio intento la resuelve. |
| **`enqueue`** (matchmaking) | **El caso residual:** los dos dejaron de sondear. El primero de los dos que vuelve al juego se desbloquea a sí mismo **y al rival**, antes incluso de que se compruebe su guarda. |

### El detalle que hace que funcione

La comprobación del plazo está en `syncPvpMatch` **antes** de decidir qué responder, así que cubre
también el **camino barato**. Es esencial: un rival que ya conoce la versión actual entra siempre
por ahí, y si solo se mirase en el camino completo, el único que puede cerrar la partida pasaría
de largo en cada sondeo. Por eso `turn_deadline_at` se añadió a `SYNC_COLS` — es un escalar, el
sondeo barato sigue siendo barato.

### La limitación, dicha claramente

**Si absolutamente nadie toca el sistema, nada se cierra.** Y no hace falta que se cierre: mientras
nadie vuelva, esa partida no está bloqueando a nadie. En el momento en que cualquiera de los dos
sondea, actúa o entra en cola, se cierra. Lo que este bloque garantiza no es «se cierra en el
segundo 91», sino **«no puede bloquear a nadie más allá de su propia vuelta»**.

---

## 7. Acción contra vencimiento

El caso crítico del encargo:

```
plazo    = 12:00:00
acción   = 11:59:59.999
barrido  = 12:00:00.001
```

**Gana la acción**, y no por una comparación de relojes: la acción escribió, así que
`state_version` ya cambió, y el `UPDATE` del barrido —condicionado a la versión que leyó— afecta a
**cero filas**. Da igual qué hora crea cada proceso que es.

| caso | resultado | verificado |
|---|---|---|
| **A** acción válida antes del plazo | gana la acción, el turno avanza, no hay vencimiento | ✓ |
| **B** acción después del vencimiento | la partida ya es terminal, la acción se rechaza | ✓ |
| **C** acción y vencimiento simultáneos | gana **exactamente uno**, nunca los dos | ✓ |
| **D** dos barridos simultáneos | una sola transición terminal | ✓ (5 barridos → 1 cierre; 5 cierres directos → 1 `EXPIRED` + 4 `LOST_RACE`) |

**Abandono contra vencimiento:** los dos van condicionados por `closed_reason is null`, así que
solo uno escribe. Verificado: causa única, 2 eventos, una partida contada.

---

## 8. Liquidación — la misma puerta, sin duplicar nada

El vencimiento **no llama a ninguna fórmula de rating**. Llama a `settleTerminalMatch`, exactamente
igual que el final normal y que el abandono, y esa llama a `duel_pvp_settle_match`.

Lo único que cambió en la liquidación es que la rama `EXPIRED` —que en 7.4.2 devolvía
`EXPIRED_NOT_SETTLED`— ahora se trata igual que `ABANDONED`: **el que consta en `closed_by`
pierde, el otro gana**. Mismo `expected_score`, misma K, misma escala, mismo libro, misma clave de
idempotencia `(match_id, user_id)`.

```
turno vencido → closed_reason='EXPIRED', closed_by=<el que debía mover>
              → settleTerminalMatch → duel_pvp_settle_match
              → LOSS al que expiró · WIN al rival · 2 eventos
```

**El estado de juego no se falsea:** `status` sigue siendo `IN_PROGRESS` y `winner` sigue siendo
`null`. El motor no inventa un ganador que no ganó dentro de las reglas; el resultado competitivo
vive en `closed_reason` + `closed_by`, que es donde el bloque 7.2 decidió que viviera.

---

## 9. Idempotencia

Verificado contra PostgreSQL real:

```
5 barridos simultáneos            → 1 cierre · 2 eventos · 1 partida contada
5 cierres directos simultáneos    → 1 EXPIRED + 4 LOST_RACE
barrer ×3 + liquidar + sondear ×2 → rating idéntico, sin eventos nuevos
acción posterior al vencimiento   → rechazada, sin segundo settlement
```

Nunca `-20, -20, -20`.

---

## 10. Polling (bloque 7.3)

**No se ha introducido una segunda máquina de estados.** El cliente recibe el mismo contrato de
siempre: el sondeo que cierra la partida devuelve `changed: true`, `terminal: true` y
`lifecycle: "EXPIRED"`. Con eso el poller existente deja de sondear por la lógica que ya tenía.

Verificado: el sondeo del rival cierra la partida **y** en esa misma respuesta ya entrega el estado
terminal — no hace falta un sondeo extra para enterarse.

---

## 11. Índice

La 0031 había creado `duel_matches_pvp_deadline_idx (turn_deadline_at) where mode='PVP' and
closed_reason is null` pensando en este bloque, pero **le faltaba una condición** y la diferencia
crece con el tiempo: una partida terminada con normalidad (`status='COMPLETED'`) **no tiene
`closed_reason`** y conserva su plazo en el pasado, así que entraba en aquel índice para siempre.

`duel_matches_pvp_live_deadline_idx` añade `status='IN_PROGRESS'`: solo contiene partidas **vivas**,
una fila entra al empezar la partida y sale al terminarla.

Comprobado que sirve la consulta con un recorrido de índice **ordenado y sin `sort`**:

```
Limit
  -> Index Scan using duel_matches_pvp_live_deadline_idx
       Index Cond: ((turn_deadline_at IS NOT NULL) AND (turn_deadline_at <= now()))
```

(Con la tabla de desarrollo, de 4 filas, el planificador prefiere un recorrido secuencial — que es
lo correcto a ese tamaño. El plan de arriba se obtiene forzando el uso de índices.)

**Medido:** barrido en vacío **6 ms** · sondeo barato de partida viva **5,4 ms** · barrido que
cierra y liquida **22 ms**.

---

## 12. Seguridad

```
[PASS] duel_pvp_expire_turn / expired_candidates / settle_match: no invocables por authenticated  — 42501
[PASS] el cliente NO puede mover turn_deadline_at                                                 — 42501
[PASS] ni turn_started_at                                                                          — 42501
[PASS] ni cerrar la partida eligiendo perdedor                                                     — 42501
[PASS] no existe ninguna acción HTTP para provocar un vencimiento                                  — 400
[PASS] `expired`/`timeout` en el cuerpo no significan nada                                         — 404
[PASS] un tercero recibe 404 y su sondeo NO cierra la partida ajena
[PASS] no se puede cerrar una partida cargándosela a quien no juega                                 — NOT_A_PLAYER
[PASS] el barrido NUNCA toca una partida PvE
[PASS] una partida ya cerrada no se vence encima
[PASS] pedir el cierre antes del plazo                                                              — NOT_DUE
```

---

## 13. Limitaciones

| limitación | por qué se acepta |
|---|---|
| Sin tráfico, nada se cierra | Mientras nadie vuelva, nada está bloqueado. Ver §6. |
| El barrido global va acotado (20 por llamada) | Es trabajo oportunista dentro de una petición de usuario, no un `cron`. Con más carga habría más llamadas. |
| Solo se vence el **turno**, no la partida entera | No existe un plazo total de partida. Nadie lo ha pedido y añadirlo sería inventar política. |
| La duración es global (90 s) | Sin configuración por modo ni por usuario. Hoy no hay modos. |

---

## 14. Cómo ejecutarlo

```bash
npm run pvp-timeout:verify            # este bloque
npm run pvp-rating-settlement:verify  # 7.4.2 — enganche de la liquidación
npm run pvp-rating:verify             # 7.4.1 — rating persistente
npm run pvp-matchmaking:verify        # 7.4 — emparejamiento
npm run pvp-sync:verify               # 7.3 — sincronización (necesita servidor)
npm run pvp:verify                    # 7.2 — modelo PvP
```
