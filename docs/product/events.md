# EVENTOS EN VIVO

> Ciclo de vida, autoridad de servidor, desafíos, Pick'ems y recompensas.
>
> Estado: **Fase 13**. Verificado por `npm run events:verify` (32 comprobaciones contra la
> base de datos real, incluidos los intentos de cobrar fuera de plazo), por `loop:verify`
> —que recorre la cadena entera de un desafío por partido: se genera, se responde, se
> corrige y se paga— y por 27 pruebas unitarias del dominio puro.
>
> La Fase 13 añadió los **desafíos por partido** (§5 bis).

---

## 1 · EL HUECO QUE ESTA CAPA CIERRA

La Fase 10 lo dejó por escrito en su lista de pendientes: **«Eventos server-side»**.

Hasta hoy, NEXUS tenía dos cosas llamadas «evento» y ninguna de las dos era una capa de
contenido vivo:

| Qué | Dónde vivía | Problema |
|---|---|---|
| El evento estilo FUT (`domain/events`, `useEventsStore`) | **`localStorage`** | Fichas, misiones, pase y tienda propios. Con sesión iniciada, `CloudSync` borraba lo reclamado en la siguiente sincronización. La Fase 10 lo dejó en **solo lectura** y escribió el motivo en pantalla |
| El torneo del circuito (`public.events`) | Servidor | Tenía fechas, partidos y Pick'ems… y **nada que hacer**: ninguna recompensa colgaba de él |

El primero repartía premios que se evaporaban; el segundo no repartía ninguno. La Fase 12
no construye un tercero: **usa el segundo para hacer lo que hacía el primero**.

---

## 2 · UN EVENTO ES UN TORNEO

No hay tabla nueva. No hay migración. `public.events` existe desde la migración 0002, la
llena la sincronización competitiva con torneos reales y ya tiene las tres columnas que
hacen falta: `status`, `start_date`, `end_date`.

Lo que faltaba no era una tabla: era **la función que traduce dos marcas de tiempo en una
fase**, escrita una vez y ejecutada en el servidor.

```
public.events ──► domain/events/lifecycle ──► fase
                  (puro, recibe `now`)
```

---

## 3 · LAS CINCO FASES

```
   UPCOMING ──► LIVE ──► ENDING ──► COMPLETED ──► ARCHIVED
   anunciado   en marcha  < 48 h    terminado,     plazo
                                    se puede       cerrado
                                    cobrar
```

| Fase | Participa | Cobra |
|---|---|---|
| `upcoming` | ❌ | ❌ |
| `live` | ✅ | ✅ |
| `ending` (últimas **48 h**) | ✅ | ✅ |
| `completed` (**7 días** de plazo) | ❌ | ✅ |
| `archived` | ❌ | ❌ |

### Por qué hay plazo de gracia

El encargo pedía que los logros de evento «dejen de ser reclamables cuando termine el
evento». Al pie de la letra sería injusto: **los puntos de un Pick'em se corrigen CUANDO
acaba el torneo**, así que el desafío «acierta 3 predicciones» solo se puede completar
después del final. Cerrar la puerta en el pitido final dejaría sin cobrar a quien lo ganó.

La ventana no se cierra al terminar: se cierra **7 días** después. Es un plazo, no una
puerta abierta, y `archived` la cierra de verdad.

### LA FECHA MANDA SOBRE EL ESTADO

Es la invariante que impide que un torneo terminado siga pagando, y tiene su propia prueba.

`status` lo escribe la sincronización competitiva y **puede ir rezagado**: un torneo que
acabó ayer sigue marcado `ongoing` hasta la siguiente pasada. `end_date` es un hecho. Si se
confiara en `status`, un evento acabado seguiría repartiendo recompensas hasta que alguien
ejecutara una sincronización.

Sin ninguna fecha se cae al estado, que es lo único que queda. Se declara como degradación,
no como norma.

---

## 4 · AUTORIDAD DE SERVIDOR

