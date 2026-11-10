# FASE 17 — PRIMEROS USUARIOS REALES

# ⚠ VALIDACIÓN HUMANA PENDIENTE — BUILD CONGELADA

**Usuarios reales que han probado NEXUS: 0.**

Este informe NO contiene resultados de usuarios, ni retención, ni sesiones, ni comentarios
cualitativos, porque **todavía no ha habido ninguna persona delante del producto**. Lo que
contiene es el estado de preparación: qué se puede medir, qué no, con qué contenido se va a
probar y qué falta hacer físicamente.

Las secciones 3, 7, 8, 12 y parte de la 9-11 quedan **deliberadamente vacías** hasta que las
sesiones ocurran. Rellenarlas ahora sería inventar.

> **Lo que SÍ cambió desde la primera redacción de este informe:** F17C conectó el puente
> real VLR → Supabase → NEXUS y el torneo que verán los participantes **ya no es demo**
> (§2.2 reescrito). Y F17D congeló la build (§1). El estado de la validación humana no ha
> cambiado: sigue pendiente.

---

## 1 · VERSIÓN PROBADA

Todos los participantes deben usar **exactamente esta versión**. La Fase 17D lo exige: nada
de UX, economía, recompensas, cartas, reglas de duelo, navegación, probabilidades ni pipeline
puede cambiar entre un usuario y el siguiente.

```
versión      0.1.1  ·  build 1  ·  canal stable
rama         arch/stabilization
tag          nexus-human-test-v1
commit       (ver §1.2)
```

**El P0-A de la primera redacción está resuelto.** Aquella versión vivía en un árbol con 717
ficheros sin commitear: no era reproducible ni identificable, y si alguien guardaba un fichero
a mitad de tanda no había forma de demostrarlo. F17D lo congeló.

### 1.2 · Qué contiene exactamente la build congelada, y qué no

Conviene decirlo sin adornos, porque afecta a cómo se lee el commit.

El árbol tenía **740 cambios sin commitear**, de los cuales **13 ficheros son de F16/F17** (el
trabajo de estas fases) y el resto es **trabajo previo que nunca se había commiteado**:
`src/domain/cards/combat.ts`, `scripts/stability-audit.ts`, `scripts/ftue-audit.ts` y ~660
ficheros más.

Un commit con «solo lo de F17» **no habría compilado**: los fixtures de F16 importan
`MIN_ROUNDS` de `combat.ts`, que nunca se commiteó. Y sin `stability-audit.ts` ni `ftue-audit.ts`
no existirían las herramientas que la propia congelación exige ejecutar.

Así que la build congelada **es el árbol completo**, por decisión explícita del responsable del
producto. Es exactamente lo que se ha probado en F16 y F17 y lo único que arranca. El commit lo
dice en su mensaje: la mayor parte es trabajo previo **no auditado en estas fases**.

### 1.1 · El test DEBE correr sobre el build de producción, no sobre `next dev`

Esto no es una preferencia: está medido. La misma auditoría, el mismo código, los dos modos:

| Servidor | Comprobaciones | P0 | P1 | P2 |
|---|---|---|---|---|
| `next dev` (1.ª pasada, servidor recién arrancado) | 105 | 0 | **1** | 3 |
| `next dev` (2.ª pasada, ya caliente) | 105 | 0 | **2** | 3 |
| **`next build` + `next start`** | 105 | **0** | **0** | **0** |

El P1 de `dev` es siempre el mismo: *«pulsar el enlace no llevó a `/tienda`; se quedó en
`/mercado`»*. Y `/mercado` **sí** tiene dos enlaces a `/tienda` en su barra de navegación, así
que es un camino real de usuario, no un enlace inventado por la auditoría.

La causa es el modo de desarrollo: Next compila cada ruta la primera vez que se pide (medido
en el log: `GET /tienda` de 81 ms a 804 ms según el momento), y la comprobación da 2,6 s a la
transición de cliente. En producción todo está compilado y **la navegación no falla ni una
vez**. Los tres P2 de siempre —401 en rutas de admin— también desaparecen.

