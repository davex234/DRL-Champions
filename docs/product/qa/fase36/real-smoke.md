# FASE 36 · Smoke real local (datos reales, sin mutaciones)

2026-09-15 · App local `next start` (:3005) → API real → Supabase del VPS por túnel SSH (`127.0.0.1:54521`) · cuenta QA `QA-8c326e52` de la Fase 35.2 (`@example.invalid`, no admin) · login por el formulario real de `/cuenta` · instrumento `scripts/_fase36-live-smoke.ts`. Solo lectura: no se jugó, no se abrió ningún sobre, no se reclamó nada, no se gastó nada. Correo, contraseña y tokens nunca impresos.

## API `GET /api/game/daily-loop`

| prueba | resultado |
|---|---|
| Con sesión | 200 · `cache-control: no-store` · 879 ms (primera lectura, túnel) |
| Fugas en el JSON (correo propio, `is_admin`, `email`, `credits`, `option_key`, `state`, `rng`) | ninguna |
| Segunda lectura (otra pestaña) | 200 · misma acción principal |
| Sin sesión | 200 · `public, max-age=10, s-maxage=15` · acción `sign-in` · `player`/`packs` = null |
| `?userId=<uuid>` | 400 `BAD_REQUEST` |
| `POST` | 405 |
| Token inválido | 200 como anónimo (solo lo público) |

## Foto real de la cuenta QA

| bloque | valor leído |
|---|---|
| Acción principal | `claim` · «2 objetivos por reclamar» → `/logros` |
| Secundarias | `predict` → `/pickems` · `campaign` → `/jugar/road-to-champions?node=c1-n2` · `live` → `/torneos/demo-masters-madrid-2026` |
| Road to Champions | **1 / 15**, siguiente **c1-n2 «Presión alta» contra LOUD**, capítulo 1 |
| Equipo activo | READY · «Equipo 2» · 10 cartas |
| Competitivo | ficha 1000 con **0 partidas** (creada en 35.2 por el `ensureRating` antiguo) → la home dice «Sin partidas · Sin rating todavía» |
| Colección | 25 cartas · 25 distintas / 772 · 0 sobres sin abrir |
| Cuenta | nivel 4 (222 / 339 XP de cuenta) · Pase: nivel 0 (0 XP del pase), siguiente recompensa nivel 1 «260 créditos» |
| Temporada | Temporada 1 · ACTIVE · sin siguiente |
| Objetivos | diarios 1/3 · semanales 0/2 · reclamables 2 · sin rotación pendiente |
| HOY | `d-abrir-1` en progreso · `d-pickem-1` en progreso · Pick'ems pendientes · siguiente nodo |
| Circuito | «DRL Masters Madrid 2026» (`source=demo`, `ongoing`) con 1 partido `live` → EN DIRECTO (con marca Demo) · próximo «Valorant Champions 2026» · 17 predicciones pendientes |
| Retos | 0 · `unavailable` = [] |

**Comprobación de honestidad del «Reclamar»** (lectura de `user_pass.state` en la BD): `d-duelo-win` (diaria, `duels_won` ≥ 1, asignada hoy 13:21:50 UTC; la cuenta ganó 2 partidas después) y `s-mazo` (temporada, `decks_saved` ≥ 1) están completas y sin reclamar en ventanas vivas. Son reclamables de verdad en Logros.

## Vestíbulo en el navegador (sesión real)

| ancho | listo | acción | h1 | desborde | controles < 44 px | circuito |
|---|---|---|---|---|---|---|
| 1440 | 1,6 s | `claim` | «2 objetivos por reclamar» | 0 | 0 | EN DIRECTO / PRÓXIMAMENTE |
| 1024 | 1,6 s | `claim` | idem | 0 | 0 | idem |
| 390 | 1,5 s | `claim` | idem | 0 | 0 | idem |

Escaneo de secretos: 125 recursos del mismo origen, 0 fugas. Consola: 0 errores propios.

## Rutas del loop

`/jugar` «Jugar» · `/temporada` «NEXUS — Temporada 1» · `/duelos/competitivo` «Ranked» · `/jugar/road-to-champions` «Road to Champions» · `/torneos` «El circuito, en directo» · `/coleccion` «Mi álbum» · `/packs` «Sobres» · `/inventario` «Inventario» · `/jugador/me` → `/jugador/8c326e52-…` · todas sin desbordamiento. (La primera pasada marcó `/coleccion` y `/packs` como error por un `500` en el texto de precios: falso positivo del instrumento, corregido; las capturas lo confirman.)

## Base de datos: huella antes / después (solo lectura, `psql` en el contenedor)

Recuento y `md5` de las filas de la cuenta QA en `profiles` (créditos, xp, puntos, sobres abiertos), `duel_pvp_ratings`, `duel_pvp_rating_events`, `campaign_progress`, `campaign_attempts`, `duel_active_deck`, `duel_decks`, `user_pass`, `user_packs`, `user_cards`, `user_achievements`, `credit_transactions`, `duel_matches`, `duel_challenges`, `player_profile_customization`, más los totales globales de `credit_transactions` (52), `duel_pvp_ratings` (2), `campaign_progress` (1) y `schema_migrations` (25, 0025).

**Resultado: IDÉNTICA** antes (16:17:03 UTC) y después del smoke. Ninguna ficha ranked, carril, rotación, progreso de campaña, equipo activo, logro, crédito, sobre ni asiento creado o cambiado por leer el vestíbulo, en ninguna de las tres anchuras ni en las dos lecturas de API.

## Segunda pasada (build final, tras las correcciones)

Misma cuenta y mismos pasos, envuelta en otra huella de BD: **antes = después = primera línea base** (idéntica). Vestíbulo listo en 1,6 s en 1440/1024/390, 0 desbordamientos, 0 controles < 44 px, 0 errores de consola, 125 recursos sin secretos. Confirmado en datos y capturas `real-01-*`: `ftue = null` (ya no pide «Abre tu primer sobre» con 25 cartas), la acción de directo dice «En directo · demo», sin logo de transición superpuesto. Las 9 rutas del loop sin error (el falso positivo del `500` desaparece con el instrumento corregido).

## Hallazgos del smoke (reales)

1. **FTUE engañoso con datos reales**: la guía decía «Abre tu primer sobre · AHORA» a una cuenta con 25 cartas porque `profiles.packs_opened` = 0. Corregido en el dominio: poseer cartas cuenta como prueba del paso.
2. **Causa raíz (P1, NO corregido en esta fase)**: `app_open_pack` incrementa `user_game.packs_opened`, pero la progresión lee `profiles.packs_opened`; las misiones `packs_opened` («Abre un sobre», «10 sobres») no avanzan con aperturas de servidor. Cambiar la fuente completaría retroactivamente misiones con baselines tomadas del contador equivocado (recompensas no ganadas): necesita una decisión de re-baseline.
3. **Directo de demostración**: el evento `demo-masters-madrid-2026` tiene un partido `live` en la BD; la tarjeta ya decía «Demo», la barra «Después» no. Corregido («En directo · demo»).
4. **Capturas de la home** tomadas durante la transición de página del shell (logo superpuesto): el instrumento espera ahora 3 s antes de capturar.
