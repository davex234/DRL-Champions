# NEXUS — PvP Rating

> BLOQUES 7.4.1, 7.4.2 y 7.4.3. Rating persistente y server-authoritative para los duelos de cartas:
> tabla, autoridad, libro de auditoría, integración con el emparejamiento, liquidación idempotente
> y su **enganche** al final del duelo.
> **Sin arena, sin UI, sin recompensas, sin temporadas, sin ligas, sin leaderboard.**
> 2026-09-08 · rama `arch/stabilization`

Resuelve tres bloqueos:
- **D-MM-1** (7.4.1) — *«no existe rating PvP persistente»*.
- **D-RAT-1** (7.4.2) — *«la liquidación no está enganchada al final del duelo»*. Ver §11.
- **D-PVP-7** (7.4.2, heredada del 7.2) — *«el abandono no acredita al rival»*. Ver §12.
- **D-PVP-6** (7.4.3, heredada del 7.2) — *«el reloj de turno no vence solo»*. Ver §12 y
  `PVP-TIMEOUT.md`.

---

## 1. Por qué existe este sistema

El bloque 7.4 entregó el emparejamiento entero —cola persistente, pairing atómico, guardas,
concurrencia— y lo dejó **FIFO puro**, con `duel_pvp_queue.rating_snapshot` declarado y siempre
`NULL`. No por descuido: no existía ningún rating de duelos que poner ahí, y poner un `1000` a
todo el mundo habría sido una constante disfrazada de sistema competitivo.

Este bloque crea el número de verdad. Con él, `rating_snapshot` se llena desde la autoridad del
servidor y el emparejamiento pasa a tener un criterio de habilidad.

---

## 2. Por qué NO se usa `profiles.points`

Es la puntuación de **Pick'ems**. La migración 0015 construye sobre esa columna los índices
`profiles_points_idx` / `profiles_region_points_idx` y las vistas públicas `ranking_points` y
`ranking_points_region`. Sumar ahí el rendimiento en duelos:

- mezclaría dos escalas que no significan lo mismo (aciertos de predicción vs. victorias en un
  juego de cartas), y
- contaminaría una clasificación **ya publicada** a los usuarios.

`profiles.points` sigue siendo exclusivamente Pick'ems. Este bloque no lo lee ni lo escribe.

---

## 3. Por qué NO se usa el Elo del 5v5

`src/competitive/` se auditó fichero a fichero antes de descartarlo:

| hallazgo | consecuencia |
|---|---|
| Es un motor **PURO y EN MEMORIA**. `newProfile()` y `recordMatch()` devuelven objetos; no hay una sola escritura a base de datos en los 11 ficheros del módulo. | No puede ser autoridad de nada persistente. |
| Está **congelado** (`docs/FROZEN.md`), con 0 consumidores de producto y condición de descongelación escrita: «Online + persistencia servidor». | Usarlo exigiría descongelarlo y construirle la persistencia — es decir, escribir este bloque igualmente, pero además rompiendo su congelación. |
| Su vocabulario es de **otro juego**: `coachRating`, `roster`, `mvp`, `scoreFor`/`scoreAgainst` en rondas, ligas y divisiones. | No modela un duelo de cartas. |
| `migrations/0003_competitive.sql` **no crea ninguna tabla de rating de jugador**: crea circuitos, eventos, equipos y estadísticas de esports reales. | No había dónde vivir. |
| `public.team_ratings` (0005) es el Elo de **equipos de esports reales** para las predicciones. | Ni siquiera habla de usuarios. |

**`src/competitive/` no se ha tocado.** Su verify sigue verde.

### Lo que SÍ se reutiliza: la matemática, como oráculo

`src/domain/esports/predict/elo.ts` (`expectedScore`, `updateElo`) es Elo logístico estándar, es
del dominio de predicciones —no del 5v5— y no está congelado. Es correcto y está probado.

Aun así **la liquidación se escribe en SQL**, por la misma razón que el emparejamiento del 7.4:
liquidar es «leer dos ratings + escribir dos filas de libro + actualizar dos ratings» de forma
indivisible, y el cliente de Supabase no sabe abrir transacciones de varias sentencias. Calcular
en TypeScript obligaría a un ciclo leer-calcular-escribir con reintentos. **La fórmula vive donde
vive la transacción.**

