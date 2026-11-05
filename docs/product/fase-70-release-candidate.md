# Fase 70 · Release Candidate

**Fecha:** 2026-09-28 · **Rama:** `arch/stabilization` (sin commit) · **App:** `http://127.0.0.1:3005` (solo loopback) + túnel SSH 54521/54522.
**Evidencia:** `docs/product/qa/fase70-rc/` (json y md pequeños; git ignora `raw/` y `screenshots/`).

## Veredicto

| | |
|---|---|
| PRODUCT READY | **YES** (0 bugs de producto blocker o critical; integridad, ledger y seguridad OK) |
| RC READY | **YES en gates; el build RC está pendiente de David** (ver «Pendiente humano») |
| PUBLIC RELEASE READY | **NO**, solo por bloqueos externos |

## Gates

| Gate | Resultado |
|---|---|
| `npm test` | **5.420/5.420 PASS** (5.417 al empezar la sesión y 3 nuevos del modo público) |
| tsc web / scripts | PASS / PASS |
| Lint | **0 errores**, 27 avisos (los mismos de F68 y F69) |
| `npm run smoke:production` | **74/74 OK**: privacidad anónima, aislamiento entre usuarios, admin, autoridad de créditos, XP, nivel, partidas y ledger |
| `npm run production:check -- --app --vps` | 23 PASS · 2 WARN · 1 FAIL. El FAIL es `backup-offsite NOT_CONFIGURED`, externo y esperado. Los WARN son `build` (la build en marcha es anterior a F70) y `auth-email` (SMTP, externo) |
| Recorrido final (QA K, `scripts/_fase70-journey.ts`) | **14/14**: login, portada, sobres, colección, equipo, PvE real (2 jugadas, partida activa en servidor), progresión, competitivo, Coach, perfil público sin email, logout, relogin, 0 errores de consola |
| Libro de créditos (`_fase68-reconcile`, SQL de solo lectura) | **12/12 cuentas OK** |
| Arnés off-site (VPS, `/tmp` aislado) | **60/60 PASS** (52 de PRE-F70 y 8 de la decisión B) |
| Escaneo de secretos | 0 hallazgos |
| `npm ls` / `npm audit --omit=dev` | limpio / 1 moderada (`baseline-browser-mapping`, transitiva de tooling, no bloquea) |
| `/api/health` · `/api/ready` | 200 · ready (schema 0058, privacy, catalog 331/331) |

## Datos (lectura directa, solo lectura)

- Cabeza de migraciones: `0058_hardening_grants`.
- `content_cards` = 331; `agents` = 29, todos publicados; 122 tablas públicas; sin deriva.
- 1 admin. `auth.users` tiene 30 usuarios, de los que 27 son cuentas QA `@example.invalid`.
- `GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false`, economía congelada.

## Trabajo de F70

1. **Off-site, decisión B.** `DRL_OFFSITE_RECOVERY_DIR` y `DRL_OFFSITE_RECOVERY_PATHS` meten `compose.yml`, `kong/` y `snippets/` DENTRO del `.cms` cifrado. `offsite.json` solo dice `recoveryConfigPresent`, y `fetch` restaura con permisos 700/600. Runbook: `drlcards-backup-restore.md §7`.
2. **Secretos QA.** Había 46 literales en 44 ficheros; quedan 0. Ahora se usa `ephemeralQaPassword()` (`scripts/lib/qaCredentials.ts`). Detalle en `qa-secrets.json`.
3. **Cuentas QA.** El procedimiento está en `docs/operations/drlcards-qa-accounts.md`, con `scripts/ops/qa-accounts.sql` y `qa-accounts-purge.sql` (ROLLBACK por defecto). No se ha ejecutado.
4. **Modo público `DRL_PUBLIC_RELEASE=1`.** En el arranque falla con una URL pública local o sin https, con el arnés QA o con los créditos sandbox. `production:check` exige SMTP real, SITE_URL, allow-list, autoconfirmación off y off-site verificado. Apagado, el comportamiento es idéntico (lo cubre un test). `/api/ready` no depende del off-site.
5. **Plantilla canónica.** `.env.example`, con los bloques [APP], [VPS], [OPS] y [QA].
6. **SMTP y dominio preparados.** Están en `drlcards-production.md §10`: reutilizan el cloudflared del PC con una regla de ingress más hacia `127.0.0.1:3005`.
7. **Evidencia.** 2,52 GB en `docs/`, de los que 2,43 GB se archivan fuera. `.gitignore` tiene 46 reglas nuevas.
8. **Fuente de release y commit.** `release-source.json` (2.820 ficheros, 108 MB) y `commit-plan.md`.
9. **Arte.** `docs/operations/drlcards-art-release-inventory.md`.
10. **Manifiesto.** `release-manifest.json`.
11. **Lanzamiento.** `docs/operations/drlcards-launch-actions.md`.

## Bugs

Ninguno de producto. Durante la fase se rompió y se corrigió un pin de test (`backup.test.ts` sobre la forma del veredicto off-site en `production-check.ts`).

## Pendiente humano (EXTERNAL/HUMAN ACTION REQUIRED)

La sesión no pudo reconstruir la app de :3005: el control de seguridad lo bloqueó y no se rodeó.

- **Build en marcha:** `drl-0.1.1-1-0cc2ffe2`, anterior a F70.
- **Huella esperada de la build RC:** `drl-0.1.1-1-c01cc6fd`.
- **Qué cambia en runtime:** solo `src/server/ops/env.ts` (modo público, apagado por defecto).

David decide cuándo reconstruir. La RC se da por cerrada cuando se cumplan las tres condiciones:
1. `production:check` muestra `build PASS`.
2. `release-manifest.json` muestra `buildMatchesSource: true`.
3. `/api/health` devuelve 200.

## Cierre de la RC (2026-09-28, con autorización de David)

- **Build:** `drl-0.1.1-1-c01cc6fd`, construida con `npm run build` y arrancada con `npm run start` en `127.0.0.1:3005`.
- **Coincidencia build/código:** el HTML servido lleva esa build (`buildMatchesSource: true`).
- **Estado de la app:** `/`, `/api/health` → 200 · `/api/ready` → ready (0058, 331/331).
- **Smoke:** 74/74.
- **production:check:** 24 PASS · 1 WARN (`auth-email`) · 1 FAIL (`backup-offsite NOT_CONFIGURED`); ambos son externos, y `build` pasa a PASS.
- **Código durante el build:** `git status` idéntico antes y después, sin cambios.

**F70 RC = CLOSED / GO.**

> **REGRESIÓN HALLADA DESPUÉS (prueba manual de David):** la instancia de :3005 cayó, y el service worker lo tapaba sirviendo la portada cacheada en cualquier ruta. Los gates de esta fase no lo detectaron: corrieron con el servidor vivo y con un perfil de Chrome efímero. Corregido y re-verificado en **F70.1** (`fase-70-1-runtime-hotfix.md`), build `drl-0.1.1-1-f3ed79f2`, con el nuevo gate `npm run gate:browser`.

## Bloqueos externos (PUBLIC RELEASE)

1. Destino off-site, con credenciales y certificado.
2. Proveedor SMTP.
3. Dominio, DNS y HTTPS (más un hostname público para la API de Supabase).
4. Confirmación legal del arte: IP de Riot, fotos de jugadores, logos de equipos y competiciones, y derechos del arte de sobres.
5. Autorización de commit, despliegue y purga de las cuentas QA.
