# Fase 17 — Variantes de carta bloqueadas: `clutch`, `rookie`, `champion-edition`

**Resultado: 8 de 9 variantes con datos reales y trazables.** `champion-edition` y `clutch`
quedan desbloqueadas leyendo datos que la fuente ya publicaba; `rookie` **sigue bloqueada** y
así debe quedarse hasta que exista una fuente de `status`.

No se ha inventado ni un dato. No se ha tocado el motor de Duelos, la economía, el marketplace,
los pagos, el FTUE ni el Trainer. Ni un nombre de equipo ni de torneo aparece escrito en el
código de decisión.

---

## 1 · Estado inicial

Las nueve variantes de torneo salen de un accolade, y el accolade de una regla del
`DEFAULT_RULESET` alimentada por el Analyzer:

| Variante | Accolade | Origen | Estado antes |
|---|---|---|---|
| `mythic` (MVP) | `tournament-mvp` | award `mvp` | ✅ |
| `top-rating` · `top-acs` · `top-kills` · `top-assist` · `top-hs` | `tournament-top-*` | líderes de scoreboard | ✅ |
| **`champion-edition`** | `tournament-champion` | narrativeTag `champion` (roster) | ❌ |
| **`clutch`** | `tournament-clutch` | award `best-clutch` | ❌ |
| **`rookie`** | `tournament-rookie` | award `best-rookie` | ❌ |

Medido sobre `VCT 2026: EMEA Stage 2` (16 equipos · 84 jugadores · 60 partidos · 146 mapas ·
1.460 filas de scoreboard): **6 variantes con datos reales, 3 ausentes.**

---

## 2 · El problema de cada variante, trazado

Las tres estaban bloqueadas por causas **distintas**, y solo una era un fallo de parser.

### 2.1 · `champion-edition` — dato publicado y no leído

```
vlr.gg /event/{id} · tabla «Prize Distribution»          ← el dato ESTÁ aquí
  ✗ importer-vlr/teams.ts:32   solo lee el header «Prize» (bolsa total), no la tabla
  ✗ importer-vlr/normalize.ts  toRawSnapshot no emitía `awards` ni `standings`
→ RawSnapshot.awards.champion             importer/types.ts        = undefined
→ ObjectiveAwards.championTeamId          importer/normalize/index.ts:166
→ analyzer/team.ts:49   champId = awards?.championTeamId ?? standings[position === 1]  → undefined
→ TeamReport.champion = false en los 16 equipos
→ analyzer/context.ts:26  narrativeTag «champion» (teamScope roster)  → nunca se emitía
→ card-generator/ruleset.ts:15  regla `champion-roster`               → nunca disparaba
→ accolade tournament-champion → data/catalog.ts:52 → variante champion-edition
```

**Toda la cadena aguas abajo ya existía y funcionaba.** Faltaba el primer eslabón.

### 2.2 · `clutch` — dato publicado, con hueco de granularidad

El diagnóstico de la Fase 16 («el dato no existe») era **correcto a medias**, y esa mitad
importa:

- **Cierto:** el scoreboard por mapa de vlr.gg **no tiene columna de clutch**. Sus columnas son
  `rating2 · acs · k · d · a · kd-diff · kast · adr · hsp · fb · fd · fk-diff`. Por eso
  `RawMapPlayerStat.clutches` salía vacío en las 1.460 filas y `aggregate.ts:37` sumaba 0.
- **Incompleto:** la página `/event/stats/` —que el conector **ya descargaba**— sí lo publica:

  ```html
  <td data-col="clp" title="CL%">23%</td>
  <td data-col="cl"><span class="st-cl-x">9</span>/<span class="st-cl-y">40</span></td>
                                    ↑ ganadas         ↑ situaciones jugadas
  ```

  Más aún: `stats.ts:16` tiene un extractor genérico `dataCols()` que **ya capturaba `cl` y
  `clp`** y los descartaba una línea más abajo, al construir `VlrStatsRow`.

