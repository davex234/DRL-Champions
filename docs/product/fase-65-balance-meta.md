# FASE 65 · BALANCE & META 5.0 — Competitive Integrity / Simulation Lab

**Veredicto: GO.**
- Laboratorio reproducible sobre el motor real: 1.430.000 partidas en 233 s.
- Un bug de implementación probado y arreglado: la integridad del mazo en PvP.
- 0 cambios de balance impreso y 0 cambios de reglas; los cambios de regla quedan como propuestas con simulación en sombra.
- 0 migraciones. Huella dorada del motor intacta.
- Evidencia en `docs/product/qa/fase65-balance/`.

## A · Línea base y método

1. **Línea base** (`baseline.json`):
   - Tests: 5.286 verdes antes de F65.
   - Catálogo: 331 cartas jugables y 196 jugadores. Roles: Flex 70, Duelista 73, Centinela 64, Controlador 61, Iniciador 63.
   - Agentes: 29.
   - Migraciones: 57, cabeza `0057_admin_cms`.
   - Flags: `GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false`.
   - Motor: `duel-turns-2` / `duel-combat-2`, huella dorada F61 `590d2997…`.
2. **Reglas leídas del código** (`rules.json`, no de la documentación):
   - Mazo: 10 cartas, 2 por rol, jugador único.
   - Partida: 10 turnos con ataque alterno.
   - Turno: el atacante elige carta y eje; el defensor VE carta, eje y valor, elige carta, y su eje lo impone la tabla (SH↔EF, GS↔GS).
   - Enfrentamiento: gana el valor mayor; la igualdad no puntúa.
   - Desempate: suma de OVR IMPRESO (+1 punto al marcador) → margen de estadística declarada → DRAW.
3. **Poder de carta:**
   - Combate = base del jugador + `statBoost` de la edición, que hoy es 0 en TODAS las ediciones.
   - El OVR impreso sale del manifiesto y cambia por edición.
   - En los 91 jugadores con varias ediciones, el combate es idéntico entre ellas y el OVR no.
4. **Laboratorio** (`src/domain/balance/lab.ts`):
   - Una partida es `startDuelMatch` + `advanceBots` (los bots reales) + `resolveCombat`.
   - Los mazos pasan por `validateDuelDeck` y se congelan con `takeDeckSnapshot`.
   - No se reimplementa ni una línea de combate.
5. **Ejecución:**
   - `npm run balance:simulate` con `--scale`, `--seed`, `--suites` y `--out`.
   - Agrega en streaming con contadores sumables y no guarda partidas enteras.
   - Escribe los 18 entregables más `simulation-report.md`.
6. **Determinismo:**
   - Semilla por suite = SEED ^ fnv1a(suite); semilla de partida = fnv1a(`SEED:suite:i`).
   - Dos corridas completas dieron números idénticos.
   - `simulation-config.json` guarda el head de git, la huella del catálogo (`2a0e6c1`), las versiones y `dbWrites: 0`.
7. **Escala:**
   - 1.430.000 partidas: espejo 100.000, lado 100.000, campo 360.000, sustitución emparejada 211.840, edición 54.400, estrategias 211.500, búsqueda 56.260, bots 108.000, PvE 144.000, starter 72.000, autocompletar 12.000.
   - Rendimiento: ~0,1 ms por partida, un solo proceso.
8. **Políticas:**
   - RANDOM, EASY, NORMAL y HARD son los bots de producción.
   - SMART es heurística al 100 % con información pública.
   - ORACLE ve el mazo rival; solo existe en el laboratorio.
9. **Generadores de mazo:**
   - RANDOM (legal, roles barajados).
   - Estrategias exactas por puntuación (retroceso con poda): OVR_MAX, COMBAT_MAX, PEAK_MAX, BALANCED, SPEC_SH/GS/EF y LOW_OVR, más variantes con ruido estable.
   - Rival de PvE (`pveOpponentDeck`).
   - Starter real (`simulateStarter` → `autocomplete`).
