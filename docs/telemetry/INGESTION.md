# NEXUS Telemetry — Capa de ingestión

> FASE 14, bloque 4. La telemetría está conectada a la aplicación.
> Verificación: `npm run telemetry:ingest` (32/32) · `npx tsx scripts/_fase14-qa-telemetria.ts` (30/30)
> Contrato: [`EVENT-TAXONOMY.md`](EVENT-TAXONOMY.md) · Modelo: [`DATA-MODEL.md`](DATA-MODEL.md)

---

## 1. Arquitectura

```
   TelemetryProbe (en GameShell, las dos ramas)
   crash.ts (manejadores globales)
   openCreate() del constructor de mazos
        │
        ▼
   src/lib/telemetry/client.ts        ← ÚNICO punto de entrada: track()
        │   · sesión en sessionStorage (30 min)
        │   · deduplicación de zona
        │   · tres cortafuegos de errores
        ▼
   POST /api/telemetry                ← ÚNICO escritor autorizado
        │   · getSession(req) → user_id  (del Bearer, jamás del cuerpo)
        │   · conjuntos cerrados
        │   · coherencia entre campos
        │   · lista blanca de metadata + redacción por forma
        │   · límite de frecuencia
        ▼
   service_role → telemetry_events    ← RLS sin políticas; el cliente no llega
        │
        ▼
   204 No Content                     ← ni un dato de vuelta
```

**Un contrato compartido** (`src/lib/telemetry/contract.ts`) lo importan cliente y
servidor. Es puro —sin red, sin base de datos, sin `window`, sin `process`— y por eso se
puede probar sin navegador (`contract.test.ts`, 25 pruebas).

---

## 2. Endpoint

`POST /api/telemetry` · `runtime: nodejs` · `dynamic: force-dynamic` · `cache-control: no-store`

**Cuerpo aceptado:**

```jsonc
{
  "event_name": "zone_entered",       // obligatorio, uno de los cuatro
  "session_id": "<uuid>",             // opcional pero casi siempre presente
  "zone":  "market",                  // según el evento
  "flow":  "deck_builder",
  "source": "client",
  "severity": "error",
  "metadata": { }                     // filtrado por lista blanca
}
```

**Los cuatro campos que el servidor se reserva** y que se **ignoran en silencio** si llegan
en el cuerpo:

| campo | de dónde sale | por qué no del cuerpo |
|---|---|---|
| `user_id` | `getSession(req)` → Bearer | Un `userId` en el cuerpo es el vector que permite escribir en nombre de otro |
| `occurred_at` | `default now()` de la tabla | El reloj de un navegador puede estar mal puesto, en otra zona horaria o mentir |
| `environment` | `NODE_ENV` del servidor | Si no, cualquiera marcaría sus eventos como `production` desde su portátil |
| `app_version` | `src/platform/version.ts` | Fuente canónica del proyecto, sincronizada por el pipeline de release |

Se **ignoran**, no se rechazan: un cliente antiguo que mande un campo de más no debe perder
el evento. Verificado en `telemetry:ingest` §10-13, mandando `user_id` de otra persona,
`occurred_at` de 1999, `environment: "development"` contra un servidor en producción y
`app_version: "9.9.9-falsa"`.

### Respuestas

| código | cuándo |
|---|---|
| **204** | Aceptado. **Cuerpo vacío**: ni un dato, ni un id, ni una confirmación |
| 400 | `event_name`, `zone`, `flow`, `source`, `severity` o `session_id` no válidos; fila incoherente; cuerpo que no es JSON |
| 413 | Cuerpo > 8 KB |
| 429 | Ráfaga por encima del techo |
| **204** | **También si la escritura falla.** El cliente no tiene ninguna decisión que tomar con esa información y sí tiene un producto que seguir mostrando |

---

## 3. Autenticación

**Autenticado:** `getSession(req)` resuelve el Bearer contra GoTrue y devuelve el `userId`.
Es la misma primitiva que usa todo el producto.

