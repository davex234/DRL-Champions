# 03 · Ensayo transaccional de 0052 (BEGIN → 0052 → sondas → ROLLBACK)

Ejecutado en la BD real del VPS (`supabase_db_DRLCards`), con `psql -v ON_ERROR_STOP=1`, fichero por stdin: cabecera `begin;` + `0052_collection_favorites.sql` (con el cerrojo corregido) + sondas + `rollback;`. Todo el DDL de 0052 es transaccional en PostgreSQL 17 (CREATE TABLE/INDEX/POLICY/FUNCTION/TRIGGER, GRANT/REVOKE), así que el ensayo es fiel.

## Primer intento (fallo del instrumento, no de 0052)
Todo el DDL de 0052 se ejecutó; la segunda consulta de sondas falló (`operator is not unique: text || "char"` al concatenar `pg_constraint.contype`). `ON_ERROR_STOP` cortó la sesión con la transacción abierta → PostgreSQL la deshizo. Comprobado después (solo lectura): tabla ausente, 0 función/políticas/disparador, 0 usuarios sintéticos, 0 sesiones «idle in transaction». Se corrigió la sonda (`contype::text`) y se repitió.

## Segundo intento — PASS (psql exit 0)
Salida: `CREATE TABLE · CREATE INDEX · ALTER TABLE · REVOKE · GRANT · DROP POLICY (no existía) · CREATE POLICY · CREATE FUNCTION · REVOKE · DROP TRIGGER (no existía) · CREATE TRIGGER`.

### Objetos creados dentro del ensayo
| comprobación | resultado |
|---|---|
| columnas | `user_id uuid NOT NULL` · `card_id text NOT NULL` · `created_at timestamptz NOT NULL default now()` |
| restricciones | `user_card_favorites_pkey` PRIMARY KEY (user_id, card_id) · `user_card_favorites_user_id_fkey` FOREIGN KEY (user_id) → auth.users(id) ON DELETE CASCADE · `user_card_favorites_card_id_format` CHECK (card_id ~ '^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$') |
| índices | `user_card_favorites_pkey` UNIQUE btree (user_id, card_id) · `user_card_favorites_user_created_idx` btree (user_id, created_at DESC) |
| disparador | `user_card_favorites_cap` BEFORE INSERT FOR EACH ROW EXECUTE FUNCTION `_user_card_favorites_cap()` |
| función | SECURITY INVOKER (`secdef=false`), `search_path=pg_catalog, public`, usa `pg_advisory_xact_lock`; EXECUTE: anon ✗ · authenticated ✗ · PUBLIC ✗ |
| RLS | habilitada (`true`), no forzada (`false`: el dueño y `service_role` la saltan, como el resto de tablas del servidor) |
| política | `tus favoritos (lectura)` · SELECT · `authenticated` · `using (auth.uid() = user_id)` · sin WITH CHECK (no hay política de escritura) |
| grants | `authenticated=SELECT` · `postgres` y `service_role` = todos · **anon y PUBLIC: ninguno** |
| `has_table_privilege` S/I/U/D/T | anon `f/f/f/f/f` · authenticated `t/f/f/f/f` · service_role `t/t/t/t/t` · PUBLIC `f/f/f/f/f` |
| filas reales | 0 |

Los privilegios por defecto del esquema (que dan `arwdDxtm` a anon/authenticated) quedan anulados por el `revoke all` de 0052: verificado.

### Tras el ROLLBACK
| objeto | estado |
|---|---|
| `public.user_card_favorites` | ausente |
| función / políticas | 0 / 0 |
| usuarios sintéticos | 0 |

Sondas de seguridad, tope e idempotencia: ver `04-security.md`.