10. **Equivalencias fijadas por test:**
    - OVR_MAX del laboratorio = `autocomplete` real.
    - `pveOpponentDeck` = `buildOpponentDeck` del servidor (huella SHA-256 del código fuente).
    - El desempate en sombra CURRENT = la decisión del motor en todas las partidas.

## B · Posición y lado

11. **Lado A/B:** 50,1 % [49,9–50,3] en el campo. No hay sesgo de lado.
12. **Atacar primero es DESVENTAJA:**
    - En el campo HARD, el primer atacante gana 45,8 % [45,6–45,9].
    - Emparejado (misma pareja de mazos y misma semilla, solo cambia quién abre): **−8,6 pp** [−9,1; −8,2].
13. **Causa (regla, no bug):**
    - El defensor decide viendo el valor del ataque.
    - Con el ataque alterno, el segundo jugador defiende siempre con una carta MÁS entre la que elegir: 10/8/6/4/2 frente a 9/7/5/3/1.
    - Por turno, el atacante gana 66–74 %. Los turnos impares (ataca el primer jugador) son los más bajos: 66,4 % en el 1 frente a 73,7 % en el 2.
14. **Mitigación existente:**
    - El servidor sortea el primer atacante con `crypto.randomInt` en PvE y PvP.
    - Es justo en esperanza; añade varianza por partida.
    - Propuesta P-2 en `rule-change-proposal.md`.
15. **Espejos** (mismo mazo en los dos lados), primer atacante:
    - NORMAL 47,8 %, RANDOM 49,8 %, HARD 52,8 %.
    - SMART 92,7 % con 47 % de empates. Es un artefacto del bot 100 % determinista en espejo, no un modo real.
16. **Ventaja del atacante por enfrentamiento:** 71,7 %. Es simétrica porque cada lado ataca 5 veces.

## C · Estadísticas, ejes y roles

17. **Distribución del catálogo** (casi simétrica): medias SH 64,5 · GS 63,7 · EF 62,4. Pico de la carta: SH 94, GS 118, EF 119.
18. **Por eje declarado** (campo HARD):

    | eje | declarado | el atacante gana |
    |---|---:|---:|
    | SH | 31,9 % | 74,3 % |
    | GS | 36,1 % | 69,9 % |
    | EF | 31,9 % | 71,0 % |

    El SH rinde más porque se responde con EF, que es bajo en Controladores e Iniciadores (≈49).
19. **Especialistas** contra el campo: SPEC_SH 99,8 %, SPEC_GS 97,4 %, SPEC_EF 86,9 %.
    - Con 2 por rol es más fácil apilar SH: está alto en 3 roles. El EF alto se concentra en Duelista y Flex.
20. **Roles** (`role-metrics.csv`):
    - El impacto medio por rol es ≈0 por construcción (la sustitución se hace dentro del rol).
    - El atacante gana 69,8 % (Flex) – 74,8 % (Duelista).
    - El defensor gana 25,1 % (Centinela) – 32,6 % (Controlador).
21. **Escasez:**
    - Iniciador: 40 jugadores (el rol más corto).
    - Controlador: 4 cartas en el 10 % superior de combate, frente a 11 en Flex.
    - No bloquea mazos: 0 starters inválidos.
22. **Regla de jugador único coherente:** el ataque «mismo jugador, otra edición» se rechaza con `DUPLICATE_PLAYER`.

## D · Cartas

23. **Métricas por carta** (`card-metrics.csv`): exactamente 331 filas.
    - Campo observado: partidas, tasa de victoria, % al atacar y al defender.
    - Impacto causal por sustitución emparejada: 320 parejas por carta, con IC 95 %.
    - Contracción empírico-bayesiana: τ entre cartas = 6,97 pp.
    - Puesto por impacto frente a puesto por OVR, y bandera.
24. **Qué predice el poder de una carta:** pico 0,84 > suma de combate 0,78 > **OVR 0,63**. La correlación OVR–combate de catálogo es 0,52.
25. **Atípicas** (|impacto| > 2τ con IC que excluye 0):
    - 5 altas: izu masters-sdc, neon ×2, vo0kashu masters-l y blowz masters-l, entre +15 y +17 pp.
    - 2 bajas: tenten base (14/27/60) y supamen base, en torno a −15 pp.