**Anónimo: sí, y a propósito.** NEXUS funciona sin cuenta en `/inventario` y `/coleccion`
(modo local de un jugador, verificado en la Fase 13). Un visitante sin sesión genera
eventos legítimos con `user_id = null`. Rechazarlos dejaría ciego justo el tramo anterior
al registro, que es la mitad del embudo de primera experiencia.

**Un Bearer inválido no rompe:** se trata como anónimo (`telemetry:ingest` §21-22). Que un
token caducado tirara la telemetría sería absurdo.

---

## 4. Validación

Todo lo que la base de datos cierra con un `CHECK` tiene su equivalente en el servidor.
**No es duplicar la verdad: es adelantarla**, para responder «zone no válida» en vez de
soltar un error de restricción de PostgreSQL. Si los dos discrepasen, manda la base de
datos — por eso el endpoint no atrapa el error de restricción para reetiquetarlo.

| se comprueba | cómo |
|---|---|
| `event_name` | uno de los cuatro |
| `zone` | una de las 30 |
| `flow` | uno de los cuatro |
| `source`, `severity` | conjuntos cerrados |
| `session_id` | UUID con expresión regular |
| coherencia entre campos | `shapeError()`, la misma lógica que `telemetry_events_shape_check` |

**Un valor desconocido se RECHAZA, no se reetiqueta como `other` en silencio.** Fallar en
voz alta durante el desarrollo es lo que impide que la taxonomía se corrompa: un `zone` mal
escrito que se guarda como `other` no se descubre nunca.

---

## 5. Metadata

### Lista blanca por evento

```
session_started  → entry_zone · referrer_kind · viewport
zone_entered     → from_zone · is_first_of_session
flow_started     → flow · context
error_captured   → code · message · fingerprint · flow
```

Una clave fuera de la lista **se descarta en silencio**. Descartar y no rechazar es
deliberado, y **solo para las claves**: una versión antigua del cliente que mande una de
más no debe perder el evento. Los campos de primer nivel sí se rechazan, porque ahí un
valor desconocido significa que alguien se ha inventado algo.

### Profundidad uno, sin excepciones

Un objeto anidado **no se recorre: se descarta entero**. No es pereza — es la garantía de
que ningún volcado de estado entre por accidente en un campo que parecía inofensivo.
Ningún evento de la taxonomía necesita anidar.

### Redacción por forma, no por nombre

Un secreto no llega siempre en un campo que se llame «token»: llega dentro de un mensaje
de error, pegado a una URL, o en mitad de una frase. **Buscar la forma es lo único que
funciona.**

| patrón | se convierte en |
|---|---|
| JWT (`ey…` + uno o dos bloques) | `[REDACTED_JWT]` |
| `Bearer …` | `[REDACTED_BEARER]` |
| `sk_`/`pk_`/`api_key`/`secret_` | `[REDACTED_KEY]` |
| Correo electrónico | `[REDACTED_EMAIL]` |
| UUID | `[REDACTED_UUID]` |
| `authorization: …` / `cookie: …` | `[REDACTED_AUTH]` / `[REDACTED_COOKIE]` |
| Cualquier cadena de consulta | `?[REDACTED_QUERY]` (el camino se conserva) |
| Rutas absolutas (Windows y POSIX) | `[REDACTED_PATH]` |
| IPv4 | `[REDACTED_IP]` |

**Se redacta ANTES de truncar.** Truncar primero partiría un patrón por la mitad y dejaría
media clave escrita — hay una prueba dedicada a eso.

> **Corregido durante el QA de este bloque.** La primera versión de la expresión del JWT
> exigía cuatro caracteres por bloque y dejaba pasar `ey….eyJzIjoxfQ.zzz`, con la firma de
> tres. Los tokens reales tienen firmas largas, pero apostar a eso es exactamente la clase
> de suposición que hace que un secreto acabe en una tabla. Corregido y con prueba de
> regresión (`contract.test.ts`).

### Límites

| límite | valor | dónde |
|---|---|---|
| Claves por evento | 8 | contrato |
| Longitud de cadena | 300 | contrato |
| Tamaño de `metadata` | 1536 B | contrato (el `CHECK` de la base de datos es 2048) |
| Cuerpo de la petición | 8 KB | endpoint (413) |

