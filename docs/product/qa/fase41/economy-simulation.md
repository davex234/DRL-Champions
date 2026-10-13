# Simulación de economía · Fase 41

**2.000.000 de trayectorias** (1.000.000 con las reglas ANTERIORES y 1.000.000 con las de la Fase 41), más **800.000
cuentas nuevas** para el starter (8 alternativas × 100.000) y **100.000 secuencias hostiles** contra los servicios reales.

## 1. Método

- **Núcleo:** `src/domain/economy/simulator.ts` (puro, determinista, mulberry32). CLI: `npm run economy:simulator --
  --rules=baseline|fase41 --n=1000000`. Reparto: 250.000 trayectorias por arquetipo, a partes iguales entre los 4 días de
  entrada en la temporada (1, 14, 43 y 71). Horizontes: 1, 7, 30, 90 y 180 días. Temporada 1 = 84 días; después del día
  84 el pase no avanza (la Temporada 2 no existe y no se modela).
- **Cartas reales:** cada sobre se sortea con el pool real (`buildPool`, 772 cartas) y los pesos reales, con la misma
  regla de bucket que `openPack` (incluido `guaranteedMin`) y elección uniforme dentro del bucket. Equivalencia medida con
  `openPack` en `economy-simulation:verify` (20.000 sobres de Inicial, Estándar, Premium y Champions, |Δ| < 0,6 pp por
  bucket). La asistencia de primer equipo reproduce `assist`.
- **Valores reales, no copiados:** tabla PvE (`duelReward`, tope 20), misiones y pase (`data/season`), logros (valores del
  catálogo), Pick'em (`REWARD_TIERS`, acumulable al recorregir, igual antes y después), desafíos de evento, campaña
  (`ROAD_TO_CHAMPIONS`, 1.350), reciclaje (`SALVAGE_BY_BUCKET`), precios (`data/packs`), XP por carta (`xpForCardRank`),
  curva de nivel (`totalXpForLevel`).
- **Reglas `baseline` (antes):** Sobre Inicial gratis sin límite (todos lo usan hasta tener plantilla; HARDCORE además
  farmea 30/día); misiones periódicas re-reclamables dentro de la tanda (cada `goal` de progreso = un cobro, hasta
  `claimVisits` al día); sin asistencia de rol.
- **Reglas `fase41` (después):** asistencia de primer equipo (gratis solo sin plantilla, 2 huecos de rol, tope 8); misiones
  una vez por tanda. **Ningún importe cambia.**
- **Fuera de los arquetipos:** la tienda de créditos de prueba (antes: +28.000 por llamada sin límite) no cabe en una
  distribución finita; se mide como traza de una acción y en el fuzzer.

### Supuestos de comportamiento (arquetipos)

| Arquetipo | Juega (prob./día) | Partidas/día | Dificultad | Victoria/empate | Reclamos/día (baseline) | Compra | Recicla | Pick'em | Campaña/día | Farmeo Inicial (baseline) |
|---|---|---|---|---|---|---|---|---|---|---|
| CASUAL | 0,35 | 1–3 | Fácil | 72 % / 6 % | 1 (60 %) | Estándar ≥ 750 | nunca | 20 % | 0,3 | 0 |
| REGULAR | 0,70 | 3–6 | Normal | 52 % / 7 % | 2 (90 %) | Estándar ≥ 1.500 · Premium ≥ 8.000 | cada 30 días | 50 % | 0,6 | 0 |
| ENGAGED | 0,90 | 8–15 | Normal | 52 % / 7 % | 4 | Estándar ≥ 2.000 · Premium ≥ 4.500 | cada 7 días | 80 % | 1 | 0 |
| HARDCORE | 1,00 | 20–35 | Difícil | 38 % / 7 % | 40 | Estándar ≥ 750 · Premium ≥ 2.500 | a diario | 100 % | 3 | 30 |

Eventos: uno cada 21 días, 7 días de duración. Los supuestos son de comportamiento, no de valores: se publican para poder
discutirlos.

## 2. Resultado en una línea

Antes, las fuentes «recurrentes» (PvE + diarias + semanales) de un jugador ENGAGED llegaban a 19.900 créditos en un día y
las de HARDCORE a 105.650, con un techo real de 11.150. HARDCORE ganaba 2.012.610 créditos en 30 días (P50) y abría
5.401 Sobres Iniciales gratis en 180. Después: máximo diario recurrente 10.330 (≤ 11.150) en 1.000.000 de trayectorias,
Sobres Iniciales gratis P99 = 1 y máx. = 2 (tope 8), y el 100 % puede formar plantilla el día 1.

## 3. Starter · alternativas A–F (100.000 cuentas cada una, motor real)

Objetivo: aperturas de starter totales (bienvenida + gratis extra) **P50 ≤ 4 · P90 ≤ 6 · P99 ≤ 8** y 100 % con plantilla.

| Alt. | Descripción | Plantilla tras la bienvenida | Aperturas P50 / P90 / P99 / P99,9 / máx | Gratis extra máx | Atrapadas | OVR equipo | Rareza en huecos asistidos (C/U/R/É/L %) | Cumple | Decisión |
|---|---|---:|---|---:|---:|---:|---|---|---|
| A | Actual (Fase 40): gratis repetible sin asistencia | 33,97 % | 5 / 9 / 14 / 19 / 28 | 24 | 0 | 80,1 | — | no | rechazada: grifo infinito y P90/P99 fuera |
| B | Sobre de rol completo (5 huecos) | 100 % | 4 / 4 / 4 / 4 / 4 | 0 | 0 | 79,3 | 70,0 / 26,0 / 3,5 / 0,5 / 0 | sí | descartada: cambia el sobre entero |
| C1 | 1 hueco asistido | 50,33 % | 4 / 6 / 6 / 7 / 8 | 4 | 0 | 79,6 | 70,0 / 26,0 / 3,5 / 0,5 / 0 | sí (P90 justo en el límite) | descartada: sin margen |
| **C2** | **2 huecos asistidos** | **79,61 %** | **4 / 5 / 5 / 5 / 6** | **2** | **0** | **79,4** | **70,0 / 26,0 / 3,5 / 0,5 / 0** | **sí** | **ELEGIDA: el mínimo con margen** |
| C3 | 3 huecos asistidos | 99,39 % | 4 / 4 / 4 / 5 / 5 | 1 | 0 | 79,3 | 70,1 / 26,0 / 3,5 / 0,5 / 0 | sí | descartada: más de lo necesario |
| C2* | C2 abriendo primero el Estándar | 99,74 % | 4 / 4 / 4 / 5 / 5 | 1 | 0 | 79,2 | 70,1 / 25,9 / 3,5 / 0,5 / 0 | sí | (orden de apertura; misma política) |
| D | Elegir 1 carta de rol (≈ C1) | 50,33 % | 4 / 6 / 6 / 7 / 8 | 4 | 0 | 79,6 | — | sí | rechazada: el cliente elegiría recompensa |
| E | Bootstrap: 10 cartas fijas al alta | 100 % | 0 | 0 | 0 | — | — | — | rechazada: cambia el alta (migración) y regala plantilla |
| F | C2 + asistencia en el Estándar | 99,79 % | 4 / 4 / 4 / 5 / 5 | 1 | 0 | 79,2 | 68,6 / 26,9 / 4,0 / 0,6 / 0,02 | sí | rechazada: toca odds de un sobre de pago |

