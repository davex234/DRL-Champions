# NEXUS — Definiciones de métricas

> FASE 14, bloque 5. Cada métrica con su definición exacta, su fuente y **sus límites**.
> Verificación: `npm run analytics:verify` (48/48).
> Implementación: `supabase/migrations/0030_analytics_functions.sql` ·
> `src/server/services/analytics.ts`

**Regla de lectura de este documento:** si una métrica tiene una limitación, está escrita
en su propia fila. Una métrica sin límites declarados no existe.

---

## Usuarios y sesiones

### DAU — usuarios activos diarios

| | |
|---|---|
| **Definición** | Usuarios **con identidad conocida** que generaron al menos un evento de telemetría en el día natural |
| **Fuente** | `telemetry_events`, `user_id is not null` |
| **Fórmula** | `count(distinct user_id) where occurred_at ∈ [día, día+1)` |
| **Límites** | Solo desde la Fase 14. **Las sesiones anónimas NO se suman**: un visitante anónimo no es un usuario único —puede ser el mismo de ayer con el almacenamiento limpio, o tres pestañas de la misma persona—. Se devuelven aparte en `anon_sessions` |
| **Retroactividad** | Ninguna |
| **Privacidad** | Agregado. Ningún dato personal |

### WAU — usuarios activos semanales

Igual, con ventana móvil de **7 días hacia atrás** desde cada día (`[día−6, día+1)`), no
semana natural. Por construcción `WAU ≥ DAU`, y la verificación lo comprueba.

### Sesiones

| | |
|---|---|
| **Definición** | `session_id` distintos con al menos un evento en la ventana |
| **Fórmula** | `count(distinct session_id)` |
| **Desglose** | `authenticated` (algún evento con usuario y ninguno sin él) · `anonymous` (ninguno con usuario) · **`mixed`** (empezó anónima y siguió autenticada) |
| **Límites** | Una sesión no es una persona: la misma persona en dos pestañas son dos sesiones |

**`mixed_sessions` es la métrica que justifica el modelo de sesión entero:** es el jugador
que navegó sin cuenta y luego se registró, y es la única forma de ver el tramo previo al
registro.

### Duración de sesión — **COTA INFERIOR**

| | |
|---|---|
| **Definición** | `max(occurred_at) − min(occurred_at)` por sesión |
| **Fuente** | `telemetry_events` |
| **Límites** | **NO es la duración.** `session_ended` se rechazó en el bloque 2 porque cerrar el navegador, perder la red o que el móvil mate la pestaña no avisan; emitirlo solo en los cierres limpios daría un dato **sesgado**. No se sabe cuánto estuvo el jugador mirando la última pantalla |
| **Cómo se nombra** | Los campos se llaman `median_seconds_lower_bound` y `avg_seconds_lower_bound`. **El nombre es la advertencia** |
| **Cuándo no significa nada** | Si `single_event_sessions` es la mayoría: esas duran 0 por definición y hunden la mediana. Por eso se devuelve esa cifra al lado |

### `last_seen`

Última actividad conocida de un usuario: `max(occurred_at)`. **No es una columna** —sería
una segunda verdad—: se calcula de los eventos que ya existen.

---

## Retención

### D1 / D7 / D30

| | |
|---|---|
| **Definición** | De los usuarios dados de alta el día X, cuántos generaron actividad registrada en la ventana **[X+N, X+N+1)** |
| **Fuente** | Cohorte: `profiles.created_at`. Actividad: `telemetry_events` |
| **Tipo** | **Retención de día concreto, no acumulada.** D7 NO incluye a quien volvió el día 3 y no el 7. Se elige así porque es la definición más común y la más difícil de inflar sin querer |
| **Límites** | **Insalvable:** la actividad sale de la telemetría, que existe desde la Fase 14 |

**La bandera que evita la mentira.** Cada fila devuelve `d1_measurable`, `d7_measurable` y
`d30_measurable`: dicen si la ventana de observación de esa cohorte cae dentro del periodo
con instrumentación.

> Sin esa columna, un `d7 = 0` en una cohorte de agosto se leería como una catástrofe de
> retención. Con ella se lee como lo que es: **no se estaba midiendo**.

Verificado: las 5 cohortes existentes salen con `d7_measurable = false` y `d7 = 0`.

---

## Primera experiencia

### Conversión FTUE

| | |
|---|---|
| **Definición** | Por cada paso del embudo, `usuarios / tamaño de la cohorte` y `usuarios / paso anterior` |
| **Cohorte** | Usuarios **creados** en la ventana (`profiles.created_at`), no los activos |
| **Fuente** | 6 de 7 pasos son autoritativos (ver [`FUNNELS.md`](FUNNELS.md)) |
| **Retroactividad** | **Sí, salvo `ftue_started`.** Medido: 58 usuarios históricos con sus pasos completos |
| **Límites** | Cuenta usuarios que **alguna vez** hicieron cada cosa, no en orden. Una etapa puede superar a la anterior; si pasa, es información |

### Conversión a primer duelo

`duel_started / user_created` de la cohorte. **Totalmente retroactivo** (`duel_matches`).

### Tasa de finalización de duelo

| | |
|---|---|
| **Fórmula** | `partidas terminadas / partidas empezadas` (terminadas = `COMPLETED`, `DRAW`, `UNRESOLVED`) |
| **Fuente** | `duel_matches`, con índice `(user_id, status)` |
| **Retroactividad** | Total |

### Duración de duelo — **EXACTA**

`updated_at − created_at` de las partidas terminadas. **A diferencia de la sesión, esta sí
es exacta**: el duelo empieza y acaba con escrituras en la fila.

