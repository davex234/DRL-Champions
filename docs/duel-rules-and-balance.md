# PHASE 7 — DUEL BALANCE & RULES RESOLUTION

Informe de la Fase 7 de Duelos. Cierra OPD-05, OPD-08, OPD-42 y OPD-04, congela las reglas de
resultado y deja la escalera de dificultad medida.

**Ámbito.** Reglas de RESULTADO y calidad de decisión de los bots. No se ha tocado el modelo de
combate, ni las cartas, ni el OVR, ni la tabla de emparejamientos, ni la interfaz, ni la economía,
ni el emparejamiento, ni la persistencia.

Reproducir las cifras de este informe:

```
npm run duel-balance -- 10000     # laboratorio de experimentos
npm run duel-balance:verify       # criterios de aceptación · 180.000 partidas
npm test                          # 308 tests
npm run typecheck
npm run security:verify
```

---

## 1. Auditoría

### 1.1 El PDF original

Se extrajo el texto completo de `PropuestaJuego (1).pdf` (8 páginas, fuentes CID, decodificado con
los `ToUnicode` del propio documento). La sección de Duelos dice, literalmente:

> La partida de duelos constará de batir al mazo rival con las estadísticas de tus cartas. El
> Stronghold (rojo) frente al Entryfrag (verde) y viceversa. El Support (azul) frente al Support.
> Solo se puede utilizar una estadística por carta, después esa carta no se podrá utilizar en el
> resto de la partida. […] **En caso de quedar [empate] el desempate se decidirá sumando las medias
> de las cartas en los mazos.**

Búsqueda exhaustiva de términos en el documento completo:

| término | apariciones | dónde |
|---|---|---|
| `empat` | 1 | la frase del desempate por suma de medias |
| `desempate` | 1 | la misma frase |
| `dificultad` | 0 | — |
| `oculta` / `oculto` | 0 | — |
| `turno` | 0 | — |
| `ataca` | 0 | — |

**Conclusión de la auditoría: el PDF define UN desempate y nada más.** No dice qué pasa cuando dos
valores de un enfrentamiento son idénticos, ni qué pasa cuando la suma de medias también empata, ni
menciona bots, dificultad, ni visibilidad del mazo rival.

### 1.2 Fases 1-6

| pieza | fase | estado antes de la Fase 7 |
|---|---|---|
| `COMBAT_MATCHUP`, `CombatStats`, OVR | 2 | cerrado por el PDF · **intacto** |
| `DuelDeck`, `DuelDeckSnapshot` | 3 | cerrado por el PDF · **intacto** |
| `resolveCombat` (`duel-combat-1`) | 4 | `TIE` sin punto (OPD-05) · `UNRESOLVED_TIEBREAK` (OPD-08) |
| Orquestador (`duel-turns-1`) | 5 | OPD-01/02/03 cerradas · flujo **intacto** |
| Bots (`duel-opponent-1`) | 6 | EASY = azar, NORMAL = heurística, HARD = heurística + info perfecta (OPD-42, OPD-04) |

### 1.3 Localización exacta de las cuatro OPD

| OPD | dónde estaba | evidencia en el PDF |
|---|---|---|
| OPD-05 | `combat/types.ts` `tiedEncounters`, `combat/resolver.ts` `resolveEncounter` | **ninguna** |
| OPD-08 | `combat/types.ts` `CombatStatus.UNRESOLVED_TIEBREAK` | **ninguna** |
| OPD-42 | `opponent/bots.ts`, `opponent/types.ts` `BotDifficulty` | **ninguna** |
| OPD-04 | `opponent/controller.ts` `visibleOpponentCards` | **ninguna** |

> **Las cuatro decisiones de esta fase son decisiones de PRODUCTO.** No se presentan como si
> vinieran del documento, porque no vienen de él. Lo único que el PDF impone y esta fase respeta es
> que el ÚNICO desempate que mueve el marcador sea la suma de las medias.

---

## 2. OPD-05 — empate de un enfrentamiento

### Estado del problema

Un enfrentamiento compara dos enteros de 0 a 99. Medido sobre 60.000 partidas (600.000
enfrentamientos): **el 3,08 % de los enfrentamientos empata**, y **el 25,69 % de las partidas tiene
al menos un empate**. No es un caso de laboratorio.

### Alternativas evaluadas

