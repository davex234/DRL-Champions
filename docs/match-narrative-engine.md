# Vertical 5 — Match Narrative Engine · Informe técnico

> Convierte una simulación en una **historia**. Narrativa emergente, sin scripts ni
> eventos predefinidos. Módulo **independiente** (`src/narrative/`) que solo
> **consume** estado/eventos del sim: nunca decide gameplay ni muta nada. No es
> "texto bonito": es el **cerebro** que permitirá replay/highlights/comentarista/
> resúmenes/noticias/carrera del jugador en fases futuras.

`npx tsc --noEmit` limpio. Validación: **200 partidos**, determinista, **199/200
historias únicas (100%)**.

---

## 1. Arquitectura

Pipeline de dos fases, todo PURO y determinista. El motor jamás toca el sim, la
cámara, el broadcast, el director ni el visualizer.

```
RoundState (terminado)  ──ingest──►  RoundRecord (memoria por ronda)
                                          │
                       (acumula N rondas) │
                                          ▼
                                     finalize()
   ┌─────────────┬──────────────┬───────────────┬────────────┬───────────┐
 momentum      arcos          héroes/villanos  nodos        story graph  shape
 (EWMA)        (trayectorias)  (standouts)      derivados    (causal)     (forma)
   └─────────────┴──────────────┴───────────────┴────────────┴───────────┘
                                          ▼
                                    NarrativeState
              (timeline · graph · keyMoments · momentum · players ·
               heroes · villains · summary)  +  answerQuestions()
```

| Archivo | Rol |
|---|---|
| `types.ts` | Toda la API tipada (NarrativeEvent, StoryGraph, PlayerArc, Momentum, Shape, NarrativeState) |
| `memory.ts` | `RoundRecord`/`PlayerRoundLine` + proxy de **economía** estimada |
| `importance.ts` | **Sistema de importancia** (base por tipo + contexto) y `roundLeverage` (impacto) |
| `ingest.ts` | Extrae eventos de una ronda (first blood, trades, multikills, **clutch 1vN**, retake, execute, timeout) |
| `momentum.ts` | Serie de momentum (EWMA), shifts y **punto de inflexión** |
| `shape.ts` | Clasifica la **forma** del partido |
| `arcs.ts` | Trayectoria por jugador + etiquetas de estado + rivalidades |
| `heroes.ts` | Héroes / villanos / MVP |
| `graph.ts` | **Nodos derivados** + construcción del **Story Graph** causal |
| `summary.ts` | Beats estructurados + verbalizador por plantilla |
| `query.ts` | Responde las preguntas (¿por qué ganó?, ¿cuándo cambió?, …) |
| `engine.ts` | `MatchNarrator` (ingest/finalize) + `buildMatchNarrative` |

API mínima:
```ts
const n = new MatchNarrator({ teamNames });
for (const round of endedRounds) n.ingestRound(round);
const story = n.finalize();          // NarrativeState
const answers = answerQuestions(story);
// o de una vez:
const story = buildMatchNarrative(endedRounds);
```

---

## 2. Cómo funciona la memoria

"Recordar absolutamente todo" se materializa en dos niveles:

- **Por ronda** (`RoundRecord`): ganador/perdedor, lado, motivo, marcador, diferencia
  de bajas, pistola, planes por equipo, si hubo timeout, confianza/momentum medios por
  equipo, y una **línea por jugador** (`PlayerRoundLine`): kills, deaths, first
  blood/death, multikill, ace, **clutch (tamaño 1vN) y si lo ganó**, supervivencia,
  trade-kills, muerte vengada, confianza/tilt/momentum/presión y **presencia** (impacto
  bruto de la ronda).
- **Por jugador, a lo largo del partido** (`PlayerArc`): agregados, **presencia por
  ronda**, rachas (mejor/peor), forma (EWMA→tanh), rondas decisivas, **rivalidades**
  (duelos repetidos) y **etiquetas de estado**.

Conceptos que el sim NO marca se **reconstruyen** desde el log de bajas: el clutch se
detecta rebobinando los conjuntos de vivos (cuándo un bando cae a 1 con rivales vivos y
luego gana); los trades, por ventana temporal; multikills/ace por conteo.

La **economía** no existe en el sim → se **estima** (proxy claramente marcado): rachas
de derrotas y rondas de pistola producen buckets full/force/eco y eventos `eco_win`.

---

## 3. Cómo se calcula el momentum

Media exponencial de los resultados de ronda (decay 0.6), matizada por el dominio de
bajas dentro de la ronda, en **[-100 (control de B) … +100 (control de A)]**:

```
raw_r   = (+1 si gana A, -1 si gana B) · 70  +  signo · min(20, |killDiff|) · 1.5
value_r = 0.6 · value_{r-1} + 0.4 · raw_r        (acotado a ±100)
control = value > +18 ? A : value < -18 ? B : neutral
```

Un **shift** se registra cuando cambia el control o el salto |Δ| ≥ 40; su `cause` se
enlaza al evento más importante de esa ronda a favor del equipo que gana momentum.

El **punto de inflexión** es la ronda R que maximiza `(momentum medio después de R) −
(antes de R)` hacia el **ganador final** — el instante que más voltea la balanza. En la
validación los puntos de inflexión cubrieron las rondas **2–24** (22 valores distintos):
no hay un guion.

---

## 4. Cómo se detectan héroes y villanos

De los arcos:

- **Héroes**: mayor `impactScore` (suma de la importancia de los eventos donde son
  protagonistas + rondas decisivas). El motivo es estructural: `N aces`, `N clutchs
  ganados`, `dominó el mapa`, `héroe en la derrota`…