La asistencia no sube rareza ni fuerza: rareza idéntica a los pesos del Sobre Inicial (70/26/3,5/0,5) y OVR medio del
equipo 79,4 frente a 80,1 sin asistencia. Verificado otra vez en `player-journey-starter:verify` (100.000 cuentas,
79,94 % con plantilla tras la bienvenida; gratis extra P90 1, P99 1, máx 2) y `economy-starter:verify` (20.000 cuentas:
P50 4, P90 5, P99 5, máx 6).

## 4. Trazas de una acción (cuánto puede dar UNA acción repetida)

| Acción | Antes | Después |
|---|---|---|
| `sandboxPurchase` (producto mayor) | **+28.000 por llamada, sin límite** | 403, +0 |
| Comprar y abrir Sobre Inicial | sobre gratis; con `d-abrir-1` re-reclamable +200 cada vez, +1.500 por cada 10 (`w-sobres-10`), reciclaje ≈ +241 de EV por sobre, logros de 100/1.000 sobres | solo sin plantilla posible (P99 1 en la vida); +0 después |
| Ganar un duelo PvE (Difícil) | +350 dentro del tope; con `d-duelo-1` (+250) y `d-duelo-win` (+400) re-reclamables, **+650 por victoria también por encima del tope** | +350 dentro del tope; misiones una vez por tanda |
| «Actualizar misiones» | re-sorteo con baseline nuevo → misión cobrable otra vez | no-op dentro de la ventana |
| Dos reclamos de misión a la vez | XP del pase sumada dos veces (niveles con créditos y sobres) | una escritura gana; la otra 409, XP una vez |
| Comprar prestigio (2.º jugador del mismo escalón) | respuesta del 1.º jugador (su saldo), sin cobro ni cosmético | cobro y cosmético propios |
| Recompensa con créditos negativos | saldo negativo posible (`app_grant_reward` sin suelo) | rechazada antes de la RPC |
| GET `/api/game/competitive` | creaba ficha de rating 1.000/0 y asentaba el pase | 0 escrituras |

**Farmeo PvE por hora:** el suelo de interfaz es ≈ 31 s por partida y una partida real dura 2–4 min. El valor esperado
en Difícil es 0,38 × 350 + 0,07 × 160 + 0,55 × 60 = 177 créditos por partida: ≈ 2.700–3.500 créditos/hora hasta el tope de
20 partidas (máx. 7.000/día ganándolo todo), y **0** a partir de la 21.ª. Las misiones de duelos pagan una vez por tanda.

## 5. Métricas de salud y objetivos

| Métrica | Objetivo | Antes | Después |
|---|---|---|---|
| Cuentas con plantilla posible el día 1 | 100 % | 100 % (a costa del grifo) | **100 %** |
| Sobres Iniciales gratis por cuenta (máx. en 180 días) | ≤ tope 8 | 27–28 (5.424 HARDCORE) | **2** |
| Créditos recurrentes en un día (máx.) | ≤ techo 11.150 | 105.650 | **10.330** |
| Fuentes infinitas sin tope | 0 | 4 (Inicial, misiones, sandbox, reciclaje alimentado por Inicial) | **0** |
| Compras de sobre de pago con EV de reciclaje ≥ precio | 0 | 0 | 0 |
| Saldo negativo | 0 | posible (recompensa negativa) | 0 (fuzzer 100.000) |

**Observaciones de diseño (medidas, NO cambiadas: «no cambiar recompensas a ojo»):**

1. **El pase se completa rápido.** REGULAR y ENGAGED llegan al nivel 30 en ≈ 30 días (P50) aunque la temporada dure 84;
   CASUAL llega al 23 a los 90 días. La XP del pase sale solo de misiones y las de temporada/hitos dan 2.000–5.000 cada una.
2. **El primer día es generoso.** Con los 6.000 créditos iniciales se compran Estándar suficientes para, el mismo día,
   reunir 50 cartas distintas (`p-coleccion-50`, 3.000) y 40 (`coleccionista`, 4.000) y guardar el primer equipo
   (`s-mazo`, 1.000): CASUAL gana ≈ 16.500 créditos el día 1 (P50), de ellos ≈ 5.300 en logros y ≈ 3.350 en misiones de
   temporada/hitos.
3. **La colección avanza deprisa:** REGULAR tiene el 56 % de las cartas distintas a 30 días y ENGAGED el 95 % a 180.
4. **El reciclaje es la segunda fuente de ENGAGED/HARDCORE** (52.000 y 101.000 a 30 días), siempre con EV por debajo del
   precio del sobre que lo alimenta: devuelve parte del gasto, no imprime.

Son decisiones de balance para una fase de contenido/tuning con criterio de producto, no agujeros: todas las fuentes
están acotadas y el simulador queda listo para evaluarlas.

## 6. Limitaciones

- Arquetipos de comportamiento supuestos (tabla del §1), no telemetría: la BD real tiene 11 cuentas.
- Tasas de victoria fijas por dificultad (el motor de combate no se simula carta a carta).
- PvP, mercado, prestigio y Pick'em por pregunta no se modelan (sin créditos, cerrado, sumidero raro, escalón aleatorio).
- Los desafíos de evento se modelan agregados. La Temporada 2 no existe.

## 7. Fuzzer hostil (servicios reales)