Las cuatro se evaluaron sobre EXACTAMENTE el mismo conjunto de partidas (comparación pareada: las
estrategias de bot no miran el marcador, así que cambiar la regla de recuento no cambia las
decisiones, solo cómo se cuentan).

| candidata | qué hace |
|---|---|
| **A · NO_POINT** | nadie puntúa (regla vigente) |
| **B · CARD_OVR** | desempate inmediato por el OVR de las dos cartas |
| **C · ATTACKER** | el punto es para el atacante |
| **D · DEFENDER** | el punto es para el defensor |

### Resultados (10.000 partidas por celda, OPD-08 fijado a DRAW para aislar el efecto)

| regla | M1 vs M1 A / B / draw | sesgo 1.er atacante | M2 vs M3 (A) |
|---|---|---|---|
| NO_POINT | 41,14 % / 41,02 % / **17,84 %** | +0,28 % | 65,55 % |
| ATTACKER | 36,81 % / 36,92 % / **26,27 %** | +0,45 % | 67,61 % |
| DEFENDER | 36,94 % / 37,08 % / **25,98 %** | +0,08 % | 67,38 % |
| CARD_OVR | 39,89 % / 39,54 % / **20,57 %** | +0,45 % | 68,83 % |

### Análisis

1. **Ninguna candidata introduce sesgo del primer atacante.** Todas quedan entre −0,12 % y +1,10 %.
   El sesgo NO es el criterio que las separa, en contra de lo que cabría esperar de C y D.
2. **Repartir el punto empeora el problema que se quiere resolver.** C y D suben los empates de
   marcador en espejo del 17,84 % al ~26 %. La causa es estructural: con el atacante alternando 5 y
   5, los empates se reparten a partes casi iguales entre los dos bandos y el marcador se queda
   igualado con MÁS frecuencia, no con menos.
3. **C y D sí cambian quién gana partidas reales** (M2 vs M3 pasa de 65,55 % a ~67,5 %), con un
   criterio que el PDF no contempla.
4. **B mete el OVR dentro de un enfrentamiento.** El PDF define el enfrentamiento como la
   comparación de UNA estadística declarada; el OVR es el criterio del desempate de PARTIDA. Usarlo
   aquí mezcla dos niveles de regla y además desplaza los resultados reales más que ninguna otra
   (M2 vs M3 → 68,83 %).
5. **A es lo único que se deduce del texto.** «Gana el valor mayor»: si no hay valor mayor, no hay
   ganador de ese enfrentamiento.

### DECISIÓN — OPD-05 = `NO_POINT` (sin cambio)

Un enfrentamiento empatado no puntúa para nadie y se contabiliza en `tiedEncounters`.

**Motivo:** es la única política que se deduce de la regla escrita, es la más simple de explicar
(«nadie ganó ese duelo»), no otorga ventaja arbitraria a ningún bando, y es la que MENOS empates de
marcador produce. Las alternativas resuelven menos y cambian más.

La decisión queda declarada como dato, no escondida en el código:
`COMBAT_RULES_V2.encounterTie === "NO_POINT"`.

---

## 3. OPD-08 — empate de marcador y de suma de medias

### Estado del problema

Confirmado el diagnóstico de la Fase 6. Con 10.000 partidas por escenario:

| escenario | doble empate |
|---|---|
| M1 vs M1 | **17,84 %** |
| M2 vs M2 | **18,67 %** |
| M3 vs M3 | **18,26 %** |
| M1 vs M2 / M1 vs M3 / M2 vs M3 | 0,00 % |
| **total** | **9,13 %** |

El 0,00 % de los emparejamientos no espejo no es casualidad: sus sumas de OVR difieren (Δ 20, 22 y
42 puntos), así que el desempate del PDF siempre decide. **El problema es exclusivamente del
espejo**, que es justamente el caso al que apunta cualquier modo competitivo.

### El teorema que descarta la mitad de las alternativas

> Con mazos espejo, **cualquier criterio que sea función del contenido de los mazos vale exactamente
> lo mismo para los dos bandos** y no puede desempatar nunca.

Eso descarta, por construcción y no por medición: victoria por OVR total (es el criterio que acaba
de empatar), suma de estadísticas dominantes, mejor carta restante, y cualquier variante de «mirar
el mazo». También descarta la muerte súbita y el «desempate por mejor carta restante»: tras 10
turnos **no queda ninguna carta**, porque el PDF exige que cada carta gaste su estadística una vez.