Se devuelven mediana **y** media. Medido en los datos reales: mediana 71 s, media 670 s —
la diferencia delata una partida larga y es la razón de dar las dos.

### Abandono de duelo — **INFERENCIA**

| | |
|---|---|
| **Definición** | Partidas `IN_PROGRESS` cuya `updated_at` lleva más de N horas sin moverse (por defecto 24) |
| **Por qué funciona** | El disparador `touch_updated_at` sella la fila **en cada turno**, así que la fecha es la del último turno, no la del comienzo |
| **Límites** | **No es un hecho, es una inferencia.** Un jugador puede volver mañana. La ventana es un **parámetro de consulta**, no una regla del producto |

Verificado: con ventana de 24 h la partida de prueba cuenta como abandonada; con ventana
de un año, no.

---

## Uso

### Uso por zona

Tres cifras que **no se mezclan nunca**:

| campo | qué es |
|---|---|
| `entries` | Veces que se entró |
| `users` | Personas distintas |
| `sessions` | Sesiones distintas |

> Un jugador entra once veces en el mercado: eso es **una** persona y **once** entradas.
> Confundirlos es la forma más fácil de creer que una zona se usa más de lo que se usa. No
> se ofrece ningún total que los sume.

`first_of_session` cuenta cuántas veces esa zona fue la **puerta de entrada**, que responde
otra pregunta: por dónde llega la gente.

**Límites:** solo desde la Fase 14. Una zona con 0 entradas puede significar «nadie entra»
o «la ruta no está en el mapa `zoneFromPath`» — en el segundo caso caería en `other`, así
que `other` creciendo es la señal de que falta una entrada en el mapa.

### Inicios de flujo

`flow_started` por flujo, con usuarios y sesiones distintos.

**Solo `deck_builder` está instrumentado.** Los otros tres del contrato aparecen con cero
porque sus inicios sí cambian de ruta y `zone_entered` ya los cubre. Es una ausencia
conocida, no un dato.

**Conversión del flujo:** `deck_builder` → existe un `duel_decks.created_at` posterior del
mismo usuario. El abandono es lo contrario, y **se calcula, no se registra**.

---

## Salud

### Tasa de errores

Errores agrupados **por huella**, no una fila por aparición: veinte apariciones del mismo
fallo son una fila con `occurrences = 20`.

Dimensiones disponibles: día, severidad, origen, zona, flujo, **versión de la aplicación**
y código.

**`app_version` es la que permite decir «esto se rompió en la 0.1.2»**, que es la pregunta
que se hace de verdad cuando algo empieza a fallar.

### Tasa de errores críticos

`severity = 'critical'`, reservada a los nueve flujos que impiden jugar.

**Límite honesto:** hoy el manejador global **nunca** emite `critical` — desde un
`window.onerror` no se sabe en qué flujo estaba el jugador, y reclasificar hacia arriba sin
saberlo vaciaría de significado la única señal que la consola necesita. Hasta que cada
flujo crítico capture sus propios errores, esta métrica solo se alimenta de emisiones
explícitas. Deuda **D-ING-5**.

---

## Cohortes y filtros

| filtro | fuente | disponible |
|---|---|---|
| Fecha de alta | `profiles.created_at` | Sí, **retroactivo** |
| Fecha de sesión | `telemetry_events.occurred_at` | Sí, desde la Fase 14 |
| Versión de la aplicación | `telemetry_events.app_version` | Sí, desde la Fase 14 |
| Entorno | `telemetry_events.environment` | Sí, con la salvedad de **D-ING-6** |

**Nunca disponibles, por diseño:** correo, IP, identificador de dispositivo, `user_agent`,
país. No se guardan (ver [`EVENT-TAXONOMY.md`](EVENT-TAXONOMY.md) §11), así que no se puede
segmentar por ellos. Es el precio de la decisión, y se paga a gusto.

> **D-ING-6 en la práctica:** `next start` en local escribe `environment: 'production'`,
> porque técnicamente lo es. Filtrar por entorno separa *tipos de build*, no *despliegues*.

---

## Rendimiento medido

Con **60.000 filas sintéticas** (≈ 4 semanas al ritmo de 2.000 sesiones/día), en el
PostgreSQL local:

| función | ventana | tiempo | plan |
|---|---|---|---|
| `analytics_ftue_funnel` | 30 días | **0,8 ms** | índices de las tablas autoritativas |
| `analytics_errors` | 7 días | **0,2 ms** | índice parcial de severidad |
| `analytics_sessions` | 7 días | **46 ms** | agregación por sesión |
| `analytics_zones` | 7 días (todo) | **163 ms** | Seq Scan — correcto: el filtro coge el 100 % |
| `analytics_zones` | 1 hora | **2,1 ms** | **Bitmap Index Scan** sobre `telemetry_name_time_idx` |
| `analytics_active_users` | 30 días | **376 ms** | 4 subconsultas × 31 días |

**No se añade ningún índice**, y eso es una conclusión medida, no una omisión:

- Con ventana estrecha, el índice `(event_name, occurred_at)` **se usa** y responde en 2 ms.
- Con ventana ancha, el Seq Scan es el plan **correcto**: cuando el filtro selecciona todas
  las filas, un índice es más lento, no más rápido.

**La que hay que vigilar es `analytics_active_users`:** 376 ms para 31 días con 60k filas.
Con la retención de 90 días y ~1,4 M de filas escalaría mal. La solución cuando llegue el
momento es una tabla diaria de agregados, y el encargo prohíbe crearla ahora con razón: **se
mide primero**. Deuda **D-AN-1**, con el umbral escrito para poder reconocerlo.
