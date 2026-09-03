# FASE 16 — REAL USER VALIDATION & LIVE TOURNAMENT

> El pipeline de torneos llevaba tiempo terminando en verde y devolviendo **cero
> estadísticas**. Se ha descubierto con un torneo real, se ha arreglado, y ahora un torneo
> real genera cartas reales.
>
> Y sobre usuarios reales, la respuesta honesta de esta fase es: **NO HAY DATOS
> SUFICIENTES.** No hay ni un solo usuario real en el sistema. Abajo está qué habría que
> medir, con qué, y por qué no se ha construido todavía.

---

## 0 · RESUMEN

| Objetivo | Resultado |
|---|---|
| 1 · Real user test | **Protocolo entregado.** Cero personas probadas: no hay usuarios |
| 2 · First session | **Las 11 métricas clasificadas.** 6 medibles hoy sin instrumentar, 5 no |
| 3 · Retención | **NO HAY DATOS SUFICIENTES.** Y falta además el dato que la haría medible |
| 4 · Torneo real | **HECHO.** VCT 2026 EMEA Stage 2 completo. Y destapó un P1 |
| 5 · Las 9 variantes | **6 de 9 se llenan con datos reales.** Trazadas una a una |
| 6 · Artwork | Auditado. Sin licencia ⇒ sin fotos. El respaldo ya existe |
| 7 · Las 8 deudas | 1 desbloqueada (torneo real), 7 siguen. Ninguna forzada |
| 8 · Prestige | **Medible hoy sin instrumentar.** Cero compras: cero usuarios |
| 9 · Economía real | Modelada sí, observada no. Cero transacciones de una persona |
| 10 · Marketplace | Cerrado. No tocado. Criterios intactos |
| 11 · Payments | Apagado. No tocado |
| 12 · Segunda moneda | No creada |
| 13 · Telemetría | Auditada. Falta UNA cosa, y se propone sin construirla |
| 14 · UX por comportamiento | Sin comportamiento que observar. Nada cambiado por suposición |

**Correcciones realizadas: 2.** Una P1 —una sola causa que cierra los 3 hallazgos P1 de §19:
el parser roto, su silencio y la verificación que no podía verlo— y una P2 pedida
expresamente: el fixture de `tournament-orchestrator:verify`. **Features añadidas: 0.**

---

## 1 · AUDITORÍA INICIAL

### 1.1 · Lo primero: ¿con qué se está trabajando de verdad?

Antes de diseñar nada, un censo de la base de datos del entorno auditado.

```
profiles              8      duel_matches          2      generated_cards       0
user_cards           35      duel_decks            1      card_reference        0
user_packs           17      pickem_submissions    1      players               0
credit_transactions  28      pickem_answers        0      player_stats          0
economy_ops          14      tournaments           0      sync_state            0
market_listings       0      events                1      payments              0
```

Y los ocho perfiles, uno por uno:

```
econdmtkc125x_d573   nivel 1   0 cartas   0 sobres abiertos
econcmtke2t6q_43db   nivel 1   0 cartas   0 sobres abiertos
econdmtkfk6o3_5abd   nivel 1   0 cartas   0 sobres abiertos
econcmtkh7t5w_98a2   nivel 1   0 cartas   0 sobres abiertos
NEXUSDemo_2f86       nivel 1   0 cartas   0 sobres abiertos
econbmtkktdfz_01b3   nivel 1   0 cartas   0 sobres abiertos
econcmtkktdrw_e448   nivel 1   0 cartas   0 sobres abiertos
econcmtklog74_035b   nivel 1   0 cartas   0 sobres abiertos
```

**Los ocho los creó un script.** Los `econ*` los crea `economy:verify`; `NEXUSDemo` lo crea
la semilla. Ninguno lo abrió una persona.

*(Este censo es del arranque de la fase. Al terminarla eran diez, porque la propia batería de
verificación crea cuentas al ejecutarse — ver el aviso de §9.2.)*

El libro mayor lo confirma:

```
starter_grant           8 ·  +48.000    (el alta automática)
qa_fund                 7 ·  +40.000    (fondos que un script se da a sí mismo)
market_buy:yuran…       7 ·   −2.300
buy_pack:premium        1 ·   −2.500
duel_win                2 ·      +440
qa_empty                1 ·   −6.000
market_sell:yuran…      1 ·      +300
market_fee              1 ·       −15
```

De 28 movimientos, **16 son de instrumentación pura** (`starter_grant`, `qa_fund`,
`qa_empty`). El resto los hicieron scripts de verificación. **Cero los hizo una persona.**

> **Consecuencia, y conviene decirla antes que nada:** todo lo que esta fase pedía medir
> sobre *personas* —retención, sesiones, abandono, deseo de prestigio, economía observada—
> **no tiene sustrato**. La regla absoluta prohíbe fabricarlo. No se ha fabricado.

### 1.2 · El único torneo del sistema era de mentira

```json
{ "id": "demo-masters-madrid-2026", "name": "DRL Masters Madrid 2026", "source": "demo" }
```

`tournaments: 0` · `players: 0` · `player_stats: 0` · `generated_cards: 0` · `sync_state: 0`.

**El pipeline VLR nunca se había ejecutado contra datos reales en este entorno.** Eso
convirtió el Objetivo 4 en la prioridad real de la fase — y acertó, porque ahí estaba el
fallo.

### 1.3 · Lo que sí es real: el catálogo

El catálogo no vive en la base de datos, vive en código, y ahí sí hay contenido real:

```
jugadores: 379   (371 filas del roster VLR)
cartas:    772
variantes:  37   ·  25 con cartas  ·  12 vacías
```

---

## 2 · METODOLOGÍA DE USER TESTING

### 2.1 · La regla que ordena esta parte

> *«NO quiero que el sistema dé las respuestas. Queremos observar al usuario.»*

La Fase 15 construyó `npm run ftue:audit`, y es una buena herramienta, pero mide otra cosa:
**qué le PROPONE el producto** a una cuenta nueva. No mide qué hace una persona. Ninguna
herramienta puede. Lo que sigue es un **protocolo para una persona observando a otra**, no
un script.

### 2.2 · Perfil de los participantes

Seis personas que no hayan visto NEXUS. Tres ejes, porque son los que cambian las respuestas
a las 15 preguntas:

| Eje | Reparto |
|---|---|
| Conoce el Valorant competitivo (VCT, equipos, jugadores) | 3 sí · 3 no |
| Ha jugado juegos de cartas coleccionables | 3 sí · 3 no |
| Dispositivo | 3 móvil (390 px) · 3 escritorio |

Seis bastan para encontrar problemas de comprensión y **no** bastan para medir tasas. Esa
distinción se respeta: de un test así salen *hallazgos*, nunca porcentajes.

### 2.3 · Preparación

1. Cuenta **real y nueva** por participante — lo que concede `handle_new_user`: 6.000
   créditos, 3 Sobres Iniciales, 1 Estándar, cero cartas. Sin sembrar. Sin excepciones.
2. **Sin tutorial hablado.** El facilitador no explica nada. La primera pregunta se responde
   sola o no se responde.
3. **Pensar en voz alta.** Es de donde salen las respuestas a las 15 preguntas.
4. Grabación de pantalla y audio, con consentimiento. Nada más.
5. Duración: hasta que la persona pare por su cuenta, o 45 minutos.

### 2.4 · El guion: tres tareas y ni una instrucción de más

| # | Lo que se dice, literal | Qué mide |
|---|---|---|
| 1 | *«Esto es NEXUS. Adelante.»* — y nada más, 10 minutos | Preguntas 1, 2, 14 |
| 2 | *«Juega una partida.»* | Preguntas 3–8 |
| 3 | *«Haz lo que harías si esto fuera tuyo.»* — hasta que pare | Preguntas 9–13, 15 |

Al final, y **solo** al final, tres preguntas abiertas: ¿qué es NEXUS, con tus palabras?
¿volverías mañana, y a hacer qué? ¿qué te ha molestado?

### 2.5 · Las 15 preguntas: cómo se responde cada una

Esto es lo que hace auditable el protocolo.

| # | Pregunta | Cómo se responde | Fuente |
|---|---|---|---|
| 1 | ¿Entiende qué es NEXUS? | Su definición al final, sin ayuda | Observación |
| 2 | ¿Entiende qué hacer primero? | Primer clic deliberado, y si duda | Observación |
| 3 | ¿Abre sus sobres? | Llega o no a `/abrir/[packId]` | **DB** `economy_ops` kind=`open_pack` |
| 4 | ¿Consigue cartas? | Sí/no y cuántas | **DB** `user_cards` |
| 5 | ¿Entiende la colección? | Sabe decir qué le falta | Observación |
| 6 | ¿Entiende construir un mazo? | Termina un mazo legal sin ayuda | **DB** `duel_decks` + observación |
| 7 | ¿Entiende Duelos? | Sabe qué decide el resultado | Observación |
| 8 | ¿Entiende por qué gana o pierde? | Lo explica al terminar el duelo | Observación |
| 9 | ¿Entiende Pick'ems? | Sabe qué predice y qué gana | **DB** `pickem_submissions` + observación |
| 10 | ¿Entiende eventos? | Sabe qué caduca y qué no | Observación |
| 11 | ¿Entiende créditos? | Sabe de dónde salen y en qué se van | Observación |
| 12 | ¿Entiende progresión? | Sabe qué sube y para qué sirve | Observación |
| 13 | ¿Entiende su perfil? | Sabe qué es suyo y qué se enseña | Observación |
| 14 | ¿Encuentra un objetivo? | Lo enuncia sin que se lo pregunten | Observación |
| 15 | ¿Tiene razón para volver? | La nombra, y es concreta | Observación |

