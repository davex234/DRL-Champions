# NEXUS Telemetry Data Model

> FASE 14, bloque 3. Modelo de datos y seguridad. **Sin tracking de aplicación, sin
> endpoint, sin dashboard.**
> Migración `supabase/migrations/0029_telemetry_events.sql` · verificación
> `npm run telemetry:verify` (35/35)

---

## 1. Purpose

Registrar **comportamiento** —sesiones, zonas, flujos abiertos y errores— porque es la
única mitad de la observabilidad que NEXUS no tenía. La otra mitad, la transaccional, ya
es autoritativa en `credit_transactions`, `economy_ops`, `market_audit` y en las marcas de
tiempo del dominio, y **no se duplica aquí** (ver [`AUDIT.md`](AUDIT.md) y
[`EVENT-TAXONOMY.md`](EVENT-TAXONOMY.md): 4 eventos almacenados, 30 derivados, 21
rechazados).

**Esta tabla no es autoridad de nada.** Si se vaciara entera, los saldos, los rangos, las
recompensas y las reglas seguirían siendo correctos, porque ninguno la consulta.

---

## 2. Table

`public.telemetry_events` · migración **0029**.

**Clave primaria: `bigint generated always as identity`, no `uuid`.**
El precedente de la casa para un registro de solo-anexado es `market_audit` (0004), que
usa identity por lo mismo: la mitad de tamaño que un uuid, crecimiento secuencial —lo que
mantiene compacto el índice de una tabla que solo recibe inserciones— y nadie necesita
generar el id en el cliente. Las tablas de **dominio** sí usan `gen_random_uuid()` porque
sus filas se referencian desde fuera; una fila de telemetría no se referencia jamás.

---

## 3. Columns

| columna | tipo | null | justificación |
|---|---|---|---|
| `id` | `bigint identity` | no | §2 |
| `event_name` | `text` | no | Cerrado a cuatro valores en la **base de datos** (§4) |
| `user_id` | `uuid` → `auth.users(id)` `on delete cascade` | **sí** | **`auth.users`, no `profiles`**: es lo que hace toda tabla de usuario del proyecto (`user_cards`, `credit_transactions`, `duel_matches`…); `profiles` es un perfil derivado, no la identidad. Nullable porque NEXUS funciona sin cuenta en `/inventario` y `/coleccion`. `cascade` porque borrar la cuenta debe llevarse el rastro |
| `session_id` | `uuid` | **sí** | Sin clave foránea **a propósito**: no existe tabla de sesiones y no se va a crear. Una sesión es una ventana de 30 min de inactividad, no una entidad (§8) |
| `zone` | `text` | sí | Zona de producto, **no ruta** (§5) |
| `flow` | `text` | sí | Solo para `flow_started` (§6) |
| `source` | `text` | sí | Solo para `error_captured` (§7) |
| `severity` | `text` | sí | Solo para `error_captured` (§7) |
| `environment` | `text` | no | Valores de `NODE_ENV`, la convención que el proyecto ya usa. Sin esto, las pruebas locales contaminan las métricas |
| `app_version` | `text` | sí | De `src/platform/version.ts` (`APP_VERSION`), **fuente única ya existente** que el pipeline de release sincroniza. Nullable: un evento sigue sirviendo sin versión, y perderlo entero por eso sería peor |
| `metadata` | `jsonb` | no (`{}`) | Lo específico de cada evento (§9) |
| `occurred_at` | `timestamptz` | no (`now()`) | Lo sella el servidor (§9) |

### Columnas deliberadamente ausentes

| campo | por qué no está |
|---|---|
| **`route`** | El encargo pedía no añadirla por defecto y no se ha añadido. `zone` + `flow` + `code` + `fingerprint` localizan un error igual de bien, y un enum cerrado **no puede filtrar identificadores por construcción**, cosa que una ruta sí puede |
| `ip` | PII, y no responde ninguna de las 14 preguntas del encargo |
| `user_agent` | Huella digital. Si hiciera falta, `viewport: mobile\|desktop` en `metadata` basta |
| `referrer` (URL) | Puede llevar identificadores de terceros. Se guarda `referrer_kind` (`direct\|internal\|external`) |
| `device_id` | Identificador persistente entre sesiones = seguimiento. Ninguna pregunta lo requiere |
| `country` / `geo` | Ninguna pregunta del encargo es geográfica |