**Consecuencia para la prueba:** en `dev`, un participante que pulse «Tienda» desde el mercado
puede ver que **no pasa nada** durante segundos, y el primero de la tanda lo sufriría más que
el último porque las rutas se van compilando. Eso rompe la Fase 17D —todos deben probar lo
mismo— por un motivo que no tiene nada que ver con el producto.

> **Se prueba sobre `npm run build` + `npx next start -p 3001`. No sobre `npm run dev`.**

---

## 2 · TORNEO Y DATOS UTILIZADOS

Hay que separar dos cosas, porque **no tienen el mismo grado de realidad** y el usuario las
verá a la vez.

### 2.1 · Las cartas: reales

Lo que el usuario abre, colecciona y juega sale del catálogo en código, y es real:

```
jugadores  379   (371 filas del roster VLR real)
cartas     772
sintéticas   0   ← verificado en esta fase
```

Los primeros del roster son Benjyfishy (Team Heretics), Wo0t (Team Heretics), Derke (Fnatic),
Boaster (Fnatic), Alfajer (Fnatic). Personas y equipos reales.

**Las 6 variantes que la Fase 16 validó con VCT 2026: EMEA Stage 2** (`mythic`, `top-rating`,
`top-acs`, `top-kills`, `top-assist`, `top-hs`) siguen derivándose de las 1.460 filas de
scoreboard reales. Las 3 bloqueadas —`champion-edition`, `clutch`, `rookie`— **siguen
bloqueadas y ausentes**, como exige el contrato. No se ha rellenado ninguna.

### 2.2 · Los torneos: REALES desde F17C

**Esta sección decía lo contrario y ha quedado obsoleta, que es la mejor noticia de la fase.**
Cuando se escribió, el único evento de la base de datos era `demo-masters-madrid-2026` y no
existía ningún camino conectado entre el scraper VLR y Supabase. F17C construyó ese puente.

Estado real de la base de datos:

```
events                2   →  vlr-2976-emea-stage-2 (source "vlr")  +  demo-masters-madrid-2026
teams                24   →  16 reales de EMEA Stage 2  +  8 del demo
players              84   →  reales (antes: 0)
matches              60   →  reales del torneo
match_maps          146
map_player_stats  1.460
player_stats        600 · standings 32 · team_stats 16 · player_event_stats 84
sync_state           ok
```

Y la correspondencia con la fuente es **exacta**:

| | vlr.gg | Supabase |
|---|---|---|
| equipos | 16 | **16** ✓ |
| jugadores | 84 | **84** ✓ |
| partidos | 60 | **60** ✓ |
| mapas | 146 | **146** ✓ |
| filas de scoreboard | 1.460 | **1.460** ✓ |

El evento lleva sus datos reales: *Olimpic Arena, Badalona* · 250.000 $ · `tier`
`vct-international` · circuito `vct` · `source: "vlr"`. Los jugadores son personas reales
(**RieNs**, **nAts**, **Sayonara**…), no plantillas.

