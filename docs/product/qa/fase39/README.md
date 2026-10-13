# QA · Fase 39 — Draft Gauntlet

**173 escenas**: 151 sintéticas + 22 reales.

## synthetic/ (151)

Arnés `/design-system/fase39?state=<estado>` — monta la MISMA `DraftGauntletScreen`, `GauntletMap` y
`DraftResultBanner` que la ruta real, con fotos construidas por el dominio real (`src/domain/draft`) sobre el catálogo
del código. Solo el **estado** de la run es sintético (marca «QA SYNTHETIC» en cada captura). Instrumento:
`npx tsx scripts/_fase39-visual-qa.ts` con `next start -p 3005`. Métricas por captura en `synthetic/index.json`.

Estados (33): landing, landing-history, new-run, pick-1, pick-5, pick-10, preview, compare, confirm, loading-pick,
stale, offline, draft-complete, gauntlet-map, stage-1…stage-4, final, in-match, recovery, win, loss, draw, completed,
failed, abandoned, abandon-confirm, art-failure, long-names, unavailable, loading, error.

| Viewport | Capturas |
|---|---|
| 1440×900 (desktop) | 52 |
| 1024×800 (tablet) | 33 |
| 390×844 (móvil, página completa) | 51 |
| 768×1024 | 12 |
| 844×390 (móvil apaisado) | 3 |
| de ellas con `prefers-reduced-motion: reduce` | 30 |
| interacción (elegir 1/2/3, cancelar, abrir/cancelar abandono) | 7 |

Resultado final: **desbordamiento horizontal 0 · errores de consola 0 · >3 cartas 3D 0 · controles < 44 px en la sala 0**.
Además 418 respuestas 404 de **fotos de jugador/escudo ausentes** (`/players/{id}.png`, `/teams/{id}.png`): el repo no
trae fotos (`public/players/README.md`) y el renderer canónico cae a la silueta. Se cuentan aparte (`missingArt`), no
son errores del draft.

**Bug encontrado aquí y corregido:** la vista previa/CONFIRMAR ELECCIÓN era `sticky bottom-2` y quedaba cortada al pie
en 1440×900 (en DRLCards `overflow-x:hidden` en html/body anula `sticky`). Ahora es un pie `fixed` sobre la barra móvil
con hueco (test R22). Las capturas son posteriores al arreglo.

## real/ (22)

Cuenta QA existente `QA-8c326e52` (no admin), app local `next start` → túnel SSH → PostgreSQL del VPS.

- `_fase39-real-e2e.ts` → `real-01…15`, `e2e.log`, `evidence.json` — **84/85 checks** en la primera pasada; el único ✗
  fue la huella md5 de `user_pass` entera (ver abajo).
- `_fase39-real-recovery.ts` → `real-41…47`, `recovery.log`, `evidence-recovery.json` — **33/33**.

| Escena | Qué demuestra |
|---|---|
| 01 hub-jugar | tarjeta DRAFT GAUNTLET en /jugar |
| 02 draft-landing | portada |
| 03 draft-pick-1 · 04 preview-pick-1 | primera oferta, vista previa por teclado |
| 05 draft-after-refresh | recarga en el pick 2: mismas opciones y misma versión |
| 06 / 07 preview-pick-5 / 10 | comparación con el mismo rol |
| 08 draft-complete-map | PLANTILLA COMPLETA + mapa |
| 09–11 arena | intro, tablero, turno (10 turnos por la interfaz, 0 por API) |
| 12 arena-result | VICTORIA 6-4 + «COMBATE 01 SUPERADO» (*) |
| 13 map-after-win | 01 SUPERADO, 02 SIGUIENTE |
| 14 / 15 | móvil / tablet |
| 41 stage2-ready | combate 02 listo |
| 42 stage2-after-refresh | recarga con el combate 02 abierto (2 turnos): misma partida |
| 43 stage2-resume | «Retomar combate» |
| 44 abandon-confirm | confirmación en pantalla |
| 45–47 abandoned | portada con última run ABANDONADA, móvil y tablet |

(*) La captura 12 es anterior al ajuste de texto del final: ahí aún dice «Recompensa no disponible.»; ahora el
`ResultScreen` en modo draft dice «Draft Gauntlet no da créditos, sobres ni XP en esta versión.» (test en
`experience.test.ts`). No se jugó otra run real solo para recapturarlo.

### Huella económica

`fingerprint-after-stage1.txt`. En la primera pasada el md5 de la fila completa de `user_pass` cambió. Causa medida:
rotación diaria de misiones **al leer** (deuda conocida: meta/vestíbulo escriben al leer), a las 08:26:21.7Z, al cargar
`/jugar` por primera vez en el día — **antes** de cualquier acción del draft. `xp: 0`, nada reclamado,
`missionsCompleted: 0`, y la nueva base `duels_played = 2` = partidas `PVE` (el draft no cuenta). La huella se separó en
`pass_economy` (xp, premium, boost, reclamos, misiones completadas/reclamadas) + `pass_xp`; en la segunda pasada todo
idéntico: `user_game`, `profile`, `user_cards` (35), `credit_tx` (7), `pass_economy`, `pass_xp` (0), `achievements` (0),
`rating`, `campaign`, `favorites` (0), `pve_matches` (2), `decks`.

## db/

`probes-rerun-2026-09-16.txt` y `postflight-2026-09-16.txt`: probes de 0053 dentro de `BEGIN … ROLLBACK` contra el
esquema aplicado (con roles `authenticated`/`anon` reales) y postflight de solo lectura.

Nada de lo guardado contiene correo, contraseña, tokens ni el id completo de la cuenta.