---

## 4. Event constraints

```sql
check (event_name in ('session_started','zone_entered','flow_started','error_captured'))
```

**En la base de datos, no solo en TypeScript**, por el mismo motivo que el resto del
proyecto: *«una defensa que solo vive en Node se salta con otro cliente»*
(`scripts/drl-credits-verify.ts`). Añadir un evento debe **costar una migración**: ese
roce es deliberado y es lo que impide que la taxonomía se desborde en seis meses.

**`CHECK` y no `create type ... as enum`** porque el proyecto no tiene ni un solo tipo enum
de Postgres — usa `CHECK` en todas sus tablas (`duel_matches.difficulty`,
`market_audit.action`, `user_strats.side`). Y un `CHECK` se amplía con un `ALTER` trivial;
un enum, no.

---

## 5. Zone constraints

30 zonas cerradas por `CHECK`, cubriendo las 33 rutas de jugador (varias comparten zona):

```
home · inventory · store · pack_ceremony
collection · collections · market
duel_hub · deck_list · duel_play · duel_replay
tournaments · tournament_detail · pickems
pass · rewards · ranking · account · events
trainer · trainer_maps · trainer_strats · trainer_match · trainer_teams
career · news · world · manager · launcher
other
```

`other` es la válvula: una ruta nueva sin zona asignada entra ahí en vez de perder el
evento.

**Corrección respecto a la taxonomía aprobada.** Al mapear las 33 rutas reales aparecieron
tres zonas que la taxonomía no listaba: `duel_replay` (`/duelos/replay/[matchId]`),
`manager` (`/manager`) y `launcher` (`/launcher`). Se han añadido, y
`EVENT-TAXONOMY.md` §7 se ha actualizado. Es la única desviación del bloque 2.

---

## 6. Flow constraints

```sql
check (flow is null or flow in ('deck_builder','pack_ceremony','pickem_form','market_listing_form'))
```

Son exactamente los flujos **cuyo inicio no cambia la ruta** y por tanto no dejan rastro en
ninguna tabla autoritativa. El caso que los justifica se midió en la Fase 13: pulsar
«Crear mi primer mazo» abre el constructor **sin cambiar de URL**, así que hoy quien lo
abre y se rinde es invisible. Si el evento no tiene flujo: `NULL`.

---

## 7. Error constraints

```sql
check (source   is null or source   in ('client','server'))
check (severity is null or severity in ('warn','error','critical'))
```

`critical` **no** significa «un error grave». Significa «un error que impide completar uno
de los nueve flujos críticos»: `login` · `ftue` · `pack_ceremony` · `inventory` ·
`deck_builder` · `duel_play` · `pickem_form` · `market_listing_form` · `reward_claim`.
Esa disciplina la impone el emisor; la base de datos cierra el conjunto para que nadie
invente un nivel nuevo.

### Coherencia entre campos — lo que TypeScript no puede garantizar

```sql
check (case event_name
  when 'error_captured'  then source is not null and severity is not null
  when 'zone_entered'    then zone is not null and severity is null and source is null
  when 'flow_started'    then flow is not null and severity is null and source is null
  when 'session_started' then flow is null and severity is null and source is null
  else false end)
```

Esto garantiza que una fila **tiene sentido**, no solo que sus campos son de tipos
válidos. Sin ello se podría insertar un `zone_entered` con `severity='critical'`, o un
`error_captured` sin saber de dónde vino. Filas así no rompen nada al escribirse: rompen
las consultas seis meses después, cuando ya hay medio millón y nadie recuerda por qué los
números no cuadran.

---

## 8. Session model

Una **sesión** es una ventana de actividad separada de la anterior por **≥ 30 minutos de
inactividad**. El `session_id` es un UUID generado en el cliente y guardado en
`sessionStorage` (el gestor se implementa en el bloque 4; aquí solo existe la columna).

**Sin tabla de sesiones y sin clave foránea.** Una sesión no es una entidad con ciclo de
vida: es una etiqueta que agrupa. Su utilidad es reconstruir el recorrido y estimar la
duración.

**Anónimo → autenticado, sin reescribir nada.** `session_id` puede existir con `user_id` y
sin él, y **se conserva al iniciar sesión**. Así, la sesión de alguien que entra anónimo y
luego se autentica se atribuye entera sin tocar ninguna fila ya escrita —que sería
imposible, porque la tabla es de solo-anexado (§12)—.
Verificado: `telemetry:verify` §16-18.

