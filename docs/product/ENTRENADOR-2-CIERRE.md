# ENTRENADOR 2.0 — CIERRE DE LAS FASES PENDIENTES

> **Estado: las doce fases del encargo están hechas y verificadas. NO se declara READY.**
> P0 = 0 · **P1 = 1**, preexistente y fuera del perímetro que el encargo deja tocar: la recompensa
> de un partido del Entrenador (créditos y XP) solo existe en el navegador y desaparece al
> recargar con sesión. Arreglarlo es una decisión de economía, no de interfaz (ver §13).
> Sin commit, sin push, sin deploy.

---

## 1 · Qué estaba pendiente

El bloque anterior (`ENTRENADOR-2.md`) cerró como PARCIAL con dos fases sin hacer:

- **Fase 19 · Partidos jugados.** «`MatchState` no se persiste»: no había nada que enseñar.
- **Fase 20 · Carrera.** Sin tocar.

Al empezar, la auditoría encontró que **una sesión anterior ya había empezado esto** sin llegar
a verificarlo ni a contarlo: la migración `0044_coach_matches.sql`, el servicio, la ruta
`/api/game/coach-matches`, la pantalla `/entrenador/partidos` y la pieza `CoachTrajectory` en
`/carrera` existían en el árbol de trabajo, sin informe. No se rehízo nada: se **midió primero**.

| Medida de partida | Resultado |
|---|---|
| `coach_matches` en la BD local (`supabase_db_DRLCards`) | existe, RLS activa, 0 filas |
| `coach-history:verify` (servidor y BD reales) | 27/27 |
| `_qa-coach-flow.ts` (Chrome real) | 22/22 |
| typecheck · pruebas del servicio | limpio · 13/13 |

Que lo existente pasara sus propias pruebas no quería decir que estuviera bien. La auditoría
encontró **doce defectos** en lo ya construido, que son la mayor parte del trabajo de este bloque
(§2).

## 2 · Qué se implementó

Cada fila es un defecto medido y lo que se hizo. Ninguno toca el motor, el 50/50, la Home ni
Duelos.

| # | Defecto encontrado | Corrección |
|---|---|---|
| 1 | **El balance salía de la página, no de los partidos.** `trayectoria()` se calculaba sobre las filas devueltas por `limit`: la Carrera pedía 20, así que «Dirigidos» **no podía pasar de 20** aunque hubiera cien, y se presentaba como total. | `balance()` en el servidor lee solo `won, score_home, score_away` de **todos** los partidos, a páginas de 1.000 (`max_rows`). La ruta devuelve `total`. |
| 2 | Rondas y marcador podían no cuadrar: se admitía 13-9 en 30 rondas (ocho rondas sin dueño). | Rondas **=** marcador sumado; cada ronda del motor suma exactamente un punto. |
| 3 | Se admitía un empate, que `won = scoreHome > scoreAway` habría guardado como derrota. | Rechazado: un partido terminado tiene ganador. |
| 4 | `rounds` salía de `match.roundNumber` (contador de ronda). | Sale de `match.history.length` (rondas liquidadas). Una prueba juega partidos reales y exige que el servidor acepte lo que resume el cliente. |
| 5 | Un fallo de red o de BD se pintaba como **«inicia sesión»** —a un jugador con sesión— o como **«todavía no has jugado»**. | Estados explícitos `sin-sesion` · `error` · `ok` en cliente y 500 real en la ruta. Nunca se pinta un fallo como historial vacío. |
| 6 | **Permisos por defecto de Supabase sin revocar**: `anon` tenía `SELECT, TRUNCATE, REFERENCES, TRIGGER`; `authenticated` también `TRUNCATE`. RLS filtra el `SELECT`, pero `TRUNCATE` no pasa por RLS. | `revoke all` y se devuelve solo `select` a `authenticated`. Aplicado en la BD local y comprobado. |
| 7 | Sin techo de frecuencia en el `POST`: un bucle podía llenar la tabla de semillas inventadas. | 20 registros/minuto por usuario, en memoria (mismo patrón que `/api/telemetry`). |
| 8 | **La ceremonia final enseñaba un tercer contador de victorias** (`useGameStore.record`, local, por navegador). En la misma sesión el final podía decir 7-2 y el expediente 3-1. | Quitado de la ceremonia. El balance tiene un único dueño: `coach_matches`. |
| 9 | **Botón muerto** en el final: «Guardar replay», deshabilitado, «Próximamente». | Quitado. El replay guardado no existe y no se finge. |
| 10 | **Las acciones del final exigían desplazarse**: revancha a 1.818 px en un viewport de 900 (medido en Chrome). | Pie de acciones **fijo** con REVANCHA · PARTIDOS JUGADOS · CENTRO TÁCTICO y el estado del registro (§8). |
| 11 | La revancha forzaba dificultad «normal»: tras perder en difícil, la revancha era, sin decirlo, un partido más fácil. | La revancha es contra el mismo rival (misma dificultad) y vuelve a sortear el lado. |
| 12 | El historial se leía como una fila de administración: resultado a 17 px, centro vacío a 1440. | Ficha de partido en rejilla (§6). |