`npm run economy:fuzz` · 100.000 secuencias · 851.178 acciones (compras, aperturas, comprar-y-abrir, reintentos del
mismo gesto, ráfagas concurrentes de 2–4, partidas, reclamos con progreso real, «actualizar», lecturas, sandbox,
reciclaje propio y ajeno, prestigio de dos jugadores a la vez, recompensas negativas, sobres DRAFT/RETIRED/inexistentes).
**17 invariantes, 0 violaciones.** Con los P0 reintroducidos a propósito (re-baseline de misiones y clave de prestigio sin
usuario), el mismo fuzzer detecta 486 violaciones en 1.000 secuencias (`exploit-fuzzer-mutation-check.json`).

## 8. Tablas completas

### Créditos ganados acumulados · antes (baseline) vs después (Fase 41) · P50 / P90 / P99
| Arquetipo | Día | Antes P50 | Antes P90 | Antes P99 | Después P50 | Después P90 | Después P99 |
|---|---|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 16.530 | 19.625 | 25.030 | 16.530 | 19.560 | 25.030 |
| CASUAL | 7 | 31.620 | 40.890 | 49.580 | 24.280 | 30.805 | 38.820 |
| CASUAL | 30 | 50.840 | 73.700 | 87.985 | 37.850 | 48.575 | 58.365 |
| CASUAL | 90 | 82.325 | 110.575 | 152.735 | 59.175 | 85.450 | 124.565 |
| CASUAL | 180 | 92.285 | 121.830 | 163.555 | 71.835 | 96.935 | 135.465 |
| REGULAR | 1 | 20.730 | 24.740 | 27.800 | 19.010 | 23.300 | 26.010 |
| REGULAR | 7 | 61.820 | 77.210 | 88.030 | 35.590 | 43.460 | 51.640 |
| REGULAR | 30 | 228.370 | 266.490 | 292.080 | 141.920 | 159.350 | 171.260 |
| REGULAR | 90 | 415.340 | 519.350 | 568.990 | 239.590 | 282.840 | 305.390 |
| REGULAR | 180 | 517.640 | 636.430 | 693.270 | 328.080 | 381.220 | 411.110 |
| ENGAGED | 1 | 25.280 | 32.730 | 38.840 | 16.070 | 20.710 | 26.760 |
| ENGAGED | 7 | 185.050 | 214.310 | 231.310 | 75.680 | 88.910 | 97.730 |
| ENGAGED | 30 | 496.690 | 563.660 | 609.410 | 212.640 | 234.570 | 248.640 |
| ENGAGED | 90 | 964.330 | 1.251.110 | 1.356.590 | 422.530 | 479.990 | 508.180 |
| ENGAGED | 180 | 1.241.670 | 1.551.710 | 1.667.320 | 691.850 | 759.430 | 796.900 |
| HARDCORE | 1 | 93.420 | 117.500 | 126.390 | 22.930 | 27.920 | 34.980 |
| HARDCORE | 7 | 621.890 | 803.290 | 850.170 | 109.400 | 123.600 | 134.780 |
| HARDCORE | 30 | 2.012.610 | 2.287.700 | 2.417.240 | 334.640 | 359.750 | 379.350 |
| HARDCORE | 90 | 4.317.430 | 5.531.750 | 5.857.730 | 766.770 | 830.230 | 864.160 |
| HARDCORE | 180 | 6.032.470 | 7.245.720 | 7.574.440 | 1.374.190 | 1.448.250 | 1.494.040 |

### Máximo de créditos RECURRENTES en un día (PvE + diarias + semanales) · techo 11.150
| Arquetipo | Antes P50 | Antes P99 | Antes máx | Después P50 | Después P99 | Después máx |
|---|---:|---:|---:|---:|---:|---:|
| CASUAL | 3520 | 4415 | 4510 | 2665 | 4295 | 4510 |
| REGULAR | 7500 | 9400 | 9620 | 4410 | 5240 | 5470 |
| ENGAGED | 14.980 | 19.000 | 19.900 | 5700 | 6670 | 7450 |
| HARDCORE | 60.480 | 97.230 | 105.650 | 7670 | 9110 | 10.330 |

### Fuentes medias a 30 días (créditos por cuenta) · antes → después
| Arquetipo | starter | pve | campaign | mission_daily | mission_weekly | mission_season | pass_free | pass_competitive | achievement | pickem | event | salvage |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 6000 → 6000 | 2006 → 2006 | 208 → 207 | 4224 → 3950 | 16.152 → 6543 | 3999 → 3999 | 9720 → 6399 | 0 → 0 | 8706 → 7860 | 686 → 688 | 702 → 704 | 0 → 0 |
| REGULAR | 6000 → 6000 | 13.025 → 13.025 | 1048 → 1049 | 21.649 → 12.228 | 61.483 → 11.710 | 8501 → 8503 | 15.868 → 14.145 | 20.808 → 19.700 | 14.089 → 12.266 | 1719 → 1719 | 2534 → 2537 | 46.986 → 25.379 |
| ENGAGED | 6000 → 6000 | 42.793 → 42.781 | 1350 → 1350 | 64.392 → 17.495 | 143.658 → 12.890 | 9500 → 9500 | 15.900 → 15.001 | 26.000 → 22.646 | 19.633 → 15.824 | 4392 → 4395 | 4881 → 4882 | 138.542 → 52.023 |
| HARDCORE | 6000 → 6000 | 106.324 → 106.313 | 1350 → 1350 | 370.190 → 19.264 | 394.692 → 12.931 | 9500 → 9500 | 15.900 → 15.104 | 26.000 → 23.000 | 65.692 → 17.868 | 7595 → 7588 | 6601 → 6600 | 932.557 → 100.844 |

### Sumideros medios a 30 días · después
| Arquetipo | Sobre Estándar | Sobre Premium |
|---|---:|---:|
| CASUAL | 37.614 | 0 |
| REGULAR | 68.065 | 32.613 |
| ENGAGED | 49.678 | 152.294 |
| HARDCORE | 27.248 | 294.222 |

