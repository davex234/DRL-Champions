# Vertical 6 — Tactical Intelligence Engine · Informe técnico

> La IA ya sabía jugar. Ahora sabe **competir**: piensa como un equipo profesional,
> conoce CONCEPTOS de Valorant (no posiciones), construye la estrategia en caliente,
> modela al rival y se adapta. El entrenador deja de ordenar jugadores y ordena
> **conceptos** ("Explode Main", "Fake → Mid", "Retake agresivo"); la IA los traduce.

Sin cámaras, replay, audio, HUD ni visualizer. Solo inteligencia táctica. `npx tsc
--noEmit` limpio. Validación: **92% de win-rate** del equipo táctico contra el estático.

---

## 1. Arquitectura

Módulo independiente y modular `src/tactics/`. Todo el estado es **plano y clonable**
(vive dentro del `RoundState`, que el motor clona cada tick) y la lógica son funciones
**puras y deterministas**. Se integra en el sim como **opt-in y POR LADO**: cada bando
usa la táctica o el director clásico de forma independiente (eso permite "táctico vs
estático" en el mismo partido).

| Archivo | Rol |
|---|---|
| `types.ts` | Hoja sin imports del sim: Lane, Buy, **ConceptId**, Tactical Graph (nodos/edges), ConceptOrder, OpponentModel, TeamTacticState, Runtime/Setup |
| `concepts.ts` | **Vocabulario**: ficha declarativa de cada concepto (la IA los "conoce") |
| `map.ts` | Abstracción por **carriles** (Main/Tree/Mid → stage·choke·sitio); cambiar de mapa = solo este archivo |
| `economy.ts` | **Economía estimada** (créditos, recompensa, bono de derrota → full/force/eco/bonus) |
| `opponent.ts` | **Modelo del rival**: aprende lanes de ataque/defensa, patrón, jugador dominante; lecturas (anti-strat) |
| `planner.ts` | **Construye** el Tactical Graph desde economía + lecturas + identidad + orden del coach |
| `assign.ts` | Traduce concepto → objetivos por jugador (el único punto que toca SimPlayer) + detección de contacto + rotación |
| `runner.ts` | Avanza el grafo cada tick (condiciones, adaptación) y asigna |
| `engine.ts` | Superficie de integración: `initRuntime`, `stepTactics`, aprendizaje entre rondas |

Integración mínima en el sim (todo retro-compatible):
`RoundState.tactical?` (datos planos) · `createRound(seed, setup, memory?, tactical?)`
construye el runtime · el director, si hay runtime para un lado, delega en
`stepTactics`; si no, usa el objetivo clásico por rol.

No hay scripts ni árboles gigantes: una estrategia nueva = añadir un concepto (ficha +
un pequeño assigner). La IA "sabe aprender" porque el planner **compone**, no recita.

---

## 2. El Tactical Graph

Cada estrategia se descompone automáticamente en un **grafo de datos** (no una lista):

- **Objetivos** (`objective`): p. ej. control de mapa antes del golpe.
- **Acciones** (`action`): el concepto que ejecuta (explode, split, fake, retake…).
- **Fallbacks** (`fallback`): re-hit / save si el plan se tuerce.
- **Adaptaciones** (`adaptation`): rotación al contacto en defensa.

Los nodos se enlazan con **condiciones de datos** (`atCommit`, `contactBad`,
`contactDetected`, `planted`, `outnumbered`…). Ejemplo de un default de ataque:

```
[objective: map_control] --atCommit--> [action: explode]
                                          --contactBad--> [fallback: re-hit]
                                                            --outnumbered--> [fallback: save]
```
Y de defensa:
```
[objective: stack/spread/crossfire] --contactDetected--> [adaptation: rotate]
                                     --planted-->                       --planted--> [action: retake]
```
El runner evalúa, cada tick, las transiciones por **prioridad** (planted > outnumbered
> contactBad > contactDetected > atCommit …) y aplica el concepto del nodo activo.

---

## 3. Cómo decide un EXECUTE

1. **Economía** (`buyOf`): eco → `eco_rush`; force → `explode`/`contact`; full → mezcla.
2. **Lecturas del rival** (`opponent.ts`): `leastDefendedLane` (por dónde no defienden)
   y `worstAttackLane` (dónde llevamos perdiendo). El carril objetivo = el menos
   defendido; si repetimos un carril perdedor, se cambia.
3. **Identidad del equipo**: agresividad alta → `explode`/`split`; baja → `play_picks`.
4. **Tempo → commitTick**: slow≈110, mid≈80, fast≈45 ticks (+ jitter humano); los
   conceptos lentos suman control de mapa antes de comprometer.
5. El director dispara el execute exactamente en `commitTick` (o si el coach lo fuerza),
   lanza la utilidad de entrada y el grafo pasa de `map_control` → `action`.

`play_picks` es pasivo: aguanta el choke y **solo COMPROMETE al lograr ventaja
numérica** (un pick) — por eso convierte el 54% en vez de quedarse esperando.

---

## 4. Cómo decide un FAKE

Cuando el equipo lleva perdiendo un carril (`worstAttackLane.net ≥ 2`) o el rival
defiende muy cargado un lado, el planner elige `fake`: **hit por un carril, finta por
el otro**. En la asignación, durante los primeros ~32 ticks del execute, **2 cuerpos
presionan el choke de la finta** (ruido + util) mientras el resto espera; pasado ese
margen, **todos golpean el carril real**. Como la defensa táctica **rota al carril de
contacto**, la finta la arrastra al lado equivocado y el hit real entra con ventaja.

---

## 5. Cómo decide un RETAKE

Tras el plant, la defensa entra en el nodo `retake` con un **estilo** derivado de la
economía y la identidad (o de la orden del coach):

- `aggressive` → retoma **de inmediato** (delay 0).
- `default` → retoma con un pequeño retardo de coordinación (~30 ticks).
- `save` → **no** retoma (eco: conservar armas), aguanta atrás.

El ancla nunca abandona el sitio; el resto converge al spike. La utilidad de retake
(flash) se lanza al contacto, como ya hacía el motor.

---

## 6. Cómo adapta la estrategia

- **En caliente** (intra-ronda): si el contacto va mal (`contactBad`, en desventaja sin
  trade), el grafo salta a `re-hit` y **cambia de carril**; si la cosa empeora
  (`outnumbered`), a `save`.
- **Defensa reactiva**: detecta el **carril de contacto** (dónde se comprometen de
  verdad los atacantes) y **rota** los holders hacia él (el ancla se queda). Esto
  castiga al ataque estático y es lo que las fintas explotan.
- **Entre rondas** (anti-strat): el `OpponentModel` aprende el patrón del rival; si
  repite un carril, la defensa hace **stack** ahí, y el ataque evita/finta el lado que
  el rival sobre-defiende. La economía estimada arrastra eco/force/bonus.

---

## 7. Validación: ¿parecen más humanas las decisiones?

300 partidos por orientación, mismo roster y semilla, **un equipo táctico vs uno
estático** (director clásico por rol). Determinista.

| Métrica | Resultado |
|---|---|
| **Win-rate del equipo táctico** | **92%** (HOME-táctico 90%, AWAY-táctico 94%) |
| Baseline estático vs estático | HOME 43% (sesgo de roster/lado) |
| Diversidad de ataque (entropía) | **2.53 bits** sobre 6 conceptos (el estático juega 1 fijo) |
| Adaptación en caliente | 3% de rondas (re-hit/save) |
| Rotaciones al contacto | 14% de rondas |
| Anti-strat (stack del patrón) | 49% de rondas |
| Conceptos en ECO | eco_rush dominante (disciplina económica) |

El táctico gana **por encima del 50% en AMBAS orientaciones** → la ventaja es de la
**inteligencia**, no del roster ni del lado. Distribución de ataque emergente:
contact 23%, default 22%, lurk 17%, split 15%, fake 12%, eco_rush 11%. La defensa
**stackea el 84%** porque el rival estático es predecible (anti-strat correcto).

**El entrenador ordena conceptos** (demo, la IA traduce y ejecuta):
- "Default lento" → `default mid` (55% plant)
- "Explode Main" → `explode main` (61%)
- "Fake → hit Mid" → `fake mid (finta main)` (45%)
- "Jugar para picks" → `play_picks mid` (54%, convierte al ganar el pick)
- "Retake agresivo" → `retake main [aggressive]` (45% vs ataque estático)

---

## 8. Qué historias nuevas aparecen

Gracias a esta inteligencia, el `OpponentModel`, las notas tácticas y el grafo dan
material narrativo que antes no existía (consumible por el Match Narrative Engine):
- *"Leyó que el rival siempre entra por Main y empezó a stackearlo."*
- *"Tras perder tres veces el mismo carril, cambió el plan y fintó."*
- *"En eco hicieron un rush a corta y robaron la ronda."*
- *"La rotación llegó tarde y el fake los pilló a contrapié."*
- *"El timeout reordenó el plan y le dieron la vuelta."*

---

## 9. Notas honestas / límites

- El slice tiene **un solo sitio**: los carriles **Main/Mid** son los transitables para
  un ataque en grupo (el grafo de waypoints hace que **Tree** clipe la celda de A-Main y
  oscile, por eso Tree queda para el lurk y los holds defensivos). Los conceptos son
  **map-agnósticos**: en un mapa de 2 sitios, A/B y más carriles salen de reescribir
  solo `map.ts`.
- La **economía es estimada** (el sim no tiene dinero real).
- El 92% es un **techo**: el rival estático es totalmente predecible. Táctico-vs-táctico
  tendería a 50% con más variedad de respuestas (trabajo futuro: meta-juego/conditioning
  más rico y aprendizaje multi-partido persistente).
