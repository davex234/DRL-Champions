# F65 · Simulation report

Generado por `npm run balance:simulate` — 1.430.000 partidas del motor real en 232.8s. Semilla 65000, escala 1, catálogo 331 cartas (huella 2a0e6c1), reglas duel-combat-2, orquestador duel-turns-2. 0 escrituras en BD.

## Partidas por suite

| suite | partidas | s |
|---|---:|---:|
| mirror | 100.000 | 17 |
| side | 100.000 | 17.6 |
| field | 360.000 | 65.9 |
| paired | 211.840 | 29 |
| edition | 54.400 | 7 |
| strategies | 211.500 | 26.8 |
| hillclimb | 56.260 | 5.8 |
| bots | 108.000 | 15.3 |
| pve | 144.000 | 26.9 |
| starter | 72.000 | 9.9 |
| autodeck | 12.000 | 11.7 |
| rng | 0 | 0 |
| integrity | 0 | 0 |

## Posición (espejo y cambio de lado)

| política | primer atacante gana | empates |
|---|---|---|
| HARD espejo | 52.8 % [52.1 %–53.4 %] | 4.2 % |
| NORMAL espejo | 47.8 % [47.2 %–48.4 %] | 0.3 % |
| SMART espejo | 92.7 % [92.2 %–93.1 %] | 47.1 % |
| RANDOM espejo | 49.8 % [49.1 %–50.4 %] | 0.3 % |
| HARD emparejado (efecto de atacar primero) | -0.08634 [-0.09076, -0.08192] | 0.0 % |

## Campo (mazos aleatorios, HARD vs HARD)

- Lado A: 50.1 % [49.9 %–50.3 %] · empates 0.0 % · primer atacante 45.8 % [45.6 %–45.9 %]
- Decidido por: NONE 0.0 % · OVR_TIEBREAK 23.4 % · SCORE 76.2 % · STAT_MARGIN 0.4 %
- Palizas (≥6 de margen) 10.1 % · ajustadas (≤1) 26.8 % · remontadas desde −2 18.1 % · decididas antes del último turno 50.4 %
- Desempate por OVR: 23.4 % de las partidas; el ganador tenía MENOS combate total en 32.3 %
- Sombra: sin OVR cambia el ganador en 10.00 %; con suma de combate en 7.77 %
- corr(dif. OVR, resultado) 0.4363 · corr(dif. combate, resultado) 0.503

| eje | se declara | atacante gana | empate | ataque medio | defensa media |
|---|---|---|---|---|---|
| stronghold | 31.9 % | 74.3 % [74.2 %–74.4 %] | 0.4 % | 79.94 | 55.52 |
| gamesense | 36.1 % | 69.9 % [69.8 %–70.0 %] | 0.9 % | 78.65 | 57.95 |
| entryfrag | 31.9 % | 71.0 % [70.9 %–71.1 %] | 0.4 % | 79.84 | 56.6 |

## Estrategias de construcción contra el campo

| estrategia | gana | OVR | combate | pico medio |
|---|---|---:|---:|---:|
| SPEC_SH | 99.8 % [99.7 %–99.9 %] | 866 | 2285 | 92.1 |
| PEAK_MAX | 99.8 % [99.7 %–99.9 %] | 853 | 2171 | 95.8 |
| COMBAT_MAX | 99.5 % [99.4 %–99.6 %] | 875 | 2353 | 89.5 |
| SPEC_GS | 97.4 % [97.1 %–97.7 %] | 845 | 2196 | 88.9 |
| BALANCED | 95.1 % [94.6 %–95.5 %] | 891 | 2293 | 83.3 |
| OVR_MAX | 92.9 % [92.3 %–93.3 %] | 939 | 2145 | 82.1 |
| SPEC_EF | 86.9 % [86.2 %–87.5 %] | 858 | 2068 | 86.5 |
| RANDOM | 55.4 % [54.4 %–56.4 %] | 863 | 1807 | 77 |
| LOW_OVR | 5.5 % [5.1 %–6.0 %] | 733 | 1656 | 70.9 |

