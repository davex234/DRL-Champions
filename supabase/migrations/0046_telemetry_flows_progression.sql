-- 0046 · TELEMETRÍA: flujos `duel_play` y `progression` (Fase 27) — APLICADA (VPS 2026-09-15, Fase 35.1).
--
-- Estado: fichero LOCAL, pendiente de decisión. Aplicada en la BD del VPS el 2026-09-15 11:57Z (Fase 35.1, backup previo pre-0046-0051). `FLOWS` del código sigue en 4: los flows nuevos se abrirán en un cambio de código aparte. No hay
-- ningún código que dependa de ella: `lib/duel/telemetry.trackDuel` y
-- `lib/progression/telemetry.trackMeta` comprueban `isFlow()` y hoy son no-op.
--
-- Qué hace: amplía el conjunto cerrado de flujos de `telemetry_events` (0029) con dos flujos
-- cuyo INICIO no cambia la ruta —una partida dentro de `/duelos/jugar` y un momento del meta
-- dentro de `/progresion`/home— para poder medir `match_start`, `card_locked`, `level_up`,
-- `continue_action`… como `context` de `flow_started`. Sin eventos nuevos, sin claves nuevas.
--
-- Al aplicarla hay que actualizar EN EL MISMO CAMBIO `FLOWS` en `src/lib/telemetry/contract.ts`
-- (y el test `FLOWS.length`), porque el contrato y el CHECK deben coincidir exactamente.
--
-- Aditiva, idempotente y compatible: solo relaja el CHECK; ninguna fila existente deja de cumplirlo.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'telemetry_events_flow_check') then
    alter table public.telemetry_events drop constraint telemetry_events_flow_check;
  end if;
  alter table public.telemetry_events
    add constraint telemetry_events_flow_check
    check (flow is null or flow in (
      'deck_builder', 'pack_ceremony', 'pickem_form', 'market_listing_form',
      -- Fase 27: partida y meta. Fase 28: competitivo (hub, escalera, historial, cola). Fase 29: social. Fase 30: eventos en directo. Fase 31: perfil de jugador.
      -- Fase 32: gestión de equipos (vista del constructor, crear, guardar, activar, autocompletar, comparar). Va aparte de
      -- `deck_builder` a propósito: `analytics_flows` (0030) mide el abandono de ese flujo como «abrió y NO creó un mazo
      -- después»; editar o activar un equipo que ya existe inflaría ese abandono.
      -- Fase 34: temporada (hub, pase, objetivos, ranked, evento y resumen vistos desde /temporada).
      -- Fase 35: modos de juego y Road to Champions (hub /jugar, mapa, nodo, partida, nodo/capítulo completado, rejugar).
      'duel_play', 'progression', 'competitive', 'social', 'live_events', 'player_profile', 'deck_management', 'season', 'campaign'
    ));
end $$;