El riesgo de tener la fórmula en dos idiomas no se cierra con un comentario:
`pvp-rating:verify` usa `expectedScore`/`updateElo` **como oráculo** y comprueba que la función
SQL devuelve exactamente lo mismo (desviación medida: `0.00e+0` en 6 casos), y que el delta real
de una liquidación coincide con el que predice `updateElo`. Si alguna de las dos deriva, el
verify rompe.

**No se reutiliza `marginMultiplier`**, y es deliberado: su propio comentario lo calibra para
margen de **mapas** de una serie (1-0→1.0, 3-0→~1.8). El marcador de un duelo llega a 10-0, que
en esa función amplifica ×2,5 — muy fuera del rango para el que se diseñó. Un duelo es una
partida, no una serie. El marcador queda guardado en la partida, así que el día que se quiera un
término de margen se podrá calibrar con datos reales en vez de a ojo.

---

## 4. La separación, dicha una vez

```
RATING DE DUELOS PvP  ≠  puntos de Pick'ems  ≠  XP  ≠  créditos  ≠  Elo competitivo 5v5
```

No hay alias, ni vista, ni wrapper que junte dos de esas cosas. Si algún día una pantalla las
quiere juntas, que las lea por separado.

---

## 5. Migración y tablas

`supabase/migrations/0033_pvp_rating.sql` — **aditiva**. No edita ninguna migración histórica; las
0026–0028 siguen pendientes y sin tocar.

### `duel_pvp_ratings`

```sql
user_id      uuid primary key references auth.users(id) on delete cascade
rating       integer not null default 1000
games_played integer not null default 0
wins         integer not null default 0
losses       integer not null default 0
draws        integer not null default 0
created_at, updated_at
```

`user_id` **es** la clave primaria: un jugador tiene un rating, y esa unicidad es justo lo que la
clave primaria ya impone. Una columna `id` sintética obligaría a un índice único adicional sobre
`user_id` para decir lo mismo dos veces — que es exactamente cómo aparecen los segundos ratings.

**No hay columna `provisional`**: se deriva de `games_played < 10`. Guardarla sería un segundo
sitio donde el mismo hecho puede desincronizarse, igual que `PvpLifecycle` (7.2) se deriva y no
se guarda.

Restricciones, todas verificadas por el verify:

| restricción | qué impide |
|---|---|
| `rating between 0 and 5000` | Un rating fuera de rango es un error de cálculo, no un jugador excepcional. |
| contadores `>= 0` | Contadores negativos. |
| `wins + losses + draws <= games_played` | Que los contadores mientan. **`<=` y no `=`**: deja hueco para finales que sumen partida sin caer en ninguna de las tres categorías. Ni el abandono (7.4.2) ni el vencimiento (7.4.3) lo necesitan —los dos son derrotas—, pero el hueco sigue disponible para una categoría futura sin recalcular filas. |
| clave primaria sobre `user_id` | Dos ratings activos para el mismo usuario. |

### `duel_pvp_rating_events` — el libro

Existe porque, sin él, la única evidencia de un rating sería el propio número: «1137». Eso no se
puede auditar, ni disputar, ni recalcular si se descubre un error en la fórmula.

```sql
id bigserial primary key
match_id uuid not null            -- SIN clave foránea: ver abajo
user_id  uuid not null references auth.users(id) on delete cascade
old_rating, delta, new_rating     integer not null
opponent_rating, k_factor         integer not null   -- hacen el delta REPRODUCIBLE
result   text check (result in ('WIN','LOSS','DRAW'))
created_at
check (new_rating = old_rating + delta)
unique (match_id, user_id)        -- LA CLAVE DE IDEMPOTENCIA
```

`opponent_rating` y `k_factor` no son completismo: sin ellos un `delta` es un número que hay que
creerse. Con ellos se recalcula exactamente — y el verify lo hace, reproduciendo el delta del
libro con `updateElo` a partir de los propios campos de la fila.

**`match_id` sin clave foránea**, y es una decisión: un libro de auditoría tiene que sobrevivir a
lo que audita. `duel_matches` se borra en cascada al borrar un usuario, así que una FK con
`cascade` se llevaría por delante la explicación del rating **del rival**, que sigue vivo y
sigue teniendo ese rating; y una con `set null` rompería la clave `(match_id, user_id)`, que es
justo lo que impide liquidar dos veces. La integridad se garantiza donde importa:
`duel_pvp_settle_match` exige que la partida exista, sea PvP y esté terminada antes de escribir.