### Después (Fase 41) · Saldo (créditos) · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 7730 | 9030 | 10.530 | 12.030 | 13.560 | 14.290 | 19.030 |
| CASUAL | 7 | 200 | 385 | 665 | 2070 | 3440 | 4035 | 6735 |
| CASUAL | 30 | 125 | 285 | 510 | 720 | 1770 | 2620 | 4155 |
| CASUAL | 90 | 75 | 190 | 375 | 560 | 675 | 710 | 740 |
| CASUAL | 180 | 75 | 185 | 375 | 565 | 675 | 710 | 740 |
| REGULAR | 1 | 10.760 | 12.230 | 13.760 | 15.450 | 17.580 | 18.080 | 20.760 |
| REGULAR | 7 | 1240 | 1610 | 2350 | 4350 | 5390 | 6350 | 12.090 |
| REGULAR | 30 | 10.020 | 21.780 | 30.890 | 34.530 | 37.690 | 39.610 | 43.400 |
| REGULAR | 90 | 7600 | 10.930 | 16.970 | 22.390 | 25.990 | 27.960 | 31.600 |
| REGULAR | 180 | 9290 | 10.890 | 12.930 | 15.250 | 17.560 | 19.030 | 22.020 |
| ENGAGED | 1 | 5970 | 7740 | 9930 | 11.930 | 14.440 | 14.960 | 20.870 |
| ENGAGED | 7 | 12.030 | 14.540 | 17.410 | 21.540 | 26.280 | 28.310 | 32.200 |
| ENGAGED | 30 | 1510 | 1850 | 2340 | 3710 | 4500 | 5270 | 5810 |
| ENGAGED | 90 | 1320 | 1430 | 1620 | 1810 | 1920 | 1960 | 1990 |
| ENGAGED | 180 | 1320 | 1430 | 1620 | 1810 | 1920 | 1960 | 1990 |
| HARDCORE | 1 | 10.110 | 11.680 | 13.500 | 15.380 | 18.370 | 19.230 | 25.340 |
| HARDCORE | 7 | 4410 | 5420 | 6830 | 8810 | 12.030 | 15.390 | 19.270 |
| HARDCORE | 30 | 2300 | 3420 | 4770 | 6070 | 7310 | 8200 | 12.460 |
| HARDCORE | 90 | 1620 | 1990 | 2510 | 3230 | 4050 | 4640 | 6660 |
| HARDCORE | 180 | 1750 | 2130 | 2670 | 3390 | 4200 | 4760 | 6330 |

### Después (Fase 41) · Créditos ganados · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 13.730 | 15.030 | 16.530 | 18.030 | 19.560 | 20.290 | 25.030 |
| CASUAL | 7 | 18.510 | 20.600 | 24.280 | 27.620 | 30.805 | 34.140 | 38.820 |
| CASUAL | 30 | 29.470 | 33.065 | 37.850 | 43.120 | 48.575 | 51.795 | 58.365 |
| CASUAL | 90 | 36.155 | 44.350 | 59.175 | 74.415 | 85.450 | 110.455 | 124.565 |
| CASUAL | 180 | 45.695 | 54.950 | 71.835 | 84.725 | 96.935 | 119.860 | 135.465 |
| REGULAR | 1 | 16.010 | 17.550 | 19.010 | 21.020 | 23.300 | 23.810 | 26.010 |
| REGULAR | 7 | 28.620 | 32.280 | 35.590 | 39.330 | 43.460 | 46.490 | 51.640 |
| REGULAR | 30 | 65.850 | 109.120 | 141.920 | 151.580 | 159.350 | 163.620 | 171.260 |
| REGULAR | 90 | 113.910 | 181.630 | 239.590 | 267.310 | 282.840 | 290.950 | 305.390 |
| REGULAR | 180 | 191.590 | 261.120 | 328.080 | 360.800 | 381.220 | 391.960 | 411.110 |
| ENGAGED | 1 | 11.670 | 13.470 | 16.070 | 18.270 | 20.710 | 21.380 | 26.760 |
| ENGAGED | 7 | 62.160 | 69.380 | 75.680 | 82.250 | 88.910 | 92.460 | 97.730 |
| ENGAGED | 30 | 159.540 | 187.810 | 212.640 | 225.210 | 234.570 | 239.640 | 248.640 |
| ENGAGED | 90 | 308.680 | 354.660 | 422.530 | 460.120 | 479.990 | 490.300 | 508.180 |
| ENGAGED | 180 | 572.970 | 623.230 | 691.850 | 733.280 | 759.430 | 772.850 | 796.900 |
| HARDCORE | 1 | 19.250 | 20.860 | 22.930 | 24.980 | 27.920 | 28.940 | 34.980 |
| HARDCORE | 7 | 97.610 | 102.310 | 109.400 | 117.170 | 123.600 | 127.480 | 134.780 |
| HARDCORE | 30 | 276.200 | 307.190 | 334.640 | 348.260 | 359.750 | 366.570 | 379.350 |
| HARDCORE | 90 | 647.130 | 696.750 | 766.770 | 807.440 | 830.230 | 842.400 | 864.160 |
| HARDCORE | 180 | 1.252.800 | 1.304.990 | 1.374.190 | 1.418.240 | 1.448.250 | 1.464.600 | 1.494.040 |

### Después (Fase 41) · Sobres abiertos · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 12 | 12 | 12 | 12 | 13 | 13 | 13 |
| CASUAL | 7 | 28 | 31 | 35 | 43 | 48 | 52 | 59 |
| CASUAL | 30 | 47 | 52 | 59 | 67 | 75 | 80 | 89 |
| CASUAL | 90 | 56 | 69 | 92 | 113 | 129 | 167 | 187 |
| CASUAL | 180 | 69 | 84 | 109 | 128 | 146 | 181 | 203 |
| REGULAR | 1 | 11 | 11 | 11 | 12 | 13 | 13 | 14 |
| REGULAR | 7 | 33 | 40 | 45 | 50 | 55 | 57 | 61 |
| REGULAR | 30 | 79 | 110 | 133 | 141 | 147 | 151 | 157 |
| REGULAR | 90 | 141 | 190 | 240 | 266 | 279 | 286 | 298 |
| REGULAR | 180 | 233 | 284 | 340 | 370 | 388 | 397 | 413 |
| ENGAGED | 1 | 7 | 7 | 8 | 8 | 9 | 9 | 10 |
| ENGAGED | 7 | 41 | 46 | 50 | 53 | 56 | 58 | 60 |
| ENGAGED | 30 | 126 | 141 | 153 | 160 | 166 | 168 | 174 |
| ENGAGED | 90 | 270 | 295 | 331 | 351 | 363 | 369 | 379 |
| ENGAGED | 180 | 506 | 534 | 569 | 592 | 608 | 616 | 631 |
| HARDCORE | 1 | 9 | 11 | 11 | 12 | 13 | 13 | 14 |
| HARDCORE | 7 | 59 | 61 | 64 | 68 | 71 | 72 | 75 |
| HARDCORE | 30 | 155 | 169 | 181 | 188 | 194 | 197 | 204 |
| HARDCORE | 90 | 356 | 379 | 410 | 428 | 439 | 445 | 456 |
| HARDCORE | 180 | 683 | 707 | 737 | 758 | 773 | 782 | 797 |