Si la metadata se pasa de tamaño, **se quitan claves por el final hasta caber**: un evento
recortado es mejor que ninguno.

---

## 6. Sesión

**UUID en `sessionStorage`, ventana de 30 minutos de inactividad.**

`sessionStorage` y no `localStorage`: una sesión es de una pestaña y de un rato. Con
`localStorage`, dos pestañas compartirían sesión y el recorrido saldría entrelazado, y una
sesión de hace tres días reviviría al volver.

**Una sesión → un `session_started`.** La bandera `isNew` solo es cierta cuando no había
sesión o la anterior había caducado. Ni un render, ni un refresco, ni un cambio de zona la
vuelven a poner a cierto. Además, `TelemetryProbe` guarda una referencia para que el modo
estricto de React —que monta dos veces en desarrollo— no dispare el arranque por duplicado.

**Sobrevive a:** navegación SPA, refresco e inicio de sesión (verificado: QA §9, §14).
**Muere con:** 30 minutos de inactividad (QA §24) o si el navegador tira el almacenamiento,
que es el comportamiento correcto: si lo ha tirado, el jugador ha vuelto a empezar.

**Anónimo → autenticado sin reescribir nada.** El `session_id` se conserva al iniciar
sesión, así que la sesión completa se atribuye entera. Es lo que hace posible ver el
recorrido de alguien desde antes de registrarse (QA §16).

**No hay `session_ended` ni heartbeat.** La duración se estima como
`max(occurred_at) − min(occurred_at)` por sesión y **se reporta siempre como cota
inferior**.

---

## 7. Zonas

**Una sola integración central: `TelemetryProbe` dentro de `GameShell`.**

La alternativa era instrumentar las 33 rutas una a una: más código, más frágil y —lo
importante— **incompleto desde el primer día**, porque cualquier ruta nueva nacería sin
telemetría y nadie lo notaría hasta echar de menos los datos meses después.

**Montada en las DOS ramas de `GameShell`** —la normal y la inmersiva—. Dejarla fuera de la
inmersiva habría cegado la ceremonia del sobre y la partida de duelo, que son las dos zonas
de mayor intención del juego.

**No se emite si la zona no ha cambiado.** Eso descarta de un plumazo los filtros, la
paginación, los cambios de consulta y los refrescos. La pregunta es «¿qué zonas usa el
jugador?», no «¿cuántos renders hizo React?».

`zoneFromPath()` normaliza las rutas dinámicas: `/torneos/vlr-2976` y `/torneos/demo` son
las dos `tournament_detail`. **El identificador se descarta en el cliente, antes de
viajar.** Y el servidor vuelve a validar que la zona esté en el enum.

`from_zone` solo existe en navegación SPA. En una carga dura el módulo se reinicia y el
cliente no sabe —honestamente— de dónde venía; se omite en vez de inventarlo.

---

## 8. Flujos

**Solo `deck_builder` está instrumentado.** Es el único flujo del producto cuyo inicio no
deja rastro: pulsar «Crear mi primer mazo» abre el constructor **sin cambiar de ruta** y
sin escribir nada, así que quien se rinde ahí era invisible. La Fase 13 lo midió y es el
hueco más grande del embudo de primera experiencia.

Los otros tres del contrato (`pack_ceremony`, `pickem_form`, `market_listing_form`) están
declarados y **no instrumentados**: sus inicios sí cambian de ruta, así que `zone_entered`
ya los cubre. Se dejan en el enum porque el día que uno de ellos gane un sub-estado sin
ruta, estará listo. Deuda **D-ING-3**.

**No se instrumenta ningún clic genérico.**

---

## 9. Errores

**`crash.ts` ya existía y ya esperaba esto**: capturaba `error` y `unhandledrejection`,
componía el informe y llevaba escrito `// TODO(server): POST report al endpoint de crashes
cuando exista`. Se le ha dado ese endpoint. **No se ha escrito un segundo capturador.**