---

## 6. RLS y grants

Misma política, **sin excepciones**, que `duel_matches` (0014), `duel_match_actions` (0031) y
`duel_pvp_queue` (0032): **RLS activo, cero políticas, `revoke all`**.

La escritura es lo evidente —un jugador que puede hacer `update` sobre su rating no tiene
rating—, pero la **lectura directa también se cierra**: para que el rating de los demás no sea
enumerable y para que exista un solo camino de lectura (el servidor) que decida qué se proyecta.
Un usuario ve su rating porque el servidor se lo cuenta.

Las funciones son `security definer` y solo se conceden a `service_role`.

**Verificado, no supuesto** — el verify lo comprueba con un Bearer real:

```
[PASS] I. un usuario autenticado NO puede hacer UPDATE de su rating        — 42501
[PASS] I. ni del rating de otro                                            — 42501
[PASS] G. ni de sus victorias                                              — 42501
[PASS] H. ni de sus derrotas ni de su contador de partidas                 — 42501
[PASS] un usuario NO puede insertarse un rating a medida                   — 42501
[PASS] W. la tabla de rating es ILEGIBLE directamente                      — 42501
[PASS] W. el libro de movimientos tampoco es legible directamente          — 42501
[PASS] nadie se escribe un movimiento a mano en el libro                   — 42501
[PASS] X. duel_pvp_ensure_rating / settle_match / expected_score /
          k_factor / rating_window: ninguna invocable por authenticated     — 42501
```

---

## 7. Autoridad server-side

`src/server/services/duelsRating.ts` es la **única** puerta de servidor al rating. Nada fuera de
ese fichero toca `duel_pvp_ratings` ni `duel_pvp_rating_events`.

| función | qué hace |
|---|---|
| `ensureRating(sb, userId)` | Crea el rating si es la primera vez y lo devuelve. Idempotente por clave primaria. |
| `getRating(sb, userId)` | Lectura para mostrar a su dueño. |
| `getRatingHistory(sb, userId, n)` | El libro de un jugador, para explicar su número. |
| `settleMatch(sb, matchId)` | Liquida una partida terminada. **Interna: hoy no la llama ningún camino.** |

Ninguna acepta un `userId` que venga del cuerpo de una petición: las que sirven a un usuario
reciben el id que `getSession(req)` sacó del Bearer, y `settleMatch` recibe un `matchId` y deriva
los dos jugadores de la fila de la partida.

**El rating inicial no se puede inyectar**: lo pone el `DEFAULT` de la columna y ninguna función
tiene un parámetro por el que un rating pudiera entrar desde fuera. No es que se ignore un
`rating` del cuerpo — es que no existe el camino.

---

## 8. Algoritmo de rating

### Rating inicial: **1000**, no 1500

Dos razones, y ninguna es «es lo habitual»:

1. **Hace la separación visible en los datos.** `src/competitive/` y `team_ratings` arrancan en
   1500. Si este también lo hiciera, un 1500 suelto en un log o en una consulta no diría de qué
   sistema es. Un 1000 sí.
2. **Deja recorrido real por debajo antes del suelo (0).** Con K=24 hacen falta decenas de
   derrotas consecutivas para acercarse; el suelo no es un techo disfrazado.

El valor absoluto de un Elo es arbitrario —lo que significa algo son las **diferencias**—, así que
la elección se justifica por legibilidad y separación, no por «calidad» del número.

### K-factor: 40 provisional / 24 asentado

| estado | partidas | K | por qué |
|---|---|---|---|
| provisional | < 10 | 40 | El sistema no sabe nada del jugador: conviene que se mueva rápido hacia donde de verdad está. |
| asentado | ≥ 10 | 24 | Ya hay señal: se estabiliza para que una mala tarde no borre veinte partidas. |

No hay un tercer escalón por rating alto (como sí hace `src/competitive/`) porque eso solo tiene
sentido con una población grande y una cima que proteger. Hoy no la hay, y añadirlo sería copiar
una forma sin su motivo.

### Resultados