### Después (Fase 41) · Sobres Iniciales gratis · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| CASUAL | 7 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| CASUAL | 30 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| CASUAL | 90 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| CASUAL | 180 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| REGULAR | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| REGULAR | 7 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| REGULAR | 30 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| REGULAR | 90 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| REGULAR | 180 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| ENGAGED | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| ENGAGED | 7 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| ENGAGED | 30 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| ENGAGED | 90 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| ENGAGED | 180 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| HARDCORE | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| HARDCORE | 7 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| HARDCORE | 30 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| HARDCORE | 90 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |
| HARDCORE | 180 | 0 | 0 | 0 | 0 | 1 | 1 | 1 |

### Después (Fase 41) · Cartas distintas · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 56 | 57 | 58 | 59 | 62 | 63 | 64 |
| CASUAL | 7 | 126 | 138 | 153 | 188 | 202 | 218 | 241 |
| CASUAL | 30 | 198 | 216 | 240 | 265 | 289 | 303 | 330 |
| CASUAL | 90 | 230 | 270 | 334 | 385 | 420 | 485 | 518 |
| CASUAL | 180 | 272 | 314 | 376 | 417 | 452 | 505 | 539 |
| REGULAR | 1 | 52 | 53 | 55 | 59 | 63 | 64 | 68 |
| REGULAR | 7 | 146 | 177 | 195 | 212 | 228 | 237 | 252 |
| REGULAR | 30 | 301 | 382 | 429 | 445 | 458 | 465 | 478 |
| REGULAR | 90 | 442 | 520 | 580 | 604 | 617 | 624 | 635 |
| REGULAR | 180 | 569 | 616 | 655 | 672 | 682 | 688 | 697 |
| ENGAGED | 1 | 35 | 36 | 40 | 42 | 45 | 46 | 49 |
| ENGAGED | 7 | 184 | 200 | 215 | 227 | 237 | 242 | 252 |
| ENGAGED | 30 | 414 | 441 | 463 | 477 | 487 | 493 | 503 |
| ENGAGED | 90 | 608 | 629 | 653 | 666 | 675 | 680 | 687 |
| ENGAGED | 180 | 720 | 728 | 735 | 741 | 745 | 747 | 751 |
| HARDCORE | 1 | 44 | 52 | 58 | 61 | 65 | 66 | 70 |
| HARDCORE | 7 | 241 | 249 | 258 | 268 | 277 | 282 | 291 |
| HARDCORE | 30 | 461 | 483 | 501 | 513 | 523 | 528 | 538 |
| HARDCORE | 90 | 667 | 679 | 693 | 702 | 708 | 712 | 718 |
| HARDCORE | 180 | 752 | 755 | 758 | 761 | 763 | 764 | 766 |

### Después (Fase 41) · Duplicadas · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| CASUAL | 7 | 13 | 16 | 23 | 33 | 41 | 47 | 60 |
| CASUAL | 30 | 36 | 45 | 58 | 73 | 90 | 101 | 124 |
| CASUAL | 90 | 52 | 77 | 128 | 185 | 233 | 360 | 433 |
| CASUAL | 180 | 77 | 110 | 174 | 229 | 286 | 407 | 492 |
| REGULAR | 1 | 1 | 1 | 2 | 3 | 5 | 5 | 7 |
| REGULAR | 7 | 21 | 29 | 37 | 45 | 53 | 59 | 68 |
| REGULAR | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| REGULAR | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| REGULAR | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ENGAGED | 1 | 0 | 0 | 1 | 2 | 3 | 3 | 4 |
| ENGAGED | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ENGAGED | 30 | 23 | 32 | 42 | 50 | 58 | 62 | 71 |
| ENGAGED | 90 | 53 | 60 | 68 | 77 | 85 | 91 | 101 |
| ENGAGED | 180 | 56 | 63 | 71 | 78 | 86 | 90 | 100 |
| HARDCORE | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| HARDCORE | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| HARDCORE | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| HARDCORE | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| HARDCORE | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### Después (Fase 41) · % colección · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 7,3 | 7,4 | 7,5 | 7,6 | 8 | 8,2 | 8,3 |
| CASUAL | 7 | 16,3 | 17,9 | 19,8 | 24,4 | 26,2 | 28,2 | 31,2 |
| CASUAL | 30 | 25,7 | 28 | 31,1 | 34,3 | 37,4 | 39,3 | 42,8 |
| CASUAL | 90 | 29,8 | 35 | 43,3 | 49,9 | 54,4 | 62,8 | 67,1 |
| CASUAL | 180 | 35,2 | 40,7 | 48,7 | 54 | 58,6 | 65,4 | 69,8 |
| REGULAR | 1 | 6,7 | 6,9 | 7,1 | 7,6 | 8,2 | 8,3 | 8,8 |
| REGULAR | 7 | 18,9 | 22,9 | 25,3 | 27,5 | 29,5 | 30,7 | 32,6 |
| REGULAR | 30 | 39 | 49,5 | 55,6 | 57,6 | 59,3 | 60,2 | 61,9 |
| REGULAR | 90 | 57,3 | 67,4 | 75,1 | 78,2 | 79,9 | 80,8 | 82,3 |
| REGULAR | 180 | 73,7 | 79,8 | 84,8 | 87,1 | 88,3 | 89,1 | 90,3 |
| ENGAGED | 1 | 4,5 | 4,7 | 5,2 | 5,4 | 5,8 | 6 | 6,4 |
| ENGAGED | 7 | 23,8 | 25,9 | 27,9 | 29,4 | 30,7 | 31,4 | 32,6 |
| ENGAGED | 30 | 53,6 | 57,1 | 60 | 61,8 | 63,1 | 63,9 | 65,2 |
| ENGAGED | 90 | 78,8 | 81,5 | 84,6 | 86,3 | 87,4 | 88,1 | 89 |
| ENGAGED | 180 | 93,3 | 94,3 | 95,2 | 96 | 96,5 | 96,8 | 97,3 |
| HARDCORE | 1 | 5,7 | 6,7 | 7,5 | 7,9 | 8,4 | 8,6 | 9,1 |
| HARDCORE | 7 | 31,2 | 32,3 | 33,4 | 34,7 | 35,9 | 36,5 | 37,7 |
| HARDCORE | 30 | 59,7 | 62,6 | 64,9 | 66,5 | 67,8 | 68,4 | 69,7 |
| HARDCORE | 90 | 86,4 | 88 | 89,8 | 90,9 | 91,7 | 92,2 | 93 |
| HARDCORE | 180 | 97,4 | 97,8 | 98,2 | 98,6 | 98,8 | 99 | 99,2 |