| Pregunta | Quién responde |
|---|---|
| ¿Existe el evento? | `public.events` |
| ¿En qué fase está? | `eventPhase()` con la hora **del servidor** |
| ¿Qué desafíos tiene? | `challengeSetFor()`, por **campos** del evento |
| ¿Cuánto llevo? | Recuento al vuelo sobre las tablas donde ya está el hecho |
| ¿Puedo cobrar? | Fase + progreso + no reclamado antes |
| ¿Cuánto me pagan? | El catálogo del servidor |

**El cliente envía dos identificadores.** Ni una cantidad, ni una recompensa, ni una fecha,
ni un progreso. Lo comprueba `security:verify`: si el cuerpo de `/api/game/events` llegara a
aceptar un campo con `credits`, `reward`, `amount`, `xp`, `token`, `pack`, `points` o
`price`, la comprobación falla.

---

## 5 · DESAFÍOS

Un objetivo medible **acotado a la ventana del evento**. La diferencia con una misión del
pase no es el premio: es el ALCANCE. Una misión mide toda tu vida de jugador («abre 100
sobres»); un desafío mide solo lo que hiciste mientras el torneo estaba en marcha.

### El conjunto base

| Desafío | Métrica | Meta | Paga |
|---|---|---|---|
| Entra al torneo | predicciones enviadas | 1 | 500 cr · 50 XP · 15 fichas |
| Ojo clínico | predicciones acertadas | 3 | 1.000 cr · 100 XP · 25 fichas |
| En forma | duelos jugados en la ventana | 5 | 800 cr · 120 XP |
| Racha de torneo | duelos ganados en la ventana | 3 | 1.200 cr · 180 XP · 1 sobre Estándar |
| Fiebre de sobres | sobres abiertos en la ventana | 5 | 500 cr · 80 XP · 20 fichas |