### Alternativas evaluadas y poder de resolución medido

Fracción de dobles empates que cada candidata convierte en un resultado con ganador:

| candidata | M1 vs M1 | M2 vs M2 | M3 vs M3 | veredicto |
|---|---|---|---|---|
| A · victoria por OVR total | 0,00 % | 0,00 % | 0,00 % | es el criterio que ya empató |
| B · enfrentamientos ganados | 0,00 % | 0,00 % | 0,00 % | es el marcador, ya empatado |
| C · muerte súbita | — | — | — | imposible: no quedan cartas |
| D · mejor carta restante | — | — | — | imposible: no quedan cartas |
| E · suma de estadísticas dominantes | 0,00 % | 0,00 % | 0,00 % | función del mazo ⇒ igual en espejo |
| F · declarar DRAW | 0,00 % | 0,00 % | 0,00 % | válido, pero deja 18 % de espejos sin ganador |
| G · menos empates de enfrentamiento | 0,00 % | 0,00 % | 0,00 % | simétrico por definición |
| **G′ · margen de estadística declarada** | **99,27 %** | **98,93 %** | **98,69 %** | **único que resuelve** |

`STAT_MARGIN` = Σ(valor declarado por A) − Σ(valor declarado por B) sobre los 10 enfrentamientos.

Funciona porque **no mira el mazo: mide la partida**. Dos jugadores con el mismo mazo declaran
estadísticas distintas en turnos distintos, así que sus totales difieren casi siempre. Es la
diferencia de goles del fútbol trasladada al duelo, y ya está en el audit trail: no hace falta
guardar ni calcular nada nuevo.

### DECISIÓN — OPD-08 = `STAT_MARGIN`, y después `DRAW` explícito

Cadena completa y terminal:

```
enfrentamientos → marcador
                     ├─ desnivelado ────────────────────────► GANADOR          (PDF)
                     └─ empatado → suma de medias (OVR)
                                      ├─ desnivelada ───────► GANADOR +1 punto (PDF)
                                      └─ empatada → margen de estadística declarada
                                                       ├─ desnivelado ───────► GANADOR (Fase 7)
                                                       └─ empatado ──────────► DRAW    (Fase 7)
```

**Exactamente un nivel adicional sobre lo que ya existía, y un terminal explícito.** No hay un
cuarto criterio en ninguna parte y hay un test que lo verifica leyendo el propio resolver.

**El margen NO otorga punto y NO toca el marcador.** Es una línea deliberada: *solo las reglas que
el PDF define pueden mover el marcador*. El desempate por medias sí suma su punto —porque el
documento lo describe así— y el margen solo nombra ganador, dejando constancia en
`marginTiebreak`. Así un 5-5 seguido de «gana A» nunca se confunde con un 6-5 por medias.

`UNRESOLVED` deja de ser alcanzable con las reglas vigentes. Sigue existiendo únicamente como
estado del ruleset histórico `duel-combat-1`, para que las partidas antiguas se puedan volver a
explicar tal y como terminaron.

---

## 4. OPD-42 — escalera de dificultad

### Estado del problema

Escalera de la Fase 6, mazos idénticos M1 vs M1, tasa de victoria de la fila:

| | EASY | NORMAL | HARD | partidas distintas (X vs X) |
|---|---|---|---|---|
| **EASY** | 52,0 % | 0,7 % | 0,1 % | 200 / 200 |
| **NORMAL** | **99,2 %** | 0,0 % | 50,0 % | **2 / 200** |
| **HARD** | **100,0 %** | 0,0 % | 50,0 % | **2 / 200** |

Dos problemas, no uno:

1. **NORMAL y HARD son prácticamente invencibles contra EASY** y prácticamente indistinguibles
   entre sí. No es una escalera.
2. **Hallazgo nuevo de esta fase: NORMAL y HARD son 100 % deterministas.** Con mazos idénticos
   juegan SIEMPRE la misma partida —2 partidas distintas en 200, una por cada primer atacante—. Un
   jugador que repita un duelo contra el bot vería exactamente la misma secuencia de jugadas. Eso es
   un problema de producto por sí solo, independientemente del balance.

### Diseño

La dificultad pasa a tener **una sola palanca: la fracción de decisiones tomadas con heurística.**
El resto de decisiones las toma el azar DETERMINISTA del mismo generador serializable
(`mulberry32`, sin `Math.random`). Ningún nivel ve más, puntúa más ni juega con reglas distintas
(§16: la dificultad está en el *decision making*).