**No hay `session_ended`.** Cerrar el navegador, perder la red o que el móvil mate la
pestaña no avisan. Emitirlo solo en los cierres limpios daría un dato **sesgado**, y eso es
peor que no tenerlo porque parece un dato. La duración se estima como
`max(occurred_at) − min(occurred_at)` por `session_id` y **se reporta siempre como cota
inferior**.

---

## 9. Metadata contract

**`metadata` NO significa «JSON libre».** La lista blanca de claves por evento la aplicará
el endpoint del bloque 4, que descartará cualquier clave no prevista **antes de escribir**.

La base de datos impone lo que puede imponer **sin duplicar esa lógica**:

| restricción | qué evita |
|---|---|
| `jsonb_typeof(metadata) = 'object'` | Que sea un array o un escalar; sin esto `metadata->>'clave'` devolvería `null` en silencio para las filas mal formadas |
| `pg_column_size(metadata) <= 2048` | Que la tabla se convierta en un vertedero o en un canal para exfiltrar datos. 2 KB son diez veces el metadata más grande de la taxonomía |

Contenido previsto por evento (lo aplica el endpoint, no la base de datos):

```
session_started  { entry_zone, referrer_kind, viewport }
zone_entered     { from_zone?, is_first_of_session }
flow_started     { flow, context? }
error_captured   { source, code, message, fingerprint, flow? }
```

### `occurred_at`

`timestamptz not null default now()`. **Lo sella el servidor**, nunca el cliente: el reloj
de un navegador puede estar mal puesto, en otra zona horaria o mentir a propósito.
`timestamptz` almacena **UTC** con precisión de **microsegundo**, igual que el resto del
esquema. Verificado: `telemetry:verify` §19.

---

## 10. Indexes

Cuatro. En una tabla que solo recibe inserciones, cada índice es un coste fijo en **cada
escritura**, así que ninguno está «por si acaso».

| índice | definición | consulta que responde |
|---|---|---|
| `telemetry_user_time_idx` | `(user_id, occurred_at desc) where user_id is not null` | El embudo por usuario y `last_seen`. **Parcial**: las filas anónimas no sirven aquí y serían una fracción importante del volumen |
| `telemetry_session_time_idx` | `(session_id, occurred_at) where session_id is not null` | Reconstruir una sesión y estimar su duración |
| `telemetry_name_time_idx` | `(event_name, occurred_at desc)` | Casi todas las métricas de la consola: DAU/WAU, uso por zona, aperturas de flujo. `event_name` va primero porque **toda** consulta agregada lo fija |
| `telemetry_severity_time_idx` | `(severity, occurred_at desc) where severity is not null` | «¿Está roto algo ahora mismo?». **Parcial**: los errores son —con suerte— una minoría diminuta |

**No se crea** un índice suelto por `occurred_at` para el barrido de retención: es un
borrado diario, no una consulta interactiva, y se pagaría en cada inserción del día. Se
mide antes de optimizar.

---

## 11. RLS

**RLS activo y CERO políticas.** Es el modelo de `market_audit` (0004), la otra tabla de
registro del proyecto: *«sin políticas de cliente (solo service_role / RPC)»*.

### ¿Por qué no dejar que cada uno lea lo suyo, como en `credit_transactions`?

Porque el libro mayor es información que **le pertenece al jugador y le sirve** —es su
recibo—, mientras que aquí no hay nada que le sirva: son zonas y errores. Abrir la lectura
solo añadiría superficie de ataque a cambio de nada. Si algún día hace falta una
exportación de datos personales, se hace por una ruta de servidor que decida qué se
entrega, **no abriendo la tabla**.

---

## 12. Append-only policy

| operación | `anon` / `authenticated` | `service_role` |
|---|---|---|
| SELECT | ❌ RLS sin políticas + `revoke` | ✅ |
| INSERT | ❌ | ✅ (el endpoint del bloque 4) |
| UPDATE | ❌ | **❌ disparador `TEL-01`** |
| DELETE | ❌ | ✅ reservado a retención (§13) |
| TRUNCATE | ❌ `revoke` | ✅ |

**UPDATE está bloqueado por disparador, incondicionalmente**, también para
`service_role`, que se salta RLS:

```
TEL-01: telemetry_events es de solo anexado; un evento no se modifica
```

Un hecho registrado no se corrige: si estaba mal, se registra otro. RLS protege del
cliente; **este disparador protege de un error en nuestro propio código de servidor**.
Verificado: `telemetry:verify` §23.

DELETE **sí** se permite —y solo `service_role` llega a él— porque la retención necesita
borrar.

---

## 13. Retention

**90 días** para el detalle. La política está decidida; **el mecanismo no se crea en este
bloque** (sin cron, sin worker, sin planificador).

Criterio: `delete from public.telemetry_events where occurred_at < now() - interval '90 days'`.

Mecanismo futuro recomendado, en orden de preferencia:

1. **`pg_cron` en Supabase**, un barrido diario en horas valle. Es lo más simple y no añade
   ninguna pieza al producto.
2. Si `pg_cron` no estuviera disponible, una ruta de mantenimiento protegida con
   `verifyAdmin`, invocada por el planificador que el proyecto **ya tiene**
   (`scheduler_jobs`, `src/engine/scheduler.ts`) — reutilizar antes que añadir.
3. **Particionado por mes** solo si el volumen lo justifica: entonces caducar es soltar una
   partición, que es instantáneo. Con las cifras estimadas (§Volumen de
   `EVENT-TAXONOMY.md`: ~70 K filas/mes en el escenario realista) **no se justifica hoy**.

---

## 14. Security

### Garantías verificadas contra la base de datos real

`npm run telemetry:verify` — **35/35**. No comprueba que la interfaz valide: comprueba que
**la base de datos se niegue**, con un cliente Supabase autenticado en la mano.

| garantía | comprobación |
|---|---|
| Un usuario no lee **ni su propia** telemetría | §24 |
| Un usuario no lee la de otro | §25 |
| Un usuario no lista la global | §26 |
| Un usuario no inserta directamente | §27 |
| Un usuario no inserta **en nombre de otro** | §28 |
| Un usuario no modifica | §29 |
| Un usuario no borra | §30 |
| Un anónimo no lee ni escribe | §31-32 |
| Los datos siguen ahí tras los intentos | §33 |
| Ni `service_role` puede reescribir la historia | §23 |

### El escritor autorizado (bloque 4, aún no existe)

```
cliente → ruta de servidor → getSession(req) → sanitización → service_role → tabla
```

`user_id` se derivará **del Bearer** con `getSession(req)`, la primitiva que ya usa todo el
producto, y **nunca del cuerpo**: un `userId` en el cuerpo es exactamente el vector que
permite escribir en nombre de otro.

La lectura administrativa usará **`verifyAdmin(req)`** (Bearer + `profiles.is_admin`
comprobado con `service_role`), **no `ADMIN_ENABLED`**, que es una compuerta de interfaz
(`NEXT_PUBLIC_ADMIN`) y no autorización.

### Hallazgo que excede esta tabla — documentado, **no corregido**

Supabase concede por defecto el juego completo de privilegios a `anon` y `authenticated`
sobre el esquema `public`, **TRUNCATE incluido**. Y **TRUNCATE se salta RLS**: una tabla
con RLS impecable y sin una sola política se puede vaciar entera si el privilegio sigue
concedido, porque las políticas de fila no protegen de una operación que actúa sobre la
tabla.

Medido en la base local:

| tabla | privilegios de `anon` / `authenticated` |
|---|---|
| `telemetry_events` | **ninguno** (esta migración los revoca todos) |
| `credit_transactions` | `SELECT` (correcto, es su recibo) + **`TRUNCATE`** |
| `market_audit` | **`SELECT, INSERT, UPDATE, DELETE, TRUNCATE`** — 0004 confió solo en RLS y nunca revocó |

**Hoy no es explotable por la vía normal**: PostgREST no expone ningún verbo que ejecute
TRUNCATE, y al Postgres local no se llega desde fuera. Es defensa en profundidad, no un
agujero abierto. Pero el coste de cerrarlo es una línea por tabla.

**No se corrige aquí** porque tocar el libro mayor y la auditoría de mercado está
explícitamente fuera del encargo de esta fase. Queda como deuda **D-SEC-1** (§17), con la
recomendación de una migración propia de una sola línea por tabla.

---

