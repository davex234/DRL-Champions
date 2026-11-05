# FASE 36.1 · E2E real con la cuenta QA

2026-09-15 · app local `next start` (:3005, build con el arreglo) → API real → Supabase del VPS por túnel SSH · cuenta QA
`QA-8c326e52` (`@example.invalid`, no admin) · login por el formulario real de `/cuenta` · instrumento
`scripts/_fase36-1-pack-e2e.ts` (fases `buy` y `open`, con huella de BD entre medias). Sin reclamos. Sin datos de otros usuarios.

## Recorrido

| # | paso | lo que ve el jugador (`/progresion`, tarjetas `data-objective`) | Daily Loop (`GET /api/game/daily-loop`) | BD |
|---|---|---|---|---|
| 1 | Objetivos antes | «Abre un sobre» **0 / 1** · «Abre 10 sobres» **0 / 10** (EN PROGRESO) | `d-abrir-1` 0 / 1 · reclamables 2 | user_game 5 · baseline 5 v2 |
| 2 | Comprar 1 sobre estándar (`POST /api/game/packs {action:"buy"}`) | — | — | 200 · créditos 5540 → 4790 |
| 3 | Inventario | tarjeta «Sobre Estándar ×1 · Abrir →» | — | user_packs estandar=1 · `buy_pack` +1 |
| 4 | Objetivos tras comprar | **0 / 1** · **0 / 10** (sin cambio) | igual · reclamables 2 | user_game **5** (sin cambio) |
| 5 | Abrir en `/abrir/estandar` (botón «Abrir sobre», flujo real de la ceremonia) | ceremonia «Sobre Estándar · 5 cartas» | — | — |
| 6 | Objetivos tras abrir | «Abre un sobre» **1 / 1 · PENDIENTE DE RECOGER** · «Abre 10 sobres» **1 / 10** | reclamables 3 · acción principal «Reclamar» | user_game **6** · `open_pack` 6 · user_cards 25 → 30 · estandar=0 |
| 7 | Recargar | igual (**1 / 1**, **1 / 10**) | igual | igual |

Resultado: COMPRAR = +0 · ABRIR = +1 · RECARGAR = persiste. `mission_reward` 0 filas (no se reclamó). Errores de consola propios: 0.
El reintento de la misma apertura (+0) y las aperturas múltiples (+3) se probaron contra Postgres con sondas en `db-evidence.md`
(no se gastaron más créditos QA para repetirlo en vivo).

## Capturas

| fichero | contenido |
|---|---|
| `01-objective-before.png` | objetivos antes (0 / 1 · 0 / 10) |
| `02-pack-owned.png` | inventario con el sobre comprado (×1) |
| `03-objective-after-purchase.png` | objetivos tras comprar (sin cambio) |
| `04-pack-opening.png` | ceremonia de apertura real |
| `04b-pack-opened-result.png` | resultado de la apertura |
| `05-objective-after-open.png` | objetivos tras abrir (1 / 1 pendiente · 1 / 10) |
| `06-objective-after-refresh.png` | tras recargar (persiste) |