| resultado | puntuación | efecto |
|---|---|---|
| **victoria** | 1.0 | `delta = round(K × (1 − esperado))` |
| **derrota** | 0.0 | `delta = round(K × (0 − esperado))` |
| **empate** (`status = 'DRAW'`) | 0.5 | simétrico; con ratings iguales, delta 0 |
| **abandono** | — | **no se liquida.** Ver §12. |
| **`UNRESOLVED`** | — | no se liquida. Inalcanzable con las reglas vigentes; si apareciera sería un fallo interno, y un fallo interno no reparte rating. |
| **partida en curso** | — | `NOT_FINISHED`. Una partida a medias no vale nada. |

**El intercambio NO es de suma cero cuando las K difieren**, y es intencionado: un novato debe
converger rápido sin arrastrar consigo el rating de un veterano. Ese es el precio de tener
provisionalidad, y es el precio correcto. Medido en el verify: provisional +20 / asentado −12.

### Límites

`[0, 5000]`. El delta que se escribe en el libro es siempre el **efectivo** (tras recortar), para
que `new_rating = old_rating + delta` se cumpla fila a fila — lo exige una restricción.

---

## 9. Snapshot

`duel_pvp_queue.rating_snapshot` pasa de «siempre NULL» a **`NOT NULL`**: toda entrada de cola
nace con el rating con el que su dueño entró, y eso es ahora un invariante, no una costumbre.

Lo escribe `duel_pvp_enqueue` **dentro de su propia transacción**, leyéndolo de
`duel_pvp_ratings`. La firma de la función **no tiene ningún parámetro de rating**: la diferencia
entre «el servidor ignora el rating que mande el cliente» y «no existe ningún camino por el que un
rating pueda entrar» es que lo segundo no hay que acordarse de comprobarlo.

### «Rating actual» ≠ «rating con el que entré»

El snapshot se fija al entrar y **no se recalcula**. Si mientras espera termina otra partida suya
y su rating cambia, su entrada **no se toca**:

- emparejar contra un valor que se mueve bajo los pies haría la elegibilidad no reproducible —
  dos emparejadores mirando a la vez podrían ver poblaciones distintas;
- y recalcular todos los snapshots en cada intento convertiría una consulta indexada en un
  recorrido.

El snapshot solo cambia **saliendo de la cola y volviendo a entrar**, que es una acción explícita
del jugador. Verificado: rating actual 1900, snapshot 1337, entrada intacta; tras cancelar y
volver a entrar, snapshot 1900.

---

## 10. Algoritmo de emparejamiento

Dos pasos, deterministas y sin azar:

1. **El buscador es el que más ha esperado.** Esto conserva intacta la prioridad FIFO del 7.4:
   nadie adelanta a quien lleva más tiempo por tener mejor rating.
2. **Su rival es, de entre los compatibles, el de MENOR diferencia de rating**; a igualdad de
   diferencia, el que más ha esperado.

### Ventana

**Calibrada para la población que hay, que es casi ninguna.** Eso no es una disculpa, es el
criterio: una ventana estrecha y perpetua, con dos jugadores conectados, no produce partidas
justas — produce cero partidas.

| espera | ventana | probabilidad del favorito |
|---|---|---|
| 0–15 s | ±150 | ~70% |
| 15–45 s | ±300 | ~85% |
| 45–90 s | ±600 | ~97% |
| 90 s+ | libre | pasado minuto y medio, cualquier rival es mejor que ninguno |

Los porcentajes salen de la propia función Elo, no de la intuición.

Compatible = la diferencia cabe en la ventana que ha abierto **el que más ha esperado de los
dos**. Se usa el mayor de los dos tiempos a propósito: exigir que ambos hayan esperado obligaría
al recién llegado a cumplir una espera que no le aporta nada — el rival ya la ha hecho por los dos.

### Fairness

La ventana dice qué es **aceptable**; el paso 2 elige siempre al **mejor** dentro de ella. Que la
ventana llegue a ±600 no significa emparejar a ±600 habiendo alguien a ±20. Verificado: con un
buscador a 1000 y candidatos a 1140 (más antiguo) y 1030 (más reciente), ambos dentro de la
ventana, empareja con **1030**.

Con una población nueva (todos a 1000) la diferencia es 0 para todos y el desempate por
antigüedad reproduce **exactamente** el FIFO del 7.4. Verificado.

Las cuatro constantes están en una función SQL y solo ahí: retocarlas cuando haya jugadores
reales es cambiar cuatro números.

