# Límite de frecuencia del PvP (Bloque 7.6)

> Estado: **D-PVP-9 RESUELTA**.
> Ámbito: `/api/game/duel/pvp` y `/api/game/duel/matchmaking`.
> Este bloque **no añade juego**. No toca el motor de combate, ni el Elo, ni la máquina de
> estados, ni las reglas. Solo pone una capa delante de dos endpoints.

---

## 1. Qué estaba mal

La deuda venía del bloque 7.3, escrita entonces así:

> *sin límite de peticiones en el endpoint. Un cliente puede sondear tan rápido como quiera; el
> ritmo lo pone el cliente por buena fe.*

Mientras el PvP era una superficie de depuración, eso era una nota al pie. Con la arena del 7.5
dejó de serlo: ya hay dos bucles que sondean de verdad y una pantalla pública que los dispara.
Antes de este bloque, un `while(true) fetch(...)` autenticado podía hacer que el servidor
consultara la base de datos tan rápido como el bucle iterara.

---

## 2. Dónde vive el contador (y por qué no se reutilizó ninguno)

El proyecto ya tenía dos limitadores. Se auditaron los dos **antes** de escribir nada:

| Existente | Qué es | Por qué no vale aquí |
|---|---|---|
| `/api/telemetry` | `new Map()` en el proceso de Node | Su **propia cabecera** lo admite: «es por proceso y se reinicia con el servidor. Con varias instancias, el límite efectivo se multiplica por el número de instancias». Se justifica porque «el peor caso de saltárselo son filas de más en una tabla con retención de 90 días». Detrás del PvP hay partidas, cola y rating: ese argumento no se traslada. |
| `_check_rate` (migración 0004, mercado) | SQL, sobrevive a varios procesos | Cuenta filas de `market_audit` de la última hora **en cada llamada**. Para unos pocos anuncios por hora es correcto; para un sondeo cada 1,2 s sería un recuento por petición. |

De ahí `api_rate_limits` + `app_rate_take` (migración `0036_pvp_rate_limit.sql`):

- **Compartido entre procesos**, porque el contador está en PostgreSQL. Dos instancias de Node
  ven el mismo número. Un `Map` en memoria no puede dar eso, y por eso no se usó.
- **Coste constante**: una fila por *(sujeto, superficie)* y **un solo `INSERT … ON CONFLICT DO
  UPDATE`** por petición. La tabla no crece con el tráfico, crece con los usuarios activos.
- **Atómico**: crear, reiniciar la ventana o incrementar ocurren en la misma sentencia. No hay
  `SELECT` previo del que fiarse — leer y decidir en dos pasos dejaría pasar a dos peticiones
  simultáneas que leyeran el mismo valor.

No hay Redis en este proyecto, así que Postgres es el único almacén compartido disponible.

### Ventana fija: la concesión, dicha en voz alta

Es una ventana **fija**, no deslizante. En el salto entre dos ventanas se pueden colar hasta 2×
el límite en un instante. Se acepta a propósito: una ventana deslizante costaría dos contadores
por sujeto y más lógica, y los límites ya llevan de 2× a 3× de margen sobre el tráfico legítimo,
así que ese pico del borde sigue estando dos órdenes de magnitud por debajo de un abuso real.

---

## 3. Quién es el sujeto

**El `user_id` del Bearer. Siempre.**

Ni `body.userId`, ni `query.userId`, ni ninguna otra cosa que elija el cliente. Si el sujeto lo
eligiera quien llama, cambiarlo sería saltarse el límite — que es exactamente lo que no puede
pasar. En el código el `userId` sale de `getSession(req)` y de ningún otro sitio, y el verificador
lo comprueba mandando el id de otra cuenta en el cuerpo (familia 4).

### Por qué no se limita por IP

Se auditó y se decidió **no** hacerlo, por dos razones:

1. **No hay una IP fiable.** No hay una cadena de proxies de confianza configurada, así que lo
   único disponible es `x-forwarded-for`, **que lo pone el cliente**. Un límite construido sobre
   una cabecera falsificable no es una defensa: es una que se salta escribiendo otra línea.
2. **Sería un amplificador.** Limitar por IP obliga a *escribir* en la base por cada petición
   anónima. Hoy una petición sin token cuesta prácticamente cero (`getSession` devuelve `null`
   sin tocar red ni base en cuanto no hay cabecera `authorization`), y añadirle un UPSERT
   convertiría el propio límite en la vía de agotar recursos.

El límite por IP pertenece al borde (nginx / Vercel / Cloudflare), que sí sabe de dónde viene la
conexión. Queda anotado como **D-RL-1**, no disimulado.

---

## 4. La política, y de dónde salen los números

Los límites no se eligieron: se midieron. Ritmo real del cliente, leído de `POLL_MS` (7.3) y de
`usePvpQueue` (7.5):

