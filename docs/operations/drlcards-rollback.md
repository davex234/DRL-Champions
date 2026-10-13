# DRLCards · Rollback: la release N+1 falla, volver a N

> **No hay cero downtime.** Es un único proceso Node detrás de un único puerto: volver atrás implica parar y arrancar (medido: unos 3 s sin servicio en local). No se promete otra cosa.

## 1. Decidir

Hacer rollback si, tras publicar, ocurre cualquiera de estas cosas:
- `/api/ready` no está en `ready`.
- `npm run smoke:production` falla.
- Aparecen errores `"level":"error"` que antes no había.
- Una partida PvE QA no completa.

## 2. Código (lo habitual)

1. Parar N+1. Localizar el proceso real con `Get-NetTCPConnection -State Listen -LocalPort 3005`, luego `Stop-Process -Id <pid>`, o `systemctl stop drlcards`.
2. Restaurar el build de N:
   - Opción rápida: renombrar `.next` → `.next-bad` y `.next-N` → `.next`.
   - Opción limpia: hacer checkout de la etiqueta `drl-<N>` en un directorio aparte, `npm ci` y `npm run build`.
3. `npm start` (o `systemctl start drlcards`), luego `/api/health` y `/api/ready`.
4. Comprobar con `npm run production:check -- --app`. El `BUILD_ID` debe ser el de N; vuelve a la huella de N solo si el árbol también es el de N.

Probado localmente en F67: parada dura + arranque en frío = `ready` en 1,3 s, con el estado de juego intacto (vive en Postgres). Ver `restart-recovery.json`.

## 3. Esquema (solo si N+1 trajo migración)

- **Preferible: migraciones aditivas.** N sigue funcionando con el esquema de N+1, así que se hace rollback de código y el esquema no se toca.
- **Si la migración no es compatible hacia atrás,** usar su bloque ROLLBACK, que se escribió y probó en el simulacro antes de publicar (checklist C):
  1. Parar la app.
  2. Ejecutar el ROLLBACK en una transacción.
  3. Comprobar la sonda `app_admin_schema_probe` y `production:check -- --app`.
  4. Arrancar N.
- **0058 (aplicada 2026-09-28, solo privilegios):** su rollback exacto es `docs/operations/proposals/0058_hardening_grants.ROLLBACK.sql` (probado en el dry-run: restituye los privilegios medidos byte a byte). Deshacerla **reabre** la exposición de `profiles`: hacerlo solo si 0058 bloquea algo crítico, y volver a aplicarla en cuanto sea posible. Tras el rollback, `/api/ready` pasa a `degraded` (sonda `privacy`) y el código debe volver a `MIGRATION_HEAD = "0057_admin_cms"`. Backup previo: `pre-0058/20260928T115532Z`.
- **Último recurso: restaurar el backup verificado previo a la release.** Se pierde lo escrito desde entonces. Procedimiento en `drlcards-backup-restore.md §4`.

## 4. Contenido y Storage (CMS)

- El contenido del CMS (`content_*`) es versionado, con ciclo de vida desde F60. Para revertirlo: volver a publicar la versión anterior desde `/admin`. `content_audit_log` dice qué cambió y quién lo cambió.
- Para objetos de Storage: restaurar del `storage.tgz` del backup previo. Hoy hay 0 objetos. Las subidas se deduplican por sha256 y no se sobrescriben (`upsert:false`), así que la versión anterior sigue existiendo.

## 5. Después

- Registrar la causa y el `BUILD_ID` fallido.
- No reintentar N+1 sin pasar de nuevo la checklist completa.
