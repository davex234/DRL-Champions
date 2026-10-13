# DRLCards · de la RC a la release pública (orden real)

Parte de la RC F70 (`docs/product/fase-70-release-candidate.md`). **D** = David · **C** = Claude · **A** = comprobación automática.
Cada paso depende del anterior. No hay que repetir F61–F70.

| # | Quién | Acción | Hecho cuando |
|---|---|---|---|
| 1 | D | Autorizar el commit de la RC (alcance: `docs/product/qa/fase70-rc/commit-plan.md`) | «OK commit» |
| 2 | C | `git add` por grupos del plan, `git rm --cached` de los pesados rastreados, commit en `arch/stabilization` | commit sin evidencia pesada ni secretos |
| 3 | A | `node scripts/ops/_secret-scan.mjs` + `npm run typecheck` + `npm test` sobre el commit | 0 hallazgos · PASS |
| 4 | D | Generar el certificado del off-site **en tu PC** (abajo). Guardar la `.key` en tu gestor y en un medio offline | tienes `.crt` y `.key` |
| 5 | D | Dar el destino off-site: tipo, endpoint, bucket o ruta, credenciales y el `.crt` (formulario del informe F70 §P) | datos entregados |
| 6 | C | Instalar en el VPS `offsite.env`, `rclone.conf` 600 y el `.crt`, con `DRL_OFFSITE_RECOVERY_DIR` (decisión B), según `drlcards-backup-restore.md §7` | `check-config` → `OFFSITE_CONFIG_OK … recoveryConfig=on` |
| 7 | A | Primera copia real: `BACKUP_OK` + `OFFSITE_OK`, `verify <TS>` → `OFFSITE_VERIFY_OK`, cron 05:10 | `production:check --vps` → `backup-offsite PASS` |
| 8 | D | Proveedor SMTP y credenciales, y dominio (y subdominio para la API de Supabase) | datos entregados |
| 9 | C | GoTrue en el VPS: `SMTP_*`, `SITE_URL=https://<dominio>`, `URI_ALLOW_LIST=https://<dominio>/**`, `MAILER_AUTOCONFIRM=false`, `API_EXTERNAL_URL`, reinicio de `auth` (`drlcards-production.md §10`) | `auth-config-status.sh` sin catcher local |
| 10 | D | DNS: `cloudflared tunnel route dns <túnel> <dominio>` (y el de la API) | el CNAME existe |
| 11 | C | Ingress de cloudflared → `http://127.0.0.1:3005` (y la API → `127.0.0.1:54521`) antes del 404; `.env.local` con `NEXT_PUBLIC_SITE_URL` y `NEXT_PUBLIC_SUPABASE_URL` públicos + `DRL_PUBLIC_RELEASE=1`; build + start | la app sigue en loopback |
| 12 | A | `npm run production:check -- --app --vps` con `DRL_PUBLIC_RELEASE=1` | 0 FAIL |
| 13 | A | `BASE_URL=https://<dominio> npm run smoke:production` + `BASE_URL=https://<dominio> npm run gate:browser` (F70.1: navegador real con service worker) + `/api/health` 200 y `/api/ready` ready por el dominio | PASS · 31/31 |
| 14 | C | Prueba real de correo: registro → confirmación → login; recuperación de contraseña | los dos correos llegan |
| 15 | D | Confirmar licencias y derechos del arte (`drlcards-art-release-inventory.md` §3) | confirmación escrita |
| 16 | D | Autorizar la purga o rotación de las cuentas QA (`drlcards-qa-accounts.md`); C la ejecuta con `qa-accounts-purge.sql` | 0 credenciales QA desechables vivas |
| 17 | D | **GO público** | anuncio |

**Nunca:** abrir :3005 a la red (la exposición es SOLO por el túnel), dejar la clave privada del off-site en el VPS o en el repo, ni publicar con `NEXUS_QA_HARNESS` o `NEXUS_SANDBOX_CREDITS` (el modo público lo impide).

## Certificado del off-site (paso 4, en TU PC, Git Bash)

```bash
mkdir -p ~/drlcards-offsite && cd ~/drlcards-offsite && umask 077
openssl req -x509 -newkey rsa:4096 -keyout drlcards-backup.key -out drlcards-backup.crt \
  -days 3650 -subj "/CN=drlcards-backup"          # pide una frase de paso: la clave queda cifrada
openssl x509 -in drlcards-backup.crt -noout -fingerprint -sha256   # anota la huella
```

- Al VPS solo va `drlcards-backup.crt`, el público.
- `drlcards-backup.key` (y su frase de paso) se queda en tu PC, en tu gestor de contraseñas y en un medio offline. Sin ella, las copias no se pueden descifrar.
- Si la clave tiene frase de paso, `fetch` con descifrado la pide en la máquina de recuperación.
