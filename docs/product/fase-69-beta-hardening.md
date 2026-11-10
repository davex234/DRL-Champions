# FASE 69 · BETA HARDENING 5.0 — Reanudar · Recuperar · Completar

**Veredicto: GO.** Deuda de producto cero (0 BLOCKER, 0 CRITICAL, 0 MAJOR, 0 MINOR, 0 POLISH abiertos).
La release candidate y la release pública siguen **BLOQUEADAS por acciones externas y autorizaciones**:
aplicar 0058, backup fuera del VPS, SMTP real, dominio + HTTPS y commit. Ninguna es un bug de producto.

- Build final: `drl-0.1.1-1-7e223fed` en `http://127.0.0.1:3005` (solo loopback) con el túnel SSH 54521/54522 abierto.
- Evidencia: `docs/product/qa/fase69-hardening/` (JSON de cierre, `raw/`, `journeys/raw/`, `journeys/reconcile-f69.json`, capturas).
- Propuesta 0058: `docs/operations/proposals/0058_*` (PROPOSAL, ROLLBACK, preflight, postflight, rls_tests). **No aplicada.**

## Cómo se hizo F69

Hubo tres pases de sesión. El primero (2026-09-27, 19:21–20:07Z) arregló F68-010, F68-011, F68-012 y F68-013, revisó la
autoridad del HUD y los textos, preparó la 0058 v2 y el inventario, y se cortó. El segundo lo revisó, lo completó y
lo verificó en vivo. Encontró además el fallo de aislamiento entre PvE y PvP y dejó escrito un `run-final.sh` que no
llegó a ejecutar. El tercero (esta reanudación) partió del disco, sin memoria de la sesión anterior. Ejecutó la
verificación que había quedado pendiente, consolidó un duplicado, cerró tres restos de producto y escribió la evidencia
que faltaba. El detalle está en `resume-audit.json`.

## Qué cambió en la reanudación

| Cambio | Fichero | Por qué | Test |
|---|---|---|---|
| Bucle del Coach consolidado | `scripts/_fase68-coach2.ts` (ganchos `onStep`/`finalShot`), `scripts/_fase69-coach.ts` | F69 había copiado el bucle de F68 | tsc scripts; prueba final del Coach con el instrumento consolidado |
| CLS de /cuenta | `src/app/cuenta/page.tsx` | La carga era más corta que la pantalla y la tira de cifras se cambiaba por un cargador de otra altura (0,139 a 1440) | `f69.polish.test.tsx` (+1) |
| «Rango» suelto en /cuenta | `src/app/cuenta/page.tsx` | El pie de privacidad y el tope de la barra no decían de qué sistema eran (resto de F68-013) | `f69.rankTerms.test.ts` (ampliado) |
| /mundo a 390 | `src/app/mundo/page.tsx` | Dos tarjetas medían 10 px más que la pantalla y se recortaban | `f69.polish.test.tsx` (+1) |
| Sondeo de foco | `scripts/_fase69-probe.ts` | Buscaba el menú del armazón en la portada, que tiene su propio menú. Daba un `menuFocusTrap:false` falso | re-medido: trampa, Escape y vuelta del foco correctos |
| Sondeo responsive | `scripts/_fase69-probe.ts` | Ancho como argumento y medida de desbordamiento por ruta (se amplió el instrumento; no se creó otro) | 390/1024/1440 |
| Security smoke | `scripts/_fase68-security.ts` | Con la evidencia en F69 no encontraba la partida de B y fallaba hasta el control | 22/22 |

## Cifras finales

| | Antes de reanudar | Final |
|---|---|---|
| Tests | 5.400 | **5.402** (0 fallos) |
| tsc web / scripts | PASS / PASS | PASS / PASS |
| Lint | 0 errores · 27 avisos | 0 errores · 27 avisos (los de F68) |
| Build | d74dc352 | **7e223fed** |
| production:check | — | 24 PASS · 1 WARN (auth-email, BLOCKED externo) · 1 FAIL (backup-offsite, BLOCKED externo) |
| smoke:production | — | **68/68** |
| /api/health · /api/ready | caídos | 200 · ready (0057_admin_cms, 331/331) |
| CLS /cuenta 390 / 1024 / 1440 | 1440 = 0,222 → 0,139 | **0 / 0,079 / 0,061** |
| Cartas · agentes · cabeza de migraciones | 331 · 29 · 0057 | 331 · 29 · 0057 |