26. **OVR mal etiquetado** (puesto por impacto y puesto por OVR distan más de 100 de 331): 42 cartas donde el OVR subestima y 37 donde sobrestima.
27. **Ediciones:**
    - Cambiar la edición baja por la alta del mismo jugador (combate idéntico) mejora el resultado **+2,6 pp** [2,4; 2,7].
    - El resultado cambia en el 2,6 % de las partidas y llega a +8,8 pp (s0pp 79→94).
    - Viene SOLO del desempate por OVR.
28. **Propuestas de carta:** `card-balance-proposals.json` (CB-1 atípicas, CB-2 etiqueta de OVR). **No aplicadas.**

## E · Mazos, meta y contrajuego

29. **Matriz de estrategias** (`matchups.csv`, 1.500 partidas por celda): PEAK_MAX gana a todas.

    | contra | PEAK_MAX gana |
    |---|---:|
    | OVR_MAX | 97 % |
    | COMBAT_MAX | 94 % |
    | BALANCED | 97 % |
    | SPEC_SH | 76 % |
    | SPEC_GS | 99 % |
    | SPEC_EF | 98 % |

30. **OVR_MAX** (el mejor OVR, 939) pierde contra PEAK_MAX (853), SPEC_SH, COMBAT_MAX y SPEC_GS. El OVR no es poder.
31. **Búsqueda de mazo dominante:**
    - 10 ascensos × 40 pasos con números aleatorios comunes.
    - Mejor mazo: **93 %** fuera de muestra contra un campo mixto nuevo.
32. **Contrajuego:** un mazo buscado específicamente contra el mejor gana solo **6,5 %**.
33. **Núcleo dominante:** no hay mazo único (75 cartas distintas entre ascensos; núcleo ≥ mitad = 1 carta, loita future-star). Hay un **arquetipo** dominante: apilar el eje pico.
34. **Diagnóstico de meta:**
    - El atacante declara su mejor eje y el defensor queda obligado al que fija la tabla, así que el pico manda.
    - Propuesta P-4: una fase de diseño de contrajuego con su propia simulación.

## F · Desempates, marcadores y ritmo

35. **Quién decide:** marcador 76,2 %, suma de OVR impreso **23,4 %**, margen 0,4 %, empate 0,006 %.
36. **El 5-5 es frecuente:** el 94 % de las partidas no tiene enfrentamientos empatados, así que el margen casi siempre es par. De ahí los 6-5 (5-5 más el punto por OVR).
37. **En los desempates por OVR, el ganador tenía MENOS combate total en el 32,3 %.**
38. **Sombra** (mismas partidas, otra regla):

    | regla | ganador distinto | empates | primer atacante gana | el ganador del desempate tenía más combate / declaró más |
    |---|---:|---:|---:|---|
    | sin OVR | 10,0 % | 0,23 % | 48,3 % | 66,5 % / 100 % |
    | suma de combate | 7,8 % | ≈0 | 46,0 % | 99,6 % / 66,3 % |
    | margen antes que OVR | 9,8 % | 0,006 % | 48,3 % | 66,5 % / 99,1 % |

39. **Propuesta P-1** (`duel-combat-3`, NO aplicada): margen de estadística declarada → suma de combate → DRAW. Premia la partida, quita la ventaja de edición y estrecha la asimetría de posición.
    - Riesgo a medir: sacrificar la carta más baja deja de ser gratis, y los bots no lo modelan.
40. **Diferencia de poder frente a resultado:** el mazo con más OVR puntúa 60 % con diferencia < 2,5 y 81 % con diferencia ≥ 27,5; el de más combate, 51 % (< 10) → 87 % (≥ 110). El combate predice mejor (corr 0,50 frente a 0,44).
41. **Palizas:** 10,1 % con margen ≥ 6 (8-2 o más). 10-0 = 0,2 %.
42. **Partidas ajustadas** (≤ 1): 26,8 %.
43. **Remontadas:** 18,1 % las gana quien estuvo 2 abajo; 24,9 % de vuelcos respecto al líder del descanso (turno 5).
44. **Decididas antes del último turno:** 50,4 % (el turno 10 es irrelevante en la mitad). Decididas en el turno 6: 3,1 %.
45. **Enfrentamientos empatados:** 0,6 %. Partidas con alguno: 6 %.