Además: paginación «Ver más» sobre el total, enlaces del historial hacia Carrera y hacia jugar,
el paso 4 de la ruta de `/entrenador` cuenta los partidos dirigidos de la misma fuente, una
barra de progreso de XP en la trayectoria, y la corrección del análisis multimapa (§10).

**Defecto propio del bloque, encontrado por el QA:** el primer pie de acciones era `sticky` y no
se pegaba a nada. `globals.css` pone `overflow-x: hidden` en `html` y `body`, lo que convierte a
`body` en un contenedor de desplazamiento que nunca se desplaza. Cambiar esa regla global habría
movido todas las pantallas, así que el pie pasó a `fixed` con un hueco que reserva su altura.

## 3 · Persistencia creada

```
FINAL del partido (phase === "ended")
  └─ efecto único por partido (`processedRef`) en /entrenador/partido
       ├─ useCareerStore.processMatch(match)      ← desarrollo de jugadores, como antes
       └─ registrarPartidoJugado(match, dificultad)
            └─ resumirPartido(match)              ← PURO: MatchState → 12 campos
                 └─ POST /api/game/coach-matches  (Bearer de la sesión)
                      ├─ getSession → user_id DEL TOKEN
                      ├─ techo 20/min
                      ├─ validarPartido           ← rechaza, no corrige
                      └─ insert con service_role
                           └─ 23505 (user_id, seed) → devuelve el que ya estaba · duplicate: true
```

**No se duplica `MatchState`.** Se guarda el resumen: `MatchState` lleva rondas, eventos,
narrativa, economía y memoria táctica —decenas de miles de objetos— y nada de eso hace falta para
responder «contra quién, dónde, cómo acabó y cuándo».

**Idempotencia.** La clave es `(user_id, seed)`: la semilla maestra se genera una vez al empezar
y ya identificaba ESE partido antes de guardarlo. Probado con siete envíos del mismo partido →
una fila, y el mismo `id` devuelto.

**Qué pasa exactamente al recargar la pantalla final**, dicho sin adornar: `MatchState` vive en
memoria, así que la recarga vuelve al menú y **no reenvía nada**. La idempotencia protege los
casos que sí reenvían: el doble efecto, el reintento tras un error (§8) y los reintentos de red.
El QA de Chrome comprueba el circuito (partido → revancha → recarga → sigue habiendo una fila) y
`coach-history:verify` comprueba la idempotencia.

## 4 · Modelo de datos

`public.coach_matches` — migración `0044_coach_matches.sql`.