### Barrido medido de la tasa `p` (2.000 partidas por celda)

| p | vs EASY | vs CASUAL | vs p = 1 | partidas distintas (p vs p) |
|---|---|---|---|---|
| 15 % | 62,00 % | 16,25 % | 1,95 % | 200 / 200 |
| 25 % | 67,30 % | 20,80 % | 2,25 % | 200 / 200 |
| 40 % | 76,35 % | 30,70 % | 5,00 % | 200 / 200 |
| **50 %** | **84,15 %** | **37,35 %** | 7,30 % | **200 / 200** |
| 60 % | 87,60 % | 43,80 % | 10,20 % | 200 / 200 |
| 75 % | 93,40 % | 55,80 % | 15,20 % | 200 / 200 |
| **85 %** | **96,55 %** | **65,40 %** | 14,55 % | **196 / 200** |
| 95 % | 98,65 % | 74,95 % | 7,80 % | 114 / 200 |
| 100 % | 99,15 % | 78,95 % | 0,00 % | **2 / 200** |

### DECISIÓN — OPD-42

```ts
DIFFICULTY_PROFILE = {
  EASY:   { heuristicRate: 0.00, perfectInformation: false },
  NORMAL: { heuristicRate: 0.50, perfectInformation: false },
  HARD:   { heuristicRate: 0.85, perfectInformation: false },
}
```

**Por qué 0,50 para NORMAL.** Baja del 99,2 % al 84,2 % contra EASY —claramente por debajo del
100 %— y deja al jugador casual ganando el 65,7 % de sus duelos: competitivo sin ser un muro.

**Por qué 0,85 y no 1,00 para HARD.** Tres razones medidas: conserva la variedad (196 partidas
distintas de 200, frente a 2), impide que sea un bot perfecto (§12), y a partir del 85 % la curva de
fuerza se aplana mientras la variedad se desploma. Además, `p = 1` reduce la partida espejo a una
única secuencia repetida.

`EASY` con `p = 0` es **exactamente** el bot aleatorio de la Fase 6: mismo consumo de generador,
mismas decisiones. Verificado por test.

---

## 5. OPD-04 — información oculta

### Medición

Se midió con el nivel FIJO y la visibilidad como única variable, y con bots estocásticos (p = 0,85)
para que exista distribución y no una única partida repetida.

| escenario | info perfecta vs info pública, cara a cara | aportación vs EASY | aportación vs CASUAL |
|---|---|---|---|
| M1 vs M1 (espejo) | **61,65 %** | +1,70 puntos | **+12,90 puntos** |
| M1 vs M2 | 98,55 % | −0,05 puntos | +1,85 puntos |

### Corrección de la observación de la Fase 6

La Fase 6 concluyó que «la diferencia es pequeña». **Esa observación era engañosa**, y esta fase la
corrige: se había medido contra un bot aleatorio, donde el techo del 96-98 % deja sin margen visible
a cualquier mejora. Medida contra un rival competente, la información oculta vale **casi 13 puntos
de tasa de victoria** y gana el cara a cara 61,65 % a 38,35 %.

### DECISIÓN — OPD-04 cerrada: ningún nivel ve las cartas no jugadas del rival

`perfectInformation: false` en los tres niveles.

**El motivo NO es que no aporte** —aporta, y bastante— sino que **no hace falta**: la tasa de
heurística por sí sola cubre de un 62 % a un 99 % de tasa de victoria contra EASY, así que la
escalera entera se construye sin recurrir a información que el jugador no tiene. Y un bot que ve lo
que su rival no puede ver es indefendible ante ese rival en el momento en que se dé cuenta.

Cambio estructural asociado: **la visibilidad la DECLARA el bot** (`DuelOpponent.perfectInformation`)
en vez de deducirla el controlador de la dificultad. Eso es lo que hizo posible medir la variable
aislada, y deja la puerta abierta a reabrir la decisión con evidencia si algún día se quiere.
`createSmartBot(id, "HARD")` conserva la visibilidad de la Fase 6 para no alterar sus tests.

---

## 6. Implementación

### Reglas versionadas — `src/domain/cardgame/combat/rules.ts` (nuevo)