## G · Bots

46. **Escalera** (media contra el resto, mazos neutros intercambiados): RANDOM 16,1 % ≈ EASY 16,7 % < NORMAL 43,6 % < HARD 65,6 % < SMART 74,2 % < ORACLE 84,6 %. **Ordenada.**
47. **Cara a cara:** HARD–NORMAL 71,3 %, NORMAL–EASY 79,7 %, EASY–RANDOM 51,0 % (EASY es aleatorio por diseño).
48. **Información:** ningún perfil de producción ve cartas no jugadas (`perfectInformation=false` en los tres).
    - ORACLE, que sí las ve, le saca 73 % a HARD.
    - Paridad humano/bot: los dos reciben el valor del atacante al defender.
49. **HARD no es la heurística pura** (85 % heurística frente a SMART 100 %: SMART le gana 61,5 %). Es la decisión documentada de F7 para dar variedad.
50. **PvE real** (rival de `buildOpponentDeck`, mazo aleatorio):

    | el jugador juega como | bot EASY | bot NORMAL | bot HARD |
    |---|---:|---:|---:|
    | NORMAL (casual) | 80,6 % | 46,5 % | 22,7 % |
    | HARD | 93,6 % | 69,8 % | 46,2 % |

    Con un equipo de máximo OVR, el jugador HARD gana al bot HARD el 63,5 %. El rival iguala OVR, no poder (P-3).

## H · Starter y autocompletar

51. **Starter real:**
    - 300 bienvenidas simuladas (sobres reales con la distribución de la BD más `autocomplete`).
    - 0 no listos.
    - OVR p50 861 (meta 939); combate p50 1.955 (meta 2.145).
52. **Starter** (jugador NORMAL) contra:

    | rival | gana |
    |---|---:|
    | PvE EASY | 82,5 % |
    | PvE NORMAL | 50,6 % |
    | PvE HARD | 26,3 % |
    | campo aleatorio | 37,8 % |
    | meta OVR_MAX | 3,6 % |
    | meta PEAK_MAX | 0,2 % |

    La puerta de entrada (PvE) es sana; la distancia al meta es de juego de colección y la gestiona el emparejamiento por rating.
53. **Autocompletar:** con la misma colección, su equipo (máximo OVR) gana solo 28,5 % / 14,2 % / 7,7 % (colecciones de 30 / 60 / 120) contra el elegido por pico.
    - Es el comportamiento documentado («Mejor OVR»). Propuesta P-3.
54. **Diversidad:** 750 equipos distintos en 750 colecciones. Cartas más usadas: xross, jinggg, brawk (OVR 93–95).

## I · Integridad y RNG

55. **RNG** (mulberry32 del motor): χ² = 4,24 con 9 gl en 1 M tiradas (crítico 16,9). Correlación entre semillas consecutivas −0,007.
    - Las semillas del servidor salen de `crypto.randomInt`.
56. **Ataques de mazo:** 6 de 6 rechazados por el validador canónico:
    - 9 cartas, 11 cartas, carta repetida, 3 de un rol, carta inexistente, mismo jugador en otra edición.
57. **Integridad del motor** en 1,43 M partidas: 0 con `integrityOk=false` y 0 discrepancias entre la sombra CURRENT y el motor.
58. **Autoridad del cliente** (`integrity.json`, `integrity-audit.json`):
    - El cliente solo envía `deckId`, dificultad, carta y eje de ataque.
    - Eje del defensor, primer atacante, semillas, rival, ganador, recompensa y rating: los decide el servidor.
    - PvP oculta la mano rival.
59. **FIX-1 · bug de integridad arreglado:**
    - PvP leía `user_cards` sin paginar. Con más de 1.000 ejemplares, sus cartas salían «no pertenece a tu colección» y un equipo legal no entraba en cola.
    - Ahora reutiliza el `loadOwned` paginado de `duels.ts`.
    - Test nuevo: rojo con el código anterior, verde con el arreglo.