- **Villanos**: `villainScore = firstDeaths·6 + tiltPico·0.18 + (desaparecido?22) +
  (frío?8) + (negativo en duelos?10) − impacto·0.12 (+8 si su equipo perdió)`. Motivo:
  `se desvaneció`, `entró en tilt`, `N primeras muertes`…
- **MVP real** = top `impactScore` global (no solo bajas): premia clutchs, rondas
  decisivas y presencia, no el fragteo vacío.
- **Desaparecido** = empezó presente (primer tercio) y se apagó (último tercio).

Etiquetas de estado por jugador: `hot/cold/tilt/clutch/pressure/disappeared/dominant/
leader/anchor`. En la validación, el **67%** de los partidos tuvo al menos un jugador
"desaparecido"; MVPs y héroes variaron (limitado a 8–9 nombres porque el roster de demo
es fijo de 10 jugadores).

---

## 5. Cómo se construye el Story Graph

Un **grafo**, no una lista. Primero se **derivan** nodos que no son eventos crudos:
`momentum_shift, confidence_shift, economy_shift, eco_win, tactical_shift, streak,
inflection, comeback_started, collapse_started, dominance, disappearance, rivalry,
match_end`. Después se enlazan por **reglas causales** sobre (ronda, tipo, a quién
beneficia), y **una arista solo existe si ambos extremos ocurrieron de verdad** → la
cadena emerge:

```
golpe (ace/clutch/multikill/retake/eco_win, equipo T)
  ─caused→     confidence_shift(T)
  ─triggered→  timeout(rival de T)
confidence_shift(T) ─led_to→ momentum_shift(→T)
timeout(T)          ─led_to→ tactical_shift(T)
tactical_shift(T)   ─enabled/reversed→ momentum_shift(→T)
momentum_shift(→T)  ─reinforced→ streak(T)
inflection          ─caused→ comeback_started / collapse_started ─culminated_in→ match_end
```

Ejemplo REAL de la validación (partido remontada 13-7):
```
clutch(r5) —caused→ confidence_shift(r5)        (peso 0.97)
clutch(r5) —triggered→ timeout(r5)              (peso 0.97)
timeout(r5) —led_to→ tactical_shift(r5)         (peso 0.80)
clutch(r5) —contributed_to→ match_end(r22)      (peso 0.68)
```
Media de **~93 nodos y ~47 aristas por partido**. La **importancia** mide cuán notable
es un evento (base por tipo + magnitud 1vN/3k/4k/5k, modulada por lo tardío de la ronda,
lo ajustado del marcador, punto de partido y si volteó la ronda); el **impact** mide
cuánto movió el partido (importancia × `roundLeverage` de su ronda).

`query.ts` recorre el grafo para responder: **¿por qué ganó?** (aristas que culminan en
`match_end`), **¿cuándo cambió?** (inflexión), **¿MVP real?**, **¿quién desapareció?**,
**¿qué decisión fue decisiva?** (timeout/cambio táctico con más peso saliente), **¿cuál
fue el momento más importante?**.

---

## 6. Historias diferentes que aparecieron

200 partidos → **199 historias únicas (100%)**. Distribución de **formas emergentes**:

| Forma | % |
|---|---|
| blowout | 28% |
| dominance | 24% |
| snowball | 18% |
| comeback | 10% |
| nail_biter | 9% |
| miracle | 6% |
| one_sided | 5% |
| trading_blows | 2% |

Tres ejemplos reales (resumen verbalizado + consulta), todos del mismo motor, todos
distintos:

- **Remontada 13-7**: "Equipo B remontó un −5; el partido giró en la ronda 9; drako MVP
  (dominó el mapa); ZephR con 6 primeras muertes; AXIS se desvaneció."
- **Bola de nieve 13-9**: "racha de 7 rondas; sable MVP (2 clutchs); giro en la ronda 5
  tras su timeout."
- **Al filo 13-12**: "4 cambios de liderato; NOVA firmó un clutch 1v2 en la ronda 19 y
  fue MVP; decidido en la ronda 24."

Cambian el ganador, el MVP, el punto de inflexión, la forma y la cadena causal.

---

## 7. Qué desbloquea esta arquitectura

El `NarrativeState` es el sustrato común de las siguientes fases (NO implementadas, pero
ya servidas por estos datos):

- **Replay automático / Highlights**: `keyMoments` + `timeline` (tick/ronda/impacto)
  marcan exactamente qué clip mostrar y en qué orden.
- **Comentarista IA / Resumen / Noticias**: los `StoryBeat` estructurados + el grafo dan
  el guion semántico; un LLM solo verbaliza (el cerebro ya decidió el significado).
- **Historial y carrera del jugador**: los `PlayerArc` (impacto, clutchs, rachas,
  rivalidades, etiquetas) se agregan a temporada → MVP de temporada, narrativa de carrera.
- **Logros**: detectados desde eventos/etiquetas (ace, 1v4, remontada, racha…).
- **Redes sociales internas**: rivalidades y "jugador del momento" como semillas de
  contenido.

Todo emerge de consumir estado + eventos; añadir una nueva consulta o un nuevo consumidor
no toca el sim ni el resto de módulos.

---

## 8. Validación

`scripts/narrative-report.ts` (`npx tsx`): match runner (a 13, cambio de lado, arrastre
mental, timeouts) → `MatchNarrator` → asserts. Determinismo (misma semilla ⇒ misma
historia) **OK**, todos los partidos con ganador **OK**, 199/200 únicas. Salida completa
en `scripts/narrative-report.out.md`.

**Notas honestas:** la economía es un **proxy** (el sim no tiene economía real); los
nombres de equipo son genéricos (no hay equipos reales en el slice); la diversidad de
MVP está acotada por el roster de demo (10 jugadores fijos) — con rosters variados la
diversidad escala sola.
