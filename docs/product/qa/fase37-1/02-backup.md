# 02 · Backup previo a 0052

| campo | valor |
|---|---|
| ruta | `/opt/nexus/backups/supabase-drlcards/pre-0052/supabase-drlcards-pre0052-20260915T193049Z.dump` |
| creado (UTC) | 2026-09-15 19:30:49Z (archivo: «Archive created at 2026-09-15 19:30:50 UTC») |
| comando | `docker exec supabase_db_DRLCards pg_dump -U postgres -d postgres -Fc > …dump` |
| formato | custom (`-Fc`), pg_dump 17.6 |
| bytes | 2 184 596 |
| sha256 | `6c7ebb5a1bd8ca15812c0006f90db02f104833f2c5bca1a76b5ee5ff71e0013d` (fichero `.sha256` junto al dump) |
| `sha256sum -c` | **OK** |
| `pg_restore -l` | **OK** · 1 796 entradas |
| permisos | directorio 700, ficheros 600 (usuario `nexusadmin`) |

Espacio libre en el volumen: 472 GB.

## Restauración (documentada, NO ejecutada)
Solo como último recurso (perdería toda escritura posterior a 19:30:49Z, incluidas cartas, créditos y partidas de cualquier jugador):

```bash
D=/opt/nexus/backups/supabase-drlcards/pre-0052
cd "$D" && sha256sum -c supabase-drlcards-pre0052-20260915T193049Z.dump.sha256
docker exec -i supabase_db_DRLCards pg_restore -U postgres -d postgres --clean --if-exists --no-owner \
  < "$D/supabase-drlcards-pre0052-20260915T193049Z.dump"
```

Para deshacer 0052 **no** hace falta restaurar: ver `08-rollback.md` (DROP de los objetos de 0052, sin tocar nada más).
