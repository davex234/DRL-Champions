-- ============================================================================================================
-- ROLLBACK OPERATIVO de 0067 (gestión de administradores). Ejecutar DESPUÉS de desplegar el código anterior
-- (sin `/api/admin/admins`). Quita la RPC, la guardia de escritura y el suelo. `is_admin` conserva los valores que
-- tenga en ese momento (revisarlos antes) y la auditoría GRANT_ADMIN / REVOKE_ADMIN se queda (append-only).
-- ============================================================================================================
begin;
drop trigger if exists profiles_admin_write_guard on public.profiles;
drop trigger if exists profiles_admin_floor_upd on public.profiles;
drop trigger if exists profiles_admin_floor_del on public.profiles;
drop function if exists public.app_admin_set_admin(uuid, uuid, boolean, text);
drop function if exists public._profiles_admin_write_guard();
drop function if exists public._profiles_admin_floor();
commit;