### Matriz (fila gana a columna)

| | OVR_MAX | COMBAT_MAX | PEAK_MAX | BALANCED | SPEC_SH | SPEC_GS | SPEC_EF | LOW_OVR | RANDOM |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **OVR_MAX** | 51 % | 29 % | 3 % | 61 % | 6 % | 29 % | 65 % | 100 % | 86 % |
| **COMBAT_MAX** | 70 % | 44 % | 7 % | 86 % | 13 % | 77 % | 94 % | 100 % | 99 % |
| **PEAK_MAX** | 97 % | 94 % | 51 % | 97 % | 76 % | 99 % | 98 % | 100 % | 100 % |
| **BALANCED** | 41 % | 14 % | 4 % | 49 % | 8 % | 10 % | 76 % | 100 % | 92 % |
| **SPEC_SH** | 94 % | 88 % | 23 % | 94 % | 51 % | 92 % | 99 % | 100 % | 100 % |
| **SPEC_GS** | 70 % | 26 % | 2 % | 89 % | 11 % | 48 % | 72 % | 100 % | 95 % |
| **SPEC_EF** | 35 % | 5 % | 3 % | 25 % | 1 % | 30 % | 55 % | 98 % | 86 % |
| **LOW_OVR** | 0 % | 0 % | 0 % | 0 % | 0 % | 0 % | 3 % | 49 % | 7 % |
| **RANDOM** | 11 % | 2 % | 1 % | 6 % | 1 % | 5 % | 13 % | 95 % | 46 % |

## Búsqueda de mazo dominante

- 10 ascensos × 40 pasos; mejor fuera de muestra 93.0 %; contrajuego específico gana 6.5 %; 75 cartas distintas entre ascensos; núcleo (≥ mitad): 1

## Bots

- RANDOM: 16.1 % de media contra el resto
- EASY: 16.7 % de media contra el resto
- NORMAL: 43.6 % de media contra el resto
- HARD: 65.6 % de media contra el resto
- SMART: 74.2 % de media contra el resto
- ORACLE: 84.6 % de media contra el resto

## PvE real (rival de `buildOpponentDeck`)

| mazo | jugador | bot | gana el jugador | empates | OVR bot − jugador |
|---|---|---|---|---|---:|
| RANDOM | NORMAL | EASY | 80.6 % [79.8 %–81.5 %] | 0.0 % | 0.04 |
| RANDOM | NORMAL | NORMAL | 46.5 % [45.4 %–47.5 %] | 0.1 % | 0.04 |
| RANDOM | NORMAL | HARD | 22.7 % [21.8 %–23.7 %] | 0.1 % | 0.05 |
| RANDOM | HARD | EASY | 93.6 % [93.1 %–94.2 %] | 0.0 % | 0.06 |
| RANDOM | HARD | NORMAL | 69.8 % [68.8 %–70.8 %] | 0.0 % | 0.01 |
| RANDOM | HARD | HARD | 46.2 % [45.1 %–47.3 %] | 0.1 % | 0.03 |
| RANDOM | RANDOM | EASY | 49.3 % [48.2 %–50.3 %] | 0.1 % | 0.05 |
| RANDOM | RANDOM | NORMAL | 16.6 % [15.8 %–17.4 %] | 0.0 % | 0.03 |
| RANDOM | RANDOM | HARD | 3.8 % [3.4 %–4.3 %] | 0.0 % | 0.07 |
| OVR_MAX | NORMAL | EASY | 91.3 % [90.7 %–91.9 %] | 0.0 % | -3 |
| OVR_MAX | NORMAL | NORMAL | 64.4 % [63.3 %–65.4 %] | 0.0 % | -3 |
| OVR_MAX | NORMAL | HARD | 36.1 % [35.1 %–37.2 %] | 0.0 % | -2.98 |
| OVR_MAX | HARD | EASY | 98.7 % [98.4 %–98.9 %] | 0.0 % | -2.99 |
| OVR_MAX | HARD | NORMAL | 87.8 % [87.1 %–88.5 %] | 0.0 % | -3 |
| OVR_MAX | HARD | HARD | 63.5 % [62.4 %–64.5 %] | 0.0 % | -3.01 |
| OVR_MAX | RANDOM | EASY | 61.7 % [60.6 %–62.7 %] | 0.0 % | -3.01 |
| OVR_MAX | RANDOM | NORMAL | 25.7 % [24.8 %–26.7 %] | 0.0 % | -3 |
| OVR_MAX | RANDOM | HARD | 7.0 % [6.5 %–7.6 %] | 0.0 % | -3 |