**11 de 15 son puramente observacionales.** Ninguna instrumentación las resuelve, y añadir
telemetría para intentarlo sería construir justo la plataforma que el Objetivo 13 prohíbe.

### 2.6 · Estado

**Participantes probados: 0.** El protocolo está listo; ejecutarlo requiere seis personas y
una sala, no código. **No se han inventado resultados.**

---

## 3 · FIRST SESSION — QUÉ SE PUEDE MEDIR HOY Y QUÉ NO

El objetivo pedía no inventar métricas y documentar primero la instrumentación que falte.
Esta es la auditoría contra el esquema real. `t₀` = `profiles.created_at`.

### 3.1 · Medibles HOY, sin tocar una línea

| Métrica | Consulta |
|---|---|
| Tiempo hasta primera carta | `MIN(user_cards.obtained_at) − t₀` |
| Tiempo hasta primer sobre abierto | `MIN(economy_ops.created_at)` con `kind='open_pack'` |
| Tiempo hasta primer mazo | `MIN(duel_decks.created_at) − t₀` |
| Tiempo hasta primer duelo | `MIN(duel_matches.created_at) − t₀` |
| Tiempo hasta primera recompensa | `MIN(credit_transactions.created_at)` con `delta>0` y `reason≠'starter_grant'` |
| Tiempo hasta primer Pick'em | `MIN(pickem_submissions.created_at) − t₀` |

Seis de las once, **ya disponibles**. El libro mayor y las marcas de tiempo por fila hacen el
trabajo que en otros productos hace una plataforma de analítica.

### 3.2 · NO medibles hoy, y por qué

| Métrica | Por qué no |
|---|---|
| Tiempo total de sesión | No existe señal de sesión. Ni `last_seen`, ni inicio, ni fin |
| Puntos donde abandona | Haría falta saber en qué pantalla estaba. No se registra ninguna |
| Acciones repetidas | Solo se ven las que mueven saldo. Repetir sin transaccionar no deja rastro |
| Errores de navegación | No hay registro de navegación |
| Pantallas que no entiende | **Nunca** será telemetría. Es observación |

> **Decisión: no se instrumenta en esta fase.** Con cero usuarios reales, una tabla de
> eventos nueva recogería exactamente cero filas y habría que rediseñarla en cuanto se
> supiera qué preguntar. La propuesta mínima está en §17.5, escrita y sin construir.

---

## 4 · FTUE

Ejecutado en esta fase sobre una cuenta **recién creada de verdad**:

```
0 P0 · 0 P1 · 0 P2
P3 · 1   /coleccion   faltan 4+ fotos de jugador (artwork sin descargar; hay respaldo visual)
móvil 390: 0 px de desbordamiento
```

Los tres fallos que encontró la Fase 15 —Pick'ems propuestos antes de tener cartas, «construye
tu mazo» enlazando a la Tienda, el constructor mandando a la Tienda en vez de al Inventario—
siguen corregidos y no han reaparecido. El único hallazgo es el P3 de artwork de §12, que
tiene respaldo y no se resuelve sin licencia.

**No se ha tocado nada de FTUE en esta fase.** Sin usuarios reales que revelen un problema
nuevo, cualquier cambio sería una suposición, y el Objetivo 14 lo prohíbe expresamente.

---

## 5 · RETENCIÓN

### 5.1 · El resultado

# NO HAY DATOS SUFICIENTES.

Cero usuarios reales. Cero sesiones de personas. El día 0 no ha ocurrido para nadie.

### 5.2 · Y hay algo peor que la falta de población

Aunque mañana entrasen 200 personas, **la retención seguiría sin poder medirse**, porque no
existe ninguna señal de «este usuario volvió».

Lo que hoy deja rastro un día cualquiera:

| Señal | Tabla | ¿Basta? |
|---|---|---|
| Compró o abrió un sobre | `economy_ops` | Solo si transacciona |
| Jugó un duelo | `duel_matches` | Solo si juega |
| Envió un Pick'em | `pickem_submissions` | Solo si predice |
| Cobró créditos | `credit_transactions` | Solo si cobra |

**Quien abre NEXUS, mira su colección, se lo piensa y se va, no deja ni una fila.** Y es
exactamente el usuario que más interesa observar en un producto de coleccionismo.

Lo medible hoy no es retención: es **recurrencia de acciones que mueven saldo**. Es otra
cosa, y siempre da un número más bajo del real.

### 5.3 · Qué debería medirse (D0 · D1 · D3 · D7 · D14)

Con la señal de actividad de §17.5 en su sitio, y ni un día antes:

| Métrica | Fuente |
|---|---|
| Usuarios que vuelven | `user_activity_days` — **no existe** |
| Sesiones | Requiere señal de sesión (más cara; ver §17.5) — **no existe** |
| Duelos | `duel_matches` ✅ ya |
| Sobres abiertos | `economy_ops` kind=`open_pack` ✅ ya |
| Cartas obtenidas | `user_cards.obtained_at` ✅ ya |
| Pick'ems realizados | `pickem_submissions` ✅ ya |
| Eventos visitados | Requiere señal de navegación — **no existe** |
| Maestría conseguida | Derivable de `user_cards` ✅ ya |
| Prestigio comprado | `credit_transactions.reason LIKE 'prestige:%'` ✅ ya |
| Créditos gastados | `credit_transactions` con `delta<0` ✅ ya |
| Créditos creados | `credit_transactions` con `delta>0` ✅ ya |

**Ocho de once ya son medibles.** Faltan tres, y una sola tabla resolvería la importante.

---

## 6 · TORNEO REAL — LA PRIORIDAD DE LA FASE

### 6.1 · Elegir un torneo de verdad, no uno cómodo

El pipeline es el que ya existía, sin duplicar nada:

```
URL vlr.gg → Importer VLR → Importer → Analyzer → Performance →
Card Generator → Materializer → Catalog Builder → Publisher
```

El primer intento fue **Valorant Champions 2026** (`/event/2766`):

```
✓ 9 equipos   ✓ 45 jugadores   ✓ 0 partidos   ✓ 0 mapas   → 1 carta
```

Cero partidos. Y estaba **bien**: el importador devolvió `status: "upcoming"`, con
`startDate 2026-09-24`. Hoy es el 3 de septiembre. **El torneo aún no se ha jugado, y el
sistema lo dijo en vez de inventárselo.** Eso es exactamente lo que debe hacer.

Así que hacía falta un torneo **terminado**. Se probaron tres regionales:

| Torneo | Estado | Partidos |
|---|---|---|
| VCT 2026: Americas Stage 2 | `upcoming` (acaba el 07-09) | 60 |
| VCT 2026: Pacific Stage 2 | `upcoming` (acaba el 06-09) | 60 |
| **VCT 2026: EMEA Stage 2** | **`finished`** (15-07 → 30-08) | **60** |

**VCT 2026: EMEA Stage 2** — Olimpic Arena, Badalona · 250.000 $ · 16 equipos · 84
jugadores · 60 partidos · 146 mapas. Real, terminado y con palmarés.

### 6.2 · Lo que pasó al ejecutarlo: verde, y mal

```
Tournament: VCT 2026: EMEA Stage 2
✓ 16 equipos   ✓ 84 jugadores   ✓ 60 partidos   ✓ 146 mapas
✓ 1 cartas generadas
✓ Runtime actualizado
Pipeline completado correctamente.
```

**Sesenta partidos reales, ciento cuarenta y seis mapas reales, y UNA carta.** El pipeline
declaró éxito. Cero avisos. Cero errores.

Esa única carta era `avez__mythic`, y venía con dos pistas escritas en ella:

```
"issues": ["sin foto", "muestra estadística baja"]
"confidence": 0.83
```

### 6.3 · El diagnóstico

Bajando por las etapas, el modelo canónico decía:

```
model: { teams: 16, players: 84, matches: 60, maps: 146, mapStats: 0 }
```

**146 mapas y cero filas de scoreboard.** Y el informe del Analyzer, por tanto:

```json
{ "playerId": "p:avez", "maps": 0, "acs": 0, "kills": 0, "deaths": 0,
  "rating": 0, "hsPct": 0, "assists": 0, "clutches": 0, "mvpScore": 13 }
```

**Los 84 jugadores tenían TODAS las métricas a cero.** Los 84. El único número distinto de
cero, `mvpScore: 13`, sale de los roles deducidos de los agentes jugados — no del
rendimiento. Es decir: **el MVP de aquel torneo se estaba decidiendo por qué personajes
eligió la gente, no por cómo jugó.**

Y sin `maps > 0` no hay líderes. La regla `leader-*` filtra por `p.maps > 0`, así que las
cinco variantes de liderato no podían dispararse jamás.