## 15. Query patterns

Las consultas previstas, y qué índice usa cada una. Se implementan en el bloque de
funnels; aquí solo se documenta que el modelo las soporta.

```sql
-- DAU · índice (event_name, occurred_at)
select count(distinct user_id) from telemetry_events
where event_name = 'session_started' and occurred_at > now() - interval '1 day';

-- Uso por zona · mismo índice
select zone, count(*) from telemetry_events
where event_name = 'zone_entered' and occurred_at > now() - interval '7 days'
group by zone order by 2 desc;

-- ¿Está roto algo ahora? · índice parcial de severidad
select zone, flow, metadata->>'code' as code, count(*) from telemetry_events
where severity = 'critical' and occurred_at > now() - interval '1 hour'
group by 1,2,3 order by 4 desc;

-- Duración estimada de sesión (COTA INFERIOR) · índice (session_id, occurred_at)
select session_id, max(occurred_at) - min(occurred_at) as duracion_minima
from telemetry_events group by session_id;

-- last_seen · índice parcial (user_id, occurred_at)
select user_id, max(occurred_at) as last_seen from telemetry_events
where user_id is not null group by user_id;

-- Abandono del constructor de mazos: conductual MENOS autoritativo.
-- Este es el patrón que justifica toda la fase: un origen no puede responderlo solo.
select count(*) from (
  select distinct t.user_id from telemetry_events t
  where t.event_name = 'flow_started' and t.metadata->>'flow' = 'deck_builder'
    and t.user_id is not null
    and not exists (
      select 1 from duel_decks d
      where d.user_id = t.user_id and d.created_at > t.occurred_at
    )
) sin_mazo;
```

---

## 16. Future endpoint contract

**No existe todavía.** Lo que este modelo da por supuesto del bloque 4:

- `POST` a una ruta de servidor. El cliente **nunca** escribe en la tabla.
- El usuario sale de `getSession(req)`; el cuerpo **no** lleva `userId`.
- `occurred_at` **no** se acepta del cliente: lo pone el `default now()`.
- `environment` y `app_version` los pone el servidor, no el cuerpo.
- `metadata` se filtra por lista blanca según `event_name` antes de escribir.
- Un `event_name`, `zone`, `flow`, `source` o `severity` desconocido se **rechaza**, no se
  reetiqueta como `other` en silencio: fallar en voz alta durante el desarrollo es lo que
  impide que la taxonomía se corrompa.
- **Fallar es no hacer nada.** Si la escritura de telemetría falla, la respuesta al jugador
  no cambia: la telemetría nunca puede romper la experiencia.

---

## 17. Technical debt

| id | deuda | detalle |
|---|---|---|
| **D-SEC-1** | `TRUNCATE` sigue concedido a `anon`/`authenticated` sobre `credit_transactions`, y sobre `market_audit` además `SELECT/INSERT/UPDATE/DELETE` | §14. No explotable hoy por PostgREST, pero es defensa en profundidad que falta. Una migración de una línea por tabla. **Fuera del encargo de esta fase** (prohibido tocar libro mayor y mercado) |
| **D-MIG-1** | **Las migraciones 0026, 0027 y 0028 existen como fichero pero NO están aplicadas a la base local** | `supabase_migrations.schema_migrations` llega a `0025`, y `profiles.tokens` —que 0027 elimina— sigue existiendo. La 0029 se aplicó **directamente y sola**, sin `db push`, precisamente para no arrastrar esas tres. La 0029 es independiente (solo necesita `auth.users`) y es idempotente, así que un `db push` futuro la puede reejecutar sin daño. **Hay que decidir aparte qué se hace con 0026-0028** |
| **D-RET-1** | Sin mecanismo de retención | §13. Política decidida (90 días), mecanismo no creado por mandato del bloque |
| **D-TEL-1** | La estimación de duración de sesión es una **cota inferior** | §8. Un heartbeat la afinaría a costa de multiplicar el volumen. Se reconsidera solo si una decisión de producto lo necesita |
| **D-TEL-2** | `zone` obliga a mantener un mapa ruta → zona | Una ruta nueva sin entrada cae en `other`. Es el precio de no guardar URLs, y se paga a gusto |

---

*Siguiente: bloque 4 — motor de tracking (`trackEvent`), endpoint y gestor de sesión.
No se ha implementado nada de eso.*