### El emparejador se serializa consigo mismo

**Este bloque introdujo un fallo y el verificador lo encontró a la primera.** En el 7.4 la
selección era **una** consulta (`limit 2 ... for update skip locked`) y `skip locked` bastaba. El
criterio de rating obliga a **dos** consultas —buscador, luego rival— y eso abre un hueco: con dos
emparejadores y dos candidatos, cada uno bloquea a uno como su buscador y luego encuentra al otro
bloqueado por el rival; los dos saltan y **nadie empareja**. No es interbloqueo —nadie espera—
pero el resultado es peor: nadie avanza.

Se cierra con un **cerrojo consultivo de transacción** tomado antes que cualquier fila, así que el
orden de bloqueo es siempre el mismo (cerrojo → filas) y no hay interbloqueo posible. Se usa la
variante que **espera**, no la que se rinde: el segundo se queda unos milisegundos y, cuando
entra, empareja a los siguientes. Rendirse habría convertido «4 candidatos y 2 emparejadores» en
una sola pareja en vez de dos.

El coste es que el emparejamiento es globalmente secuencial (deuda **D-MM-4**). Medido: 4 ms por
reserva → techo del orden de cientos de emparejamientos por segundo, muy por encima de cualquier
población previsible.

**Todo lo demás del 7.4 sigue igual**: `for update skip locked`, reserva del `matchId` por
adelantado, «las dos entradas o ninguna», guarda de partida activa y recuperación por
arrendamiento.

---

## 11. Liquidación — **enganchada** (bloque 7.4.2)

`duel_pvp_settle_match(match_id)` lee el resultado **autoritativo** de `duel_matches`
(`status` + `winner` + `closed_reason` + `closed_by`, escritos por el orquestador) y mueve los dos
ratings. Lo único que recibe es un `matchId`: no hay parámetro de ganador, ni de delta, ni de
rating. **No existe el camino** por el que un cliente declare un resultado.

### Dónde se engancha, exactamente

Dos puntos, y los dos están **después** de la escritura condicionada que hace terminal la partida:

| punto | fichero | cuándo |
|---|---|---|
| final normal | `duelsPvp.ts` → `applyPvpAction`, tras el `UPDATE ... eq(state_version)` | solo si la transición recién aplicada deja la partida terminal |
| abandono | `duelsPvp.ts` → `abandonPvpMatch`, tras su `UPDATE` condicionado | siempre (el `UPDATE` ya garantiza que solo un abandono escribe) |

Que vayan **después** del `UPDATE` es lo que hace imposible que el rating se adelante al
resultado: si esa escritura no triunfó, la línea de liquidación no se alcanza.

```
ACCIÓN DEL JUGADOR → validación server-side → el MOTOR decide → UPDATE condicionado
                                                                        │
                                                        (solo si quedó terminal)
                                                                        ▼
                                                        duel_pvp_settle_match  →  respuesta
```

### La consistencia elegida, sin adornos

Son **dos transacciones**: la que cierra la partida y la que mueve los ratings. No pueden ser una,
porque entre ellas tiene que correr el motor, que es TypeScript. La consistencia es **eventual y
con una dirección elegida**:

- **Puede** existir, durante milisegundos, una partida terminada y aún no liquidada.
- **No puede** existir lo contrario —rating movido con la partida sin cerrar—, porque la
  liquidación solo se invoca después del `UPDATE`.
- **No puede** existir una liquidación a medias: las dos filas de rating y las dos del libro se
  escriben en la **misma** transacción de `duel_pvp_settle_match`.

Y la ventana se cierra sola: **`syncPvpMatch` reintenta la liquidación** cuando devuelve el estado
completo de una partida terminal. Como el transporte del bloque 7.3 **es** el sondeo, esa segunda
oportunidad está garantizada sin construir nada. Solo ocurre en el camino completo —cuando el
cliente ya conoce la versión terminal, el sondeo barato responde `changed: false` sin llegar ahí—,
así que es como mucho un intento por jugador y por transición.

La liquidación **no propaga errores** al jugador: si el rating fallara, la partida ya está
terminada y eso es lo que tiene que recibir. Perder la respuesta de una partida jugada por un
fallo al sumar puntos sería el peor intercambio posible.

### Idempotencia