| Mínimo pedido | Columna | Nota |
|---|---|---|
| id | `id uuid` | |
| usuario | `user_id uuid → auth.users` | del token, nunca del cuerpo; `on delete cascade` |
| rival | `rival_name text(1-60)` | nombre visible; + `difficulty` (`easy/normal/hard`) |
| mapa | `map_id text` + `map_site text` | hoy siempre `ascent` · `A` (§9); por fila, no constante |
| resultado | `won boolean` | **derivado** del marcador en el servidor; el del cliente se ignora |
| rondas | `rounds int` | = `score_home + score_away` |
| lado inicial | `start_side ATK/DEF` | el **sorteado**, no el de la segunda mitad |
| fecha | `finished_at timestamptz` | la pone el servidor |
| duración | `duration_s int null` | reloj **interno** del motor; se guarda y **no se enseña** (§9) |
| resultado final | `score_home`, `score_away` | 0-99 |
| — | `seed bigint` | clave de idempotencia |
| — | `team_name`, `mvp` | el MVP solo si es del equipo dirigido |

**Lo que NO se guarda, a propósito:** roster del rival, sus decisiones, su economía, las rondas y
los eventos. No hacen falta para el historial y guardar el estado de otro jugador es guardarse un
problema.

## 5 · Seguridad / RLS

| Qué | Cómo | Comprobado por |
|---|---|---|
| Solo el dueño lee | política `select using (user_id = auth.uid())` | Beto por PostgREST: 0 filas de Ana |
| El cliente no escribe | sin política de escritura; `revoke all` a `anon` y `authenticated` | insert / update / delete → `permission denied` |
| Sin sesión no hay nada | ruta → 401; PostgREST con `anon` → `permission denied` (antes: `[]`) | `coach-history:verify` §5 |
| `user_id` inventado | se ignora: sale del token | — |
| Cuerpos absurdos | 7 casos rechazados sin dejar fila | §6 del verificador |
| Inundación | 25 seguidos → 20 aceptados, 5 × 429, 0 filas de más | §8 del verificador |

**Hasta dónde llega la autoridad del servidor**, porque es fácil leer de más en
«server-authoritative»: el servidor decide **quién**, **si se puede escribir** y **qué valores son
admisibles**. **No** decide el resultado: el simulador del Entrenador corre en el navegador por
diseño, así que el marcador es el que informa el cliente. Por eso esta tabla es un **historial
personal**: no puntúa, no concede nada y no alimenta ningún ranking.

## 6 · Historial — `/entrenador/partidos`

Cada partido es una **ficha**, no una fila, con la jerarquía del encargo:

```
┃ DERROTA                                    ASCENT
┃                                            sitio A
┃ 10 — 13                  (asset real de Ascent, muy atenuado)
┃ vs RIVAL (NORMAL)
┃ 11 sept 2026 · Defensa de salida · Flujo FC
┃ ─────────────────────────────────────────────
┃ 23 rondas · Destacado Derke
```

- Filo de color y palabra del resultado arriba; el marcador es el único número a tamaño titular.
- Rejilla de 1/2/3 columnas (390 / 768 / 1440).
- Balance, diferencial de rondas y racha en la cabecera, **de todos los partidos**.
- «Ver más · quedan N» cuando hay más de 30; filtra por `id` para no repetir fichas.
- Enlaces **Dirigir otro partido →** y **Ver tu carrera →**.

Estados: cargando · **sin sesión** («el historial vive en tu cuenta» → Entrar) · **error**
(«no se pudo leer» → Reintentar) · **vacío** (§ Fase 6) · lista.

**Estado vacío** — «Todavía no has dirigido ningún partido» con **Jugar partido** →
`/entrenador/partido`, visible sin desplazarse (top 334 px a 1440). Sin tabla. La Carrera tiene
su propio vacío: «Tu carrera empieza en el banquillo» → **Dirigir mi primer partido**, y **no**
pinta un balance 0–0 inventado.

## 7 · Carrera

### Qué significa «Carrera» hoy en el producto — auditoría

| Qué | Dónde | Fuente | Relación con el Entrenador |
|---|---|---|---|
| **`/carrera`** | página enlazada desde el Entrenador | `useCareerStore` → desarrollo de jugadores en el mundo (`world.players[id].dev`), química, temporada | cada partido terminado evoluciona a los jugadores (`processMatch`) |
| **Progresión global de cuenta** | barra superior | `profiles.xp` → `levelFromXp` | la misma para todo NEXUS |
| **Mánager** | `/manager` | `useManagerStore.career` (local): reputación, licencia, contrato, `stats.wins/losses`, historia | modo propio; `grantMatchOutcomeReward` le suma cada partido **si** el usuario creó entrenador |
| `useGameStore.record` | ceremonia final (hasta este bloque) | local, por navegador | contador de victorias paralelo |
| Pase de temporada / logros | `/recompensas`, `/logros` | `user_pass`, `user_achievements` | no reciben partidos del Entrenador |

