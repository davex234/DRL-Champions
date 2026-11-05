# QA · Fase 43 — Card Mastery & Deck Strategy 3.0

## Salidas máquina (`npm run deck-strategy:lab`)

| Fichero | Qué es |
|---|---|
| `catalog-strategy.json` | Catálogo real (772 definiciones, 353 jugadores): rangos, percentiles, roles, correlaciones, eje dominante por carta, atípicos |
| `legal-deck-simulation.json` | **1.000.000** equipos legales: distribuciones de medias, forma, orientación, calibración (20.000) frente al millón, **dominancia de OVR** y diversidad Pareto |
| `suggestion-simulation.json` | Colecciones de 50 / 100 / 250 / 500 / 772 definiciones (5.000 ejemplares): legalidad, determinismo, óptimo del eje, tiempos p50/p95/p99; EQUILIBRADO frente a fuerza bruta |
| `swap-fuzz.json` | **100.000** cambios (incluye ajenas y no poseídas) |
| `strategy-fuzz.json` | **100.000** equipos (orden, serial, rareza, equipo, región, edición, NaN, etiquetas acotadas) |
| `match-insight-fuzz.json` | **100.000** historiales sintéticos + **2.000** partidas del motor real |
| `security-fuzz.json` | **100.000** casos: equipo/uid ajeno, rival oculto, stats/OVR/rol/serial falsos, userId arbitrario, recorrido de ruta, tamaños excesivos |
| `*-mutation-*.json` | Regresiones inyectadas que el fuzzer DETECTA: delta erróneo, serial con poder, desempate mal puntuado, cuerpo con campos extra |

## Capturas SINTÉTICAS — `synthetic/` (152)

Arnés `/design-system/fase43?scene=<escena>`: catálogo, validador, análisis y motor **reales**; ejemplares inventados
(banda «QA SYNTHETIC»). 40 escenas × 1440/1024/390 + laboratorio en móvil + lectura de partida + alternativas +
movimiento reducido + teclado (Tab real por CDP) + detalles abiertos. `index.json`: desbordamiento, controles < 44 px,
errores, piezas presentes, foco visible.

Escenas: legal-balanced, legal-stronghold, legal-gamesense, legal-entryfrag, polarized, incomplete-8, invalid-duplicate,
selected-duelist/initiator/controller/sentinel/flex, swap-positive, swap-tradeoff, swap-no-change (gemelos reales
zhe/runner plata), no-alternatives, many-alternatives, unowned-comparison, active-deck, inactive-deck, suggest-balanced,
suggest-entryfrag, pareto-options, context-gamesense, large-5000, two-deck-comparison, prematch-own, pvp-hidden-rival,
pve-permitted, post-match-win/loss/draw, ovr-tiebreak, stat-tiebreak, axis-stronghold/gamesense/entryfrag,
replay-summary, keyboard, strategy-unavailable.

## Evidencia REAL — `real/` (27 capturas)

Cuenta QA existente `8c326e52`, app local → túnel → BD del VPS (solo lectura por SSH). Sin PII.

- `real-qa-run1.log/json` — **ejecución 1**: huella; 3 GET del espacio + análisis/alternativas/sugerencias/comparación →
  0 escrituras; navegador (laboratorio, foco, alternativas, vista previa, plantilla, comparar, pre-partida) → 0
  escrituras; **guardado real** de un cambio legal con `baseVersion` → persiste, activo intacto; guardado con versión vieja
  → **409**; **reversión** → composición original; **una partida PvE Fácil real** (7–3) → lectura por eje = turnos en BD
  (exacta). Un ✗ del instrumento: comparaba el texto del DOM con el punto decorativo «●»; re-verificado ✓ en las
  ejecuciones siguientes.
- `real-qa.log/json` — ejecución 2 tras cambiar el percentil mostrado (misma partida con `MATCH_ID`, sin guardar de nuevo
  con `SKIP_SAVE=1`): todo ✓.
- `real-shots.log/json` — capturas complementarias de solo lectura: repetición 1024/1440, cartas turno a turno, foco y
  vista previa en móvil, plantilla equilibrada en móvil, ficha propia («Comparar para equipo») y no poseída (informativa,
  sin confirmar), comparar equipos en móvil → 0 escrituras.

Instrumentos: `scripts/_fase43-real-qa.ts <creds>`, `scripts/_fase43-real-shots.ts <creds> <matchId>`,
`scripts/_fase43-visual-qa.ts`.

PvP real: no se buscó rival (no hace falta). La privacidad PvP/privado se prueba con la proyección real
(`projectMatchFor` + `buildMatchView`) en la matriz S078–S079, el verificador de seguridad y el fuzzer (0 cartas no
jugadas del rival en vista + lectura).