El bloqueo real no era de datos, era de **carril**: VLR lo publica por torneo y `RawSnapshot`
solo tenía `mapStats` (por mapa). Repartir el agregado entre mapas sería inventar estadísticas
por mapa que nadie ha publicado — ahí el informe anterior acierta de pleno. Pero `best-clutch`
es un premio **de torneo**, así que el agregado de torneo es la granularidad *correcta*, no un
apaño.

### 2.3 · `rookie` — sin fuente

La definición que usa NEXUS (`analyzer/awards.ts:62`) es: *el jugador con mayor `mvpScore`
**entre aquellos cuyo `status` contiene «rookie»***. No es «jugador joven». Sin el conjunto de
marcados no hay nada que ordenar, y el premio **se omite a propósito**.

---

## 3 · Fuentes investigadas

| Fuente | Comprobado | `clutch` | `rookie` | campeón |
|---|---|---|---|---|
| `/event/{id}` — cabecera | `teams.ts` `parseEventInfo` | — | — | solo bolsa total |
| `/event/{id}` — tarjetas de equipo | `VlrRosterPlayer`: `vlrId`, `nick`, `country` | — | **no** | — |
| `/event/{id}` — **Prize Distribution** | HTML real de `vlr.gg/event/2976` | — | — | **SÍ** ✅ |
| `/event/stats/{id}` — 22 `data-col` | `agents, maps, rnd, rating2, acs, kd, kast, adr, kpr, apr, fkfd, fbpr, fdpr, hsp, **clp**, **cl**, kmax, k, d, a, fk, fd` | **SÍ** ✅ | **no** | — |
| Página de partido — scoreboard por mapa | `maps.ts`, `div.ovw-cell[data-col]` | **no** | **no** | — |
| `src/data/vlr/players-vct-2026.json` (371 jugadores reales) | claves: `agents, country, id, maps, metrics, nick, region, role, roleConfidence, roleSource, team, teamTag, vlrId` | — | **no** | — |
| Round-level data | `RawRound` existe; el conector no lo rellena (VLR no publica rondas parseables) | no | — | — |

**Para `rookie` no hay ninguna fuente.** «Rookie» en VCT es una designación de liga, no un campo
de vlr.gg.

---

## 4 · Datos encontrados (reales, de `VCT 2026: EMEA Stage 2`)

Clasificación final, leída de la tabla:

```
 1  Karmine Corp          $100,000   +8
 2  Team Liquid            $65,000   +6
 3  FUT Esports            $40,000   +5
 4  Fire Flux Esports      $25,000   +4
 5  Enterprise Esports     $10,000        ← empate «5th–6th»
 5  BBL Esports            $10,000        ← empate
 7  Eintracht Frankfurt          —        ← empate «7th–8th»
 7  Team Vitality                —        ← empate
```