## Tactical Coach: prueba final de F68-010, F68-011 y F68-012

Persona D (QA 225e1fce), build d74dc352. El código del Coach es idéntico en la build final. Partido completo por la
interfaz: VICTORIA 13–12, 25 rondas, 366 s.

| Momento | Créditos (servidor) | XP (servidor) | HUD créditos | HUD nivel |
|---|---|---|---|---|
| Antes | 9.430 | 552 | 9.430 | 3 |
| En la ceremonia (sin recargar) | 9.430 | 552 | 9.430 | 3 |
| Tras el freno de CloudSync | 9.430 | 552 | 9.430 | 3 |
| Tras F5 | 9.430 | 552 | 9.430 | 3 |

- El historial del Coach sube de 6 a 7, y a 8 con el partido del explorador. El libro de D sigue en 6.000 + 3.430 = 9.430, sin ningún apunte del Coach. 0 errores de consola, 0 respuestas malas.
- **F68-011:** en la ronda 1 la IA recomienda «DEFAULT › Ronda pistola: nadie tiene nada que guardar…». No sale ningún SAVE en la pistola.
- **F68-012:** la fase de compra solo ofrece «JUGAR LA RONDA», en todas las rondas observadas.
- El nivel del HUD se compara consigo mismo, porque `/api/game/state` no devuelve el nivel.

## Bugs

- **F68 (14):** 10 siguen arreglados y tienen test; 4 se cerraron en F69 (010, 011, 012, 013). No hay regresiones (`f68-bugs-recheck.json`).
- **Hallados y cerrados en F69:**
  - F69-A…E: modos locales con cuenta, ventana SESSION_PENDING, errores crudos, terminología y relectura tras cobrar.
  - **F69-F (MAJOR):** la partida rápida retomaba un duelo PvP en curso y producía 80 × 500. Antes: dos partidas colgadas ~640 s cada una. Después: dos partidas de ~32 s, sin errores.
  - F69-G: CLS y «rango» en /cuenta.
  - F69-H: /mundo a 390.
- **Abiertos:** ninguno.

## Seguridad y privacidad

- **Contrato de exposición del perfil** (`src/lib/supabase/profileExposure.ts`, `profile-exposure.json`):
  - anon: nada de la tabla; lo público sale por vistas y por la API.
  - Otro usuario autenticado: `id, username, avatar, level, points, region`.
  - Uno mismo: el resto, por `GET /api/game/me` con service_role, filtrado por el Bearer.
  - Admin: igual que cualquiera por REST; el panel usa `/api/admin/*` con `verifyAdmin`.
- **Estado real hoy:** anon lee las 20 columnas de `profiles`, incluidas `credits`, `xp`, `is_admin` y `last_seen_at` (`security.json`). El cliente F69 ya no depende de esas lecturas. **El cierre exige aplicar 0058.**
- **Revisión de 0058:**
  - Conclusión **B**: es necesaria y correcta con los ajustes de la v3. Se revalidó sin cambios.
  - Dry-run en PGlite: 14 fallos antes, 0 después y 14 tras el rollback, que restituye exactamente lo anterior.
  - Comprobación viva de solo lectura: preflight 15/15.
  - **No se ha aplicado.** Es RC BLOCKER hasta que haya autorización.
- **Security smoke 22/22:**
  - cruce de datos entre usuarios;
  - IDOR de partidas ranked, con 404 uniforme;
  - replay ajeno;
  - admin;
  - recompensas, créditos, precio y sobre falsos;
  - REST sobre 7 tablas.

  Smoke 68/68. 0 secretos de servidor en el bundle.
- **Auditoría de secretos antes del commit:** 0 secretos de servidor. 36 avisos de contraseñas literales de cuentas QA desechables, clasificados LOW. En F70 hay que borrar o rotar esas cuentas antes de publicar la API.
- **npm audit:** 1 aviso moderado en producción (`baseline-browser-mapping`, no alcanzable) y 5 de desarrollo. No se usó `--force`.

## Conciliación (solo lectura, 12 cuentas QA)