60. **Deudas documentadas, no arregladas:**
    - INT-1 (P2): PvE `play` sin control de concurrencia (gana la última escritura). Sin ventaja explotable y con el pago idempotente.
    - INT-2 (P3): los cuerpos de las rutas no son estrictos.

## J · Real frente a simulado, QA en vivo y regresión

61. **Telemetría real: BLOQUEADA.**
    - La lectura directa de la BD del VPS (psql por ssh, solo lectura) la denegó el control de permisos de la sesión, y no se buscó otra vía.
    - `real-vs-sim.json` queda en `BLOCKED`, con los valores simulados de referencia.
    - `real-telemetry-query.sql` (solo lectura, agregado, sin `user_id`) está listo para ejecutar.
62. **PvE en vivo** (cuenta QA 40a1e10d, NORMAL, 10 turnos):
    - Resultado: victoria 7-3 por marcador, con recompensa de tabla (14 pt / 220 cr / 110 XP).
    - El resultado recalculado desde el historial con `rules.json` coincide con el servidor, incluidos los totales de estadística.
    - 0 ejes ilegales.
    - Un eje enviado al defender se ignora (el servidor usó el obligado).
    - `winner` y `reward` falsos en el cuerpo no cuentan.
    - Se enviaron `seed` y `firstAttacker` en el `start` y abrió el bot. Es coherente con que se ignoren, aunque una sola partida no lo prueba; el código lo confirma (punto 58).
63. **PvP ranked en vivo** (QA 40a1e10d frente a QA a9a86124):
    - Emparejadas, 20 jugadas, FINISHED 3-7.
    - Resultado recalculado = servidor.
    - Mano rival no visible (0 cartas del snapshot rival en la respuesta).
    - Asiento de rating 1000 → 980 (K = 40).
64. **Regresión en ejecución** (`runtime-regression.json`): 12 páginas y 7 APIs de F61–F64 → 19 de 19 con 200 en la build nueva.
65. **Gates** (con el túnel cerrado):
    - `npm test`: **5.298 de 5.298** (+11 del laboratorio, +1 de integridad PvP).
    - tsc web: 0. tsc scripts: 0.
    - eslint src: 0 errores (27 avisos previos, ninguno en ficheros de F65).
    - `npm run build`: verde.
    - F61 MOTOR 01 (huella dorada) verde: **el motor no cambió**.

## K · Cierre

66. **Cambios en código:**
    - Nuevo: `src/domain/balance/{lab,lab.test}.ts`, `scripts/balance/{simulate,report}.ts` más instrumentos `_`, `src/server/services/duelsPvp.owned.service.test.ts`.
    - Modificado: `duelsPvp.ts` (FIX-1), `starterMath.ts` (campo aditivo `deckCardIds` para el laboratorio) y `package.json` (`balance:simulate`).
67. **No tocado:**
    - Stats, OVR, roles ni ediciones impresos de las 331 cartas.
    - Reglas (`duel-combat-2`, `duel-turns-2`) y bots.
    - Economía y recompensas.
    - Pick'ems: sin worker, cron ni importador.
    - Migraciones: 0.
68. **Cuentas:**
    - Solo QA; el instrumento aborta si recibe la cuenta del usuario.
    - La cuenta del usuario no se usó.
    - El laboratorio no abre conexión a la BD.
    - No se pudo re-verificar por SQL el estado de la cuenta del usuario porque el acceso psql por ssh quedó denegado. Ninguna acción de F65 la usa.
69. **Estado final:**
    - App en **http://localhost:3005** (build de F65) con el túnel abierto.
    - NO commit, NO push, NO deploy.
    - **Decisiones que quedan al producto, todas con evidencia:**
      - P-1: desempate.
      - P-2: posición.
      - P-3: autocompletar y rival de PvE por poder en vez de OVR.
      - P-4: meta de pico.
      - CB-1/CB-2: revisión de cartas.