Clutch: **84 de 84 jugadores** con dato. Líder real: `KROSTALY` (FUT) con **17/73 (23 %)`.

---

## 5 · Implementación

### 5.1 · `champion-edition`

**`src/importer-vlr/standings.ts`** (nuevo) — parser de la tabla, escrito contra el markup
**real** descargado de `vlr.gg/event/2976`. Tres trampas del markup, contempladas:

1. El nombre del equipo lleva la región anidada (`<div class="text-of">Karmine Corp<div
   class="ge-text-light">Europe</div></div>`): un `textOf` del bloque daría «Karmine Corp
   Europe», que no resuelve contra ningún equipo. Se toma el primer nodo de texto.
2. Puestos **empatados** en rango con raya larga (`5<sup>th</sup>–6<sup>th</sup>`): se queda el
   primer número y ambos comparten posición.
3. Un `<a>` **comentado** en la celda de puntos con un valor viejo. `textOf` solo borra
   etiquetas, así que el texto del comentario sobrevivía: se eliminan los comentarios primero.

`prizeToAwards` **exige que el puesto 1 sea inequívoco**: dos equipos en el 1 ⇒ no hay campeón.

**`normalize.ts`** emite `awards.champion` / `runnerUp` / `placements` y `standings` (el camino
de reserva que `analyzer/team.ts` ya buscaba). Sin tabla, nada de esto: un torneo en curso no
tiene ganador y adivinarlo sería inventarlo.

### 5.2 · `clutch`

Carril nuevo de **estadística por torneo**, aditivo y opcional en todo el recorrido:

```
stats.ts clutch()                → VlrStatsRow.clutchesWon / clutchSituations / clutchPct
normalize.ts                     → RawSnapshot.playerTournamentStats[]
importer/parse/index.ts          → descarta filas sin jugador y sin denominador
importer/normalize/index.ts      → PlayerTournamentStat (modelo canónico)
analyzer/player.ts               → PlayerReport.tournamentClutchesWon / …Situations
analyzer/awards.ts               → award best-clutch
```

**No sustituye a `clutches`, convive con él.** `PlayerReport.clutches` sigue siendo la suma por
mapa; los campos nuevos son el agregado de torneo. Se mantienen separados a propósito: son datos
con procedencias distintas, y aplanarlos haría imposible saber cuál se está mirando.
`clutchesPerMap`, `clutchScore` y los highlights **siguen leyendo `clutches`** y siguen diciendo
la verdad (0 = no medido) cuando la fuente no lo publica por mapa. Solo el premio de torneo usa
el agregado.

Y no se mezclan procedencias dentro de un mismo torneo: si algún jugador trae el agregado,
**solo compiten los que lo traen**. Mezclarlos daría un ganador decidido por a quién le faltaba
el dato.

### 5.3 · `rookie`

**Ningún cambio.** Se documenta el bloqueo y se añade un test que lo protege (§10).

---

## 6 · Variantes desbloqueadas

| Variante | Estado | Dato | Fuente |
|---|---|---|---|
| `champion-edition` | ✅ **desbloqueada** | equipo en el puesto 1 | tabla Prize Distribution |
| `clutch` | ✅ **desbloqueada** | clutches ganados en el torneo | `/event/stats/` `data-col="cl"` |

## 7 · Variantes que siguen bloqueadas

| Variante | Motivo |
|---|---|
| `rookie` | **Bloqueada por falta de fuente de datos verificable.** Ninguna de las páginas que el conector descarga, ni el dataset de 371 jugadores reales, publica un indicador de rookie. Desbloquearla exigiría una fuente de rósters distinta o autoría editorial explícita. Cualquier proxy (edad, mapas jugados, primer torneo visto) sería un dato inferido. |

---

## 8 · Definición exacta de cada variante

- **`champion-edition`** — se concede a **todo jugador del equipo que ocupa el puesto 1 de la
  clasificación final publicada por la fuente** y que haya disputado al menos un mapa del torneo
  (`rules.ts:89`, `p.maps > 0`). Si el puesto 1 es ambiguo o no hay tabla, no se concede.
- **`clutch`** — se concede al jugador con **más situaciones de clutch ganadas en el torneo**
  según la fuente (`st-cl-x` de `data-col="cl"`), con un mínimo de 1. Un clutch es una situación
  1vX resuelta a favor; la definición y el recuento son de vlr.gg, aquí no se recalculan.
- **`rookie`** — *(bloqueada)* se concedería al jugador con mayor `mvpScore` **entre aquellos
  cuyo `status` en la fuente los identifique como rookie**. Sin ese conjunto, se omite.

---

## 9 · Source of truth

```
CHAMPION EDITION
  vlr.gg /event/{id} · Prize Distribution · fila con position 1
    → VlrPlacement.teamName                     importer-vlr/standings.ts
    → RawSnapshot.awards.champion  (por NOMBRE, convención del conector)
    → ObjectiveAwards.championTeamId            importer/normalize (resolveRef)
    → TeamReport.champion                       analyzer/team.ts:49
    → narrativeTag «champion» (teamScope roster) analyzer/context.ts:26
    → accolade tournament-champion              card-generator/ruleset.ts:15
    → variante champion-edition                 data/catalog.ts:52

