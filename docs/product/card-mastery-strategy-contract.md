# Contrato — Card Mastery & Deck Strategy 3.0 (Fase 43)

> Canónico. Dominio puro: `src/domain/deckStrategy/` (`stats`, `catalog`, `analysis`, `swap`, `comparison`,
> `suggestion`, `match`). Presentación: `src/lib/deckStrategy/`. Interfaz: `src/components/duel/strategy/`.
> Verificadores: `npm run deck-strategy:verify` (+ `-analysis`, `-suggestion`, `-security`, `-match`, `-performance`,
> `-content`). Laboratorio: `npm run deck-strategy:lab` (catálogo, 1M equipos, sugerencias, fuzzers).

## 1. Principio

La capa estratégica es **descriptiva**. No crea estadísticas, no da bonificaciones, no cambia el combate y no predice
resultados. Solo lee lo que ya tiene cada carta: **OVR, Stronghold, Gamesense, Entryfrag, rol y jugador**. Rareza,
serial, equipo, región, edición y favoritos **no se leen** (tests y fuzzer lo demuestran).

## 2. Combate canónico (verificado en el repo)

| Pieza | Valor | Fuente |
|---|---|---|
| Orquestador | `duel-turns-2`, 10 turnos, atacante alterno | `domain/cardgame/match/types.ts` |
| Reglas de resultado | `duel-combat-2` | `domain/cardgame/combat/rules.ts` |
| Emparejamientos | Stronghold ↔ Entryfrag, Gamesense ↔ Gamesense | `domain/cards/combat.ts` (`COMBAT_MATCHUP`) |
| Quién elige | El atacante elige carta y estadística; el defensor elige carta y **responde con la estadística que impone la tabla** (`requiredDefenderStat`) | `orchestrator.ts`, `duels.ts playTurn` |
| Turno | Gana el valor mayor (1 punto); **igual = 0 puntos** (OPD-05, `NO_POINT`) | `resolver.ts` |
| Desempates | 1) marcador · 2) suma de OVR de las 10 cartas (**+1 punto**) · 3) estadística total declarada (**sin punto**) · 4) empate explícito (`DRAW`) | `resolver.ts`, `rules.ts` |
| Bots | Fácil 0 · Normal 0,5 · Difícil 0,85 de decisiones con heurística; **ningún nivel ve cartas no jugadas** | `opponent/bots.ts` |
| Qué se sabe | Tus cartas; del rival, solo las jugadas, la carta/estadística que ya declaró al atacar y cuántas le quedan | `lib/duel/matchView.ts`, `pvp/projection.ts` |
| Qué decide el servidor | Todo: legalidad, estadística impuesta, resultado, marcador, desempates, recompensa | `server/services/duels.ts` |

## 3. Estadística y percentiles

- **Resumen por métrica**: media, mediana, mínimo, máximo, desviación **poblacional**, rango.
- **Percentil de carta**: rango percentil de punto medio `100·(#<x + ½·#=x)/N` frente a **todas las definiciones del
  catálogo** de su calibración (`dataVersion`). Derivado en tiempo de ejecución del catálogo recibido.
- **Calibración de equipos**: 20.000 equipos legales sintéticos, semilla fija `43043`. Muestreo: por rol, 2 jugadores
  distintos uniformes; de cada jugador, una definición uniforme; una sola calibración. `legal-deck-simulation.json`
  repite el cálculo con **1.000.000** de equipos: la muestra de 20.000 se separa ≤ 1,4 puntos de percentil en cualquier
  cuantil.
- **Percentil de la media (el que se enseña y da el nivel)**: rango percentil de la **media del equipo** frente a las
  **cartas del catálogo** de su calibración. Ej.: «Stronghold 73,3 · Alto · P76».
