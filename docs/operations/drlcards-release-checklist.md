# DRLCards · Checklist de release

> Una release **no** sale de un árbol de trabajo irreproducible. Hoy hay decenas de fases sin commit (F17D…F67): **antes de la primera release pública hay que consolidarlas en commits** y etiquetar la revisión. El `BUILD_ID` (sha256 de `src`, `package.json`, `next.config.mjs`, `tailwind.config.ts`, `tsconfig.json`, `version.json`…) identifica el build de forma exacta aunque no haya commit.

## A. Antes (T-1 día)

- [ ] Árbol limpio: `git status` sin cambios pendientes y revisión etiquetada (`git tag drl-<version>`).
- [ ] `npm ci` desde el lockfile (`package-lock.json` v3) con Node de `.nvmrc` (24.15.0). `engines` exige >=22.12 <25.
- [ ] `npm audit --omit=dev`: 0 críticos. Los hallazgos dev-only están documentados en `docs/product/qa/fase67-production/dependency-audit.json`.
- [ ] `npm test`, `npx tsc --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npx eslint src` (0 errores), `npm run build`.
- [ ] `npm run production:check`: 0 FAIL. `build` en PASS significa que el `BUILD_ID` coincide con la huella del código actual.
- [ ] Revisar `.env` de producción contra `.env.example`: sin `NEXUS_SANDBOX_CREDITS`, sin `NEXUS_QA_HARNESS`, sin `NEXT_PUBLIC_TELEGRAM_WEBHOOK`.
- [ ] Flags: `GLOBAL_MARKET_ENABLED=false` y `PAYMENTS_ENABLED=false`, salvo decisión explícita.
- [ ] Indexación: `NEXUS_PUBLIC_INDEXING` solo si la beta es pública.

## B. Backup verificado (obligatorio antes de publicar o migrar)

- [ ] `ssh … 'DEST=/opt/nexus/backups/supabase-drlcards/f67 bash -s' < scripts/ops/backup-drlcards.sh` termina con `BACKUP_OK`.
- [ ] Si hay migración: `restore-drill.sh` sobre ese backup termina con `DRILL_OK`.
- [ ] Copia externa del backup hecha. Hoy está **BLOCKED**: sin destino externo.

## C. Migración (solo si la release la trae)

- [ ] Primero en el simulacro aislado (restaurar el backup y aplicar la migración en el contenedor desechable).
- [ ] Rollback SQL escrito y probado en el simulacro.
- [ ] Aplicar en producción en una transacción, con la app parada (no hay modo mantenimiento).
- [ ] `npm run production:check -- --app`: `schema` en verde con la nueva cabeza. Actualizar `MIGRATION_HEAD` en `src/server/ops/release.ts` y la sonda `EXPECTED_SCHEMA_KEYS`.

## D. Publicar

- [ ] Parar la versión N (el proceso real de :3005 o `systemctl stop drlcards`).
- [ ] Conservar el build N: `.next` → `.next-N` o el artefacto anterior, para poder volver atrás.
- [ ] Arrancar N+1. `/api/health` 200 y `/api/ready` `ready`.
- [ ] Si hay CDN: purgar el HTML. Las páginas estáticas salen con `s-maxage=31536000`; `/_next/static` es inmutable.

## E. Después (T+15 min)

- [ ] `npm run smoke:production`: 0 fallos.
- [ ] `npm run production:check -- --app --vps`: sin FAIL nuevos.
- [ ] Logs sin `level:"error"` nuevos: buscar `"level":"error"`.
- [ ] Una partida PvE QA completa (y PvP QA si la release toca duelos: `scripts/multiplayer/_fase66-e2e.ts --matches=1`).

## F. Bloqueos conocidos para la PRIMERA release pública

- [ ] **Dominio + TLS:** proxy delante de `127.0.0.1:3005`. HSTS con `preload` solo cuando el dominio sea definitivo.
- [ ] **GoTrue:** `GOTRUE_SITE_URL` y `GOTRUE_URI_ALLOW_LIST` con el dominio (hoy `127.0.0.1:3000`), **SMTP real** (hoy Inbucket), `GOTRUE_MAILER_AUTOCONFIRM=false`, `GOTRUE_PASSWORD_MIN_LENGTH=8`.
- [ ] **`NEXT_PUBLIC_SUPABASE_URL` pública con TLS:** Kong detrás del proxy. Hoy es `http://127.0.0.1:54521` a través del túnel.
- [ ] **Copia externa de backups.**
- [ ] **Migración propuesta 0058** (`docs/operations/proposals/0058_hardening_grants.PROPOSAL.sql`): columnas públicas de `profiles`, INSERT, TRUNCATE y funciones de recálculo.
- [ ] **Commits** de todo el trabajo pendiente y una revisión etiquetada.
- [ ] **Logos de equipo de las pistas (F72.3):** 25 PNG en `public/hints/teams/` — integración técnica aprobada, **derechos de marca/licencia para release pública SIN RESOLVER**. Confirmar por escrito o retirarlos (vaciar `HINT_TEAM_LOGOS`: la pista cae a la bandera sola). Ver `docs/operations/drlcards-art-release-inventory.md` §3.9.
- [ ] **Banderas (F72.3):** `public/flags/LICENSE-flag-icons.txt` (MIT) debe viajar con la build. Sin dependencia externa en runtime (resuelto).
- [ ] **Iconos de rol VALORANT / liga VCT y los 16 logos de equipo restantes:** NO importados (licencia de Riot / derechos pendientes). No es bloqueo mientras sigan fuera; sí lo será si se añaden sin licencia escrita.