CLUTCH
  vlr.gg /event/stats/{id} · td[data-col="cl"] · st-cl-x / st-cl-y
    → VlrStatsRow.clutchesWon / clutchSituations importer-vlr/stats.ts
    → RawPlayerTournamentStat                    importer/types.ts
    → PlayerTournamentStat                       importer/model/results.ts
    → PlayerReport.tournamentClutchesWon         analyzer/player.ts
    → award best-clutch                          analyzer/awards.ts
    → accolade tournament-clutch                 card-generator/ruleset.ts:17
    → variante clutch                            data/catalog.ts:56

ROOKIE
  (sin fuente) → RawPlayer.status = undefined → award best-rookie OMITIDO → sin carta
```

Sin lógica duplicada: cada dato entra por un punto y viaja por el contrato que ya existía.

---

## 10 · Tests

**38 tests nuevos** (suite total: 489 → **527**).

`src/importer-vlr/standings.test.ts` (10) — puestos, premios y puntos · el nombre no arrastra la
región · el comentario HTML no se cuela · empates comparten posición · la cabecera no cuenta ·
no se cuelan filas de tablas posteriores · **cambiar el campeón del fixture cambia el resultado**
· sin tabla no hay campeón · puesto 1 ambiguo ⇒ sin campeón · markup roto ⇒ vacío.

`src/importer-vlr/clutch.test.ts` (6) — lee ganadas/jugadas/porcentaje · **sin celda no inventa
nada, ni cero** · fracción a medias ⇒ nada · **ninguna otra estadística se convierte en clutch**
· cero ganadas es un dato y se conserva · tabla mixta conserva quién tiene dato.

`src/analyzer/awards.variants.test.ts` (12) — clutch: sin dato no se concede · el líder en kills
no se lo lleva · gana quien más ganó, no quien más jugó · no se comparan procedencias distintas ·
compatibilidad con fuentes que sí publican por mapa · cero ganadas ⇒ sin premio. Rookie: sin
status no se concede · status desconocido tampoco · con status válido gana el mejor **entre los
marcados** (no el mejor del torneo). Champion: sin campeón no se afirma un título · con campeón
gana él aunque otro tenga mejor winrate · cambiar el campeón cambia el resultado.

`src/card-generator/variants.blocked.test.ts` (10) — **de punta a punta** (snapshot → modelo →
analyzer → cartas): el roster del campeón y solo él recibe la variante · torneo sin campeón ⇒
ninguna · **cambiar el campeón del fixture cambia quién recibe la carta** · campeón que no juega
⇒ nada · clutch para el líder aunque sea del subcampeón · sin dato ⇒ ninguna carta de clutch ·
el MVP no hereda la carta de clutch · **rookie sigue sin generarse** · **las seis variantes que
ya funcionaban siguen generándose** · determinismo.

`scripts/importer-vlr-verify.ts` — apartado 7.5 nuevo (11 comprobaciones; 58 → **69**). Sin él,
el verify pasaba en verde aunque el conector dejara de leer la clasificación o el clutch.

**Todos los fixtures son sintéticos y se declaran como tales** («Alpha Esports», «London Lions»).
Su *markup* es el real de vlr.gg; ninguna cifra ni nombre de un fixture describe a una persona o
un equipo real.

---

## 11 · Resultado sobre `VCT 2026: EMEA Stage 2`

Ejecución real: 3 páginas de evento + 60 páginas de partido, sin manipular ningún dato.

```
equipos 16 · jugadores 84 · partidos 60 · mapas 146 · mapStats 1.460
modelo canónico ok=true · 0 errores · 0 avisos

