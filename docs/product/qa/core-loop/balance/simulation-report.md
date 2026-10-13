# F65 · Simulation report

Generado por `npm run balance:simulate` — 252.000 partidas del motor real en 103.3s. Semilla 65000, escala 1, catálogo 331 cartas (huella 2a0e6c1), reglas duel-combat-2, orquestador duel-turns-2. 0 escrituras en BD.

## Partidas por suite

| suite | partidas | s |
|---|---:|---:|
| bots | 108.000 | 20.5 |
| pve | 144.000 | 82.7 |

## Bots

- RANDOM: 19.0 % de media contra el resto
- EASY: 19.6 % de media contra el resto
- NORMAL: 45.9 % de media contra el resto
- HARD: 64.7 % de media contra el resto
- SMART: 71.4 % de media contra el resto
- ORACLE: 80.3 % de media contra el resto

## PvE real (rival de `buildOpponentDeck`)

| mazo | jugador | bot | gana el jugador | empates | OVR bot − jugador |
|---|---|---|---|---|---:|
| RANDOM | NORMAL | EASY | 77.8 % [76.9 %–78.7 %] | 0.1 % | 0.04 |
| RANDOM | NORMAL | NORMAL | 45.0 % [43.9 %–46.0 %] | 0.0 % | 0.04 |
| RANDOM | NORMAL | HARD | 23.6 % [22.7 %–24.5 %] | 0.1 % | 0.05 |
| RANDOM | HARD | EASY | 91.0 % [90.3 %–91.6 %] | 0.0 % | 0.06 |
| RANDOM | HARD | NORMAL | 63.9 % [62.8 %–64.9 %] | 0.0 % | 0.01 |
| RANDOM | HARD | HARD | 42.2 % [41.1 %–43.3 %] | 0.1 % | 0.03 |
| RANDOM | RANDOM | EASY | 49.3 % [48.2 %–50.3 %] | 0.1 % | 0.05 |
| RANDOM | RANDOM | NORMAL | 18.4 % [17.5 %–19.2 %] | 0.0 % | 0.03 |
| RANDOM | RANDOM | HARD | 5.2 % [4.7 %–5.7 %] | 0.0 % | 0.07 |
| OVR_MAX | NORMAL | EASY | 82.6 % [81.7 %–83.4 %] | 0.0 % | -5 |
| OVR_MAX | NORMAL | NORMAL | 44.3 % [43.2 %–45.4 %] | 0.0 % | -5 |
| OVR_MAX | NORMAL | HARD | 16.9 % [16.1 %–17.7 %] | 0.0 % | -5 |
| OVR_MAX | HARD | EASY | 95.1 % [94.6 %–95.6 %] | 0.0 % | -5 |
| OVR_MAX | HARD | NORMAL | 60.5 % [59.4 %–61.6 %] | 0.0 % | -5 |
| OVR_MAX | HARD | HARD | 20.4 % [19.6 %–21.3 %] | 0.0 % | -5 |
| OVR_MAX | RANDOM | EASY | 51.8 % [50.7 %–52.9 %] | 0.0 % | -5 |
| OVR_MAX | RANDOM | NORMAL | 16.7 % [15.9 %–17.5 %] | 0.0 % | -5 |
| OVR_MAX | RANDOM | HARD | 3.3 % [2.9 %–3.7 %] | 0.0 % | -5 |