Y se ha **instalado también en la app de jugador**: hasta ahora `installCrashHandler()`
solo se llamaba desde `initPlatform()`, y a `initPlatform()` solo lo llama `BootGate`, es
decir, únicamente el launcher. En las rutas normales no había ningún manejador global.

### Qué viaja y qué no

| dato | ¿viaja? | por qué |
|---|---|---|
| `message` | **Sí**, saneado dos veces (cliente recorta, servidor redacta) | Es lo único que identifica el fallo |
| `code`, `fingerprint` | Sí | Agrupan repeticiones |
| `stack` | **No** | Lleva rutas absolutas del sistema de ficheros y, en escritorio, la estructura de la instalación |
| `recentLogs` | **No** | Búfer de 25 entradas al que cualquiera puede haber pasado cualquier cosa con `log()`. Sería un canal abierto |
| Cabeceras, cookies, cuerpo | **No** | Nunca |

El informe **completo** sigue guardándose en el almacenamiento local del dispositivo, como
siempre.

### Severidad

El manejador global emite `error`, **no `critical`**. `critical` está reservado a los nueve
flujos que impiden jugar, y desde un manejador global no se sabe en cuál estaba el jugador.
Reclasificar hacia arriba sin saberlo vaciaría de significado la única señal que la consola
necesita.

### Protección de bucles — tres cortafuegos

1. **Bandera `sendingError`.** Un error al reportar un error no se reporta. No es teórico:
   es exactamente lo que pasa cuando alguien pierde la conexión —falla la red, el manejador
   captura, intenta reportar, vuelve a fallar—. Se libera en el siguiente tic, no de
   inmediato, porque un fallo síncrono de la petición todavía llegaría dentro de la misma
   pila.
2. **Huellas vistas.** El mismo error repetido no se manda otra vez en la sesión.
3. **Techo de 20 errores por sesión.** Un bucle de render generaría miles de eventos
   idénticos; los primeros veinte ya cuentan la historia y los demás taparían los errores
   distintos.

Verificado: QA §21 (tres repeticiones del mismo error → sigue habiendo **una** fila) y §22.

---

## 10. Aislamiento de fallos

**Si la telemetría falla, no pasa nada.** No es una aspiración: está impuesto por la forma
del código.

| dónde | qué pasa si falla |
|---|---|
| `track()` | Devuelve `void`, **no una promesa**. Nadie puede escribir `await track(...)` y meterla en el camino crítico de una acción |
| `send()` | Todo dentro de `try/catch`. Sin red, servidor caído, petición abortada: se pierde el evento |
| `sessionStorage` | Ventana privada o almacenamiento bloqueado → se trata como sesión nueva y se sigue |
| Endpoint | Devuelve **204 aunque la escritura falle** |
| Base de datos | El `catch` del endpoint traga el error |
| `crash.ts` | El envío va en su propio `try/catch`: la telemetría jamás decide si un fallo se recupera |

Verificado en QA §23: tras provocar errores, la aplicación sigue navegando y pintando
(2.820 caracteres, 78 controles). Y en §30: toda la actividad de telemetría **no movió ni
un asiento del libro mayor**.

---

## 11. Límite de frecuencia

**Ventana deslizante en memoria del proceso.** 120 eventos por minuto y clave (sesión, o
usuario si no hay sesión). Una sesión real hace unos 20 por minuto.

**Por qué no el patrón SQL del proyecto.** El único límite de frecuencia existente
(`_check_rate`, migración 0004) cuenta filas de `market_audit` en la última hora. Aquí no
encaja: contar filas antes de cada inserción **duplicaría el trabajo de base de datos del
endpoint de mayor volumen del producto**, para proteger una tabla que no decide nada.

**Qué protege:** un bucle de render que dispare mil eventos, un reintento enloquecido,
alguien curioseando con `curl`.

**Qué NO protege, dicho claramente:** es por proceso y se reinicia con el servidor. Con
varias instancias, el límite efectivo se multiplica por el número de instancias. Es
suficiente porque el peor caso de saltárselo son **filas de más en una tabla con retención
de 90 días** — no un crédito, ni un punto, ni una carta. Deuda **D-ING-1**.