### 6.4 · La causa, y es doble

**a) El parser del scoreboard ya no entendía la página.** vlr.gg cambió el scoreboard de
`<table class="wf-table-inset mod-overview">` a `<div>`. Medido sobre una página real:

```
class="wf-table-inset mod-overview"   →   0     (lo que el parser buscaba)
<table …>                             →   0     (no queda NI UNA tabla en la página)
class="ovw-kda-stat…"                 → 108
class="stats-sq"                      → 270
class="ovw-table"                     →   6     (3 bloques × 2 equipos)
class="ovw-row"                       →  30     (6 tablas × 5 jugadores)
```

**b) Y nada lo dijo.** `importer-vlr:verify` es 100 % offline y usa un fixture con el markup
**antiguo**. Pasaba 52/52 mientras el conector real devolvía cero filas.

> Es el mismo fallo de método que encontró la Fase 15 con las cuentas sembradas, en otro
> sitio: **la verificación validaba una realidad que había dejado de existir.** Un fixture
> congelado no puede detectar que la fuente cambió — por definición.

Conviene ser exacto sobre qué seguía funcionando, porque casi todo funcionaba:

| Parser | Estado real |
|---|---|
| Página de evento (equipos, fechas, premio, sede) | ✅ correcto |
| Página de `/event/stats/` (84 filas, métricas completas) | ✅ correcto |
| Página de partido: mapas, marcadores, veto, ganador | ✅ correcto |
| Página de partido: **scoreboard por jugador** | ❌ **0 filas** |

Un solo parser roto de cuatro, y bastaba para vaciar de sentido el pipeline entero.

### 6.5 · La corrección

Es la más pequeña que resuelve la causa, y no toca ningún motor.

**1. `src/importer-vlr/maps.ts` — leer los dos markups.** El actual (`div.ovw-table` ›
`div.ovw-row` › `div.ovw-cell[data-col]`) y el antiguo (`<tr>` con `td.mod-stat`). El camino
nuevo identifica cada celda **por nombre** (`data-col`), no por posición, que es lo que
impide que un cambio de orden de columnas se convierta en estadísticas silenciosamente
equivocadas. K/D/A viven anidados en `span.ovw-kda-stat[data-col]` y se leen igual.

**2. `src/importer-vlr/engine.ts` — que deje de ser silencioso.** Si se leen mapas y salen
cero filas de scoreboard, ahora hay aviso explícito:

> *N mapas leídos y NINGUNA fila de scoreboard: el markup de la página de partido
> probablemente ha cambiado. Sin estas filas, todas las estadísticas por jugador serán cero.*

**3. `scripts/importer-vlr-verify.ts` — cubrir el markup actual.** Seis comprobaciones
nuevas, con el markup real de vlr.gg copiado de una página viva. La que importa:

> *markup actual ⇒ MISMAS estadísticas que el legacy (celdas por nombre, no por posición)*

Compara los dos snapshots **byte a byte**. Si algún día divergen, salta.

**Lo que NO se ha tocado:** ni el Analyzer, ni el Card Generator, ni el ruleset, ni OVR, ni
stats, ni pricing, ni el catálogo. La regla de no regresión se respeta entera. El fallo
estaba en el parser, y solo se ha tocado el parser.

### 6.6 · El mismo torneo, después

```
mapStats:  0  →  1460
```

Y el reparto no deja lugar a dudas de que lo leído es lo que hay, ni una fila de más:

```
146 mapas · 1.460 filas       → exactamente 10,000 por mapa
mapas con ≠ 10 filas          → 0        (mín 10 · máx 10)
filas con acs/kills/rating nulos → 0
equipos distintos en las filas → 16      (los 16 del torneo)
avisos                        → 0
```

Y con ello, los premios pasan a decidirse con rendimiento real:

| | Antes (sin stats) | Después (con stats reales) |
|---|---|---|
| MVP | Avez — `mvpScore 13` | **Kachoww** — `mvpScore 57` |
| Mejor duelista | — | Kachoww (93) |
| Mejor controlador | — | Riens (88) |
| Mejor centinela | Avez (35) | Nats (32) |
| Mejor iniciador | — | Riens (93) |
| Mejor entrada | Avez (10) | Kachoww (98) |
| Mejor apoyo | — | Riens (91) |
| Cartas generadas | **1** | **6** |

Y los líderes del torneo, extraídos de los 1.460 scoreboards reales:

```
rating    → Kachoww    (Fire Flux Esports)   maps=16
acs       → Kachoww    (Fire Flux Esports)   264   maps=16
hsPct     → al0rante   (PCIFIC Esports)       44   maps=18
kills     → kamo       (Team Liquid)         486   maps=27
assists   → sociablEE  (FUT Esports)         235   maps=27
clutches  → —          0 en todos            (ver §7.3)
```

### 6.7 · Auditoría de los 14 puntos del objetivo

| # | Punto | Estado |
|---|---|---|
| 1 | Torneo | ✅ Real, `finished`, con sede, fechas y premio correctos |
| 2 | Partidos | ✅ 60, con marcador, fase, ronda y ganador |
| 3 | Preguntas | ⚠️ El ciclo de Pick'ems corre en `orchestrator`, no en `tournament:generate` |
| 4 | Pick'ems | ⚠️ Igual que 3: es el otro camino del pipeline |
| 5 | Match Challenges | ❌ Bloqueado: `matches` no guarda mapa ni MVP (deuda 5) |
| 6 | Resultados | ✅ 146 mapas con marcador, veto y ganador |
| 7 | Corrección | ⚠️ No ejercitada: exige un Pick'em abierto sobre ESTE torneo |
| 8 | Recompensas | ⚠️ Igual que 7 |
| 9 | Progresión | ⚠️ Igual que 7 |
| 10 | Contenido generado | ✅ 6 cartas, con su traza y su evidencia |
| 11 | Cartas | ✅ Materializadas, catálogo v2026.1.0, runtime publicado |
| 12 | Variantes | ✅ 6 de las 9 vacías (§7) |
| 13 | Perfil | — Sin usuarios, no hay perfil que mirar |
| 14 | Eventos | ✅ El evento se importa con circuito, fase, sede y premio |

**Nada de lo marcado ⚠️ se ha forzado.** Ejercitar corrección, recompensas y progresión
exige un Pick'em abierto sobre este torneo antes de que terminase, y **crearlo ahora sería
fabricar un resultado deportivo**, que la regla absoluta prohíbe.

---

## 7 · LAS 9 VARIANTES

### 7.1 · Cuáles son, exactamente

De las 37 variantes, 12 están vacías. Tres lo están por otros motivos —`americas-mvp`,
`game-changers` y `hall-of-fame`, que son las deudas 1 y 2 de §13.
**Las nueve que dependen del pipeline de torneos** son estas, y el mapa
`accolade → variante` está en `variantsForAccolade`:

```
tournament-mvp        → mythic             tournament-top-acs     → top-acs
tournament-champion   → champion-edition   tournament-top-rating  → top-rating
tournament-rookie     → rookie             tournament-top-hs      → top-hs
tournament-clutch     → clutch             tournament-top-kills   → top-kills
                                           tournament-top-assists → top-assist
```

### 7.2 · Seis se llenan. Con datos reales, y aquí está la traza

Formato exigido por el objetivo: **torneo → condición → jugador → galardón → variante → carta.**

| Torneo | Condición (evidencia literal del motor) | Jugador | Galardón | Variante | Carta | OVR |
|---|---|---|---|---|---|---|
| VCT 2026 EMEA Stage 2 | `award mvp (mvpScore 57)` | Kachoww | `tournament-mvp` | `mythic` | `kachoww__mythic` | 97 |
| VCT 2026 EMEA Stage 2 | `líder del torneo en rating (60)` | Kachoww | `tournament-top-rating` | `top-rating` | `kachoww__top-rating` | 96 |
| VCT 2026 EMEA Stage 2 | `líder del torneo en acs (264)` | Kachoww | `tournament-top-acs` | `top-acs` | `kachoww__top-acs` | 95 |
| VCT 2026 EMEA Stage 2 | `líder del torneo en kills (486)` | kamo | `tournament-top-kills` | `top-kills` | `kamo__top-kills` | 90 |
| VCT 2026 EMEA Stage 2 | `líder del torneo en assists (235)` | sociablEE | `tournament-top-assists` | `top-assist` | `sociablee__top-assist` | 82 |
| VCT 2026 EMEA Stage 2 | `líder del torneo en hsPct (44)` | al0rante | `tournament-top-hs` | `top-hs` | `al0rante__top-hs` | 77 |

**Seis variantes que llevaban vacías desde la Fase 13 se llenan con un torneo real.** Ni un
premio inventado: cada fila lleva la evidencia que emitió el motor, y esa evidencia sale de
1.460 scoreboards descargados de vlr.gg.

`mythic` es la variante más rara del juego (rango 16, `statBoost` 7, 25 seriales). La ha
ganado el MVP real de un torneo real.

### 7.3 · Las otras tres, y qué dato real falta en cada una

Aquí aparece un patrón que merece decirse antes que los tres casos: **el esquema canónico ya
tiene sitio para los tres datos que faltan.** No es una limitación de diseño. Es que el
conector VLR no rellena tres campos que ya existen:

```
RawPlayer.status          → nunca se rellena   (bloquea rookie)
RawMapPlayerStat.clutches → nunca se rellena   (bloquea clutch)
RawSnapshot.standings / RawAwards.champion → nunca se rellenan (bloquea champion-edition)
```

Y no son tres casos iguales: uno es dato ausente en la fuente, otro es dato ausente en esa
página concreta, y el tercero es dato **presente y no leído**.

**`clutch` ← `tournament-clutch` ← `award best-clutch`**
`analyzer/awards.ts:34` lo concede al líder en `clutches` con umbral 1. Medido: `clutches = 0`
en los 84 jugadores. La razón es concreta: **el scoreboard por mapa de vlr.gg no tiene columna
de clutch.** Sus columnas reales son `rating2 · acs · kills · deaths · assists · kd-diff ·
kast · adr · hsp · fb · fd · fk-diff`, y ahí no está. La página `/event/stats/` sí la trae
(`data-col="cl"` y `"clp"`), pero son **agregados de todo el torneo**, y el modelo solo
ingiere filas por mapa. Repartir un agregado entre mapas sería **inventar estadísticas**.
→ *No resoluble sin cambiar qué ingiere el modelo. Documentado.*

**`rookie` ← `tournament-rookie` ← `award best-rookie`**
Corrijo aquí una suposición que no resistió la comprobación: **no depende del historial.**
`analyzer/awards.ts:41` solo concede el premio si el `status` del jugador en el modelo
contiene «rookie» — y si no lo evidencia, **omite el premio a propósito**. El campo
`RawPlayer.status` existe; el conector VLR no lo rellena, y las páginas que descarga no
publican esa condición. → *Haría falta una fuente de rósters o autoría editorial.
Documentado.*

**`champion-edition` ← `tournament-champion` ← `narrativeTag champion (roster)`**
Este es el distinto, y el más accionable. `analyzer/team.ts:49` busca
`model.awards.championTeamId` o `model.standings[position = 1]`. El conector **no importa
standings ni placements**: `toRawSnapshot` no devuelve ninguno de los dos.

Y el dato **está en la página que el conector ya descarga**. Literal, del HTML del evento:

```
Prize Distribution
Place    Prize        Team            Points
1st      $100,000     Karmine Corp    Europe
```

Es decir: el campeón de VCT 2026 EMEA Stage 2 es **Karmine Corp**, está publicado, el conector
lo tiene delante y no lo lee. (Coherente con lo que sí salió: el premio `best-team` fue para
`t:karminecorp`, aunque por winrate, no por título.)

Deducirlo como «ganador del último partido de playoffs» sería una inferencia que puede
equivocarse; **parsear la tabla de clasificación no lo sería**. → *Resoluble, y es una
capacidad nueva del conector. Por eso se decide en la Fase 17 y no se cuela en una fase que
prohíbe features.*

### 7.4 · Resumen

| | Antes de la fase | Después |
|---|---|---|
| Variantes de torneo llenadas **con datos reales** | 0 | **6** |
| Bloqueada por dato que **no existe** en el scoreboard de la fuente | 9 | 1 · `clutch` |
| Bloqueada por dato que **la fuente no publica** | — | 1 · `rookie` |
| Bloqueada por dato **publicado y no leído** | — | 1 · `champion-edition` |

---

## 8 · DUELOS · COLECCIÓN · PACKS · PICK'EMS · EVENTOS · MATCH CHALLENGES

Los seis sistemas están construidos y verificados. Lo que esta fase podía aportar sobre
ellos era **comportamiento observado**, y no hay ninguno. Así que lo que sigue es lo que sí
se ha comprobado: que siguen en pie y qué se sabría de ellos en cuanto haya una persona.

| Sistema | Estado técnico | Qué se sabría de un usuario real, y con qué |
|---|---|---|
| **Duelos** | `duel:e2e` ✅ · `duel-gameplay` ✅ | Si juega y cuándo: `duel_matches`. Si entiende **por qué** gana: solo observación |
| **Colección** | 772 cartas · 77 conjuntos | Qué tiene: `user_cards`. Si entiende qué le falta: observación |
| **Packs** | `economy:verify` ✅ · reparto medido en tienda desde la Fase 13 | Compras y aperturas: `economy_ops`. Si entiende el reparto: observación |
| **Pick'ems** | `test:pickems` ✅ | Si participa: `pickem_submissions`. Si entiende qué gana: observación |
| **Eventos** | `events:verify` ✅ | ❌ **Nada.** Visitar un evento no deja rastro (§5.2) |
| **Match Challenges** | Construido | Bloqueado por la deuda 5 (`matches` sin mapa ni MVP) |

**Ninguno se ha modificado.** El motor de combate, el CombatPlan, los bots, el RNG, el OVR,
las stats, el CardRegistry, las recompensas de duelo y el rango están intactos, como exige
la regla de no regresión.

Una nota concreta y medible sobre **eventos**: es el único de los seis del que hoy no se
sabría **absolutamente nada**. Duelos, packs y Pick'ems dejan fila; visitar un evento y
marcharse, no. Si alguna instrumentación llegara a justificarse, ese es el primer sitio.

---

## 9 · ECONOMÍA REAL

### 9.1 · Lo modelado

`economy:model` y `economy:simulate` siguen ejecutándose y dando lo mismo que en la Fase 12
(no se ha tocado ni un precio, ni una probabilidad, ni una recompensa):

```
Casual      62 % del catálogo · una carta nueva cuesta ya    249 cr · 0,3 sobres
Activo      57 % del catálogo · una carta nueva cuesta ya    841 cr · 0,3 sobres
Intensivo   91 % del catálogo · una carta nueva cuesta ya   1609 cr · 0,6 sobres

rare         1693 cr    ·  16.926 acumulado  ·   23 sobres
epic         5097 cr    ·  50.972 acumulado  ·   68 sobres
legendary   20.696 cr   · 206.964 acumulado  ·  276 sobres
```

### 9.2 · Lo observado

Al terminar la fase, y sobre el total acumulado de la base de datos:

| Medida | Observado | De personas |
|---|---|---|
| Créditos creados | 130.740 — de los cuales **130.000** son alta automática, fondos de QA y un ajuste de admin | **0** |
| Créditos destruidos | 11.115 — **todos** de scripts | **0** |
| Compras de sobres | 1 (`buy_pack`) | **0** |
| Sobres abiertos | 5 (`open_pack`) | **0** |
| Cartas obtenidas | 46 — 26 de sobre, 12 de admin, 8 de mercado | **0** |
| Duelos | 2 | **0** |
| Pick'ems enviados | 1 | **0** |
| Salvage | 0 | 0 |
| Prestigio | 0 | 0 |
| Marketplace | 0 — cerrado, como debe | 0 |

> **Aviso de método, y es importante para leer estas cifras:** los números de §1 son el censo
> al **empezar** la fase; estos son al **terminarla**. Han cambiado porque **la propia batería
> de verificación crea cuentas y mueve saldo**: durante esta sesión aparecieron dos perfiles
> nuevos (`econdmtl92wbb_605a`, `auditor_7659`), ambos de scripts. Que las cifras de «actividad»
> suban al ejecutar los tests, y solo entonces, **es la demostración más directa de que aquí
> no hay ni un usuario**.

### 9.3 · La comparación que pedía el objetivo

**No se puede hacer.** Comparar economía modelada con economía observada exige una economía
observada, y aquí no hay ninguna: **cero sobres abiertos por una persona**. El modelo predice
el comportamiento de un jugador; lo registrado es el comportamiento de un script.

**No se ha cambiado ningún precio.** El objetivo lo prohibía explícitamente sobre muestra
pequeña, y esta muestra no es pequeña: es inexistente.

---

## 10 · PRESTIGE

`PRESTIGE_TIERS` sigue exactamente igual — **no se ha tocado ningún precio**, como exigía el
objetivo:

```
plata   15.000    oro   40.000    élite  100.000       total por conjunto: 155.000
```

### 10.1 · Buena noticia de método: ya es medible entero

Las cuatro cosas que el objetivo pedía registrar **no necesitan instrumentación nueva**,
porque la Fase 14 dejó el rastro en el sitio correcto:

| Qué registrar | Dónde ya está |
|---|---|
| Prestige purchases | `economy_ops` con `kind='buy_cosmetic'` |
| Credits spent | `credit_transactions` con `reason LIKE 'prestige:%'` |
| Sets selected | El propio `reason` lleva el conjunto **y** el escalón: `prestige:insignia:equipo:100t:oro` |
| Sets completed | Derivable de `user_cards` con `masterySets()` |

Que el motivo del apunte contable identifique el conjunto y el escalón es lo que hace que
«¿qué conjuntos prefieren?» sea una consulta, y no un proyecto.

### 10.2 · Lo observado

**Compras de prestigio: 0.** Créditos gastados en prestigio: 0. Conjuntos completados: 0.

Las siete preguntas del objetivo —¿lo entienden? ¿lo desean? ¿lo compran? ¿qué conjuntos
prefieren? ¿hay decisiones? ¿se percibe como prestigio o como impuesto?— **son todas
observacionales o requieren compras que no existen.**

# NO HAY DATOS SUFICIENTES.