**Integridad verificada:** 0 filas de scoreboard sin jugador, sin equipo o con agente
inválido; **0 con agente nulo**; 0 mapas duplicados; y el evento demo **intacto** (sus 7
partidos y sus 5 Pick'ems abiertos siguen ahí).

**Dos entidades que faltaban en los catálogos** se dieron de alta tras detectarlas el dry run
y **decidirlo una persona**, no el programa: el agente `Veto` (4 selecciones en todo el
torneo, un solo jugador) y el mapa `Summit` (16 partidos, el 6.º más jugado). El rol de
`Veto` es un dato aportado por el responsable del producto, no derivado de la fuente.


### 2.3 · Los Pick'ems SÍ son usables (comprobado)

El evento figura con `status: "scored"`, lo que a primera vista parecía impedir la pregunta 13
del protocolo. **No lo impide.** La puerta real está en la RPC, por pregunta y con el reloj de
la base de datos:

```sql
-- 0012_pickems.sql: si now() >= locks_at, se rechaza
(now() >= q.locks_at) as locked
```

Y 5 de las 6 preguntas bloquean en el futuro (4, 6, 7 y 9 de septiembre; hoy es el 3). Además
`test:e2e` ejercita los dos caminos: *predicción abierta → 200* y *predicción cerrada → 409*.

**Conclusión: un participante puede predecir de verdad.**

### 2.3 bis · Y sobre el torneo REAL no puede, con razón

El ciclo de Pick'ems se ejecutó también sobre `vlr-2976-emea-stage-2` y creó el contenedor
(*Predicciones · VCT 2026: EMEA Stage 2*) con **0 preguntas**. No es un fallo:
`isPredictable` exige `start_time > now` y estado no cerrado, y **los 60 partidos terminaron
el 30 de agosto**. No queda nada que predecir.

Lo que sí quedó demostrado es que **el dato que recibe Pick'ems ya es correcto**. El
enunciado se construye interpolando `matches.team_a`, y la sincronización escribía ahí el
**id** del equipo: un Pick'em real habría preguntado *«¿quién gana vlr-t-2593 vs
vlr-t-1001?»*. Corregido en el mapper —no en Pick'ems—, y verificado en la base de datos:

```
team_a  «FUT Esports»      team_a_id  «vlr-t-1184»
team_b  «Natus Vincere»    team_b_id  «vlr-t-4915»
partidos con un id en team_a: 0
```

**Consecuencia para la prueba:** el único torneo con predicciones abiertas es el DEMO (5).
El real aparece, correctamente, como cerrado.

---

## 3 · NÚMERO DE USUARIOS REALES

# 0

Ni uno. Las **9** cuentas que hay en la base de datos las creó un script: siete `econ*` de
`economy:verify`, `NEXUSDemo_2f86` de la semilla y una más de una pasada de verificación.
(`ftue:audit` crea la suya y **la borra al terminar**, que es por lo que no aparece.)

No son personas y no se cuentan como tales en ningún sitio de este informe.

---

## 4 · RECORRIDO DE PRIMERA SESIÓN

### 4.1 · Preparación por participante

1. **Cuenta real y nueva**, creada por la propia persona en el formulario de registro. Lo que
   concede `handle_new_user` y nada más: 6.000 créditos, 3 Sobres Iniciales, 1 Estándar, cero
   cartas. **Sin sembrar. Sin excepciones.**
2. **No se le explica dónde pulsar.** Ni una indicación. La primera pregunta del test se
   responde sola o no se responde.
3. **Pensar en voz alta**, con grabación de pantalla y audio previo consentimiento.
4. Se anota la hora de inicio y la de abandono. Se para cuando la persona pare, o a los 45
   minutos.

### 4.2 · Lo único que dice el facilitador

| Momento | Frase, literal |
|---|---|
| Inicio | *«Esto es NEXUS. Adelante.»* — y silencio |
| A los 10 min, si sigue sin jugar | *«Juega una partida.»* |
| Después | *«Haz lo que harías si esto fuera tuyo.»* |
| Si se atasca >2 min | *«¿Qué estás intentando hacer?»* — nunca la respuesta |

### 4.3 · Las 17 preguntas y de dónde sale cada respuesta

`OBS` = lo responde el observador. `DB` = lo confirma `npm run session:observe`.

| # | Pregunta | Fuente |
|---|---|---|
| 1 | ¿Qué cree que es NEXUS? | OBS (con sus palabras, al final) |
| 2 | ¿Qué intenta hacer primero? | OBS (primer clic deliberado) |
| 3 | ¿Encuentra los sobres? | OBS |
| 4 | ¿Abre su primer sobre? | **OBS + DB** (`economy_ops` `open_pack`) |
| 5 | ¿Entiende que ha conseguido cartas? | OBS |
| 6 | ¿Encuentra su colección? | OBS |
| 7 | ¿Entiende para qué sirve el mazo? | OBS |
| 8 | ¿Consigue construirlo? | **OBS + DB** (`duel_decks`) |
| 9 | ¿Entiende por qué puede/no puede jugar? | OBS |
| 10 | ¿Encuentra un duelo? | **OBS + DB** (`duel_matches`) |
| 11 | ¿Entiende el resultado? | OBS |
| 12 | ¿Descubre Pick'ems? | OBS |
| 13 | ¿Hace una predicción? | **OBS + DB** (`pickem_answers`) |
| 14 | ¿Encuentra progreso/objetivos? | OBS |
| 15 | ¿Qué le resulta confuso? | OBS |
| 16 | ¿Qué le gusta? | OBS |
| 17 | ¿Qué esperaba y no encontró? | OBS |

**13 de 17 son puramente observacionales.** Ninguna instrumentación las resuelve, y añadir
telemetría para intentarlo sería el sistema de analytics que la fase prohíbe.

### 4.4 · Una pregunta extra, por §2.2

> **18 · ¿Menciona el torneo? ¿Le parece real?**

No se le pregunta por él: solo se anota **si lo saca la persona por su cuenta**. Es la única
forma honesta de saber si el contenido demo estorba.

### 4.5 · El instrumento: `npm run session:observe`

```
npm run session:observe                       # cuentas creadas hoy
npm run session:observe -- --user <nombre>    # una persona
npm run session:observe -- --since <ISO>      # una ventana
npm run session:observe -- --json             # para pegar en el informe
```

**Es de solo lectura.** No escribe, no crea esquema, no añade telemetría y no toca el
producto: reconstruye la línea de tiempo desde las tablas que ya existen.

Probado sobre la cuenta sembrada, que es el único recorrido completo disponible hoy:

```
NEXUSDemo_2f86   ·   alta 2026-09-02 20:06:09
  primer sobre COMPRADO       2m 35s
  primer sobre ABIERTO           21s
  primera CARTA                  21s
  primer MAZO                   3m 4s
  primer DUELO iniciado        3m 10s
  primer DUELO terminado       3m 54s
  primera RECOMPENSA           3m 54s
  primer PICK'EM enviado       4m 29s
  primera PREDICCIÓN               —
```

Y agrega un embudo sobre el conjunto observado (cuántas cuentas llegaron a cada hito), además
de **imprimir siempre la lista de lo que NO puede responder**, para que nadie lo dé por medido.

---

## 5 · MÉTRICAS DISPONIBLES

Ocho de los doce puntos que pedía la Fase 17A, **sin una línea de código de producto**:

| Punto | Fuente exacta |
|---|---|
| Apertura de sobre | `economy_ops` con `kind='open_pack'` |
| Obtención de primera carta | `user_cards.obtained_at` |
| Construcción de mazo | `duel_decks.created_at` |
| Inicio de duelo | `duel_matches.created_at` |
| Finalización de duelo | `duel_matches.status` ∈ {COMPLETED, DRAW} + `updated_at` (trigger `touch_updated_at`) |
| Pick'ems | `pickem_submissions.created_at` |
| Predicción | `pickem_answers` (`option_key`, `is_correct`, `points_award`) |
| Progreso | `profiles.level/xp` · `user_pass` · `user_achievements.claimed_at` |

Extras que salen del mismo sitio y no cuestan nada: compra de sobre (`buy_pack`), primera
recompensa (primer ingreso del libro mayor que no es `starter_grant`), créditos entrados y
salidos, y reciclaje (`salvage`).

---

## 6 · MÉTRICAS NO DISPONIBLES

| Punto | Por qué no |
|---|---|
| **Primera sesión** (duración) | No existe ninguna señal de inicio ni de fin de sesión |
| **Entrada en la colección** | Es navegación: no deja fila |
| **Perfil** | Ídem |
| **Objetivos** | Ídem |
| Punto de abandono | Haría falta saber en qué pantalla estaba |
| Acciones repetidas | Solo se ven las que mueven saldo |
| **Retención D1 · D3 · D7 · D14** | **No hay señal fiable de actividad diaria** |

### 6.0 · Retención: lo que se puede recuperar y lo que no (F17D)

Reconfirmado en F17D, sin construir nada. De las once métricas de retención de §5.3:

| Se puede recuperar HOY | Cómo |
|---|---|
| Duelos por día | `duel_matches.created_at` |
| Sobres abiertos por día | `economy_ops` `kind='open_pack'` |
| Cartas obtenidas por día | `user_cards.obtained_at` |
| Pick'ems enviados por día | `pickem_submissions.created_at` |
| Predicciones | `pickem_answers.created_at` |
| Maestría | derivable de `user_cards` |
| Prestigio comprado | `credit_transactions.reason LIKE 'prestige:%'` |
| Créditos creados / gastados | `credit_transactions.delta` |

| **NO se puede recuperar** | Por qué |
|---|---|
| **Usuarios que vuelven (D1 · D3 · D7 · D14)** | **No existe señal fiable de actividad diaria** |
| Sesiones (número y duración) | No hay marca de inicio ni de fin |
| Eventos visitados | Es navegación: no deja fila |

# NO EXISTE SEÑAL FIABLE DE ACTIVIDAD DIARIA.

**De esta tanda saldrá primera sesión, no retención.** No se van a fabricar D1/D3/D7: quien
entra, mira su colección y se va no deja ni una fila, así que lo único medible sería
«recurrencia de acciones que mueven saldo», que es otra cosa y siempre da un número más bajo.

Es la **deuda 5**, excluida por encargo expreso, y **no se ha implementado nada** en F17D. Si
se quiere D1 en adelante, la tabla de §17.5 tiene que existir **antes** de que entre la
primera persona: después el dato no se recupera.

### 6.1 · La ausencia de señal de retención, confirmada otra vez

Buscado en el esquema completo: **no existe `last_seen`, ni tabla de actividad diaria, ni
nada equivalente.** Lo único con «daily» es `card_price_daily`, que es de mercado y no de
usuarios.

El patrón sigue siendo el de la Fase 16: **NEXUS registra transacciones, no presencia.** Quien
entra, mira su colección y se va no deja ni una fila — y en un juego de coleccionismo, mirar
es la mitad del producto.

**Es la deuda 5, y me pediste no resolverla.** No se ha resuelto. Consecuencia concreta y
asumida: **de este test saldrá primera sesión, pero no retención.** Si se quiere D1+, hay que
decidir esa deuda **antes** de la primera sesión, no después.

### 6.2 · Una trampa heredada, para que nadie mida desde ahí

`profiles.packs_opened`, `distinct_cards`, `collection_value` y `rarest_rank` están declarados
y protegidos por trigger, pero **no los escribe nadie**: valen 0 para siempre (deuda 6). El
contador vivo de sobres es `user_game.packs_opened`.

`session-observe` lo tiene en cuenta y lee de las tablas que sí se mueven. Está anotado en su
cabecera para que no se reintroduzca el error.

---

## 7 · PROBLEMAS OBSERVADOS EN USUARIOS

**PENDIENTE — no ha habido usuarios.**

Se rellenará con lo que se vea, no con lo que se sospeche.

## 8 · FRECUENCIA DE CADA PROBLEMA

**PENDIENTE.** Con 5–10 personas se cuentan *incidencias* (3 de 7), nunca porcentajes: esa
muestra sirve para encontrar problemas, no para medir tasas.

---

## 9 · PROBLEMAS P0

**De usuarios: ninguno, porque no ha habido usuarios.**

De preparación, **uno bloqueante para la validez del test, no para el producto**:

| # | Problema | Por qué es P0 |
|---|---|---|
| P0-A | La versión a probar está en un árbol con 717 ficheros sin commitear | Si cambia a mitad de la tanda, los participantes dejan de probar lo mismo y no hay forma de demostrar qué probó cada uno. Rompe la Fase 17D en su raíz |

**No se corrige aquí:** congelar exige commit/etiqueta, y la fase lo prohíbe. Es acción humana
(§14).

## 10 · PROBLEMAS P1

| # | Problema | Estado |
|---|---|---|
| P1-A | Los torneos y Pick'ems que verá el usuario son **contenido demo** (§2.2) | **Aceptado y documentado.** Corregirlo exige el puente VLR→BD, que es funcionalidad nueva |
| P1-B | No hay señal de retención: el test no podrá responder D1+ (§6.1) | **Aceptado.** Es la deuda 5, excluida por encargo |

## 11 · PROBLEMAS P2

| # | Problema | Estado |
|---|---|---|
| P2-A | Contadores de `profiles` muertos (deuda 6) | Documentado; `session-observe` los esquiva |
| P2-B | El único Pick'em figura `scored` pese a tener 5 preguntas abiertas | Cosmético: la puerta real es `locks_at` y funciona (§2.3). Puede confundir a quien lea la BD |
| P2-C | Sin fotos de jugador ni logos | El respaldo (sigilo/monograma) funciona; sin licencia no se tocan |

### 11.1 · Un P1 que se investigó y resultó NO ser del producto

`audit:stability` sacó en `dev` un P1 de navegación (`/mercado` → `/tienda`) que **no estaba
en las ejecuciones anteriores**. No se descartó como «cosa rara»: se reprodujo (salió 1 vez y
luego 2), se comprobó que `/mercado` **sí** enlaza a `/tienda` —o sea, camino real— y se
ejecutó la misma auditoría contra el build de producción.

**En producción: 0 P0 · 0 P1 · 0 P2.** Es un artefacto del modo desarrollo (§1.1), no un fallo
del producto, y **no se ha tocado ni una línea** para «arreglarlo». Lo que cambia es dónde se
corre la prueba.

---

## 12 · COMENTARIOS CUALITATIVOS

**PENDIENTE — no ha habido usuarios.**

Aquí irán las respuestas a las preguntas 15, 16, 17 y 18 con las palabras de cada persona,
sin parafrasear.

---

## 13 · DECISIONES QUE NO DEBEN TOMARSE TODAVÍA

Ninguna de estas tiene hoy evidencia que la sostenga. Tomarlas ahora sería construir sobre una
sospecha:

1. **No diseñar un tutorial.** Es la reacción natural a las preguntas 1–3, y es exactamente lo
   que la fase prohíbe anticipar. Primero hay que ver dónde se atasca la gente de verdad.
2. **No tocar la economía ni las recompensas.** No hay economía observada de personas: cero.
3. **No abrir el marketplace** (0 de los 200 jugadores del criterio) **ni activar payments.**
4. **No resolver las 8 deudas** — incluida la rama `base` de `engine.ts:215`, que es
   inalcanzable pero cuya reactivación es decisión de producto, no de ingeniería.
5. **No construir el puente VLR→BD** hasta decidir si el contenido competitivo real es
   requisito del producto o adorno. El test dará señal sobre eso (pregunta 18).
6. **No añadir analytics.** Ocho de doce métricas ya salen del libro mayor; de las cuatro que
   faltan, tres las responde una persona mirando.
7. **No cambiar nada entre participantes.** Si aparece un P0 real a mitad de la tanda, se para
   la tanda y se anota — no se parchea en caliente.

---

## 14 · RECOMENDACIONES PARA F18

### 14.1 · Lo que hay que hacer con las manos, antes de la primera sesión

1. **Congelar la versión** (P0-A). Una etiqueta o rama desde el árbol actual, y que nadie
   guarde un fichero hasta que termine la tanda. Sin esto el test no es defendible.
2. **Decidir la deuda 5** (señal de actividad diaria). Si se quiere retención, la tabla tiene
   que existir **antes** de que entre la primera persona; después no hay forma de recuperar el
   dato. Es una tabla de dos columnas, y sigue sin construirse por encargo expreso.
3. **Reclutar 5–10 personas** que no hayan participado en el desarrollo, con un reparto que
   cubra: conoce/no conoce el Valorant competitivo, ha jugado/no ha jugado juegos de cartas, y
   móvil (390 px)/escritorio.
4. **Resolver el acceso.** Hoy NEXUS corre en `127.0.0.1:3001`. O las sesiones son presenciales
   sobre esa máquina, o hace falta un despliegue — y desplegar está prohibido en esta fase.
   **Es la segunda decisión humana pendiente.**
5. **Arrancar en producción, no en desarrollo** (§1.1):

   ```
   npm run build
   npx next start -p 3001      ← NO `npm run dev`
   npm run audit:stability     ← debe dar 105 · 0 · 0 · 0 antes de empezar
   ```

6. **Preparar la grabación** y el consentimiento.

### 14.2 · Durante

- Una persona observa y anota; nadie más habla.
- Al terminar cada sesión: `npm run session:observe -- --user <nombre> --json` y se pega la
  salida en §4 del informe.
- **No se toca el producto entre participantes** (Fase 17D).

### 14.3 · Después

- Clasificar cada hallazgo por **frecuencia** (cuántas personas de N) antes que por gravedad.
- Corregir solo **P0/P1 o problemas repetidos y claramente demostrados**.
- Para cada uno, determinar antes si es copy, navegación, jerarquía, feedback, onboarding,
  información, estado vacío o bug — y corregir **la causa más pequeña posible**.

---

## 14 bis · F17C — EL PUENTE LIVE, COMPLETADO

`VLR real → importer-vlr → adaptador → syncTournament → Supabase → NEXUS` funciona de punta a
punta con `VCT 2026: EMEA Stage 2`. Los recuentos coinciden 1:1 con la fuente (§2.2).

**Dos bugs reales que solo una ejecución real podía destapar**, ambos preexistentes y ambos
corregidos:

| Bug | Síntoma | Causa |
|---|---|---|
| `events_circuit_id_fkey` | El primer sync murió en la primera escritura | `upsertCircuits` y `circuitRow` existían y **nadie los llamaba**; el circuito `vct` no estaba entre los diez sembrados |
| ACS decimal en columna `int` | `invalid input syntax for type integer: "219.5"` | `aggregatePlayerStats` promediaba el ACS entre mapas y `player_stats.acs` es `int` |

El primero falló **limpio**, sin escribir nada. Ninguno era visible antes porque la
sincronización **nunca había corrido**: `sync_state` estaba vacía.

Se corrigió además un tercer defecto que habría llegado al usuario: la sincronización escribía
el **id** del equipo en las columnas legacy que lee Pick'ems, así que un Pick'em real habría
preguntado *«¿quién gana vlr-t-2593 vs vlr-t-1001?»*. Arreglado en el mapper, **sin tocar
Pick'ems** (§2.3 bis).

### Ficheros de F17C

| Fichero | Motivo |
|---|---|
| `src/lib/esports/sync/vlrSnapshotSource.ts` (nuevo) | El adaptador entre las dos familias `Raw*` |
| `src/lib/esports/sync/mappers.ts` | `playerRow`; nombre legible en columnas legacy; `adr` medido |
| `src/lib/esports/sync/writers.ts` | `upsertPlayers` |
| `src/lib/esports/sync/orchestrator.ts` | Circuitos, alta de jugadores, `nameOf`, `SyncOptions`, `avgInt` |
| `src/lib/esports/sync/source.ts` | `RawMapPlayer.adr?` |
| `scripts/vlr-sync.ts` (nuevo) | CLI con dry run obligatorio y evento demo protegido |

**Sin migraciones.** Diff real: +139 / −10.

---

## 15 · QUÉ SE HA TOCADO EN ESTA FASE

| Fichero | Motivo |
|---|---|
| `scripts/session-observe.ts` (nuevo) | Instrumento de **solo lectura** para reconstruir la primera sesión desde tablas existentes |
| `package.json` | Una línea: `session:observe` |
| `docs/product/phase-17-report.md` (nuevo) | Este informe |

**Cero ficheros de `src/`.** Ningún motor, esquema, migración, telemetría, economía, UX,
navegación, pipeline ni contenido. Ninguna de las 8 deudas resuelta. Sin commit, sin push, sin
despliegue.