### Qué se hizo

La Carrera **no tiene sistema nuevo**. `CoachTrajectory`, arriba de `/carrera`, reúne tres
fuentes que ya existían, cada una con su dueño:

- **Dirigidos · Balance · Rondas · Racha** → `coach_matches`, derivados en el servidor (§2 #1).
- **Nivel y XP** → los **globales** de la cuenta (`levelFromXp`), los mismos de la barra
  superior, ahora con su barra de progreso. No hay «nivel de entrenador»: sería una segunda
  escalera para la misma persona.
- **Temporada** → el reloj único del mundo.

El recorrido PARTIDOS → RESULTADOS → PROGRESIÓN → CARRERA queda así: el partido deja fila
(`coach_matches`) y evoluciona a los jugadores (`processMatch`); la Carrera enseña la trayectoria
—con la tira de «Últimos» y el enlace al expediente— encima del desarrollo de esos jugadores.

### Duplicaciones encontradas

- `useGameStore.record` — **quitado de la pantalla**; sigue escribiéndose en `rewards.ts` y ya
  no lo lee nadie (P2, §14).
- `ManagerCareer.stats` — un segundo contador de victorias, pero de **otro modo** (`/manager`),
  local y solo si se creó entrenador. No se ha tocado ni se enseña en el Entrenador (P2, §14).

### MISSING — no existe y no se ha inventado

- **Rating o ranking del entrenador.** No existe ninguna métrica competitiva del Entrenador; el
  ranking de NEXUS es de Duelos. Y no puede existir con honestidad mientras el resultado lo
  informe el cliente (§5).
- **Logros del Entrenador.** El catálogo de logros no tiene ninguno ligado a partidos dirigidos.
- **Progresión propia del Entrenador que persista con sesión.** Ver P1 (§13).

## 8 · Flujo completo

Recorrido con Chrome real y sesión real (`scripts/_qa-coach-flow.ts`), jugando un partido
**entero** —no una fila inyectada por la API—:

| Paso | Qué se comprueba | Resultado |
|---|---|---|
| ENTRENADOR | JUGAR a la vista sin desplazarse a 390/768/1024/1440 | top 89 px en las cuatro |
| JUGAR → PREPARACIÓN → 50/50 | «Sortear lado y jugar»; el sorteo es el del bloque anterior (sin cambios) | pasa |
| PARTIDO → COMPRA → RONDA → RESULTADO → SIGUIENTE | el QA avanza pulsando las órdenes ancladas al pie | llega al final |
| FINAL | revancha y «Partidos jugados» a la vista a 1440 / 1024 / 768 / 390, sin quedar bajo la barra móvil; sin botones muertos; el pie dice «Partido registrado en tu expediente» | revancha a la vista: top 825 px @1440 · 693 @1024 · 889 @768 · 709 @390; 0 botones deshabilitados; «Partido registrado en tu expediente» |
| REVANCHA | arranca otro partido de verdad | pasa |
| RECARGA | no crea otra fila | 1 → 1 |
| PARTIDOS JUGADOS | la ficha es la de la BD; resultado y mapa reales; balance; enlace a Carrera | pasa |
| CARRERA | trayectoria, «Dirigidos» = BD, nivel **de cuenta**, enlace al expediente | pasa |
| ENLACES | todos los `href` internos de seis pantallas del Entrenador | 13 destinos · 0 rotos |
| SIN SESIÓN | el historial lo dice e invita a entrar | pasa |

**Estado del registro en el final**, en una línea del pie: *registrando…* · *registrado* · *ya
constaba* · *sin sesión: no queda en ningún historial* (→ Entrar) · *no se pudo registrar*
(→ Reintentar, seguro por la idempotencia).

## 9 · Limitaciones reales

1. **El partido simulado es Ascent · sitio A.** Es lo único que el motor simula
   (`src/sim/map/ascentA.ts`). Se dice en la retransmisión (`broadcast/engine.ts:99`), en el
   historial (`map_id = ascent`, `map_site = A`, «sitio A» en la ficha) y en el fondo del portal.
   Los doce assets reales siguen sirviendo donde el mapa **es** el mapa —selector, pizarra,
   `/entrenador/mapas`— y **no** se afirma en ningún sitio que el motor juegue los doce.
2. **El resultado lo informa el cliente.** Historial personal, no competitivo (§5).
3. **La duración existe, pero no significa lo que parece.** `duration_s` es el reloj interno del
   motor: el QA registró un 13-7 de veinte rondas con **3 minutos**, unos nueve segundos por
   ronda. No corresponde a lo que dura una ronda real ni al tiempo que el jugador pasó dirigiendo
   (sala táctica, compras, pausas), que el motor no mide. Se guarda porque el encargo lo pide «si
   existe», y **no se enseña**: un número exacto que no significa nada es peor que no ponerlo. La
   duración real de la sesión es **MISSING**.
4. **Sin sesión no hay historial.** El modo local es legítimo y no escribe en ningún sitio; el
   final lo dice.
5. **El techo de frecuencia es por proceso** y se reinicia con el servidor; con varias instancias
   se multiplica. El peor caso son filas de más en el historial propio.
6. **Colisión de semilla.** Dos partidos del mismo usuario con la misma semilla de 32 bits se
   tratarían como el mismo. Probabilidad ~n²/2³³ (1 entre ~8.600 a los mil partidos). Se
   documenta; no se ha inventado otro identificador.

## 10 · Análisis del futuro simulador multimapa

En `docs/product/ANALISIS-SIMULADOR-MULTIMAPA.md`, **revisado y corregido en este bloque** con
medidas propias. Resumen:

- **24 ficheros** importan `ascentA` directamente (sim, brain, tactics, utility, abilities,
  spatial) y más dependen de forma indirecta (carriles de `tactics/map`, la capa de vista vía
  `@/sim`). La tabla anterior atribuía import directo a seis ficheros que no lo tienen y omitía
  `spatial/ascent`; el total de 24 era correcto.
- **154 literales de zona en 23 ficheros** del simulador (confirmado). Es el 80 % del trabajo: la
  IA razona con nombres propios («si estás en `heaven`, ancla»).
- **Reutilizable:** `nearestZone`/`route` (algoritmos), el Spatial Engine (ya tiene el patrón
  «otro mapa = otro adaptador»), combate, percepción, economía, loadouts, narrativa.
- **Específico de Site A:** `ZoneId` como unión cerrada, holds y staging por rol, carriles
  main/tree/mid, un único sitio de plantado, `FIELD` 1000×700.
- **Datos que faltan por mapa:** zonas con rol, adyacencia, muros, sitios de plantado, spawns y
  —nuevo en el análisis— una **calibración medida** entre el campo abstracto y el PNG.
- **Red de seguridad** para la fase mecánica: resultados de N semillas grabados antes y exigidos
  idénticos después.

No se ha implementado nada del motor.

## 11 · Tests

| Comando | Resultado |
|---|---|
| `npm test` | **822/822** (801 del bloque anterior + 21 nuevos) |
| `typecheck` (app + scripts) | limpio |
| `eslint` (`.eslintrc` del proyecto) sobre los 10 ficheros tocados | limpio |
| `build` | limpio |
| `npm run security:verify` | ✅ todas pasan |
| `E2E_BASE_URL=… npm run strats:verify` | ✅ pasa |
| `E2E_BASE_URL=… npm run ux:verify` | ⚠ **incompleta** — 180/180 comprobaciones sin fallo (incluidas `/entrenador`, equipos, mapas y strats a 1440 y 1920) antes de que el sistema la detuviera **dos veces por falta de memoria** al llegar a `/colecciones`, ruta que este bloque no toca. Pendiente de una ejecución completa (§13) |
| `E2E_BASE_URL=… npm run trainer:verify` | ✅ **35/35** |
| `E2E_BASE_URL=… npm run coach-history:verify` | **32/32** (27 de partida + 5 nuevas) |

Pruebas nuevas:

- `src/lib/match/history.test.ts` (6) — **juega partidos reales con el motor** y exige que el
  servidor acepte lo que resume el cliente; rondas = marcador; lado sorteado y no el de la segunda
  mitad; semilla; Ascent · A; MVP solo del equipo propio.
- `src/server/services/coachMatches.test.ts` (+3, 1 reescrita) — rondas exactas, empate, balance
  sobre la forma mínima.
- `coach-history:verify` (+5) — `anon` rechazado por permisos, rondas de más, empate, balance
  sobre el total con página de 1 y paginación estable, techo 20/min.

## 12 · Chrome QA

`npx tsx scripts/_qa-coach-flow.ts` (instrumento `_`, fuera de CI): **⟦FLOW⟧**, a
1440×900 · 1024×768 · 768×1024 · 390×844. Regresión del bloque anterior
(`scripts/_qa-trainer2.ts`, preparación → compra → ronda → fin de ronda con las órdenes
ancladas): **⟦QA2⟧**.

Capturas en `docs/product/qa/entrenador2-cierre/`: Carrera vacía, historial vacío, final a las
cuatro anchuras, historial y Carrera con partido, `/entrenador` · `/entrenador/partidos` ·
`/carrera` a las cuatro anchuras, e historial sin sesión.

**Falsos positivos del propio instrumento, corregidos y contados aparte:** «Dirigidos» se buscaba
con `\b1\b` y la cifra venía pegada a la etiqueta («Dirigidos1»); y la detección de la barra móvil
habría confundido el propio pie `fixed` con ella. Ninguno era un defecto del producto.

## 13 · P0 / P1 / P2

**P0 = 0.**

**P1 = 1 — preexistente, fuera del perímetro del encargo.**

> **La recompensa del partido no se persiste con sesión.** `grantMatchOutcomeReward` aplica
> créditos y XP con `applyReward`, que solo toca el estado del navegador. `CloudSync` llama a
> `syncFromServer` en cada carga y los sobrescribe con `profiles`. **Medido en Chrome:** la
> ceremonia promete «+2720 créditos · +709 XP», la barra superior sube a 8.720 y nivel 4, y tras
> recargar la cuenta vuelve a 6.000 créditos y nivel 1 (capturas `11-final-1440.png` y
> `12-partidos-1440.png` del bloque).
>
> No se ha «arreglado» porque las dos salidas obvias están mal: conceder créditos en el servidor
> por un marcador que informa el cliente es un exploit (20 partidos falsos por minuto), y dejar de
> conceder en local es cambiar la economía sin encargo. Es una decisión de producto:
>
> - **A.** Simular el partido en el servidor → el resultado pasa a ser verificable y la recompensa
>   se puede conceder por `app_grant_reward`. Es otro proyecto.
> - **B.** Recompensa acotada en el servidor (tope diario, idempotente por semilla), aceptando que
>   se puede falsear hasta el tope.
> - **C.** Con sesión, no prometer recompensa en el final hasta que exista A o B.

**Verificación incompleta — no es un defecto del producto, pero impide decir GREEN:**
`ux:verify` no llegó al final. El equipo tenía 1,7 GB libres de 15,8: Chrome del usuario
(~2,8 GB) y contenedores Docker de otros cuatro proyectos además de los dos stacks de Supabase.
El sistema detuvo la verificación dos veces, en `/colecciones`. Hasta ahí: 180/180. No se
pararon procesos ni contenedores ajenos para forzarla. Para cerrarla: liberar memoria y
`E2E_BASE_URL=http://127.0.0.1:3005 npm run ux:verify`.

**P2:**

1. `useGameStore.record` se sigue escribiendo y ya no lo lee nadie (código muerto en
   `rewards.ts`/`useGameStore`).
2. `ManagerCareer.stats` cuenta victorias por su cuenta en `/manager` (otro modo).
3. `overflow-x: hidden` en `html, body` anula todo `sticky` de la aplicación.
4. Los permisos por defecto de Supabase (`TRUNCATE`, `TRIGGER`, `REFERENCES` a `anon` y
   `authenticated`) están en el resto de tablas, p. ej. `user_pass`. En `coach_matches` ya no.
5. La ceremonia final (`MatchCeremony`) conserva su estilo anterior (radios, emoji, degradados)
   frente al lenguaje `Surface` del resto del Entrenador. Solo se tocó lo que el encargo pedía.
6. `/carrera` mantiene su cabecera y paneles de desarrollo con el estilo antiguo; la trayectoria
   nueva va arriba.
7. **Saltos de línea para la revisión.** `src/app/entrenador/partido/page.tsx` y
   `src/app/entrenador/page.tsx` son CRLF en `HEAD` y LF en el árbol de trabajo desde una sesión
   anterior a esta (al empezar ya eran LF; las ediciones de este bloque respetan el salto que
   encuentran). Por eso `git diff` los enseña enteros: el cambio real, con
   `git diff --ignore-cr-at-eol`, es 288+/76− en `partido` y 173+/198− en la home, sumando este
   bloque y el anterior. No se ha normalizado de vuelta sin preguntar.

## 14 · Deudas restantes

| Deuda | Tipo | Requiere |
|---|---|---|
| Recompensa del Entrenador no persistida (P1) | economía | decisión A / B / C |
| Simulador multimapa | motor | su propio proyecto (§10) |
| Geometría de zonas de los 12 assets | datos | levantarla sobre los assets, no deducirla |
| Rating / logros del Entrenador | producto | resultado verificable (A) |
| `useGameStore.record` sin lectores | limpieza | tocar `rewards.ts` |
| Doble contador en `/manager` | producto | decidir si el Mánager lee `coach_matches` |
| `overflow-x` global | CSS | encargo propio (afecta a todas las pantallas) |
| Permisos por defecto en el resto de tablas | seguridad | migración de revocado general |
| Techo de frecuencia por proceso | infraestructura | almacén compartido si hay varias instancias |
| Fase 21 · Duelos | — | bloque independiente, por encargo |
| Saltos de línea CRLF→LF en dos ficheros | revisión | decidir antes del commit (P2 #7) |

---

### READY — lista del encargo

| | |
|---|---|
| ✅ Partidos terminados se persisten realmente | `coach_matches`, verificado en BD y en Chrome |
| ✅ No se crean duplicados al recargar | `(user_id, seed)`; 7 envíos → 1 fila; recarga 1 → 1 |
| ✅ Cada usuario solo ve sus partidos | API y PostgREST directo |
| ✅ Historial con datos reales | ficha = fila de la BD |
| ✅ Historial con UX de juego competitivo | ficha con jerarquía, no tabla |
| ✅ Carrera con datos reales existentes | `coach_matches` + XP global + temporada del mundo |
| ✅ Sin progresión duplicada nueva | ninguna cifra nueva; dos duplicados previos documentados (P2) |
| ✅ Estado vacío | historial y Carrera, CTA directo a jugar |
| ✅ Flujo completo del Entrenador | §8 |
| ✅ Sin botones muertos | «Guardar replay» quitado; 0 deshabilitados en el final |
| ✅ Sin scroll para acciones críticas | JUGAR y el final a las cuatro anchuras |
| ✅ Limitación Ascent A documentada | §9 y análisis multimapa |
| ✅ No se inventan mapas, partidos ni estadísticas | MISSING declarados en §7 |
| ✅ Tests · Build · Security | §11 |
| ⚠ UX | `ux:verify` 180/180 sin fallos pero **sin terminar**: detenida por falta de memoria del equipo (§11, §13) |
| ✅ P0 = 0 | |
| ❌ **P1 = 0** | **P1 = 1**, preexistente (§13) |

**ENTRENADOR 2.0 — CIERRE: FASES DEL ENCARGO COMPLETAS · NO READY (P1 de economía pendiente de
decisión).**