### Después (Fase 41) · Épicas distintas · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 0 | 0 | 1 | 1 | 2 | 2 | 3 |
| CASUAL | 7 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| CASUAL | 30 | 3 | 4 | 5 | 6 | 7 | 7 | 8 |
| CASUAL | 90 | 3 | 5 | 6 | 7 | 8 | 9 | 9 |
| CASUAL | 180 | 4 | 5 | 6 | 8 | 8 | 9 | 9 |
| REGULAR | 1 | 0 | 0 | 1 | 1 | 2 | 2 | 3 |
| REGULAR | 7 | 3 | 4 | 5 | 6 | 7 | 7 | 8 |
| REGULAR | 30 | 6 | 7 | 8 | 9 | 9 | 9 | 9 |
| REGULAR | 90 | 8 | 9 | 9 | 9 | 9 | 9 | 9 |
| REGULAR | 180 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| ENGAGED | 1 | 0 | 0 | 1 | 2 | 3 | 3 | 4 |
| ENGAGED | 7 | 6 | 7 | 7 | 8 | 9 | 9 | 9 |
| ENGAGED | 30 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| ENGAGED | 90 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| ENGAGED | 180 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| HARDCORE | 1 | 1 | 1 | 2 | 3 | 4 | 4 | 5 |
| HARDCORE | 7 | 8 | 8 | 9 | 9 | 9 | 9 | 9 |
| HARDCORE | 30 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| HARDCORE | 90 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| HARDCORE | 180 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |

### Después (Fase 41) · Legendarias distintas · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| CASUAL | 7 | 0 | 0 | 0 | 1 | 1 | 2 | 3 |
| CASUAL | 30 | 0 | 0 | 1 | 1 | 2 | 2 | 3 |
| CASUAL | 90 | 0 | 0 | 1 | 2 | 3 | 3 | 4 |
| CASUAL | 180 | 0 | 0 | 1 | 2 | 3 | 3 | 4 |
| REGULAR | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| REGULAR | 7 | 0 | 0 | 1 | 1 | 2 | 3 | 3 |
| REGULAR | 30 | 1 | 1 | 2 | 3 | 4 | 5 | 6 |
| REGULAR | 90 | 1 | 2 | 4 | 5 | 6 | 6 | 7 |
| REGULAR | 180 | 2 | 3 | 4 | 5 | 6 | 7 | 7 |
| ENGAGED | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 2 |
| ENGAGED | 7 | 1 | 1 | 2 | 3 | 4 | 4 | 5 |
| ENGAGED | 30 | 3 | 4 | 5 | 5 | 6 | 7 | 7 |
| ENGAGED | 90 | 4 | 5 | 6 | 7 | 7 | 7 | 7 |
| ENGAGED | 180 | 6 | 6 | 7 | 7 | 7 | 7 | 7 |
| HARDCORE | 1 | 0 | 0 | 0 | 1 | 1 | 1 | 2 |
| HARDCORE | 7 | 1 | 2 | 3 | 4 | 5 | 5 | 6 |
| HARDCORE | 30 | 4 | 5 | 6 | 7 | 7 | 7 | 7 |
| HARDCORE | 90 | 6 | 7 | 7 | 7 | 7 | 7 | 7 |
| HARDCORE | 180 | 7 | 7 | 7 | 7 | 7 | 7 | 7 |

### Después (Fase 41) · Nivel del pase · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 2 | 2 | 2 | 3 | 4 | 4 | 5 |
| CASUAL | 7 | 4 | 4 | 6 | 10 | 11 | 11 | 12 |
| CASUAL | 30 | 11 | 12 | 14 | 17 | 20 | 21 | 22 |
| CASUAL | 90 | 11 | 14 | 23 | 29 | 30 | 30 | 30 |
| CASUAL | 180 | 11 | 14 | 23 | 29 | 30 | 30 | 30 |
| REGULAR | 1 | 3 | 3 | 4 | 5 | 5 | 5 | 5 |
| REGULAR | 7 | 7 | 12 | 13 | 15 | 16 | 16 | 17 |
| REGULAR | 30 | 19 | 25 | 30 | 30 | 30 | 30 | 30 |
| REGULAR | 90 | 19 | 30 | 30 | 30 | 30 | 30 | 30 |
| REGULAR | 180 | 19 | 30 | 30 | 30 | 30 | 30 | 30 |
| ENGAGED | 1 | 1 | 2 | 2 | 3 | 3 | 3 | 3 |
| ENGAGED | 7 | 19 | 20 | 20 | 20 | 21 | 22 | 22 |
| ENGAGED | 30 | 25 | 30 | 30 | 30 | 30 | 30 | 30 |
| ENGAGED | 90 | 25 | 30 | 30 | 30 | 30 | 30 | 30 |
| ENGAGED | 180 | 25 | 30 | 30 | 30 | 30 | 30 | 30 |
| HARDCORE | 1 | 2 | 5 | 5 | 6 | 8 | 8 | 8 |
| HARDCORE | 7 | 20 | 20 | 20 | 21 | 22 | 22 | 22 |
| HARDCORE | 30 | 26 | 30 | 30 | 30 | 30 | 30 | 30 |
| HARDCORE | 90 | 26 | 30 | 30 | 30 | 30 | 30 | 30 |
| HARDCORE | 180 | 26 | 30 | 30 | 30 | 30 | 30 | 30 |

### Después (Fase 41) · Nivel de cuenta · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 7 | 7 | 7 | 7 | 7 | 8 | 8 |
| CASUAL | 7 | 12 | 12 | 14 | 16 | 17 | 18 | 19 |
| CASUAL | 30 | 17 | 18 | 20 | 21 | 23 | 24 | 26 |
| CASUAL | 90 | 21 | 24 | 27 | 30 | 33 | 38 | 41 |
| CASUAL | 180 | 26 | 29 | 32 | 35 | 38 | 42 | 45 |
| REGULAR | 1 | 6 | 7 | 7 | 8 | 8 | 8 | 9 |
| REGULAR | 7 | 15 | 17 | 18 | 20 | 21 | 22 | 23 |
| REGULAR | 30 | 29 | 34 | 38 | 39 | 40 | 41 | 42 |
| REGULAR | 90 | 46 | 53 | 59 | 61 | 63 | 64 | 66 |
| REGULAR | 180 | 67 | 73 | 78 | 81 | 83 | 85 | 87 |
| ENGAGED | 1 | 6 | 7 | 7 | 8 | 8 | 8 | 9 |
| ENGAGED | 7 | 22 | 24 | 26 | 27 | 28 | 28 | 29 |
| ENGAGED | 30 | 49 | 51 | 54 | 55 | 56 | 57 | 58 |
| ENGAGED | 90 | 85 | 89 | 92 | 95 | 97 | 98 | 99 |
| ENGAGED | 180 | 129 | 132 | 135 | 137 | 139 | 140 | 142 |
| HARDCORE | 1 | 10 | 10 | 11 | 11 | 11 | 12 | 12 |
| HARDCORE | 7 | 35 | 35 | 36 | 37 | 38 | 38 | 39 |
| HARDCORE | 30 | 74 | 76 | 78 | 79 | 80 | 81 | 82 |
| HARDCORE | 90 | 138 | 140 | 143 | 145 | 146 | 147 | 148 |
| HARDCORE | 180 | 211 | 213 | 215 | 217 | 218 | 219 | 220 |