Y no se ha regalado nada para forzar uso, como el objetivo prohibía.

---

## 11 · LIVE CONTENT

El pipeline VLR está intacto y **no se ha duplicado**: la corrección de §6.5 toca un parser
dentro del conector existente, no crea un camino nuevo.

Lo que esta fase demuestra sobre live content, con medición:

- La cadena completa funciona de punta a punta contra **la fuente real**, no contra fixtures.
- Un torneo **que aún no se ha jugado** produce cero partidos y lo dice, en vez de rellenar.
- Un torneo **terminado** produce 60 partidos, 146 mapas, 1.460 scoreboards y 6 cartas.
- Publicar es **idempotente**: el Publisher conserva su transacción y su rollback.
- Ejecutar `tournament:generate` **no escribe en disco**: `persist` es opcional y no se pasa.
  Todo lo de esta fase ha sido en memoria. **Nada se ha desplegado.**

---

## 12 · ARTWORK

### 12.1 · Lo que hay, medido

```
public/players/   1 fichero   (README.md)   → 0 imágenes
public/teams/     1 fichero   (README.md)   → 0 imágenes
```

Cero retratos y cero logos, para 379 jugadores y 66 equipos.

### 12.2 · Lo que el producto necesita de verdad

Aquí conviene separar «necesario» de «deseable», porque es donde se justifica no hacer nada:

| Recurso | ¿Lo necesita el producto para funcionar? | Estado |
|---|---|---|
| Retrato de jugador | **No.** `PlayerPhoto` cae al **sigilo**: un emblema geométrico distinto por jugador, que se densifica con la rareza | Resuelto desde la Fase 13 |
| Logo de equipo | **No.** `TeamLogo` cae a un monograma con la etiqueta y el color de marca | Resuelto |
| Marco, fondo, efectos de variante | Sí — y **ya son código**, no imágenes (`artwork-composer`, `artwork-renderer`) | Hecho |

El respaldo no es un parche: es lo que impidió que 772 cartas compartieran la misma silueta
genérica. **La colección se lee como una colección sin una sola fotografía.**

### 12.3 · Qué puede usarse legalmente

- **Nada que no tenga licencia.** No hay autorización de Riot Games, ni de los equipos, ni de
  los jugadores para usar su imagen.
- `src/artwork-acquisition` ya modela esto en el tipo, no en un comentario:
  `LicenseKind = "official" | "editorial" | "cc" | "unknown"`, y el selector **ordena
  poniendo `official` primero**. La arquitectura está preparada para una licencia que hoy no
  existe.
- **No se ha descargado ni una imagen.** No se ha copiado ningún asset de terceros. No se ha
  hecho ninguna búsqueda masiva. El objetivo lo prohibía las tres veces.

### 12.4 · Qué pipeline haría falta, si algún día hay licencia

Ya está construido (`artwork-acquisition` → `artwork-ai` → `artwork-composer` →
`artwork-renderer` → `artwork-updater`). Lo que falta **no es software**: es un contrato.

**Decisión: no hacer nada.** Sin autorización no se usan fotografías reales, y el producto
no las necesita para funcionar.

---

## 13 · LAS 8 DEUDAS

| # | Deuda | Estado actual | Datos necesarios | ¿Resoluble ahora? | Decisión |
|---|---|---|---|---|---|
| 1 | 8 jugadores con galardón y sin carta | Sigue. ScreaM, TenZ, Sacy, Leo, Boostio, Zest sin métricas; mimi y Flxja bajo el umbral de rondas | Autoría editorial de una persona, o métricas que no existen | **No** | No hacer. En trinquete en `content:verify` |
| 2 | `americas-mvp` sin portador | Sigue. `VACIA — ningún jugador con su galardón` | Un MVP regional de Americas que conste | **No** — inventarlo sería fabricar un resultado deportivo | No hacer |
| 3 | Rareza alta de China | Sigue. 0 de 89 jugadores chinos con galardón alto | Palmarés real | **No** | No hacer. La tienda ya lo advierte y China es el regional más barato por carta |
| 4 | Devolver Prime al escaparate | Sigue. `content:audit`: Prime es 30,75× el mejor sobre en *uncommon* y 1,38× en *legendary* | Un catálogo que sostenga un cuarto sobre | **No** | No hacer |
| 5 | Mapa/MVP en Match Challenges | Sigue. `matches` no guarda mapa ni MVP | Columnas nuevas + el dato en el pipeline | **No en esta fase** — es una feature | No hacer |
| 6 | Maestría por temporada | Sigue. El catálogo no marca cartas por temporada | Marca de temporada por carta | **No** | No hacer |
| 7 | Marketplace | Sigue. Cerrado | ≥200 jugadores. Hay **0** | **No** | No hacer (§14) |
| 8 | **Validación con torneo real** | **Desbloqueada** | Un torneo real en el pipeline | **Sí — hecho** | **Hecha**, y encontró un P1 (§6) |

**Una de ocho, y precisamente la que el objetivo marcaba como prioridad.** Las otras siete
siguen necesitando datos reales o decisiones humanas que un programa no puede tomar. Ninguna
se ha resuelto por aparecer en la lista.

Sobre la deuda 8 conviene ser preciso para no exagerar: **el pipeline queda validado; el
ciclo de Pick'ems sobre un torneo en vivo, no** (§6.7, puntos 3, 4, 7, 8 y 9). Eso exige un
torneo empezando, no un torneo terminado.

---

## 14 · MARKETPLACE

**No se ha abierto.** `GLOBAL_MARKET_ENABLED = false`.

- No se ha creado liquidez artificial.
- No se han creado ventas artificiales.
- No se han creado bots de mercado.
- No se ha ajustado ningún `marketValue`.

Los criterios objetivos siguen **exactamente** como estaban, y no había razón demostrable
para cambiarlos:

| Criterio | Umbral | Hoy |
|---|---|---|
| Jugadores | ≥ 200 | **0** |
| Liquidez | ≥ 0,2 | — |
| Ventas antes de reajustar el ancla | ≥ 1.000 | **0** |
| Mediana frente a `marketValue` | 0,5× – 2× | — |

Medición preparada: `market_listings`, `market_offers`, `market_audit` y
`credit_transactions` con `kind` y `counterparty_id` ya registran todo lo necesario. **No
hace falta instrumentar nada para abrirlo cuando toque.**

---

## 15 · PAYMENTS

`PAYMENTS_ENABLED = false`. **No activado. Sin checkout. Sin pagos reales.** `payments`
tiene 0 filas. No se ha tocado.

---

## 16 · SEGUNDA MONEDA

**No se ha creado ninguna.** Ni tokens, ni materiales, ni crafting, ni fragmentos, ni moneda
de evento. La economía sigue siendo DRL Credits y nada más.

(Nota: `profiles.tokens` y `Reward.tokens` ya existían de fases anteriores y siguen a cero;
`loop:verify` comprueba que un tipo de recompensa sin ruta de entrega **se declara** en vez
de tragarse. No se ha añadido nada.)

---

## 17 · TELEMETRÍA

### 17.1 · La pregunta del objetivo

> *¿Tiene NEXUS suficiente información para responder «qué hacen realmente los usuarios»?*

**Respuesta: casi. Le falta una cosa, y es la más importante.**

### 17.2 · Lo que YA registra, y es más de lo que parece

NEXUS no tiene analítica, pero sí tiene algo mejor para lo que aquí importa: un **libro mayor
auditable** y marcas de tiempo por fila. Sin haber sido diseñado como telemetría, responde:

| Pregunta | Fuente | ¿Hoy? |
|---|---|---|
| ¿Compra sobres? ¿cuáles? ¿cuándo? | `economy_ops` + `credit_transactions` | ✅ |
| ¿Los abre? | `economy_ops` kind=`open_pack` | ✅ |
| ¿Qué cartas consigue y de dónde? | `user_cards` (`origin`, `obtained_at`) | ✅ |
| ¿Construye mazos? | `duel_decks` | ✅ |
| ¿Juega duelos? ¿gana? | `duel_matches` | ✅ |
| ¿Hace Pick'ems? | `pickem_submissions` / `pickem_scores` | ✅ |
| ¿Recicla cartas? | `economy_ops` kind=`salvage` | ✅ |
| ¿Compra prestigio? ¿de qué conjunto y escalón? | `credit_transactions.reason` | ✅ |
| ¿Cuántos créditos entran y salen, y por qué? | `credit_transactions` (`delta`, `reason`) | ✅ |
| ¿Sube de nivel? ¿desbloquea cosméticos? | `profiles`, `user_cosmetics` | ✅ |

Diez preguntas de comportamiento, respondidas hoy, sin instrumentar nada.

### 17.3 · Una trampa encontrada por el camino, y conviene señalarla

Al preparar las consultas de §3.1 apareció esto, y habría estropeado el primer análisis:

**Cuatro contadores desnormalizados de `profiles` no los escribe nadie.** Están declarados,
están protegidos por el trigger «SEC-02: solo lo modifica el servidor»… y **no existe ni una
sentencia que los actualice**:

| Columna | ¿Se escribe? | Dónde está el valor de verdad |
|---|---|---|
| `profiles.packs_opened` | **No** | `user_game.packs_opened` (lo incrementa `app_apply_pack_open`) |
| `profiles.distinct_cards` | **No** | Contar `user_cards` |
| `profiles.collection_value` | **No** | Calcular sobre `user_cards` |
| `profiles.rarest_rank` | **No** | Calcular sobre `user_cards` |

Medido en la base de datos: los diez perfiles tienen `packs_opened = 0` y
`distinct_cards = 0`, mientras `user_game.packs_opened` suma **5** y `user_cards` tiene **46**
filas.

Quien midiera «sobres abiertos» o «cartas conseguidas» desde `profiles` obtendría **cero para
siempre**, y no se notaría: cero es exactamente lo que se espera de un producto sin usuarios.

**No es un fallo visible del producto** —las cuatro vistas SQL que leen esas columnas
(`ranking_collection`, `ranking_rarities`, `ranking_market`, `ranking_level`) **no las usa la
aplicación**— pero sí es una trampa para el trabajo de medición que esta fase recomienda. Por
eso todas las consultas de §3.1 y §5.3 van contra `user_cards`, `economy_ops`,
`credit_transactions` y `duel_decks`, **nunca contra los contadores de `profiles`**.

→ *P3. Documentado, no corregido: corregirlo es cambiar el esquema, y hoy no lo lee nadie.*

### 17.4 · Lo que NO puede responder

| Pregunta | Por qué |
|---|---|
| **¿Volvió ayer?** | No hay ninguna señal de presencia |
| ¿Cuánto duró su sesión? | Ídem |
| ¿Qué pantallas vio? | No se registra navegación |
| ¿Dónde abandonó? | Ídem |
| ¿Visitó un evento? | Ídem (§8) |

El patrón es uno solo: **NEXUS registra transacciones, no presencia.** Quien mira y se va es
invisible — y en un juego de coleccionismo, mirar es la mitad del producto.

### 17.5 · La instrumentación mínima (propuesta, NO construida)

Lo mínimo que desbloquea retención, y nada más:

```sql
-- UNA tabla. Una fila por usuario y día. Nada más.
create table public.user_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null,
  primary key (user_id, day)
);
```

Escritura: un `insert … on conflict do nothing` en la primera petición autenticada del día.

**Por qué así, y no de otra manera:**

| Criterio del objetivo | Cómo lo cumple |
|---|---|
| Respeta la privacidad | Sin IP, sin user-agent, sin ruta, sin hora. Solo «este usuario existió este día» |
| Sin datos innecesarios | Dos columnas. La granularidad de día es la que pide D1/D3/D7/D14, y ni una más |
| Segura | RLS igual que el resto: lectura de lo propio, escritura solo desde servidor |
| Documentada | Este apartado |
| No es una plataforma de analítica | Es una tabla. De las 11 métricas de retención de §5.3, **8 ya están** y esta desbloquea la que más importa: «usuarios que vuelven» |

Las **dos** que seguirían sin medirse —«sesiones» y «eventos visitados»— se dejan fuera a
propósito: la primera exige señal de inicio y fin, la segunda exige registrar navegación, y
ambas son justamente la plataforma de analítica que el objetivo prohíbe. Con seis personas
delante, las responde mejor mirar.

Con esto, D0/D1/D3/D7/D14 pasa a ser una consulta.

**Lo que NO se propone:** ni eventos de navegación, ni page views, ni sesiones, ni embudos, ni
un proveedor externo. Todo eso responde preguntas que §2.5 ya asigna a la observación directa,
que es más barata y más fiable con seis personas.

### 17.6 · Por qué no se ha construido

Con **cero usuarios reales**, esa tabla recogería exactamente **cero filas**. Construirla hoy
sería añadir esquema, RLS, migración y superficie de escritura para no medir nada — y llegaría
al primer test de usuarios sin haberse validado nunca contra datos.

**El momento correcto de construirla es justo antes del primer test con personas**, que es
también cuando se sabrá si hace falta algo más. La Regla 0 de esta fase dice medir antes de
programar; aquí no hay nada que medir todavía.

---

## 18 · UX BASADA EN COMPORTAMIENTO

El objetivo pedía que, ante un problema de un usuario real, se determine primero si la causa
es copy, navegación, jerarquía, feedback, onboarding, información, estado vacío o bug — y se
corrija la causa más pequeña posible.

**No ha habido ningún usuario real, así que no ha habido ningún problema de usuario real, así
que no se ha cambiado ni una línea de UX.** Cambiar algo aquí habría sido exactamente la
suposición que el objetivo prohíbe.

El único problema encontrado en toda la fase (§6) se clasificó con ese mismo método y resultó
ser **un bug de parsing**, no un problema de interfaz. Se corrigió la causa —el parser— y no
sus síntomas: no se ha tocado ni una pantalla, ni un texto, ni un enlace.

---

## 19 · PROBLEMAS ENCONTRADOS

| # | Problema | Nivel | Evidencia | Decisión |
|---|---|---|---|---|
| 1 | El scoreboard por mapa de vlr.gg no se parseaba: 146 mapas → **0 filas**, y con ello las métricas de los 84 jugadores a cero, sin líderes ni premios reales | **P1** | `mapStats: 0` con 146 mapas · `'<table'` = 0 apariciones en la página real | **CORREGIDO** (§6.5) |
| 2 | El fallo era **silencioso**: el pipeline terminaba en verde y publicaba | **P1** | `Pipeline completado correctamente` con 1 carta de 60 partidos | **CORREGIDO** — aviso explícito |
| 3 | `importer-vlr:verify` no podía detectarlo: fixture 100 % offline con el markup antiguo | **P1 de método** | 52/52 en verde con el conector real roto | **CORREGIDO** — fixture del markup actual + comparación byte a byte |
| 4 | No existe ninguna señal de retorno de usuario | **P2** | No hay `last_seen` ni tabla de actividad | **Documentado** (§17.5). No se construye: cero usuarios |
| 5 | Visitar un evento no deja ningún rastro | **P2** | §8 | **Documentado**. Misma razón |
| 6 | `tournament-orchestrator:verify` fallaba 3/47 **en el árbol de trabajo** (pasaba 47/47 en HEAD) | **P2** | Causa exacta abajo | **CORREGIDO** (§20.1) tras pedirlo · 47/47 |
| 6b | `card-generator:verify` (37/50), `materializer:verify` (rompe) y `catalog-builder:verify` (29/44): mismo fixture obsoleto | **P2** | `grep -c metrics` = 0 en los tres | **Documentado. No corregido** (§22.3) |
| 7 | `champion-edition` inalcanzable: el conector no lee la clasificación final, que **sí está** en la página que ya descarga | **P2** | §7.3 · `1st · Karmine Corp` en el HTML | **Documentado**. Es una capacidad nueva |
| 8 | `clutch` y `rookie` inalcanzables: el conector nunca rellena `RawMapPlayerStat.clutches` ni `RawPlayer.status` | **P2** | `clutches = 0` en los 84 | **Documentado** |
| 9 | Cuatro contadores de `profiles` (`packs_opened`, `distinct_cards`, `collection_value`, `rarest_rank`) no los escribe nadie: valen 0 para siempre | **P3** | `user_game.packs_opened` = 5 y `user_cards` = 46 frente a 0 en los 10 perfiles | **Documentado** (§17.3). No lo lee la app; sí es trampa para medir |
| 10 | Sin fotos de jugador ni logos de equipo | **P3** | `public/players/` y `public/teams/` vacíos | **No hacer** — sin licencia, y el respaldo funciona (§12) |

### 19.1 · Detalle del problema 6, porque conviene no confundirlo con el 1

`tournament-orchestrator:verify` pasaba **47/47 sobre HEAD limpio** y fallaba **3/47 con el
árbol de trabajo actual**. Comprobado en ambos sentidos: **no lo causó ningún cambio de esta
fase** —las tres seguían fallando igual con los cambios de la fase revertidos—.

La causa es un choque entre dos cosas que ya estaban ahí:

- El árbol de trabajo tiene sin commitear la regla de «**cero estadísticas por defecto**»:
  `cardsForPlayer` devuelve `[]` si `playerCombatBase` falla, y esta solo acepta `metrics`
  reales (con `rounds >= MIN_ROUNDS`, hoy 100) o autoría `editorial` explícita.
- El fixture del verify usa jugadores sintéticos (`Lion1`…`Wolf5`) que **no tienen ni lo uno
  ni lo otro**, porque se escribió antes de que esa regla existiera.

Y hay un eslabón que conviene nombrar, porque es donde se cierra el círculo: un jugador que el
conector descubre en un torneo llega como **borrador**, y `buildDraft` (`card-generator/
identity.ts`) **no le pone `metrics`**. Así que un jugador desconocido no genera carta —y eso
es correcto—. En un torneo real no se nota porque sus jugadores ya están en el catálogo: las
6 cartas de §7.2 fueron para Kachoww, kamo, sociablEE y al0rante, **los cuatro del roster**,
con entre 352 y 1.394 rondas registradas.

**Era un fixture obsoleto, no un fallo del producto**, y esta fase lo demostró de la manera más
directa posible: el mismo camino de código, con un torneo real, generó 6 cartas.

**Corregido** (§20.1), a petición explícita y después de haberlo documentado.

