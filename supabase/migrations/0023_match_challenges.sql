-- ============================================================================
-- FASE 13 · DESAFÍOS POR PARTIDO: EL RESULTADO EXACTO
--
-- ────────────────────────── QUÉ AÑADE ──────────────────────────
--
-- Un tipo de pregunta más: `match_score`. No es un segundo Pick'em —es la MISMA tabla, el
-- MISMO ciclo de vida, el MISMO corrector y la MISMA ruta de recompensa—, sino un `kind`
-- más de los que ya existían.
--
-- Un partido predecible pasa a traer DOS preguntas:
--
--   `match_winner`  ¿quién gana?          2 opciones   puntos de la ronda
--   `match_score`   ¿con qué resultado?   4 opciones   el DOBLE
--
-- El doble no es una cifra suelta: con cuatro opciones en vez de dos, acertar a ciegas baja
-- del 50 % al 25 %. Pagar el doble por la mitad de probabilidad deja intacto el valor
-- esperado de adivinar, así que la pregunta premia saber sin subirle el suelo a nadie.
--
-- ────────────────────────── LOS OTROS TRES NO SE PUEDEN ──────────────────────────
--
-- El encargo proponía además mapa, jugador destacado y diferencia. No se implementan, y el
-- motivo es concreto: `public.matches` no guarda ni mapa ni MVP, y `player_stats` solo se
-- llena si el importador de estadísticas ha pasado por ese partido. Una pregunta que no se
-- puede corregir es una pregunta que nadie cobra.
--
-- ────────────────────────── POR QUÉ EL ÍNDICE CAMBIA ──────────────────────────
--
-- La 0018 puso `unique (pickem_event_id, match_id)` para que dos pasadas solapadas de la
-- sincronización no duplicaran la pregunta de un partido. Con dos preguntas por partido esa
-- restricción pasa a impedir justo lo que queremos, así que la clave incorpora el tipo.
--
-- Sigue cumpliendo su función original —no puede haber dos preguntas del MISMO tipo para el
-- mismo partido— y ahora admite una de cada tipo. El índice viejo se elimina porque dejarlo
-- sería dejar puesta la prohibición que estamos levantando.
-- ============================================================================

alter table public.pickem_questions
  drop constraint if exists pickem_questions_kind_check;

alter table public.pickem_questions
  add constraint pickem_questions_kind_check
  check (kind in ('match_winner', 'match_score', 'champion', 'advance'));

drop index if exists public.pickem_questions_match_uniq;

-- El indice NO es parcial, y es deliberado: `ON CONFLICT` de PostgREST no puede apuntar a
-- un indice parcial, que es exactamente el tropiezo que la Fase 10 documento al crear el
-- anterior. No hace falta filtrar por `match_id is not null` porque en Postgres los NULL no
-- colisionan entre si: las preguntas sin partido (`champion`, `advance`) quedan fuera solas.
create unique index if not exists pickem_questions_match_kind_uniq
  on public.pickem_questions (pickem_event_id, match_id, kind);

comment on index public.pickem_questions_match_kind_uniq is
  'Una pregunta de cada tipo por partido. Sustituye a pickem_questions_match_uniq (0018), que solo admitia una en total.';