- **Percentil frente a equipos legales simulados**: rango percentil de la media frente a la calibración; se muestra en
  «Detalles avanzados». Decisión tomada en QA real: la media de 10 cartas aleatorias tiene σ ≈ 2 de OVR, así que frente a
  equipos simulados casi cualquier equipo cuidado salía P9x (sin distinguir nada); frente a las cartas, el equipo real
  QA sale P73 / P76 / P60 / P61.
- Extremos: «P>99» / «P<1» (nunca redondeo a P100/P0).
- **Niveles**: ALTO ≥ P66,7 · BAJO ≤ P33,3 · MEDIO entre medias (terciles; ningún «80 = bueno»).

## 4. Identidad del equipo (solo con 10 cartas)

`z_eje = (media_eje − μ_eje) / σ_eje` frente a la calibración. Con z ordenados z1 ≥ z2 ≥ z3:

| Regla | Etiqueta |
|---|---|
| z1 − z2 ≥ **1 σ** | «Orientado a X» |
| si no, z1 − z3 < **0,5 σ** | «Equilibrado» |
| si no | «Perfil mixto» (dos ejes por encima del tercero) |

**Forma**: desviación del OVR de las 10 cartas frente a la de la calibración: ≥ P90 «Polarizado», ≤ P10 «Consistente».
**Balance** (texto): «Perfil equilibrado…» / «X destaca; Z es el eje más débil.» / «X e Y por encima de Z.».
Distribución medida en 1M equipos: mixto 63,4 % · orientado a Entryfrag 13,4 % · a Gamesense 9,8 % · a Stronghold
3,8 % · equilibrado 9,5 % (no se fuerza un reparto).

## 5. Fortalezas y puntos flojos (máx. 3 cada uno, solo si son ciertos)

Fortalezas: eje que destaca (orientado) · ejes ALTO · OVR medio ALTO · forma consistente.
Puntos flojos: eje más bajo (si no es equilibrado) · ejes BAJO · «Los dos X están por debajo de la media del equipo en
Y» (Y = eje más bajo, ambos por debajo) · carta con OVR atípico bajo (vallas de Tukey) · forma polarizada.

## 6. Roles y aportación

- **Rol**: media de sus dos cartas, eje con mayor media (empate: SH, GS, EF), diferencia de OVR entre ambas, media del
  rol − media del equipo.
- **Carta**: sus cuatro cifras, − media del equipo, − compañero de rol, percentil de catálogo, y hechos estrictos
  («Mayor/Menor X del equipo»). Nunca «MVP».

## 7. Cambios de carta

- **Alternativas**: cartas **poseídas** del mismo rol que `tryReplace` (que ejecuta `validateDuelDeck`: tamaño, 2 por
  rol, carta y jugador únicos, propiedad, calibración) acepta. **Una opción por definición** (copias = misma opción,
  representada por el uid menor). Orden explícito elegido por el jugador (Δ OVR / SH / GS / EF), nunca «la mejor».
- **Delta exacto**: `media_después − media_antes` por métrica (= `(nueva − sustituida)/10` con 10 cartas); la pantalla
  redondea a un decimal y pone el signo en texto («+0,3», «−0,2», «=») con `aria-label`.
- **Impacto**: orientación antes → después, distancia entre ejes (σ) antes → después, y hasta 3 frases de encaje
  («Sube Gamesense, pero reduce Entryfrag.», «Mejora el eje más débil del equipo (X).», «Mantiene el mismo orden de ejes
  que N.»).
- **Carta no poseída**: `informativeImpact` — mismos deltas, **sin `nextUids`**, sin botón de aplicar.
- **Vista previa**: no guarda. **Aplicar** cambia el borrador; **Guardar** usa el guardado canónico con `baseVersion`;
  **Deshacer cambios** vuelve a lo guardado (local, sin BD).
- Corrección de la Fase 32: el impacto del comparador restaba medias ya redondeadas; ahora el delta sale de medias exactas.

## 8. Comparador de equipos

Medias A y B por métrica, diferencia A − B, orientación de cada uno y OVR medio por rol. Frases: «A tiene +4 de
Entryfrag medio.». **Nunca un ganador.**