```ts
COMBAT_RULES_V1 = { version: "duel-combat-1", encounterTie: "NO_POINT",
                    finalTiebreak: "NONE",        terminal: "UNRESOLVED" }
COMBAT_RULES_V2 = { version: "duel-combat-2", encounterTie: "NO_POINT",
                    finalTiebreak: "STAT_MARGIN", terminal: "DRAW" }        // vigente
```

Las decisiones de producto viven como DATO declarado, no como `if` enterrado en el resolver.

### Resolver — `combat/resolver.ts`

`resolveCombat(a, b, plan, rules = CURRENT_COMBAT_RULES)`. Sigue siendo la **única autoridad**:
marcador, los dos desempates, ganador y estado terminal salen de aquí.

Campos nuevos en `CombatResult`, todos serializables:

| campo | para qué |
|---|---|
| `statTotalA` / `statTotalB` | dato de auditoría, presente SIEMPRE (no solo cuando desempata) |
| `marginTiebreak` | desglose del segundo desempate, o `null` |
| `decidedBy` | `SCORE` \| `OVR_TIEBREAK` \| `STAT_MARGIN` \| `NONE` |
| `status` += `DRAW` | empate explícito, distinto de `UNRESOLVED_TIEBREAK` |

Funciones nuevas: `statTotals`, `explainCombatReason`, `auditCombatResult`.

### Orquestador — `match/orchestrator.ts`

**No calcula nada nuevo.** Congela `combatRulesVersion` al empezar y adopta el estado del resolver.
Hay un test que lee el fichero y falla si aparece `sumOvr`, `statTotals`, `tiebreak` o
`marginTiebreak`.

`MatchStatus` += `DRAW`. `DuelMatchResult` += `isDraw`, copiado del resolver y no deducido de
`winner === null`, para que un empate nunca se confunda con una partida sin resolver.

### Bots — `opponent/bots.ts`

`createDuelBot(id, difficulty, override?)`. **No hay una tercera estrategia**: compone las dos
existentes. Con `p = 0` devuelve el bot aleatorio tal cual y con `p = 1` el heurístico tal cual —sin
tirada de mezcla— para que los extremos conserven byte a byte el comportamiento de la Fase 6.
`createRandomBot` y `createSmartBot` siguen exportados y sin cambios de comportamiento.

---

## 7. Simetría y sesgo del primer atacante

Sobre las 180.000 partidas de aceptación (10.000 × 6 emparejamientos × 3 niveles), alternando quién
ataca primero:

| nivel | sesgo del primer atacante (agregado) |
|---|---|
| EASY | **+0,24 puntos** |
| NORMAL | **−1,80 puntos** |
| HARD | **−0,62 puntos** |
| **aislado de la estrategia** (espejo + azar puro) | **+0,34 puntos** |

La última fila es la que mide **las REGLAS**: con azar puro las decisiones no tienen estructura, así
que cualquier ventaja de empezar solo podría venir del reglamento. **+0,34 puntos sobre 30.000
partidas: las reglas no favorecen a quien empieza.**

Espejos, tasa de victoria de A sobre partidas decisivas —todos dentro de 42-58 %—:

| | EASY | NORMAL | HARD |
|---|---|---|---|
| M1 vs M1 | 50,36 % | 49,84 % | 50,38 % |
| M2 vs M2 | 49,74 % | 48,66 % | 50,53 % |
| M3 vs M3 | 49,73 % | 50,28 % | 50,16 % |

---

## 8. Las 10.000 simulaciones finales

`npm run duel-balance:verify` · 6 emparejamientos × 3 niveles × 10.000 = **180.000 partidas**.

