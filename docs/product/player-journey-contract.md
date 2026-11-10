# PLAYER JOURNEY 3.0 — contrato (Fase 40)

> **El tutorial es el juego.** La primera sesión se guía encima de los sistemas reales: sobre real, colección real,
> constructor real, partida PvE real. Sin cartas, sobres, bots, combate, moneda ni recompensas de tutorial.

## 1. Alta real (lo que recibe una cuenta nueva) — medido en código y BD

| Qué | Valor | Fuente |
|---|---|---|
| Créditos | **6.000** (valor por defecto de `profiles.credits`) + asiento `starter_grant` 6.000 (ref `starter:<id>`) | `0001_init.sql:19`, `0011_server_authority.sql:159-160` |
| Nivel / XP / puntos | 1 / 0 / 0 | defaults de `profiles` |
| Sobres | **3 × Sobre Inicial + 1 × Sobre Estándar** (`user_packs`, `on conflict do nothing`) | `0011:153-155` |
| Cartas | **0** (el alta no crea cartas) | `handle_new_user` |
| Equipo / activo | ninguno | — |
| `user_game.packs_opened` | 0 | `0011:64-69` |
| Pase | sin fila hasta que el servidor la crea | `0016` |
| Rating / campaña / draft / logros | sin filas | — |

Idempotencia: el alta es el disparador `on_auth_user_created` (AFTER INSERT en `auth.users`, una vez por usuario);
PK de `profiles`/`user_game`, `on conflict do nothing` en sobres e índice único `credit_tx_ref_uniq`. La app no tiene
ninguna ruta que conceda el starter y la Fase 40 **no la añade** (verificado: `player-journey-starter:verify`).

Nota medida en real: al registrarse, la pantalla `/cuenta` monta `CompetitiveSummary` → `GET /api/game/competitive`, cuya
lectura crea la ficha ranked 1000/0 y la fila de pase vacía (`ensureRating` + `getProgression`). Deuda previa de «escribir
al leer»; sin economía; no la usa el recorrido.

## 2. Garantía de equipo legal (medida, decisión del producto)

- Con los 4 sobres de bienvenida solo **≈ 34 %** de las cuentas puede formar un equipo legal (faltan sobre todo Flex y
  Centinela: ~10 % de las cartas cada rol). Medido con el motor de sobres real sobre 100.000 cuentas.
- **Decisión (2026-09-16): no se toca el alta ni la economía.** La ruta garantizada es el **Sobre Inicial**, que hoy es
  gratis y repetible (`data/packs.ts`, precio 0; compra real en servidor con asiento `buy_pack:inicial` de 0).
- Resultado: **100.000 / 100.000** cuentas llegan a un equipo legal sin gastar nada: mediana +1 Sobre Inicial, p90 +5,
  p99 +10, peor caso 24.
- Riesgo documentado: si el Sobre Inicial deja de ser gratis o repetible, esta garantía cae (el verificador lo detecta:
  comprueba precio 0).

## 3. Recorrido (dominio puro `src/domain/journey`)

Derivado de hechos persistidos; **sin estado de onboarding guardado, sin `created_at`, sin `obtained_at`**.

| # | Paso | Hecho cuando | CTA | Ruta |
|---|---|---|---|---|
| 1 | **Abre** «Tu colección empieza aquí.» | `packs_opened > 0` o cartas > 0 | Abrir mi primer sobre | `/abrir/<sobre que posee>` (inicial > estándar > orden) · sin sobres: `/packs/inicial` |
| 2 | **Colecciona** «Cada carta representa un jugador real.» | la colección YA forma un equipo legal (2 jugadores distintos por rol, una versión) o hay equipo legal | Abrir el siguiente sobre · sin sobres: Conseguir Sobre Inicial gratis · 2.º: Ver mi colección | `/abrir/…` · `/packs/inicial` · `/coleccion?tener=owned` |
| 3 | **Construye** «Forma una plantilla legal de diez cartas.» | equipo **guardado y legal** (`valid > 0`, validador canónico) | Ir al constructor | `/duelos/mazos?nuevo=1` o `?deck=<a medias>` |
| 4 | **Juega** «Pon tu plantilla a prueba.» | ≥ 1 partida terminada (ganar, perder o empatar; sin Draft) | Jugar mi primer combate | `/duelos/jugar?dificultad=EASY&primera=1` |