## Starter

- 300 equipos de bienvenida reales; OVR p50 861 (meta 939); combate p50 1955 (meta 2145)
- contra PvE EASY: 82.5 % [81.8 %–83.1 %]
- contra PvE NORMAL: 50.6 % [49.7 %–51.5 %]
- contra PvE HARD: 26.3 % [25.5 %–27.1 %]
- contra campo (aleatorio, HARD): 37.8 % [37.0 %–38.7 %]
- contra meta OVR_MAX (HARD): 3.6 % [3.3 %–4.0 %]
- contra meta PEAK_MAX (HARD): 0.2 % [0.1 %–0.3 %]

## Autocompletar

- colección de 30: contra PEAK_MAX de la misma colección 28.5 % [26.6 %–30.6 %] · contra COMBAT_MAX de la misma colección 42.4 % [40.3 %–44.6 %]
- colección de 60: contra PEAK_MAX de la misma colección 14.2 % [12.8 %–15.8 %] · contra COMBAT_MAX de la misma colección 31.2 % [29.2 %–33.3 %]
- colección de 120: contra PEAK_MAX de la misma colección 7.7 % [6.6 %–8.9 %] · contra COMBAT_MAX de la misma colección 26.3 % [24.4 %–28.2 %]

## Cartas (sustitución emparejada, contraída)

- corr(OVR, impacto) 0.6334 · corr(combate, impacto) 0.7784 · corr(pico, impacto) 0.8432
- Señaladas: 86 (ver card-metrics.csv)

| top | rol | OVR | SH/GS/EF | impacto |
|---|---|---:|---|---:|
| izu__masters-sdc | Flex | 90 | 96/64/69 | 0.1749 |
| neon__masters-l | Centinela | 93 | 99/73/75 | 0.1612 |
| vo0kashu__masters-l | Centinela | 92 | 99/68/62 | 0.1564 |
| neon__future-star | Centinela | 93 | 99/73/75 | 0.1537 |
| blowz__masters-l | Iniciador | 85 | 91/93/45 | 0.1497 |
| trent__masters-l | Iniciador | 93 | 91/89/52 | 0.1324 |
| blowz__future-star | Iniciador | 89 | 91/93/45 | 0.1288 |
| timotino__future-star | Duelista | 94 | 46/48/95 | 0.1244 |
| xross__future-star | Iniciador | 95 | 87/78/52 | 0.1231 |
| wo0t__masters-l | Flex | 93 | 65/60/85 | 0.1218 |

| fondo | rol | OVR | SH/GS/EF | impacto |
|---|---|---:|---|---:|
| tenten__base | Duelista | 74 | 14/27/60 | -0.1563 |
| supamen__base | Controlador | 75 | 53/60/59 | -0.1498 |
| rosa__base | Iniciador | 72 | 42/48/45 | -0.1382 |
| thyy__base | Duelista | 82 | 35/51/49 | -0.1307 |
| hermes__base | Flex | 77 | 49/56/54 | -0.1209 |
| c1nder__base | Controlador | 72 | 37/61/37 | -0.1164 |
| leviathan__base | Controlador | 79 | 62/63/51 | -0.1127 |
| autumn__base | Duelista | 81 | 63/50/72 | -0.1119 |
| au1__masters-sdc | Centinela | 79 | 57/54/41 | -0.1115 |
| starxo__base | Iniciador | 79 | 60/58/49 | -0.11 |