| escenario | nivel | A | B | draw | sin resolver | marcador medio | empates | ΔOVR |
|---|---|---|---|---|---|---|---|---|
| M1 vs M1 | EASY | 50,29 % | 49,58 % | 0,13 % | **0,00 %** | 4,74-4,73 | 0,53 | 0 |
| M1 vs M1 | NORMAL | 49,67 % | 49,99 % | 0,34 % | **0,00 %** | 4,84-4,85 | 0,32 | 0 |
| M1 vs M1 | HARD | 45,99 % | 45,29 % | 8,72 % | **0,00 %** | 4,93-4,92 | 0,15 | 0 |
| M2 vs M2 | EASY | 49,64 % | 50,16 % | 0,20 % | **0,00 %** | 4,76-4,78 | 0,46 | 0 |
| M2 vs M2 | NORMAL | 48,52 % | 51,20 % | 0,28 % | **0,00 %** | 4,84-4,88 | 0,28 | 0 |
| M2 vs M2 | HARD | 46,70 % | 45,72 % | 7,58 % | **0,00 %** | 4,96-4,95 | 0,10 | 0 |
| M3 vs M3 | EASY | 49,61 % | 50,15 % | 0,24 % | **0,00 %** | 4,76-4,78 | 0,46 | 0 |
| M3 vs M3 | NORMAL | 50,17 % | 49,61 % | 0,22 % | **0,00 %** | 4,84-4,85 | 0,31 | 0 |
| M3 vs M3 | HARD | 49,65 % | 49,33 % | 1,02 % | **0,00 %** | 4,86-4,87 | 0,26 | 0 |
| M1 vs M2 | EASY | 76,06 % | 23,94 % | 0,00 % | **0,00 %** | 5,79-4,42 | 0,03 | 22 |
| M1 vs M2 | NORMAL | 80,96 % | 19,04 % | 0,00 % | **0,00 %** | 5,97-4,22 | 0,03 | 22 |
| M1 vs M2 | HARD | 92,51 % | 7,49 % | 0,00 % | **0,00 %** | 6,33-3,85 | 0,01 | 22 |
| M1 vs M3 | EASY | 80,38 % | 19,62 % | 0,00 % | **0,00 %** | 5,96-4,00 | 0,20 | 42 |
| M1 vs M3 | NORMAL | 90,54 % | 9,46 % | 0,00 % | **0,00 %** | 6,54-3,48 | 0,12 | 42 |
| M1 vs M3 | HARD | 97,80 % | 2,20 % | 0,00 % | **0,00 %** | 6,95-3,00 | 0,12 | 42 |
| M2 vs M3 | EASY | 65,55 % | 34,45 % | 0,00 % | **0,00 %** | 5,31-4,74 | 0,17 | 20 |
| M2 vs M3 | NORMAL | 78,84 % | 21,16 % | 0,00 % | **0,00 %** | 5,85-4,26 | 0,11 | 20 |
| M2 vs M3 | HARD | 91,68 % | 8,32 % | 0,00 % | **0,00 %** | 6,13-4,08 | 0,04 | 20 |

**0 partidas sin resolver de 180.000. 0 invariantes rotos de 180.000.**

Qué nivel decide (NORMAL): en espejo, marcador ~81 % · **margen ~18 %** · empate ~0,25 %. En no
espejo, marcador ~79 % · desempate del PDF ~21 % · margen 0 %.

---

## 9. Matriz de balance y jugador humano

Mazos idénticos M1 vs M1, tasa de victoria de la FILA:

| | EASY | NORMAL | HARD | CASUAL |
|---|---|---|---|---|
| **EASY** | 51,8 % | 18,1 % | 3,4 % | 9,2 % |
| **NORMAL** | 84,2 % | 48,5 % | 20,1 % | 37,4 % |
| **HARD** | 96,5 % | 80,9 % | 46,5 % | 65,4 % |
| **CASUAL** | 90,2 % | 65,7 % | 36,5 % | 49,0 % |

`EASY < NORMAL < HARD` estricto. Diagonal entre 46,5 % y 51,8 %: cada nivel contra sí mismo es
simétrico. Ninguna celda de NORMAL roza el 100 %.

**CASUAL** es la estrategia de referencia del jugador humano casual (§15): elige carta al azar pero
declara el mejor eje de la carta que ha elegido —el instinto humano evidente—. No es un humano
perfecto ni un humano tonto.

| el jugador casual… | M1 vs M1 | M1 vs M2 (con el mazo mejor) |
|---|---|---|
| contra EASY | gana el **90,2 %** | gana el 99,0 % |
| contra NORMAL | gana el **65,7 %** | gana el 87,6 % |
| contra HARD | gana el **36,5 %** | gana el 69,4 % |

Lectura de producto: EASY es un nivel de aprendizaje, NORMAL es competitivo pero el jugador gana la
mayoría, HARD exige jugar bien y castiga el azar. La fuerza del mazo sigue pesando por encima de la
dificultad, que es lo que debe ocurrir en un juego de colección.

---

## 10. Impacto matemático