### Después (Fase 41) · Puntos de rango · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 0 | 0 | 0 | 8 | 16 | 19 | 24 |
| CASUAL | 7 | 8 | 16 | 27 | 40 | 56 | 64 | 80 |
| CASUAL | 30 | 78 | 99 | 123 | 150 | 174 | 190 | 220 |
| CASUAL | 90 | 291 | 329 | 372 | 418 | 460 | 486 | 534 |
| CASUAL | 180 | 630 | 685 | 747 | 811 | 869 | 904 | 972 |
| REGULAR | 1 | 0 | 0 | 28 | 42 | 56 | 56 | 70 |
| REGULAR | 7 | 98 | 131 | 168 | 206 | 243 | 262 | 300 |
| REGULAR | 30 | 575 | 642 | 720 | 800 | 870 | 912 | 993 |
| REGULAR | 90 | 1909 | 2028 | 2162 | 2298 | 2420 | 2494 | 2634 |
| REGULAR | 180 | 3966 | 4136 | 4325 | 4516 | 4689 | 4792 | 4986 |
| ENGAGED | 1 | 14 | 61 | 84 | 103 | 126 | 136 | 154 |
| ENGAGED | 7 | 421 | 487 | 557 | 622 | 679 | 712 | 772 |
| ENGAGED | 30 | 2101 | 2230 | 2372 | 2511 | 2633 | 2705 | 2839 |
| ENGAGED | 90 | 6646 | 6867 | 7110 | 7351 | 7566 | 7692 | 7927 |
| ENGAGED | 180 | 13.559 | 13.872 | 14.218 | 14.560 | 14.865 | 15.048 | 15.387 |
| HARDCORE | 1 | 118 | 148 | 178 | 206 | 242 | 258 | 288 |
| HARDCORE | 7 | 1092 | 1164 | 1248 | 1332 | 1408 | 1452 | 1538 |
| HARDCORE | 30 | 5024 | 5178 | 5350 | 5524 | 5678 | 5772 | 5950 |
| HARDCORE | 90 | 15.490 | 15.756 | 16.054 | 16.356 | 16.626 | 16.788 | 17.088 |
| HARDCORE | 180 | 31.314 | 31.690 | 32.112 | 32.538 | 32.918 | 33.146 | 33.574 |

### Después (Fase 41) · Plantillas disjuntas posibles (diversidad) · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 2 | 2 | 2 | 3 | 3 | 4 | 4 |
| CASUAL | 7 | 5 | 5 | 6 | 7 | 8 | 9 | 10 |
| CASUAL | 30 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
| CASUAL | 90 | 8 | 10 | 12 | 13 | 15 | 15 | 16 |
| CASUAL | 180 | 10 | 11 | 13 | 14 | 15 | 16 | 17 |
| REGULAR | 1 | 1 | 2 | 2 | 3 | 3 | 3 | 4 |
| REGULAR | 7 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
| REGULAR | 30 | 11 | 12 | 14 | 15 | 15 | 16 | 16 |
| REGULAR | 90 | 14 | 16 | 17 | 17 | 17 | 18 | 18 |
| REGULAR | 180 | 17 | 17 | 17 | 18 | 18 | 18 | 18 |
| ENGAGED | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 3 |
| ENGAGED | 7 | 6 | 7 | 8 | 8 | 9 | 10 | 10 |
| ENGAGED | 30 | 13 | 14 | 14 | 15 | 16 | 16 | 16 |
| ENGAGED | 90 | 17 | 17 | 17 | 18 | 18 | 18 | 18 |
| ENGAGED | 180 | 18 | 18 | 18 | 18 | 18 | 18 | 18 |
| HARDCORE | 1 | 1 | 2 | 2 | 3 | 3 | 3 | 4 |
| HARDCORE | 7 | 7 | 8 | 9 | 10 | 10 | 11 | 12 |
| HARDCORE | 30 | 14 | 14 | 15 | 16 | 16 | 16 | 17 |
| HARDCORE | 90 | 17 | 17 | 18 | 18 | 18 | 18 | 18 |
| HARDCORE | 180 | 18 | 18 | 18 | 18 | 18 | 18 | 18 |

### Después (Fase 41) · Créditos de reciclaje · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CASUAL | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CASUAL | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CASUAL | 90 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CASUAL | 180 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| REGULAR | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| REGULAR | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| REGULAR | 30 | 8900 | 19.780 | 28.490 | 31.980 | 34.930 | 36.700 | 40.120 |
| REGULAR | 90 | 22.680 | 46.230 | 67.460 | 77.180 | 84.280 | 88.310 | 95.670 |
| REGULAR | 180 | 49.130 | 77.030 | 104.660 | 118.710 | 129.010 | 134.790 | 145.380 |
| ENGAGED | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ENGAGED | 7 | 6530 | 9120 | 11.590 | 13.960 | 16.150 | 17.500 | 20.130 |
| ENGAGED | 30 | 36.740 | 45.050 | 53.090 | 59.490 | 64.920 | 68.140 | 74.210 |
| ENGAGED | 90 | 89.050 | 108.760 | 134.030 | 149.340 | 160.470 | 166.610 | 178.010 |
| ENGAGED | 180 | 197.470 | 220.210 | 247.830 | 267.380 | 282.350 | 290.740 | 306.100 |
| HARDCORE | 1 | 30 | 100 | 270 | 600 | 870 | 1190 | 1790 |
| HARDCORE | 7 | 18.630 | 21.080 | 24.190 | 27.700 | 31.200 | 33.430 | 37.850 |
| HARDCORE | 30 | 79.400 | 90.840 | 102.040 | 111.290 | 119.440 | 124.330 | 133.620 |
| HARDCORE | 90 | 219.680 | 242.050 | 269.290 | 289.040 | 304.130 | 312.680 | 328.420 |
| HARDCORE | 180 | 465.740 | 490.720 | 519.100 | 542.990 | 562.540 | 573.670 | 594.610 |

