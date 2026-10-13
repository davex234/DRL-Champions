VPS 212.95.40.144 · contenedor supabase_db_DRLCards · Postgres 17.6
Backups: /opt/nexus/backups/supabase-drlcards/pre-0057/ (20260924T181611Z y 20260924T191344Z; full 1902 entradas, 10 tablas tocadas, agents CSV, SHA256SUMS)
Dry-run 1: fallo detectado (_bump_distribution sin argumento) → corregido; dry-run 2 PASS; dry-run 3 (migración final + smoke ampliado) PASS; rollback demostrado (25 valores idénticos) antes de aplicar.
Apply: 2026-09-24T19:13:56Z, una transacción, COMMIT tras CHECKS_OK.
Post-check: sólo cambian las sondas 0057, +2 tablas (content_packs, content_entity_version), +22 funciones y la política de lectura de agents. Agentes/cartas/jugadores/pools/assets/inventarios/auditoría idénticos.
Instantánea del roster vs BD: idéntica (npm run agents:snapshot -- --check).
Restaurar esquema: ver docs/product/fase-60-admin-cms.md §Rollback; datos: pg_restore del dump touched_tables_pre0057.