- **El modelo de combate no ha cambiado.** `COMBAT_MATCHUP`, `CombatStats`, `combatOvrRaw`,
  `computeCombatOvr`, `applyCombatBoost`, las constantes congeladas VCT-2026, las variantes y la
  composición del mazo están intactas. Verificado por test y por el verify.
- **El marcador no ha cambiado.** Con `NO_POINT` sin tocar y el margen sin otorgar punto, el
  marcador es idéntico al de la Fase 4 en todas las partidas.
- **Lo único que cambia** es el resultado de las partidas que antes quedaban `UNRESOLVED`: el
  9,13 % del total y el ~18 % de los espejos. De ellas, el ~99 % pasa a tener ganador y el ~1 %
  pasa a ser un empate declarado.
- **Ganancia neta:** el 17,84 % de partidas espejo sin resultado baja al 0,13 %-0,34 % de empates
  explícitos con bots estocásticos.

---

## 11. Replay, versionado y serialización

- Un `CombatResult` guarda `resolverVersion`; una `DuelMatch` guarda `combatRulesVersion`.
- `resolveCombat(a, b, plan, getCombatRuleset(guardada))` reproduce **exactamente** el resultado
  original de una partida antigua. Verificado byte a byte.
- Una partida empezada con `duel-combat-1` se **cierra** con `duel-combat-1` aunque el binario
  actual sea otro: las reglas se congelan al arrancar, no al terminar.
- Una versión desconocida **no se sustituye** por las actuales: la partida se queda sin resultado en
  vez de reinterpretarse en silencio.
- Resolver el mismo plan con v1 y v2 da enfrentamientos, marcador y desempate del PDF **idénticos**;
  solo difiere el estado terminal del doble empate. Verificado.
- Versiones incrementadas: `duel-combat-1` → **`duel-combat-2`** (reglas de resultado),
  `duel-turns-1` → **`duel-turns-2`** (la partida ahora guarda sus reglas),
  `duel-opponent-1` → **`duel-opponent-2`** (dificultad y visibilidad). Ninguna se sobrescribe.
- Pausar en el turno 4, serializar a JSON y reanudar produce el mismo resultado que jugar del tirón.

---

## 12. Seguridad

Sin Supabase, sin API, sin red, sin React, sin cliente, sin persistencia. `rules.ts`,
`resolver.ts`, `orchestrator.ts` y `bots.ts` se inspeccionan por test y por el verify: no pueden
contener `Math.random`, `Date.now`, `performance.now`, `crypto.*`, `localStorage`, `supabase`,
`fetch(`, `process.env`, `@/data/catalog`, `@/store`, `@/app` ni `react`.

`npm run security:verify` → **PASS**.

---

## 13. Tests

| suite | antes | después |
|---|---|---|
| total del proyecto | 271 | **308** |
| fallos | 0 | **0** |

**37 tests nuevos** en `src/domain/cardgame/balance.test.ts`: OPD-05, OPD-08 (incluido un fixture de
doble empate *construido*, no encontrado por casualidad), 7 property tests, 5 adversariales,
versionado, replay, serialización, audit trail, OPD-42 y OPD-04, seguridad.

**Dos tests anteriores cambiaron. Ninguno se ha borrado ni debilitado:**

1. `opponent.test.ts` — `OPPONENT_ENGINE_VERSION` pasa de `duel-opponent-1` a `duel-opponent-2`.
   **Por qué:** la escalera de dificultad y el modelo de visibilidad cambiaron; cambiar el
   comportamiento sin cambiar la versión sería el error.
2. `resolver.test.ts` — los dos tests del doble empate pasan a fijar `COMBAT_RULES_V1` de forma
   explícita. **Por qué:** describían el comportamiento histórico, que sigue siendo correcto bajo
   sus reglas. De paso se descubrió que **ambos colgaban de un `if` que nunca se cumplía y pasaban
   sin ejecutar ni una aserción**; ahora usan un fixture de empate absoluto reproducible (el mismo
   mazo contra sí mismo declarando siempre Gamesense) y **sí** comprueban lo que dicen comprobar.
   El cambio los hace más estrictos, no menos.

Las suites de las Fases 1, 2, 3, 4, 5 y 6 pasan sin más modificaciones.

---

## 14. Observaciones de balance

1. **Los empates de enfrentamiento caen cuando sube la habilidad**: 0,53 por partida con EASY, 0,32
   con NORMAL, 0,15 con HARD en espejo. Un bot mejor evita los cruces igualados.