Libro, inventario, cartas y progresión cuadran en las 12 cuentas. No hay sobres negativos ni cartas ajenas en ningún
equipo. En Elo, cada cuenta cumple antes + Σdelta = después: C 1.072 + 32 = 1.104 y E 948 − 27 = 921. Cada partida
mueve el Elo una sola vez.

## Regresiones F61–F68

| Fase | Resultado |
|---|---|
| F61 | Motor de cartas con huella dorada intacta y PvE completo |
| F62 | Reclamos sin pagos dobles |
| F63 | Tres altas nuevas completas |
| F64 | Presupuesto de peticiones en 10,4 (umbral 10,5): el +1 es `/api/game/me`; anotado como OPS-REQ-BUDGET |
| F65 | Propuestas sin aplicar |
| F66 | Ranked real y aislamiento PvE↔PvP |
| F67 | Health, ready, production:check y smoke |
| F68 | Recorridos que habían encontrado bugs, todos PASS |

El detalle está en `regressions.json`.

## Lo que no se tocó

- Economía F57.6.
- Balance del duelo de cartas (P-1…P-4 siguen propuestas).
- Catálogo de 331 cartas y 29 agentes.
- Pick'ems: worker, cron e importador.
- Esquema de producción: la cabeza sigue en 0057.
- Marketplace y pagos: OFF.
- La cuenta del usuario: 0 escrituras.
- Sin commit, push, deploy, DNS ni SMTP.

La regla de pistola de F68-011 cambia la compra de la **ronda 1 del simulador del Coach**: tramo «eco» en vez de «save».
El simulador es entrenamiento y no da recompensas; ni el motor de cartas ni la economía del juego cambian.

## RC readiness (`rc-readiness.json`)

| Categoría | Estado | Siguiente acción |
|---|---|---|
| GAMEPLAY, PROGRESSION, ONBOARDING, GAME_FEEL, BALANCE, MULTIPLAYER, TACTICAL_COACH | READY | — |
| OPERATIONS | READY_WITH_EXTERNAL_ACTION | Alojar la app con un gestor de procesos y registrar 0026–0057 (F70+) |
| SECURITY / DATA_PRIVACY | BLOCKED | Autorizar 0058 → backup verificado → preflight → aplicar → postflight → pruebas RLS → smoke |
| BACKUPS | BLOCKED | Destino externo y credenciales (el script ya acepta DEST) |
| AUTH_EMAIL | BLOCKED | SMTP real, SITE_URL y allow-list al dominio, confirmación de correo ON |
| DOMAIN_HTTPS | BLOCKED | Dominio y proxy TLS |
| SOURCE_CONTROL | BLOCKED | Autorizar el commit de F70 según `release-file-inventory.json` (LFS o archivo externo para 2,55 GB de evidencia y 0,74 GB de arte) |

## Operación

- **App:** `npm run start`, que ejecuta `next start -H 127.0.0.1 -p 3005`.
- **Túnel:** `ssh -N -L 54521:127.0.0.1:54521 -L 54522:127.0.0.1:54522 nexusadmin@212.95.40.144`.
- **Antes de los gates:** cerrar el túnel, porque `.env.local` apunta a la BD real.
- **Instrumentos:** `scripts/_fase69-*` y el arnés `scripts/_fase68-*` con `F68_OUT=docs/product/qa/fase69-hardening/journeys`. Las credenciales QA están en scratchpads, nunca en el repo.

## Actualización operativa · PRE-F70 (2026-09-28)

**0058: PROPUESTA → APLICADA + VERIFICADA.** Se aplicó con autorización explícita, después de:

- un backup verificado (`/opt/nexus/backups/supabase-drlcards/pre-0058/20260928T115532Z`);
- comprobar la huella en el VPS (sha256 `ad5f9e5a…`);
- un preflight OK, sin deriva.

Resultado: postflight todo ok, RLS 27/27, anon 401 en `profiles` y 0 cambios en los 23 recuentos. La cabeza pasa a
`0058_hardening_grants` y `/api/ready` vigila su efecto con la sonda `privacy`. SECURITY y DATA_PRIVACY pasan a
READY. **El siguiente blocker es el backup off-site.** Evidencia en `docs/product/qa/pre-f70-0058/`.