### Después (Fase 41) · Reclamos de misión · P10/P25/P50/P75/P90/P95/P99
| Arquetipo | Día | P10 | P25 | P50 | P75 | P90 | P95 | P99 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| CASUAL | 1 | 1 | 2 | 3 | 4 | 5 | 5 | 6 |
| CASUAL | 7 | 5 | 7 | 9 | 11 | 13 | 14 | 16 |
| CASUAL | 30 | 12 | 17 | 22 | 27 | 31 | 34 | 39 |
| CASUAL | 90 | 13 | 21 | 41 | 56 | 65 | 70 | 78 |
| CASUAL | 180 | 13 | 21 | 41 | 56 | 65 | 70 | 78 |
| REGULAR | 1 | 3 | 4 | 6 | 7 | 8 | 8 | 8 |
| REGULAR | 7 | 16 | 18 | 20 | 22 | 24 | 25 | 26 |
| REGULAR | 30 | 32 | 44 | 64 | 69 | 72 | 74 | 78 |
| REGULAR | 90 | 32 | 57 | 110 | 155 | 170 | 175 | 184 |
| REGULAR | 180 | 32 | 57 | 110 | 155 | 170 | 175 | 184 |
| ENGAGED | 1 | 4 | 6 | 6 | 7 | 7 | 7 | 7 |
| ENGAGED | 7 | 25 | 26 | 27 | 29 | 29 | 30 | 31 |
| ENGAGED | 30 | 43 | 66 | 87 | 90 | 92 | 93 | 96 |
| ENGAGED | 90 | 43 | 93 | 164 | 208 | 226 | 230 | 235 |
| ENGAGED | 180 | 43 | 93 | 164 | 208 | 226 | 230 | 235 |
| HARDCORE | 1 | 6 | 7 | 8 | 8 | 9 | 9 | 9 |
| HARDCORE | 7 | 29 | 29 | 29 | 29 | 31 | 31 | 31 |
| HARDCORE | 30 | 47 | 89 | 94 | 96 | 97 | 98 | 100 |
| HARDCORE | 90 | 47 | 116 | 200 | 230 | 244 | 246 | 249 |
| HARDCORE | 180 | 47 | 116 | 200 | 230 | 244 | 246 | 249 |

### Pase a día 90 según el día de entrada en la temporada (después) · P10/P50/P90
| Arquetipo | Día 1 | Día 14 | Día 43 (mitad) | Día 71 (últimas 2 semanas) |
|---|---|---|---|---|
| CASUAL | 25 / 30 / 30 | 23 / 28 / 30 | 15 / 20 / 24 | 4 / 11 / 13 |
| REGULAR | 30 / 30 / 30 | 30 / 30 / 30 | 30 / 30 / 30 | 18 / 19 / 24 |
| ENGAGED | 30 / 30 / 30 | 30 / 30 / 30 | 30 / 30 / 30 | 24 / 25 / 26 |
| HARDCORE | 30 / 30 / 30 | 30 / 30 / 30 | 30 / 30 / 30 | 25 / 26 / 26 |

### Antes (baseline) · Sobres Iniciales gratis y reclamos de misión a 180 días · P50/P99/máx
| Arquetipo | Iniciales gratis P50 | P99 | máx | Reclamos misión P50 | P99 |
|---|---:|---:|---:|---:|---:|
| CASUAL | 1 | 10 | 27 | 54 | 99 |
| REGULAR | 1 | 10 | 28 | 242 | 391 |
| ENGAGED | 1 | 10 | 25 | 666 | 1027 |
| HARDCORE | 5401 | 5410 | 5424 | 3912 | 5789 |

### Salud
| Comprobación | Antes | Después |
|---|---|---|
| CASUAL:primer-equipo-dia-1 | ✓ 250000/250000 con plantilla posible el día 1 | ✓ 250000/250000 con plantilla posible el día 1 |
| CASUAL:fuente-recurrente-acotada | ✓ máximo diario recurrente 4510 vs techo 11150 | ✓ máximo diario recurrente 4510 vs techo 11150 |
| CASUAL:sobre-inicial-acotado | ✗ Sobres Iniciales gratis a 180 días P99 10 · máx 27 (tope 8) | ✓ Sobres Iniciales gratis a 180 días P99 1 · máx 2 (tope 8) |
| REGULAR:primer-equipo-dia-1 | ✓ 250000/250000 con plantilla posible el día 1 | ✓ 250000/250000 con plantilla posible el día 1 |
| REGULAR:fuente-recurrente-acotada | ✓ máximo diario recurrente 9620 vs techo 11150 | ✓ máximo diario recurrente 5470 vs techo 11150 |
| REGULAR:sobre-inicial-acotado | ✗ Sobres Iniciales gratis a 180 días P99 10 · máx 28 (tope 8) | ✓ Sobres Iniciales gratis a 180 días P99 1 · máx 2 (tope 8) |
| ENGAGED:primer-equipo-dia-1 | ✓ 250000/250000 con plantilla posible el día 1 | ✓ 250000/250000 con plantilla posible el día 1 |
| ENGAGED:fuente-recurrente-acotada | ✗ máximo diario recurrente 19900 vs techo 11150 | ✓ máximo diario recurrente 7450 vs techo 11150 |
| ENGAGED:sobre-inicial-acotado | ✗ Sobres Iniciales gratis a 180 días P99 10 · máx 25 (tope 8) | ✓ Sobres Iniciales gratis a 180 días P99 1 · máx 2 (tope 8) |
| HARDCORE:primer-equipo-dia-1 | ✓ 250000/250000 con plantilla posible el día 1 | ✓ 250000/250000 con plantilla posible el día 1 |
| HARDCORE:fuente-recurrente-acotada | ✗ máximo diario recurrente 105650 vs techo 11150 | ✓ máximo diario recurrente 10330 vs techo 11150 |
| HARDCORE:sobre-inicial-acotado | ✗ Sobres Iniciales gratis a 180 días P99 5410 · máx 5424 (tope 8) | ✓ Sobres Iniciales gratis a 180 días P99 1 · máx 2 (tope 8) |
