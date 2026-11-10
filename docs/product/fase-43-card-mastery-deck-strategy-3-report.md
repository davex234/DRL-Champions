# Fase 43 — Card Mastery & Deck Strategy 3.0 «Build with purpose. Play with a plan.» · Informe

Fecha: 2026-09-16 · Rama `arch/stabilization` · sin commit, sin deploy, **sin migración** (última: 0053).
Contrato: [`card-mastery-strategy-contract.md`](card-mastery-strategy-contract.md) · QA: [`qa/fase43/README.md`](qa/fase43/README.md).

## Resumen

Mirar las diez cartas y entender **qué tengo, qué me falta, qué cambia si sustituyo una y qué pasó en mi última
partida**, sin tocar el combate ni inventar poder:

- **Laboratorio de equipo** en el constructor: identidad («Orientado a Entryfrag», «Equilibrado», «Perfil mixto»,
  «Polarizado/Consistente»), los tres ejes y el OVR con percentil frente a las cartas del catálogo, hasta 3 fortalezas y
  3 puntos flojos, roles y detalles avanzados plegados.
- **Carta seleccionada**: aportación (frente a la media, a su compañero de rol y al catálogo) y **alternativas reales
  tuyas** con deltas exactos («SH +2,6 · GS −1,6 · EF +1,9»), vista previa con identidad y balance antes → después, sin
  guardar; «Deshacer cambios».
- **Plantilla por objetivo** (Equilibrado / Priorizar Stronghold / Gamesense / Entryfrag) y opciones no dominadas. Nunca
  «el mejor equipo».
- **Comparar equipos** propios sin ganador. **Pre-partida** (PvE, ranked y nodo de campaña) con el perfil del propio equipo.
- **Lectura de la partida** (resultado PvE, PvP y repetición): «Perdiste 3 de 5 comparaciones de Entryfrag», desglose
  por eje y por carta, explicación exacta del desempate, «Ajustar equipo» con el eje como contexto.
- **Colección**: «Comparar para equipo» (propia) y «Comparar con mi equipo» (no poseída, solo informativa).

## Hallazgos de diseño (medidos)

| Tema | Medida | Decisión |
|---|---|---|
| Dominancia de OVR | Correlación OVR~eje por carta 0,80 / 0,60 / 0,38; R² del OVR medio sobre la media de eje en 1M equipos 0,76 / 0,49 / 0,27; en 120 colecciones el equipo de máxima OVR **nunca** coincide con el de máximo eje; 4,87 opciones Pareto de media | **OVR no domina por completo**: Gamesense y sobre todo Entryfrag dejan decisiones reales. Stronghold va muy ligado al OVR (P2 de diseño, sin rebalancear) |
| Percentil frente a equipos simulados | Media de 10 cartas aleatorias: σ OVR 2,04; el equipo real QA salía P99/P88/P96 | El percentil mostrado es frente a las **cartas del catálogo** (real QA: P73/P76/P60/P61); el de equipos pasa a detalles avanzados |
| Orientación | 1M equipos: mixto 63,4 % · Entryfrag 13,4 % · Gamesense 9,8 % · Stronghold 3,8 % · equilibrado 9,5 %; forma 10/80/10 | Umbrales en σ (1 y 0,5), sin forzar reparto |
| Equilibrado como «max min z» | Seguía al OVR y devolvía «Orientado a Stronghold» | Redefinido: mínima distancia entre ejes con suelo de OVR (máx − 1σ); exacto 60/60 frente a fuerza bruta |
| Calibración | 20.000 frente a 1.000.000: ≤ 1,39 puntos de percentil | Muestra representativa |

## Bugs encontrados y corregidos

1. Delta del comparador de la Fase 32 calculado restando medias **ya redondeadas** (podía decir «=» con +0,09).
2. El comparador enseñaba «Rareza ▲ +10» en verde, como si la rareza fuese poder → «solo colección».
3. Percentiles saturados (P100/P9x) frente a equipos simulados → percentil frente a cartas + «P>99/P<1».
4. Sugerencia EQUILIBRADA en mínimos locales (25 % exacta) → enumeración exacta ≤ 200.000 equipos (100 %).
5. Equilibrado definido como max-min z devolvía equipos orientados → redefinición con suelo de OVR.
6. Instrumentos: comparación de texto con el «●» decorativo; literal NUL en el script de laboratorio.

## Gates

Ejecución final sobre el código definitivo: **67/67 en verde** — `npm test` **3.702/3.702** (base 3.446 · +256),
typecheck web + scripts, `next build`, eslint (ficheros de la fase) y 63 verificadores: deck-strategy ×7 (nuevos),
live-service ×6, economy ×7, battlepass, security, pack, content, distribution, importer-vlr, combat, deck, social,
replay, competitive, season ×5, campaign ×4, daily-loop ×3, pack-objective ×3, collection ×5, pack-opening ×3,
draft-gauntlet ×5, player-journey ×4.

Una ejecución previa falló en dos puntos, corregidos: el test de UI vivía en `components/duel/strategy` y el invariante
de duelo lo trataba como componente (movido a `src/lib/deckStrategy`), y la sugerencia EQUILIBRADA superó 150 ms en p95
(155 ms) → selección por rol lineal en vez de ordenar por cada peso (p95 68 ms).

Economía: `seasonBudget()` sin diferencias, techo diario 11.150, tabla de duelos y niveles de Pick'em con la misma huella
que la Fase 42; la única variación real es la recompensa PvE normal de la partida de QA (+120 créditos, +60 XP, +8 puntos).

## P2

- Stronghold muy correlacionado con OVR (R² 0,76): priorizar Stronghold y priorizar OVR se parecen. Solo análisis.
- EQUILIBRADO por encima de 200.000 equipos legales es heurístico (tiempo acotado); su calidad exacta solo se mide en
  colecciones pequeñas.
- Sin rival real para PvP en QA real: la privacidad se prueba con la proyección real (matriz, verificador, 10.000
  intentos de fuzzer, 1.000 simulaciones).
- Sin histórico por equipo (no hay snapshot fiable de equipo por partida en el pasado): la lectura es de la partida.
- La lectura en PvP no ofrece «Ajustar equipo» (el id del equipo del PvP no está en la vista).