| Bucle | Intervalo | Peticiones reales |
|---|---|---|
| Sondeo de partida, turno del rival | 1.200 ms | **50 / min** |
| Sondeo de partida, tu turno | 2.500 ms | 24 / min |
| Sondeo de cola | 2.000 ms | **30 / min** |
| Pestaña oculta (partida / cola) | 15.000 / 6.000 ms | 4 y 10 / min |
| Acciones | 20 por partida, repartidas en minutos | — |

Y la política que sale de ahí (`src/server/services/rateLimit.ts`):

| Cubeta | Superficie | Límite | Margen sobre lo real |
|---|---|---|---|
| `pvp_sync` | `GET /api/game/duel/pvp` | 150 / min | 3× sobre 50 |
| `pvp_action` | `POST /api/game/duel/pvp` | 40 / min | 2× una partida entera por minuto |
| `mm_status` | `GET /api/game/duel/matchmaking` | 90 / min | 3× sobre 30 |
| `mm_write` | `POST /api/game/duel/matchmaking` | 20 / min | 10× sobre ~2 por búsqueda |

El margen tiene destinatario y no es generosidad: dos pestañas abiertas con la misma cuenta, un
refresco, la transición de cola a partida y los `syncNow` manuales. Aun así, «mil peticiones en
un segundo» se corta alrededor de la petición 150.

Cada entrada de `RATE_POLICY` lleva un campo `why` con su justificación, y el verificador
comprueba que ninguno esté vacío: un número sin explicación es un número elegido a ojo.

---

## 5. Qué se responde

`429 Too Many Requests`. **Nunca 500** — un límite superado no es un fallo del servidor, y
devolver 500 haría que el cliente lo tratara como un error irrecuperable.

```
HTTP/1.1 429 Too Many Requests
retry-after: 37
cache-control: no-store

{"error":"Demasiadas solicitudes. Inténtalo de nuevo en unos segundos.","code":"RATE_LIMITED"}
```

El cuerpo es **deliberadamente anodino y siempre el mismo**. No dice qué cubeta se agotó, ni
cuántas peticiones van, ni si el usuario existe, ni si la partida existe, ni cuánta gente hay en
cola, ni quién es el rival. Un mensaje que varíe según el caso es un oráculo que se puede
interrogar: quien recibiera «has agotado `pvp_action` de la partida X» acabaría de aprender que
la partida X existe.

Lo único que cambia entre respuestas es `Retry-After`, que es información sobre la **política**
—pública por definición— y no sobre nadie. Nunca es 0: un `Retry-After: 0` invitaría a reintentar
de inmediato, justo lo contrario de lo que se pide.

`code: "RATE_LIMITED"` está para que el cliente pueda reaccionar sin leer el texto.

---

## 6. Fallo abierto, y a propósito

Si el contador falla, **se deja pasar la petición**. Suena raro en algo llamado «límite», pero: el
PvP no funciona sin base de datos, así que un fallo del contador significa que la partida iba a
fallar de todos modos. Cerrar aquí convertiría un problema del limitador en una caída del juego,
y el limitador es lo accesorio.

---

## 7. Qué hace el cliente cuando lo recibe

Un límite solo sirve si el cliente **afloja** al recibirlo. Los dos bucles ya lo hacen:

- **Poller de partida** (`pvpTransport`, 7.3): ya mapeaba `429 → RATE_LIMIT` y ya lo incluía en
  `isRetryable`, así que el backoff existente (1 s / 2 s / 4 s / 8 s / 10 s) se aplicó solo. **No
  hizo falta tocarlo.**
- **Bucle de cola** (`usePvpQueue`, 7.5): sí hizo falta. Antes, cualquier respuesta no-OK paraba
  la búsqueda en seco — seguro para el servidor, pero le cortaba la partida a un jugador legítimo
  con dos pestañas abiertas. Ahora un 429 **no es un error de la búsqueda**: es «más despacio».
  Se respeta `Retry-After` si viene y, si no, se escala 2 s → 4 s → 8 s → 15 s. La entrada en cola
  no se toca; el jugador sigue buscando.
- **Al pulsar «buscar»**, en cambio, sí se le dice algo a la persona, porque fue un gesto suyo y
  no ha entrado: *«Vas demasiado rápido. Espera unos segundos y vuelve a intentarlo.»* Sin
  números y sin jerga.

---

## 8. Lo que este límite **no** es

No sustituye a ninguna defensa existente. Siguen siendo la autoridad real:

| Defensa | Contra qué | Sigue intacta |
|---|---|---|
| Índice único parcial de `duel_pvp_queue` | dos entradas vivas | sí |
| Guarda de partida activa | encolarse jugando | sí |
| `state_version` | jugar sobre un estado viejo | sí |
| `action_id` | repetir una acción | sí |
| Unicidad `(match_id, user_id)` en rating | liquidar dos veces | sí |

El verificador lo prueba a propósito **por debajo** del límite: 15 altas simultáneas (con un
límite de 20/min, así que ninguna la corta el limitador) y aun así solo queda **una** entrada
viva. Si mañana se quitara el rate limiter, eso seguiría siendo cierto.

---

## 9. Limpieza