La impone el índice único `(match_id, user_id)`, no una comprobación previa. Verificado: segunda
llamada (`ALREADY_SETTLED`, rating intacto), **5 liquidaciones simultáneas** (0 aplicadas, 1
partida contada, 2 eventos), pares de acciones finales simultáneas, y **dos abandonos simultáneos**
(uno gana con `STALE_VERSION` para el otro, un solo settlement).

### Orden de bloqueo

Las dos filas de rating se bloquean **ordenadas por `user_id`**: sin ese orden, dos liquidaciones
simultáneas de partidas que comparten jugadores podrían bloquearse en orden inverso.

---

## 12. Abandono — **D-PVP-7 RESUELTO** (bloque 7.4.2)

### La política, en una frase

**Abandonar un duelo que ya había empezado es perderlo. El rival gana.**

Sin castigo adicional: la derrota del Elo **ya es** la penalización, y añadir otra sería inventar
una política de castigo que nadie ha decidido. Verificado: el delta de un abandono es exactamente
el de una derrota normal según `updateElo`.

### Las condiciones — son ellas las que impiden regalar victorias

| condición | por qué |
|---|---|
| Abandono **explícito** | `closed_reason = 'ABANDONED'` solo lo escribe `abandonPvpMatch`, que es una acción deliberada del jugador contra el endpoint. **Cerrar el navegador, perder la conexión o dejar de sondear no escriben nada**: la partida se queda viva esperando. Una desconexión **no** es una derrota. |
| Consta **quién** se fue (`closed_by`) | Sin abandono atribuible no hay a quién cargarle la derrota. Sin él → `NO_ABANDONER`, y no se liquida. |
| Quien se va es **uno de los dos** | Un `closed_by` que no sea jugador → `NO_ABANDONER`. |
| La partida **había empezado** (`status = 'IN_PROGRESS'`) | Una partida en `WAITING` no llegó a jugarse: abandonarla no da victoria a nadie → `NOT_COMPETITIVE`. |

**«Los dos abandonan a la vez» no puede ocurrir**, y no porque se compruebe: el `UPDATE` de
`abandonPvpMatch` va condicionado por `state_version` y por `closed_reason is null`, así que de dos
abandonos simultáneos solo uno escribe. El segundo recibe `MATCH_CLOSED` o `STALE_VERSION`.

### Sin recompensas

El abandono mueve **rating y nada más**. No toca créditos, ni XP, ni battle pass, ni economía: eso
es de otros bloques y no hay ningún gancho puesto.

### Timeout de turno — **también liquidado** (bloque 7.4.3)

`closed_reason = 'EXPIRED'` ya **no** devuelve `EXPIRED_NOT_SETTLED`: desde el bloque 7.4.3 existe
el barrido del reloj, que cierra la partida escribiendo en `closed_by` **el jugador que debía
mover**. Con ese dato, el vencimiento se liquida exactamente igual que un abandono.

La condición sigue siendo la misma para los dos cierres: sin `closed_by` no se liquida
(`NO_ABANDONER`), porque no hay a quién cargarle la derrota.

| causa | qué significa | rating |
|---|---|---|
| `ABANDONED` | alguien pulsó «abandonar». Acto deliberado. | LOSS al que se fue |
| `EXPIRED` | se acabó el tiempo. Hecho del reloj, sin voluntad. | LOSS al que debía mover |

Las dos producen el mismo movimiento, pero la causa queda diferenciada en la fila para siempre.
Detalle completo en **`docs/pvp/PVP-TIMEOUT.md`**.

---

## 13. Seguridad — resumen

| vector | qué lo impide |
|---|---|
| `rating` / `mmr` / `elo` en el cuerpo | Ninguna capa lo lee. Y no hay parámetro por el que viaje: `duel_pvp_enqueue` no lo acepta. Verificado enviando `999999`: el snapshot guardado es el real. |
| `wins` / `losses` / `gamesPlayed` en el cuerpo | Igual. Verificado: contadores intactos. |
| `userId` de otro en cuerpo o query | La ruta no lo lee: `getSession(req)` → Bearer. Verificado con `?userId=<otro>` + tres alias en el cuerpo. |
| `UPDATE` directo sobre la tabla | `revoke all` + RLS sin políticas. 42501. |
| `INSERT` de un rating a medida | Idem. 42501. |
| Escribir un movimiento en el libro | Idem. 42501. |
| Llamar a las RPC desde el cliente | Revocadas; solo `service_role`. 42501 con argumentos correctos. |
| Dos ratings para el mismo usuario | Clave primaria. |
| Liquidar una partida inventada | `NO_MATCH`: la función exige que exista, sea PvP y esté terminada. |
| Manipular el snapshot ya sellado | No hay camino de escritura; reintentar el alta no lo cambia. |