---

## 20 · CORRECCIONES REALIZADAS

**Una, de nivel P1**, en tres ficheros y sin tocar ningún motor.

| Fichero | Cambio | Por qué |
|---|---|---|
| `src/importer-vlr/maps.ts` | `parseScoreboard` lee el markup actual (`div.ovw-*`, celdas **por nombre** vía `data-col`) además del antiguo. Helpers `blocksFrom`, `rowPlayer`, `rowAgent`, `ovwCols`, `scoreboardsOf` | Es la causa. Leer por nombre evita que un cambio de orden de columnas produzca estadísticas equivocadas en silencio |
| `src/importer-vlr/engine.ts` | Aviso si hay mapas y **cero** filas de scoreboard | Que un fallo de esta clase no pueda volver a ser silencioso |
| `scripts/importer-vlr-verify.ts` | Fixture con el markup real actual + 6 comprobaciones, incluida la comparación **byte a byte** entre ambos markups | Que la verificación pueda detectarlo |

**No se ha tocado:** Combat Resolver, CombatPlan, bots, RNG, OVR, stats, CardRegistry,
generated cards, pricing, salvage, economy, market, rewards, duels, rank, duelRewards, ledger,
RLS, auth, trainer. **Ni una línea.**

**Verificación de que el cambio es neutro donde debe serlo:** el check *«markup actual ⇒ MISMAS
estadísticas que el legacy»* compara los dos snapshots completos por igualdad estricta. Si el
camino nuevo produjera un solo número distinto, salta.

### 20.1 · Corrección 2 (P2) — el fixture de `tournament-orchestrator:verify`

Documentada primero (§19.1) y corregida después, a petición explícita.

**Qué se ha hecho, en un solo fichero (`scripts/tournament-orchestrator-verify.ts`):**

El fixture inventa un torneo, así que tiene que inventar también **su catálogo**. Se añade un
`FIXTURE_ROSTER` con los diez jugadores del fixture (`Lion1`…`Wolf5`), cada uno con `metrics`
de la misma forma que una fila real del roster VLR: `rounds = 4 × MIN_ROUNDS` y los ocho
componentes que `deriveCombat` exige (`kd`, `kast`, `assists`, `fk`, `fd`, `adr`, `hsPct`,
`deaths`). El pipeline pasa a recibir `pipelineRoster()` = catálogo vivo **+** esos diez,
deduplicado por id.

```
cartas generadas y materializadas:   0 generadas · 0 CardDefs
                                  →  6 generadas · 6 CardDefs      ✅ 47/47
```

**Tres decisiones que merecen justificarse:**

1. **No se toca ningún motor.** La tentación era hacer que `buildDraft` rellenara `metrics`
   desde el torneo. Sería un cambio en el Card Generator —«generated cards» está en la regla de
   no regresión— y además cambiaría el comportamiento del producto, no el del test. Lo que
   estaba mal era el fixture.
2. **El umbral se importa, no se copia.** `MIN_ROUNDS` viene de `@/domain/cards/combat` en vez
   de escribir `100` a mano. Duplicar una constante del dominio dentro de un test es
   exactamente la clase de deriva que causó el P1 de esta fase. El verify ya dependía de ese
   módulo de forma transitiva (vía `@/data/catalog`), así que no añade acoplamiento nuevo.
3. **Las métricas son de fixture y no salen de ahí.** Igual que los marcadores del HTML. Van en
   el roster que el verify inyecta, el catálogo del producto no las ve, y el propio verify lo
   comprueba al terminar (*«catálogo semilla restaurado»*). Medido después del cambio: **379
   jugadores · 772 cartas · ningún `fx-` en el catálogo**.

---

## 21 · PROBLEMAS NO CORREGIDOS

Los P2/P3 de §19 que siguen abiertos, y ninguno por descuido:

| # | Por qué no se corrige |
|---|---|
| 4 · Señal de retorno | Recogería 0 filas hoy. Se construye antes del primer test con personas (§17.5) |
| 5 · Eventos sin rastro | Mismo caso |
| 6 · Verify del orquestador | **Ya no aplica: corregido** (§20.1) |
| 6b · Los otros tres verifies | Mismo fixture obsoleto. Se pidió el del orquestador; estos tres necesitan la misma decisión explícita (§22.3) |
| 7 · `champion-edition` | Parsear la clasificación es una **capacidad nueva** del conector, y la fase prohíbe features. Se decide en la 17 |
| 8 · `clutch` y `rookie` | El dato no está en lo que el modelo ingiere (`clutch`) o la fuente no lo publica (`rookie`). Sintetizarlo sería inventar estadísticas |
| 9 · Contadores muertos de `profiles` | Cambiar el esquema por columnas que hoy no lee la aplicación. Basta con no usarlas, y §3.1 y §5.3 ya no las usan |
| 10 · Artwork | Sin licencia no se usan fotos. El producto no las necesita: el sigilo funciona |

---

## 22 · TESTS

Toda la batería exigida, ejecutada **después** de la corrección de §20.

| Comprobación | Resultado |
|---|---|
| `npm test` | ✅ **480/480** · 0 fallos (39,3 s) |
| `typecheck` | ✅ limpio (`tsc --noEmit` + `tsconfig.scripts.json`) |
| `build` | ✅ `next build` |
| `security:verify` | ✅ |
| `economy:verify` | ✅ |
| `events:verify` | ✅ |
| `loop:verify` | ✅ |
| `progression:verify` | ✅ |
| `ux:verify` | ✅ |
| `audit:interactions` | ✅ |
| `duel:e2e` | ✅ |
| `duel-gameplay:verify` | ✅ |
| `strats:verify` | ✅ |
| `sw:verify` | ✅ |
| `test:integration` | ✅ |
| `test:pickems` | ✅ |
| `test:e2e` | ✅ (con `E2E_BASE_URL=http://127.0.0.1:3001`; su valor por omisión es el 3000) |
| `economy:simulate` | ✅ |
| `economy:model` | ✅ |
| `content:audit` | ✅ |
| `audit:stability` | ✅ **105 comprobaciones · P0 0 · P1 0 · P2 3** |
| `ftue:audit` | ✅ **P0 0 · P1 0 · P2 0** (1 P3: faltan fotos en `/coleccion`, con respaldo visual) · móvil 390: **0 px** de desbordamiento |

**P0 = 0 · P1 = 0.**

`duel:e2e` merece una línea aparte porque mide justo lo que esta fase no podía medir con
personas: 47 peticiones en todo el recorrido, sin errores de consola, sin avisos de
hidratación y **0 px** de desbordamiento en 390, 768 y 1440. Y `duel-gameplay:verify` cierra
partidas completas de 10 turnos en las tres dificultades (10-0, 4-5, 6-4).

### 22.1 · Además, lo directamente afectado por el cambio

| Comprobación | Antes | Después |
|---|---|---|
| `importer-vlr:verify` | 52/52 | ✅ **58/58** (+6, §6.5) |
| `importer:verify` | 20/20 | ✅ 20/20 |

Los 3 P2 de `audit:stability` son los mismos de siempre y no los toca esta fase: un 401 en
`/admin/assets`, `/admin/control` y `/admin/releases` al entrar con una sesión sin permisos de
administrador. Es el comportamiento correcto; lo que la herramienta anota es el ruido en
consola.

### 22.2 · `tournament-orchestrator:verify`, encontrado en rojo y corregido

| | Antes | Después |
|---|---|---|
| `tournament-orchestrator:verify` | 44/47 | ✅ **47/47** — 6 cartas generadas · 6 CardDefs |

Estaba en rojo **antes de esta fase** (comprobado revirtiendo sus cambios: fallaba igual) y
se ha corregido al pedirlo. El detalle de la causa y del arreglo está en §19.1 y §20.1.

### 22.3 · Tres verificaciones más en rojo, con la MISMA causa

Buscando el alcance real del fixture obsoleto aparecieron otras tres. **Ninguna la ha roto
esta fase**: no importan nada de lo que se ha tocado, y se comprobó ejecutándolas con los
cambios de la fase retirados — fallan exactamente igual.

| Verificación | Estado | Síntoma |
|---|---|---|
| `card-generator:verify` | **37/50** | `✗ torneo grande (150 jugadores nuevos) generado — 0 cartas` |
| `materializer:verify` | **rompe** | `TypeError: Cannot read properties of undefined (reading 'ovr')` en `materializer-verify.ts:133` — `gen.cards[0]` es `undefined` porque no hay ninguna carta |
| `catalog-builder:verify` | **29/44** | 15 fallos, todos de catálogo generado |

La causa es una sola y es la de §19.1: **sus fixtures no llevan `metrics` ni `editorial`**
(`grep -c metrics` da **0** en los tres), así que `cardsForPlayer` devuelve `[]` y todo lo que
dependa de que exista una carta se cae.

**No se han tocado.** Se pidió arreglar el del orquestador; estos tres merecen la misma
decisión explícita en vez de colarse aquí. El arreglo es el mismo patrón de §20.1 —darles un
roster de fixture con métricas suficientes— y en `materializer:verify` conviene además que
`gen.cards[0]` se compruebe antes de usarse: un fixture vacío debería fallar con un mensaje,
no con un `TypeError`.

