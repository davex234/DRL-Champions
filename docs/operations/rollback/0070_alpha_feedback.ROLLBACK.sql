-- ROLLBACK de 0070_alpha_feedback (F86.2). Quita el feedback de la alpha (TABLA Y SU CONTENIDO) y la RPC del embudo.
-- Antes de ejecutarlo, si el feedback importa: exportarlo (\copy (select * from public.alpha_feedback) to '…csv' csv header).
-- No toca ninguna otra tabla: el embudo era una lectura derivada.
begin;
drop function if exists public.app_alpha_funnel(timestamptz, boolean);
drop trigger if exists alpha_feedback_guard on public.alpha_feedback;
drop table if exists public.alpha_feedback;
drop function if exists public._alpha_feedback_guard();
commit;