Verificado: QA de ingestión §25, una ráfaga se corta con 429.

---

## 12. Reintentos e idempotencia

**Ningún reintento.** Best effort: si falla, se pierde. Una cola que sobreviva al cierre de
la pestaña necesita almacenamiento; un reintento necesita saber si el fallo era temporal.
Las dos cosas son infraestructura para un dato que, por definición, es prescindible.
`keepalive: true` cubre el caso que sí importa —que el evento salga aunque la página se
esté cerrando— y ahí se acaba.

**Ninguna arquitectura de idempotencia**, y esto es una decisión, no un olvido:

- `zone_entered` se deduplica **en el cliente** (misma zona consecutiva → no se emite), que
  es donde está la información para hacerlo bien.
- `session_started` es idempotente por construcción: solo se emite cuando nace una sesión.
- `error_captured` se deduplica por huella.
- `flow_started` es un gesto explícito: si alguien abre el constructor dos veces, **son dos
  aperturas** y contarlas dos veces es lo correcto.

Un duplicado ocasional en telemetría conductual no cambia ninguna conclusión: los embudos
se calculan con `count(distinct user_id)`, no sumando filas. Una clave de idempotencia
aquí sería el tipo de precisión que cuesta y no compra nada.

---

## 13. Seguridad

| garantía | verificado en |
|---|---|
| El cliente **no puede escribir** en la tabla (RLS sin políticas + revoke) | `telemetry:verify` §27-32 |
| `user_id` sale del Bearer; no se puede suplantar | `telemetry:ingest` §10 |
| `occurred_at`, `environment`, `app_version` los pone el servidor | §11-13 |
| La lista blanca deja pasar solo lo previsto | §14 |
| Ni token, ni cookie, ni correo, ni IP, ni cabeceras llegan a la base de datos | §15 |
| Un secreto dentro de un campo **permitido** se redacta por forma | §16-17 |
| La consulta de una URL se descarta | §17 |
| Un Bearer inválido se trata como anónimo, no rompe | §21-22 |
| El endpoint no devuelve **ningún** dato | §24 |
| Toda la actividad no movió el libro mayor | §31-32 · QA §30 |

**Telemetría nunca es autoridad.** No concede nada, no lee nada del jugador, y ningún dato
que envíe el cliente influye en economía, recompensas, rango ni reglas.

---

## 14. Deuda técnica

| id | deuda | detalle |
|---|---|---|
| **D-ING-1** | El límite de frecuencia es por proceso | §11. Con varias instancias el techo efectivo se multiplica. Aceptable: el peor caso son filas de más |
| **D-ING-2** | `from_zone` no existe en carga dura | §7. Es honesto: el cliente no lo sabe. Se podría inferir en servidor cruzando eventos consecutivos de la misma sesión |
| **D-ING-3** | Tres de los cuatro flujos declarados no están instrumentados | §8. Sus inicios cambian de ruta, así que `zone_entered` ya los cubre |
| **D-ING-4** | La duración de sesión sigue siendo una cota inferior | Heredada del bloque 3 (D-TEL-1) |
| **D-ING-5** | El manejador global nunca emite `critical` | §9. Marcar la severidad correcta exigiría que cada flujo crítico capturara sus propios errores. Se hará cuando haya datos que digan cuáles fallan |
| **D-ING-6** | `NODE_ENV` no distingue «mi portátil» de «el servidor desplegado» | Descubierto al verificar este bloque: un `next start` local escribe `environment: 'production'`, porque técnicamente lo es. Es correcto y a la vez engañoso: la distinción que hará falta el día que haya datos reales es por DESPLIEGUE, no por tipo de build. La solución es una variable de entorno propia, y crearla es un cambio de configuración que este bloque tiene prohibido. Mientras tanto: los datos generados por las suites automáticas en local se borran a mano para no contaminar las primeras cifras reales |

---

*Siguiente bloque: operaciones en vivo y embudos. **No implementados**: no hay dashboard,
ni consultas de embudo, ni interfaz de operaciones.*