- **COMPLETA** = ≥ 1 partida terminada. Legacy explícito: partidas sin equipo → completa; equipo sin partidas → Juega;
  cartas sin sobres → no se pide abrir.
- **Bienvenida** = nada hecho todavía (termina sola con el primer sobre; no se repite).
- **Primera sesión completada** (`justCompleted`) = exactamente 1 partida terminada: destinos reales en la home y en el
  resultado. Con más partidas desaparece.
- `deckReadiness` = la misma condición que `autocomplete` del constructor (contrastado: 0 discrepancias en 7.962
  comparaciones).

## 4. Un solo motor de prioridad

El recorrido NO decide la home: `buildDailyLoop` lo calcula y `dailyCandidates` mete su siguiente paso como una acción
más (`journey-open|collect|build|play`, `ftue: true` → rango 0.5 en `orderToday`).

```
partida a medias (ranked > privada > campaña > PvE > combate de Draft)   rango 0   ← SIEMPRE gana
paso de la primera sesión                                                rango 0.5
retos · reclamar · Pick'ems · objetivo casi completo · sobres …          rangos 1+
```

Mientras la primera sesión está activa se omiten las sugerencias de equipo (crear/editar/conseguir cartas) y de modos
(campaña/ranked/partida rápida): el recorrido ya propone el siguiente paso. Nada se bloquea (sin locks nuevos). Nuevo
también: `resume-draft` (combate de Draft Gauntlet en curso, lectura de `draft_runs` IN_MATCH).

## 5. API y lecturas

- **Sin endpoint nuevo.** Viaja en `GET /api/game/daily-loop` (usuario del token, sin parámetros, `no-store`, cubeta
  `daily_loop_read`), campo `journey` de la foto.
- **Cero escrituras.** Lecturas añadidas: `user_packs.pack_id` (misma consulta), `ownedCardIds` de la MISMA lectura de
  `loadFacts` (`peekProgression`), catálogo del servidor (caché) y `draft_runs` IN_MATCH (una consulta, tolerante a
  0053 ausente). Sin N+1.
- Aislamiento: si progresión, sobres o equipos no se leen, `journey = null` (no se adivina); temporada, social o eventos
  caídos no afectan.

## 6. Cliente

- **Mission Control** (`JourneyMissionControl`) sustituye al héroe SOLO si la acción principal es del recorrido. Con
  algo más urgente o tras «Explorar por mi cuenta», **tira** discreta (`JourneyStrip`). Tras la primera partida,
  **destinos** (`JourneyDiscovery`): Road to Champions, Draft Gauntlet, Competitivo, Colección, Temporada (+ evento solo
  si hay partido en directo real).
- **Explorar por mi cuenta**: preferencia de PRESENTACIÓN por dispositivo en el adaptador KV de la plataforma
  (`journey-explore-<usuario>`). No cambia prioridad, pasos ni economía.
- **Coaches** (un bloque cada uno, nunca sobre la partida): colección (arriba, qué es una carta + roles con denominador +
  «Ver solo mis cartas»), constructor (primer equipo, «Autocompletar equipo»), pre-partida (reglas del motor, Fácil
  preseleccionado).
- **Primer equipo**: al guardar el PRIMER equipo legal sin equipo activo se activa con la acción existente `set_active`
  (validada en servidor) y se dice: «Plantilla lista: equipo guardado y activado…».
- **Reglas del primer combate** = `duel-combat-2`: turno empatado sin punto; final: turnos → suma de OVR (+1 punto) →
  total de estadística declarada (sin punto) → empate. `HelpSheet` corregido para decir «no otorga punto».
- **Apertura de sobres (arreglo)**: un revelado ya VISTO solo se recupera al recargar esa pantalla; «Abrir el siguiente
  sobre» enseña un sobre sellado (antes, durante 10 min, repetía el resumen del anterior).

## 7. Economía

La capa del recorrido da **0 créditos, 0 sobres, 0 cartas, 0 XP**. Todo cambio económico de una primera sesión mapea a:
alta (`starter_grant`), sobres (apertura; compra del Sobre Inicial a 0) o recompensa PvE existente (`duel_*`, Fácil:
120/60/25 créditos por victoria/empate/derrota).

## 8. Telemetría

No-op honesto: `FLOWS` sigue cerrado en 4 (CHECK de 0029) y el contrato del vestíbulo fija que no emite. Sin migración.