## 9. Plantilla por objetivo (nunca «mejor equipo»)

| Objetivo | Definición |
|---|---|
| Priorizar X | maximizar lexicográficamente (Σ X, Σ OVR, Σ otros dos ejes); separable por rol ⇒ **óptimo exacto** (comprobado frente a fuerza bruta) |
| Equilibrado | sujeto a `media OVR ≥ media OVR(equipo de máxima OVR) − σ_OVR`, minimizar `max z − min z`; luego maximizar `min z`; luego Σ OVR. **Enumeración exacta si hay ≤ 200.000 equipos legales**; si no, 66 pesos del símplex + mejora local 1×1 y 2×1 |
| Opciones no dominadas | equipos de los objetivos y de una rejilla de pesos, sin dominados en (Σ OVR, Σ SH, Σ GS, Σ EF), etiquetados «Más OVR / Más X / Más equilibrado» |

Solo cartas poseídas, deterministas, validadas por `checkDraft`; sin serial, rareza, equipo, región, edición, favoritos,
valor de mercado ni información del rival. «Aplicar al borrador» no guarda.

## 10. Pre-partida y privacidad

`PreMatchStrategy` recibe **solo tus cartas**. PvE: el mazo del bot se construye en el servidor al empezar y sus cartas
no jugadas nunca salen; PvP y privado: `projectMatchFor` antes de construir la vista. La lectura estratégica se calcula
sobre esa vista ya proyectada (fuzzer: 0 cartas no jugadas del rival en vista + lectura).

## 11. Después de la partida

`summarizeMatch(turnos persistidos proyectados, resultado)`:

- **Eje de un turno** = la estadística que declaraste o te impusieron.
- **Por eje**: comparaciones, ganadas, perdidas, empatadas, balance de puntos, atacando/defendiendo.
- **Por carta**: su turno (una carta = un turno), estadística y valor.
- **Resolución**: marcador; suma de OVR (+1 punto, a quién); estadística total (sin punto); empate total.
- **Coherencia**: `ganadas + punto de desempate = marcador` y empates = `tiedEncounters`; si no cuadra, se dice y no se
  afirma nada.
- **Hechos, máx. 3**, sin «porque»: «Ganaste 3 de 4 comparaciones de Entryfrag.», «Perdiste 4 de 6 comparaciones de
  Gamesense.», «N turnos terminaron en empate de estadística (0 puntos).».
- **«Ajustar equipo»**: `/duelos/mazos?deck=<equipo propio>&eje=<eje con más derrotas>`; el eje es **contexto** que ordena
  alternativas («no es una recomendación»). Sin equipo propio (PvP ajeno, Draft) no hay enlace.
- **Repetición**: la misma lectura desde `getReplay` (turnos guardados, sin volver a ejecutar el motor). `deckId` solo en
  el PvE propio.

## 12. Seguridad y datos

- Sin endpoint nuevo: el análisis usa la foto de `GET /api/game/duels` (ya acotada a tus ejemplares) y el catálogo público.
- Mutaciones con cuerpo estricto (`parseDeckRequest`): `ovr`, `combat`, `role`, `serial`, `userId`… ⇒ 400. La propiedad
  la decide la BD (`loadOwned`); el combate usa las estadísticas del snapshot del servidor.
- Parámetros de enlace: `eje` contra lista cerrada, `explorar` contra `^[a-z0-9_-]{1,80}$`.
- Cero escrituras al abrir el laboratorio, sugerir, comparar o ver la pre-partida (tests con MemSupabase + huella real).

## 13. Rendimiento (5.000 ejemplares sobre 772 definiciones)

Análisis p95 0,2 ms · alternativas p95 ~25 ms · sugerencia p95 ~63 ms · comparación p95 0,5 ms (objetivos: 20/50/150 ms).
Alternativas en memoria (sin consultas por carta).
