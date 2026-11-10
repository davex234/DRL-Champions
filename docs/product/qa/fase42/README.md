# QA · Fase 42 — Live Service & Retention 3.0

## Salidas máquina

| Fichero | Qué es | Resultado |
|---|---|---|
| `live-service-map.json` | 15 sistemas temporales con alcance, ventanas, verdad, autoridad y flags | — |
| `priority-fuzz.json` | 100.000 combinaciones de hechos → `buildDailyLoop` → invariantes | **0 violaciones** |
| `priority-fuzz-mutation-active-match-lost.json` | la partida activa pierde el primer puesto (regresión inyectada) | 79.544 detectadas |
| `priority-fuzz-mutation-fake-urgency.json` | urgencia sin fin real (regresión inyectada) | 100.000 detectadas |
| `return-state-simulation.json` | 100.000 vueltas a 0 h / 6 h / 1 / 3 / 7 / 14 / 30 d con actividad real | **0 violaciones**, ≤ 3 hechos |
| `temporal-fuzz.json` | 100.000 secuencias (1.149.590 acciones) con servicios reales + reloj controlado: lecturas, resets, jugar, abrir, reclamar, doble reclamo, pestañas, reloj del cliente desviado | **0 violaciones**, 101.532 cobros, 105.956 resets |

Regenerar: `npm run live-service:fuzz` (o `npx tsx scripts/live-service-fuzz.ts <priority|return|temporal|map> [--n=] [--workers=] [--mutate=]`).

## Capturas SINTÉTICAS — `synthetic/` (143)

Arnés `/design-system/fase42?scene=<escena>`: **hechos de cuenta inventados** (banda «QA SYNTHETIC» en cada captura), piezas y dominio reales (`buildDailyLoop`, `DailyLobby`, `NextUpAfter`). 40 escenas × 1440/1024/390 + 16 con movimiento reducido + 5 de teclado real (Tab por CDP) + 2 de scroll. `index.json` por captura: desbordamiento, controles < 44 px, hechos de vuelta, caducidades, plazo del héroe, foco visible, errores de consola.

Resultado: 143 capturas · desbordamiento 0 · errores 0 · controles < 44 px 0 · vuelta > 3 hechos 0 · foco visible en las 5 de teclado.

Escenas: normal-today, active-pvp, active-private, active-draft-combat, active-draft-drafting, daily-claimable, weekly-almost, daily-complete, weekly-complete, all-complete, pickem-soon, pickem-none, event-live, event-upcoming, event-none, season-normal, season-ending, return-1d/3d/7d/14d/30d, no-packs, pack-owned, campaign-progress, ranked-progress, subsystem-unavailable, offline, reset-imminent, post-reset, clock-ahead, clock-behind, keyboard, long-text, after-match, after-pack, after-campaign, after-draft, after-ranked, after-private.

Instrumento: `npx tsx scripts/_fase42-visual-qa.ts` (app en :3005).

## Evidencia REAL — `real/`

Cuenta QA existente `8c326e52` (la de la Fase 40 se conserva), app local `next start` → túnel SSH → BD del VPS. BD solo lectura por SSH. Sin PII.

- `real-qa.log/json` (ejecución final) y `real-qa-run1.log` (primera ejecución, con el reclamo real y el bug encontrado):
  - 16 lecturas `daily-loop`/`meta`/`loop` (+4 en paralelo) → **huella de BD idéntica** (créditos, XP, puntos, `last_seen_at`, sobres, cartas, partidas, rating, pase md5 + `updated_at`, logros, libro mayor, `economy_ops`, Draft, campaña, respuestas Pick'em, pagos).
  - `serverNow` vs reloj real: −26 ms; resets de la foto = ventanas UTC; temporada = calendario (75 d, sin S2).
  - `?userId` / `?now` / `?tz` / `?serverNow` → 400; sin `correct_option`.
  - Reclamo real legítimo (sin SQL): `w-duelos-5` → +1.200 una vez; reintento y doble reclamo → 409; un asiento.
  - Bug real: «Ver en directo» de un evento DEMO caducado → corregido y re-verificado.
- `real-shots.log/json` + `real-*.png` (20): home 1440/1024/390 (héroe, hoy/semana, temporada), home abierta 70 s con refresco automático → **0 escrituras**; Logros, Temporada, Pick'ems y el evento real Valorant Champions 2026 (17 predicciones abiertas) sin fuga de respuestas.

Instrumentos: `scripts/_fase42-real-qa.ts <creds>`, `scripts/_fase42-real-shots.ts <creds>` (credenciales fuera del repo).

No existía en la cuenta QA: partida activa, run de Draft, vuelta ≥ 1 día, Pick'em que cierre en < 12 h ni partido en directo real → cubiertos con el arnés, la matriz L001–L100 y los fuzzers (marcados SYNTHETIC).