Sin `cron`, igual que la caducidad de la cola (7.4) y el vencimiento de turno (7.4.3): el barrido
lo mueve el mismo tráfico que crea las filas. `maybeSweepRates` llama a `app_rate_sweep` con
probabilidad ~1/500, así que el coste medio por petición es despreciable. Una fila muerta no
molesta a nadie; lo único que hay que impedir es que la tabla crezca sin fin.

---

## 10. Cómo se comprueba

```bash
npm run pvp-ratelimit:verify     # necesita el servidor en 3005: un límite solo se prueba por HTTP
```

Seis familias:

1. **El tráfico real pasa** — 10 sondeos al ritmo exacto del cliente (1,2 s) y **una partida
   entera de 20 acciones**, sin un solo 429. Es la mitad que más importa: un límite que molesta
   al jugador legítimo es peor que no tener límite.
2. **El abuso se corta** — ráfagas de 300–400 peticiones en paralelo contra cada superficie
   reciben 429, y ninguna responde 500.
3. **La respuesta** — 429, `Retry-After` coherente, cuerpo pequeño, sin ids ni cifras ni SQL, e
   **idéntica** sea cual sea la cubeta agotada.
4. **Aislamiento** — agotar a un usuario no afecta a otro; mandar `userId` ajeno en el cuerpo no
   cambia de cubeta ni gasta la de la víctima; agotar la escritura no cierra la consulta.
5. **No sustituye a nada** — con el limitador sin intervenir, el índice único sigue dejando una
   sola entrada viva.
6. **Compartido y medido** — el contador se lee desde fuera del proceso, un segundo cliente
   incrementa el mismo, y el sobrecoste se **mide** en milisegundos en vez de suponerse.

Si no hay servidor levantado, el verificador **omite** las familias y lo dice, en vez de dar por
buenas unas pruebas que no ha hecho.

---

## 11. Lo que la medición encontró

Las ráfagas del verificador no solo confirmaron lo esperado: enseñaron tres cosas que no se
sabían. Se dejan escritas porque son la parte útil.

### 11.1 Un 500 que no debía existir — **corregido**

Con 300 conexiones simultáneas desde un solo proceso, la pila local de Supabase se queda sin
sockets (`other side closed`) y el cliente lanza `TypeError: fetch failed`. El `catch` final de
las dos rutas PvP respondía entonces **500 con el texto interno del error**. Dos cosas mal en
una: 500 dice «me he roto yo» cuando lo cierto es «mi dependencia no contesta», y el mensaje
crudo no es asunto de quien llama.

Ahora una dependencia inalcanzable es **503 con `Retry-After` y un texto genérico**
(`isDependencyDown` en `rateLimit.ts`). Para el cliente no cambia nada —`kindForStatus` trata
todo 5xx igual, como reintentable— pero deja de mentir y deja de filtrar internals.

Reparto real de una ráfaga de 300, ya con la corrección:

```
200x83   401x22   429x159   503x36        (ningún 500)
```

### 11.2 D-RL-2 — el límite está *detrás* de la validación del token

`getSession` resuelve el Bearer contra GoTrue **con una llamada de red por petición**, y eso pasa
*antes* de consultar el contador. Consecuencias, las dos medidas:

- Una inundación autenticada sigue costando una validación de token por petición. El límite
  protege la base de datos del juego; **no protege al servicio de auth**.
- Bajo esa presión GoTrue empieza a rechazar tokens **válidos**: los `401x22` de arriba son
  peticiones legítimas cuyo token no se pudo validar a tiempo.

No se ha tocado. `getSession` es compartido por todas las rutas del proyecto, no solo las de PvP,
y cambiar cómo se valida un token —por ejemplo verificando el JWT localmente contra
`SUPABASE_JWT_SECRET` en vez de preguntar a GoTrue— es una modificación del núcleo de
autenticación que se sale de este bloque y merece el suyo.

### 11.3 D-RL-3 — fallar abierto se afloja justo cuando aprieta

El fallo abierto (§6) es deliberado y el verificador lo comprueba apuntando el cliente a un puerto
muerto. Pero tiene una consecuencia que solo se ve midiendo: bajo saturación **la propia llamada
al contador falla**, así que el límite deja de limitar exactamente en el momento de más presión.
Es la consecuencia lógica de la política, no un fallo de implementación, y la alternativa
—fallar cerrado— convertiría un parpadeo de la base en una caída del PvP. Se deja como está y se
anota.

---

## 12. Deuda abierta

- **D-RL-1 — no hay límite por IP.** Las peticiones sin token no se cuentan. Hoy cuestan
  prácticamente cero (§3), pero eso no es lo mismo que estar protegido frente a una inundación
  desde muchas conexiones: la defensa real de ese vector está en el borde, y este proyecto no
  tiene todavía un borde configurado. Documentado, no disimulado.
- **D-RL-2 — el límite va detrás de la validación del token** (§11.2).
- **D-RL-3 — el fallo abierto se afloja bajo saturación** (§11.3).
- **Ventana fija.** Pico de hasta 2× el límite en el salto de ventana (§2).
