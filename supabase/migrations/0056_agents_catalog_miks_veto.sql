-- 0056 · CATÁLOGO DE AGENTES DE ESPORTS: MIKS Y VETO
--
-- Fuente canónica: el roster verificado del Tactical Coach (`src/domain/tactics/valorantRoster.ts`,
-- valorant-api.com 13.05, contrastado con playvalorant.com). Espejo TS: `src/data/esports/agents.ts`.
--
-- ESTADO REAL DE PRODUCCIÓN (precheck F59.1, 2026-09-24): 28 agentes. El seed del repo (0003) tiene 27,
-- pero la BD viva ya tenía `veto` —name 'Veto', icon NULL— con role 'duelist', y 6 estadísticas
-- (4 map_player_stats + 2 player_stats) apuntando a él. Veto es CENTINELA en el juego.
--
-- Qué hace (sólo datos, sin esquema, idempotente):
--   A) Miks: la crea si no existe (controller). Si ya existe, no la toca.
--   B) Veto: la crea si no existe (BD nueva desde el repo: sentinel). Si ya existe, NO crea otra fila ni
--      cambia su id —las FK de las estadísticas siguen intactas—; sólo corrige role 'duelist' → 'sentinel'.
--      Ninguna otra columna. Sin delete + insert.
--   Estadísticas: no se tocan.
--
-- Deshacer (datos): update public.agents set role = 'duelist' where id = 'veto';
--                    delete from public.agents where id = 'miks';  -- sólo si nada la referencia

insert into public.agents (id, name, role) values ('miks', 'Miks', 'controller')
on conflict (id) do nothing;

insert into public.agents (id, name, role) values ('veto', 'Veto', 'sentinel')
on conflict (id) do nothing;

update public.agents set role = 'sentinel'
where id = 'veto' and role = 'duelist';