campeón detectado : Karmine Corp (t:karminecorp)  ← awards.championTeamId
subcampeón        : Team Liquid
roster del campeón: N4RRATE[21m] · LewN[21m] · Avez[21m] · dos9[21m] · SUYGETSU[21m]
best-clutch       : KROSTALY · 17/73
best-rookie       : OMITIDO (sin fuente)
clutch medido     : 84/84 jugadores
```

Cartas contra el catálogo real (379 jugadores):

| Variante | n | Jugadores |
|---|---|---|
| `champion-edition` | **5** | avez, dos9, lewn, n4rrate, suygetsu |
| `clutch` | **1** | krostaly |
| `mythic` | 1 | n4rrate |
| `top-acs` | 1 | kachoww |
| `top-rating` | 1 | kachoww |
| `top-assist` | 1 | sociablee |
| `top-hs` | 1 | al0rante |
| `top-kills` | 1 | kamo |
| `rookie` | **0** | — *(bloqueada, como debe ser)* |

- Champion Editions: **5**, exactamente el roster de Karmine Corp.
- Jugadores que **no** son del campeón con la carta: **0**.
- Cartas de premio sin regla que las justifique: **0**.
- Recuentos idénticos a la validación previa (16/84/60/146/1.460): **cero regresiones**.

### QA

`npm test` **527/527** · `typecheck` (web + scripts) ✅ · `build` ✅ · `security:verify` ✅ ·
`card-generator:verify` 50/50 · `materializer:verify` 42/42 · `catalog-builder:verify` 44/44 ·
`tournament-orchestrator:verify` 47/47 · `importer:verify` 20/20 · `importer-vlr:verify`
**69/69** · `analyzer:verify` 22/22.

Ficheros tocados: `importer/{types,parse,normalize,model/results}`, `importer-vlr/{types,stats,
normalize,engine,standings}`, `analyzer/{types,player,awards}` y los tests. **Cero cambios** en
Duelos, economía, marketplace, pagos, FTUE, Trainer o APIs.

---

## 12 · Riesgos y deuda restante

1. **`rookie` sigue bloqueada.** Es el resultado correcto, no una tarea pendiente disfrazada.
   Desbloquearla exige decidir de dónde sale `status`: una fuente de rósters (Liquipedia, la web
   de VCT) o autoría editorial explícita con su trazabilidad. **No debe resolverse con un proxy.**
   El test `ROOKIE · sigue bloqueada` se pondrá rojo si alguien lo intenta.

2. **El parser depende del markup de vlr.gg.** Es la misma exposición que ya tenía el conector —
   y que ya mordió una vez, cuando el scoreboard pasó de `<table>` a `<div>`. Mitigación: los dos
   parsers nuevos **se degradan a vacío**, nunca a un valor inventado; un cambio de markup deja
   el torneo sin campeón (visible) en vez de con el campeón equivocado (invisible). Falta una
   alerta activa: hoy no hay ningún aviso si la tabla de clasificación desaparece de un torneo
   terminado, igual que sí lo hay para «mapas sin scoreboard».

3. **`champion-edition` exige `p.maps > 0`** (`rules.ts:89`). Un suplente del campeón que no jugó
   ningún mapa no recibe la carta. Es defendible y es el comportamiento que ya existía, pero es
   una decisión de producto que conviene conocer: en EMEA Stage 2 los 5 jugadores del roster
   jugaron 21 mapas cada uno, así que no se manifestó.

4. **El clutch por mapa sigue sin existir.** `clutchesPerMap`, `clutchScore` y los highlights de
   clutch valen 0 con fuentes tipo vlr.gg. No es un fallo: es que el dato no está publicado a esa
   granularidad. Se ha dejado así deliberadamente en vez de repartir el agregado.

5. **Los puntos de circuito** (`RawPlacement.points`) se leen pero nadie los consume aguas abajo.
   Quedan disponibles para quien los necesite; no se ha añadido consumidor.

6. **La tabla de clasificación solo lista a los equipos premiados** (8 de 16 en este torneo). Es
   suficiente para el campeón, pero `standings` no es una clasificación completa del torneo y no
   debe usarse como tal.