2. **El desempate del PDF nunca se aplica en espejo y decide entre el 14 % y el 24 % de los duelos
   no espejo** (M1 vs M2 23,7 % · M1 vs M3 16,9 % · M2 vs M3 22,0 % con bots aleatorios). Es una
   regla mucho más presente de lo que sugiere el texto, que la trata como caso excepcional.
3. **La fuerza del mazo domina sobre la dificultad**: M1 vs M3 con EASY ya da un 80 %, y con HARD un
   97,8 %. La diferencia de OVR (Δ42) pesa más que la calidad de decisión.
4. **El marcador medio en espejo es 4,8-4,8**, muy lejos de los 5-5 nominales por culpa de los
   empates de enfrentamiento: en un ~19 % de las partidas los 10 puntos no se reparten enteros.

---

## 15. Riesgos

| riesgo | evidencia | mitigación / estado |
|---|---|---|
| **HARD en espejo empata el 8,72 %** de las veces (M1 vs M1) | tabla §8 | es consecuencia de que HARD sea casi determinista: ambos bandos convergen a la misma línea y sus totales coinciden. Es un empate EXPLÍCITO, simétrico y explicable, no un fallo. Si el producto lo considera alto, la palanca es bajar `HARD_HEURISTIC_RATE`; queda documentado, no corregido a ciegas. |
| El margen premia declarar valores altos | por construcción | solo actúa en un doble empate perfecto (~9 % de las partidas, 0 % fuera del espejo). El efecto sobre la estrategia global es despreciable. |
| `CASUAL` es una aproximación, no un humano | §9 | está definido y es reproducible; sirve para comparar niveles entre sí, no para prometer una tasa de victoria concreta a personas reales. |
| Las tasas de la escalera se han medido sobre M1 vs M1 | §9 | los mazos M2 y M3 confirman la simetría en §7-8; la matriz completa por mazo queda para cuando exista emparejamiento real. |

---

## 16. OPD restantes

| OPD | estado tras la Fase 7 |
|---|---|
| OPD-01 · una comparación por enfrentamiento | cerrada en Fase 5 |
| OPD-02 · quién declara la estadística | cerrada en Fase 5 |
| OPD-03 · orden de ataque alterno | cerrada en Fase 5 |
| **OPD-04 · información oculta** | **CERRADA** — ningún nivel la usa (§5) |
| **OPD-05 · empate de enfrentamiento** | **CERRADA** — `NO_POINT` (§2) |
| **OPD-08 · doble empate** | **CERRADA** — `STAT_MARGIN` y después `DRAW` (§3) |
| **OPD-42 · escalera de dificultad** | **CERRADA** — 0 / 0,50 / 0,85 sin información oculta (§4) |
| OPD-xx · química del mazo | **ABIERTA** — el PDF la define (1-3 puntos por liga / nacionalidad / equipo) y aún no está implementada. No es de esta fase. |
| OPD-xx · abandono y rendición | **ABIERTA** — el PDF no los menciona; no se ha inventado un estado `ABANDONED`. |
| OPD-xx · recompensas del duelo | **ABIERTA** — el PDF dice «recompensas por determinar». Fuera del alcance de esta fase. |

---

## 17. Criterio de aceptación

| criterio | estado |
|---|---|
| OPD-05 documentada y cerrada | ✅ |
| OPD-08 documentada y cerrada | ✅ |
| OPD-42 documentada y cerrada | ✅ |
| OPD-04 evaluada con evidencia | ✅ (y corrigiendo la observación de la Fase 6) |
| Sin `UNRESOLVED` accidentales | ✅ 0 de 180.000 |
| Espejos con resultado determinista | ✅ |
| Sin ventaja del primer atacante | ✅ +0,34 puntos aislado de la estrategia |
| EASY el más débil · NORMAL intermedio · HARD el más fuerte | ✅ |
| NORMAL sin ~100 % de tasa de victoria | ✅ 84,2 % contra EASY |
| RNG determinista · replay · serialización | ✅ |
| Combat Resolver única autoridad · orquestador sin matemática duplicada | ✅ verificado leyendo el fichero |
| Cartas, OVR y matchup sin tocar | ✅ |
| Fases anteriores sin romper · tests nuevos, adversariales y de propiedad | ✅ 308/308 |
| 10.000 simulaciones | ✅ 180.000 partidas |
| `tsc` limpio · `security-verify` PASS | ✅ |