---

## 23 · SEGURIDAD

`security:verify` ✅ · `economy:verify` ✅ · `events:verify` ✅.

Sobre lo tocado en esta fase:

- **Superficie de ataque: sin cambios.** El único código modificado es un parser de HTML puro
  (string → dato) dentro del conector, más un aviso. No hay endpoint nuevo, ni RPC nueva, ni
  política RLS tocada, ni permiso movido.
- **El conector sigue sin red fuera de su capa.** `createHttpFetcher` es el único punto con
  `fetch`, y no ha cambiado. Los parsers son puros e inyectables, y así siguen.
- **Nada del snapshot llega al cliente.** La comprobación *«el snapshot NO contiene
  cartas/OVR/rareza»* sigue pasando.
- **Sin credenciales nuevas.** Las llamadas a vlr.gg de esta auditoría fueron a páginas
  públicas, con el user-agent que el propio conector ya declara.
- **Sin datos personales nuevos.** La telemetría propuesta en §17.5 se ha diseñado
  explícitamente sin IP, sin user-agent y sin ruta — y **no se ha construido**.

---

## 24 · RENDIMIENTO

| Medida | Resultado |
|---|---|
| 50 imports completos offline | **43 ms** (0,9 ms/import) — el presupuesto es < 5 s |
| Pipeline completo, torneo real de 60 partidos | **29,6 s**, 63 páginas descargadas, con la pausa de cortesía |
| Torneo sin jugar (Champions 2026) | 753 ms |
| `npm test` | 480 pruebas en ~40 s |

El parser nuevo **no cuesta más**: 0,9 ms por import completo, igual que antes. Los 29,6 s del
torneo real son casi todo espera de red por la pausa de cortesía entre páginas, no cómputo.

---

## 25 · DATOS OBSERVADOS

Todo lo medido en esta fase, junto y sin adornos.

### 25.1 · Usuarios

```
usuarios reales                     0
cuentas en la base de datos     8 → 10   (todas creadas por scripts; +2 durante la fase)

              total en la BD   hechas por una persona
sobres abiertos        5                     0
duelos                 2                     0
Pick'ems enviados      1                     0
cartas obtenidas      46                     0
compras de prestigio   0                     0
créditos gastados 11.115                     0
```

### 25.2 · Catálogo

```
jugadores  379      cartas  772      variantes  37  (25 con cartas · 12 vacías)
```

### 25.3 · Torneo real — VCT 2026: EMEA Stage 2

```
estado    finished          sede    Olimpic Arena, Badalona (ES)
fechas    15-07 → 30-08     premio  250.000 $
equipos   16     jugadores  84     partidos  60     mapas  146

                          antes        después
filas de scoreboard            0          1.460
jugadores con maps > 0         0             84
cartas generadas               1              6
variantes de torneo llenas     0              6
MVP                    Avez (13)   Kachoww (57)
```

### 25.4 · Torneo sin jugar — Valorant Champions 2026

```
estado  upcoming   ·   inicio 2026-09-24   ·   equipos 9   ·   partidos 0   ·   cartas 1
```
Registrado a propósito: es la prueba de que el sistema **no rellena** lo que no ha ocurrido.

---

## 26 · DECISIONES PARA LA FASE 17

Ordenadas por lo que desbloquean, no por lo que apetece.

### 26.1 · Lo que hay que hacer antes que nada

**1 · Conseguir usuarios reales.** Es el cuello de botella de esta fase entera y de casi todo
lo que la 16 no pudo responder. Seis personas y el protocolo de §2 responden las 15 preguntas
del objetivo — y 11 de ellas **no las responde ninguna cantidad de código**.

**2 · Construir `user_activity_days` justo antes de ese test** (§17.5). Una tabla, dos
columnas. Antes del test no mide nada; después, mide retención.

### 26.2 · Lo que la Fase 16 dejó a un paso

**3 · Un Pick'em sobre un torneo que empieza.** Es lo único que falta para cerrar los cinco
puntos ⚠️ de §6.7 (preguntas, Pick'ems, corrección, recompensas, progresión). Requiere
esperar a un torneo, no escribir código: Americas Stage 2 y Pacific Stage 2 terminaban el 7 y
el 6 de septiembre, y Champions 2026 empieza el 24.

**4 · Decidir si el conector lee la clasificación final.** Desbloquea `champion-edition` —
la 7.ª de las 9 variantes, y probablemente la más deseable, porque son **cinco cartas para el
róster campeón** en vez de una para un individuo. Y es la más barata de las tres que quedan:
el dato ya está en la página que el conector descarga (§7.3). Es una capacidad nueva y **debe
decidirse, no colarse**.

**5 · Actualizar los otros tres fixtures obsoletos.** El de
`tournament-orchestrator:verify` ya está hecho (§20.1) y sirve de patrón. Quedan
`card-generator:verify` (37/50), `materializer:verify` (rompe con un `TypeError`) y
`catalog-builder:verify` (29/44), los tres por la misma causa (§22.3). Va junto con el trabajo
sin commitear que los dejó obsoletos, así que la decisión es de quien lo tenga en curso.

Y de paso, una salvaguarda barata: **que un fixture sin cartas falle con un mensaje y no con
un `TypeError`.** `materializer-verify.ts:133` hace `gen.cards[0].ovr` sin comprobar que haya
alguna; con cero cartas la verificación no dice qué pasa, se rompe.

### 26.3 · Lo aprendido sobre el método, que vale más que cualquiera de los anteriores

**6 · Toda verificación 100 % offline contra una fuente externa caduca sin avisar.**
`importer-vlr:verify` pasaba 52/52 con el conector real roto, igual que en la Fase 15 las
capturas pasaban con cuentas sembradas mientras la primera experiencia estaba rota. **Es el
mismo fallo dos fases seguidas, en dos sitios distintos.**

La corrección de §6.5 arregla *esta* instancia. La pregunta para la 17 es la general: qué
otras verificaciones validan una realidad que puede haber dejado de existir. Una comprobación
periódica contra la fuente real —aunque sea semanal, aunque sea un solo torneo— habría
detectado esto el día que vlr.gg cambió el markup.

### 26.4 · Lo que NO hay que hacer

- **No abrir el marketplace.** 0 de 200 jugadores.
- **No activar payments.**
- **No tocar precios ni economía.** No hay economía observada contra la que calibrar.
- **No añadir una segunda moneda.**
- **No cambiar UX por suposición.** Primero las seis personas.
- **No comprar ni descargar artwork** sin licencia. El sigilo funciona.

---

## 27 · LO QUE SE PREGUNTABA AL EMPEZAR

> *«¿Qué ocurre cuando una persona real utiliza NEXUS?»*

**No lo sabemos, porque ninguna persona real lo ha utilizado todavía.** Ni una. Y esa es la
respuesta honesta, no una evasiva: las catorce preguntas del resultado esperado —¿entiende el
juego? ¿juega? ¿colecciona? ¿vuelve? ¿gasta créditos? ¿quiere prestigio? ¿qué le frustra? ¿qué
le entusiasma? ¿qué feature ignora? ¿dónde abandona?— **exigen una persona**, y esta fase ha
confirmado que ni el producto ni ninguna herramienta pueden responderlas en su lugar.

Lo que sí sabemos ahora y no sabíamos al empezar:

1. **Qué protocolo responde a cada una de las 15 preguntas**, y que 11 solo las responde una
   persona observando (§2.5).
2. **Qué se puede medir hoy sin instrumentar**: 6 de las 11 métricas de primera sesión y 8 de
   las 11 de retención (§3, §5.3).
3. **Qué falta exactamente para el resto**: una tabla de dos columnas (§17.5).
4. **Que el pipeline de torneos funcionaba mal desde hacía tiempo**, y nadie podía verlo
   porque la verificación miraba un fixture congelado.
5. **Que un torneo real recorre el sistema entero** y produce 6 cartas reales para 6
   variantes que llevaban vacías desde la Fase 13 (§7.2).
6. **Qué dato concreto falta** para cada una de las 3 variantes restantes (§7.3).

Esta fase no ha hecho NEXUS más grande. Ha hecho que **la parte que ya existía diga la
verdad** — y ha dejado escrito, sin inventar una sola cifra, qué hace falta para responder al
resto.

---

## 28 · CUMPLIMIENTO DE LA REGLA ABSOLUTA

| Prohibición | Cumplida |
|---|---|
| No inventar datos | ✅ Toda cifra de este informe procede de una consulta, una ejecución o un parser |
| No fabricar usuarios | ✅ Los 10 perfiles se declaran como lo que son: scripts |
| No fabricar retención | ✅ **NO HAY DATOS SUFICIENTES** |
| No fabricar ventas | ✅ 0, y así se dice |
| No fabricar liquidez | ✅ Marketplace cerrado, sin tocar |
| No fabricar resultados deportivos | ✅ El único torneo real es real; el que no se ha jugado se declara `upcoming` |
| No fabricar feedback | ✅ Cero participantes, y así se dice |
| No crear datos falsos para que una feature parezca funcionar | ✅ Las 3 variantes que no se llenan se documentan en vez de rellenarse |

**Sin commit. Sin push. Sin deploy. Sin producción.**

