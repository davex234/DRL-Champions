-- ============================================================================
-- FASE 24.4 · ESTRUCTURA DEL CUADRO — PROGRESIÓN GANADOR/PERDEDOR Y CLASIFICACIÓN
--
-- QUÉ FALTABA
--   `matches` (0002/0003) guarda cada partido con su ronda, su hora y su resultado, pero NO
--   adónde va el ganador ni adónde cae el perdedor. Por eso el cuadro de la 24.3 solo podía
--   dibujar una conexión cuando el resultado ya la demostraba.
--
-- POR QUÉ COLUMNAS EN `matches` Y NO UNA TABLA DE ARISTAS
--   En todos los formatos que la fuente publica (eliminación simple, doble, GSL) un partido
--   tiene COMO MUCHO un destino para su ganador y uno para su perdedor. Dos pares de columnas
--   (destino + hueco) lo representan sin duplicar el id del partido en otra tabla, con FK
--   reales y sin un segundo sitio que mantener sincronizado. Si un día un formato exige varios
--   destinos, se crea la tabla entonces, con este historial como base.
--
-- INVARIANTES
--   · Solo escribe el importador (service_role): el cliente sigue con lectura pública.
--   · Sin autoaristas (check). Destino inexistente → no se puede (FK). Al borrar el destino,
--     el enlace se queda en NULL (on delete set null), nunca cuelga.
--   · `progression_confidence` solo admite CONFIRMED: lo INFERIDO no se persiste. Lo que no se
--     sabe es NULL, no un valor.
--   · La clasificación se guarda por su clave (`winner_qualifies`, p. ej.
--     "qualified:group-a:winners") + etiqueta legible. El clasificado NO se guarda: se lee del
--     ganador real del partido.
--   · Reimportar no borra: el sync solo escribe estas columnas cuando trae estructura
--     CONFIRMADA para ese partido (upsert parcial por columnas).
-- ============================================================================

alter table public.matches add column if not exists winner_to_match_id     text references public.matches(id) on delete set null;
alter table public.matches add column if not exists winner_to_slot         smallint check (winner_to_slot in (1, 2));
alter table public.matches add column if not exists loser_to_match_id      text references public.matches(id) on delete set null;
alter table public.matches add column if not exists loser_to_slot          smallint check (loser_to_slot in (1, 2));
alter table public.matches add column if not exists winner_qualifies       text;
alter table public.matches add column if not exists winner_qualifies_label text;
alter table public.matches add column if not exists progression_evidence   text
  check (progression_evidence is null or progression_evidence in ('SOURCE_EXPLICIT', 'SOURCE_BRACKET_LINK', 'SOURCE_STRUCTURED_HTML'));
alter table public.matches add column if not exists progression_confidence text
  check (progression_confidence is null or progression_confidence in ('CONFIRMED'));
alter table public.matches add column if not exists progression_version    text;
alter table public.matches add column if not exists progression_synced_at  timestamptz;

alter table public.matches drop constraint if exists matches_no_self_progression;
alter table public.matches add constraint matches_no_self_progression
  check (winner_to_match_id is distinct from id and loser_to_match_id is distinct from id);

-- Un hueco lo alimenta un solo partido con estructura confirmada (por origen: ganador o perdedor
-- se comprueban por separado; un mismo hueco no puede recibir dos ganadores).
create unique index if not exists matches_winner_slot_uniq
  on public.matches (winner_to_match_id, winner_to_slot)
  where winner_to_match_id is not null and winner_to_slot is not null;
create unique index if not exists matches_loser_slot_uniq
  on public.matches (loser_to_match_id, loser_to_slot)
  where loser_to_match_id is not null and loser_to_slot is not null;

create index if not exists matches_winner_to_idx on public.matches (winner_to_match_id);
create index if not exists matches_loser_to_idx  on public.matches (loser_to_match_id);

comment on column public.matches.winner_to_match_id is 'Fase 24.4: partido al que avanza el ganador (estructura CONFIRMADA de la fuente). NULL = desconocido.';
comment on column public.matches.winner_qualifies   is 'Fase 24.4: clave del nodo de clasificación al que va el ganador, si la fuente lo publica.';