---

## 14. Cómo ejecutar los verificadores

```bash
# Requisitos: Supabase local (54521). El servidor (:3005) solo para las pruebas HTTP.
npm run pvp-rating:verify          # este bloque
npm run pvp-matchmaking:verify     # 7.4 — el emparejamiento con rating dentro
npm run pvp:verify                 # 7.2 — modelo PvP
npm run pvp-sync:verify            # 7.3 — sincronización (necesita servidor)
npm run competitive:verify         # 5v5 CONGELADO — debe seguir verde e intacto
npm run matchmaking:verify         # cola 5v5 CONGELADA — idem
```

---

## 15. Deudas

| id | deuda | prioridad |
|---|---|---|
| ~~**D-RAT-1**~~ | ~~La liquidación no está enganchada~~ → **RESUELTO** por el bloque 7.4.2. Se dispara en `applyPvpAction` y en `abandonPvpMatch`, con red de seguridad en `syncPvpMatch`. Ver §11. | — |
| **D-MM-4** *(nueva)* | El emparejador se serializa globalmente con un cerrojo consultivo (§10). Medido en 4 ms, techo de cientos de emparejamientos/segundo. Solo importa con una población que hoy no existe. | P3 |
| **D-RAT-2** *(nueva)* | Sin decaimiento por inactividad ni temporadas: un rating alto se conserva para siempre. Correcto para un sistema sin población; hay que revisarlo antes de publicar clasificaciones. | P3 |
| **D-MM-1** | **RESUELTO** por este bloque. | — |
| ~~**D-PVP-7**~~ | ~~El abandono no acredita al rival~~ → **RESUELTO** por el bloque 7.4.2: abandonar una partida empezada es perderla. Ver §12. | — |
| **D-RAT-3** *(nueva, 7.4.2)* | Cerrar la partida y liquidar son dos transacciones. La ventana es de milisegundos y la cierra sola el sondeo, pero no es atomicidad estricta. Cerrarla del todo exigiría meter el motor en la base de datos. | P3 |
| ~~**D-PVP-6**~~ | ~~El reloj de turno no vence solo~~ → **RESUELTO** por el bloque 7.4.3. Ver `PVP-TIMEOUT.md`. | — |
| ~~**D-PVP-8**~~ | ~~No hay UI de PvP~~ → **RESUELTO** por el bloque 7.5. Ver `PVP-ARENA.md`. | — |
| ~~**R11**~~ | ~~`toPublicView` cableado a `snapshotA`~~ → **RESUELTO** por el bloque 7.5 al extraer `buildMatchView`. | — |
| **D-PVP-5, D-PVP-3** *(heredadas)* | Sin cambios. ~~D-PVP-9~~ quedó **resuelta en el BLOQUE 7.6**. | — |

---

## 16. Futuras temporadas y rangos

Nada de esto se ha construido, y el modelo no lo presupone:

- **Temporadas**: harían falta una tabla de temporada y un *soft reset*. El libro ya permite
  reconstruir cualquier estado pasado, así que un reset no destruye historia.
- **Ligas/divisiones**: son una PROYECCIÓN del rating, no un dato nuevo. No se guardan.
- **Leaderboard**: `duel_pvp_ratings_rating_idx` ya lo soporta; falta decidir qué se publica y
  con qué privacidad (hoy la tabla no es legible por nadie).
- **Recompensas**: fuera de scope y sin ningún gancho puesto.

---

## 17. Lo que este bloque NO implementa

Arena PvP · UI · WebSocket · Realtime · SSE · recompensas · XP · créditos · temporadas · ligas ·
divisiones · decaimiento · leaderboard · historial visual · recompensas por resultado PvP.

`src/competitive/`, `src/matchmaking/`, `src/online/` y `src/social/` siguen **congelados y sin
tocar**. `profiles.points` sigue siendo exclusivamente Pick'ems. El motor de combate y las reglas
del juego no se han tocado. No se ha creado ni un evento de telemetría nuevo.