Los torneos **internacionales** añaden uno más: *Analista del circuito* (40 puntos de
Pick'em → 1.500 cr · 200 XP · 40 fichas). No cambia el premio de los demás: se suma uno.

### Por qué NO hay tabla de desafíos

Un desafío tiene tres partes y las tres ya tenían sitio:

- **La definición** es contenido, y el contenido vive en el código como el resto del
  catálogo (`data/packs`, `data/season`, `domain/pickems/rewards`).
- **El progreso** no se guarda: se cuenta al vuelo sobre `pickem_scores`, `duel_matches` y
  `economy_ops`. Es la misma decisión que tomó `metricsFor` en la Fase 9E, y por el mismo
  motivo: un contador duplicado es un contador que acabará discrepando.
- **Lo reclamado** va a `user_achievements` con el id `event:<evento>:<desafío>`. Esa tabla
  guarda exactamente eso, ya está cerrada al cliente y ya tiene su RLS — y de paso resuelve
  gratis el requisito de que los logros de evento «queden registrados y conserven
  historial».

### De dónde sale cada métrica

| Métrica | Tabla | Nota |
|---|---|---|
| `event_picks_made` | `pickem_answers` vía `pickem_submissions` | |
| `event_picks_correct` · `event_pickem_points` | `pickem_scores` | |
| `event_duels_played` · `event_duels_won` | `duel_matches` acotado por `created_at` | |
| `event_packs_opened` | `economy_ops` con `kind = 'open_pack'` | **`profiles.packs_opened` no sirve**: es un total acumulado y no se puede acotar a una ventana |

**Sin `start_date` no hay ventana**, y las métricas temporales se quedan a cero en lugar de
contar toda la historia del jugador. Contar desde el principio de los tiempos convertiría un
desafío de evento en un logro retroactivo que se cobra el primer día.

### Nada de `if evento === "…"`

Los conjuntos se eligen por una condición sobre los **campos** del evento (`type`), no por
su id. Un torneo que la sincronización traiga mañana recibe sus desafíos sin tocar código.
Hay una prueba que lo comprueba cambiando **solo** el id y exigiendo el mismo conjunto.

---

## 5 bis · DESAFÍOS POR PARTIDO (Fase 13)

Un partido predecible trae ahora **dos** preguntas, no una:

| Tipo | Pregunta | Opciones | Puntos |
|---|---|---|---|
| `match_winner` | ¿Quién gana? | 2 | los de la ronda (10–30) |
| **`match_score`** | **¿Con qué resultado?** | **4** (2-0 · 2-1 · 1-2 · 0-2) | **el doble** |

**No es un segundo Pick'em.** Es un `kind` más de la misma tabla, el mismo ciclo de vida, el
mismo corrector y la misma ruta de recompensa. Lo único que cambió en el servidor fue que la
lista de preguntas a generar es más larga y que el corrector pregunta por el tipo antes de
resolver.

### Por qué el doble

Con cuatro opciones en vez de dos, acertar a ciegas baja del 50 % al 25 %. Pagar el doble
por la mitad de probabilidad deja el valor esperado de **adivinar** exactamente igual que
antes: la pregunta premia saber y no le sube el suelo a quien va al azar.

### Los otros tres no se pueden

El encargo proponía cinco: ganador, mapa, jugador destacado, diferencia y resultado exacto.
Solo dos se pueden **corregir** con los datos que hay:

| Desafío | Dato necesario | ¿Existe? |
|---|---|---|
| Ganador | `matches.winner_team` | ✅ |
| **Resultado exacto** | `matches.score_a` · `score_b` | ✅ **comprobado: 2 de 2 partidos terminados traen marcador** |
| Mapa | — | ❌ `public.matches` no guarda mapa |
| Jugador destacado | `player_stats` | ❌ solo si el importador de estadísticas pasó por ese partido |
| Diferencia | derivable del marcador | ❌ redundante con el resultado exacto |

Una pregunta que no se puede corregir es una pregunta que nadie cobra. Se documentan en
lugar de fingirse.

### El índice tuvo que cambiar

La 0018 puso `unique (pickem_event_id, match_id)` para que dos pasadas solapadas de la
sincronización no duplicaran la pregunta de un partido. Con dos preguntas por partido esa
restricción impedía justo lo que queremos, así que la clave incorpora el tipo
(`0023_match_challenges.sql`). Sigue cumpliendo su función —no puede haber dos preguntas del
MISMO tipo para el mismo partido— y el índice **no es parcial**, porque `ON CONFLICT` de
PostgREST no puede apuntar a uno parcial: es el mismo tropiezo que la Fase 10 documentó.

---

## 6 · CUÁNTO PAGA, Y POR QUÉ ESO

El conjunto entero reparte **4.000 créditos**, 530 XP, 60 fichas y un sobre Estándar; el
internacional, 5.500 créditos. Con tres eventos por temporada son **12.000–16.500
créditos**, un **+9,6 % a +13 %** sobre los 124.900 no repetibles que `economy.md` §4 tiene
medidos.

No es una cifra elegida por intuición: es la que mantiene el evento por debajo de la sexta
parte del grifo de temporada, para que añadir contenido vivo no sea añadir inflación. Hay
una prueba que falla si un conjunto se pasa del 15 %.

Medido en la simulación completa (`npm run economy:simulate`, 84 días), los eventos aportan:

| Perfil | Créditos de eventos | % de todo lo que gana |
|---|---|---|
| Casual | 9.900 | **8,7 %** |
| Activo | 16.500 | **4,5 %** |
| Intensivo | 16.500 | **1,5 %** |

Es contenido, no un grifo.

### La regla de no pagar dos veces

**Los desafíos no repiten el premio del Pick'em.** El escalón del Pick'em
(`domain/pickems/rewards`) paga por ACERTAR y es la recompensa mayor; el desafío paga por
PARTICIPAR y queda deliberadamente por debajo. Hay una prueba que exige que ningún desafío
pague más créditos que el escalón alto del Pick'em: si lo hiciera, acertar dejaría de ser lo
que más renta.

Las dos rutas pasan por `services/rewards.award()` con **claves distintas**
(`pickem:<ev>:<escalón>` y `event:<ev>:<desafío>`), así que se pueden auditar por separado
en el libro mayor.

---

## 7 · EVENTO → XP → PASE

No hay una segunda vía. `award()` concede XP, y el pase progresa con la XP de la cuenta —
igual que con las misiones y los duelos desde la Fase 10. Un desafío de evento **no toca el
pase directamente**: le da XP al jugador y el pase hace lo que hace siempre.

Es la razón de que no haya doble recompensa que reconciliar: solo hay un contador.

---

## 8 · LA COMPRA DE UN COBRO, PASO A PASO

El orden **no** es casual:

```
1. ¿Existe el evento?                    404 si no
2. ¿La FASE permite cobrar?              409 — aqui se cierra el agujero
3. ¿El desafio es de ESE evento?         404 si es de otro conjunto
4. ¿El progreso REAL llega a la meta?    409, contado ahora y en el servidor
5. ¿Estaba ya reclamado?                 409
6. PAGO   → services/rewards.award()     idempotente por `ref`
7. REGISTRO → user_achievements
```

**Los pasos 6 y 7 van en ese orden a propósito.** Si se registrara primero y el pago
fallara, el desafío quedaría marcado como cobrado sin haber pagado nada. Al revés, un fallo
entre los dos deja un reintento que vuelve a llamar a `award()` —que ya no paga, por la
clave— y completa el registro que faltaba.

---

## 9 · QUÉ SE INTENTA ROMPER Y QUÉ LO IMPIDE

Todo en `npm run events:verify`, contra la base de datos real:

| Ataque | Defensa | Verificado |
|---|---|---|
| Cobrar un desafío a medias | Progreso contado en el servidor | ✅ |
| Cobrar dos veces | Registro + clave de idempotencia en `award()` | ✅ |
| Cobrar en un evento **archivado** con el desafío completo | La fase se comprueba antes que nada | ✅ |
| Cobrar en un evento que no ha empezado | Misma puerta | ✅ |
| Cobrar un desafío de otro conjunto | `challengeById` valida contra ESE evento | ✅ |
| Inventarse un identificador | 404 | ✅ |
| Inventarse un evento | 404 | ✅ |
| Que cuenten partidas anteriores al evento | Ventana `[start, end]` | ✅ |
| Un `status` rezagado que reabra un torneo | La fecha manda sobre el estado | ✅ |
| Enviar la recompensa en el cuerpo | La ruta no admite ningún campo económico | ✅ en `security:verify` |

---

## 10 · LA PANTALLA

El vestíbulo responde a las cuatro preguntas, en orden:

```
QUE EVENTO HAY  →  QUE PUEDO HACER  →  QUE PUEDO GANAR  →  CUANDO TERMINA
```

Tres decisiones que merecen explicarse:

1. **Un desafío completo se distingue de lejos.** Es lo único del panel que exige una
   acción; el resto es información.
2. **Los bloqueados no desaparecen.** Un desafío de predicciones en un evento sin Pick'em se
   queda a cero y se ve. Esconderlo dejaría al jugador preguntándose por qué su lista es más
   corta que la de otro.
3. **Si no hay evento, no hay panel.** Un recuadro que dice «no hay ningún evento» ocupa el
   mejor sitio del vestíbulo para no decir nada.

Lo que cuenta el reloj cambia con la fase, y se dice: «Empieza en», «Termina en», «Puedes
reclamar durante». «3 días» a secas puede querer decir tres cosas y dos de ellas son
urgentes.

---

## 11 · LO QUE **NO** SE HA CREADO

Ninguna tabla. Ninguna migración. Ninguna entidad «evento» paralela a `public.events`.
Ninguna segunda ruta de recompensa. Ningún tipo de recompensa nuevo.

El evento local estilo FUT (`useEventsStore`, `data/events.ts`, `/eventos`) **sigue intacto**
y sigue funcionando en el modo sin cuenta, que es un modo legítimo del producto. No se ha
borrado: se ha dejado de necesitar para el modo con sesión.

---

## 12 · LO QUE QUEDA

| Pendiente | Nota |
|---|---|
| **Migrar la tienda de fichas del evento** | Las fichas (`profiles.tokens`) ya son server-authoritative; la tienda que las gasta sigue siendo local |
| **Desafíos por partido** | Hoy el alcance es el torneo entero. Un desafío atado a un partido concreto exigiría métricas por `match_id` |
| **Aviso de que un evento va a cerrar** | El panel lo enseña al entrar; no hay notificación fuera de la aplicación |
| **Retirar `/eventos` cuando la tienda esté migrada** | Mientras exista el modo sin cuenta, tiene sentido que siga |
