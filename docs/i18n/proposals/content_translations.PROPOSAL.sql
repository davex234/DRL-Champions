-- =============================================================================
-- PROPUESTA (SIN APLICAR) · traducciones opcionales del contenido editable
-- =============================================================================
-- Aditiva: una tabla nueva. No toca ninguna tabla, fila ni función existente; el contenido del CMS sigue en español.
-- No está en supabase/migrations a propósito: la cabeza de producción sigue siendo 0073 hasta que se decida aplicarla
-- (entonces se numera, se copia allí, se hace el backup previo de siempre y se enciende CONTENT_TRANSLATIONS_ENABLED).
--
-- ROLLBACK:  drop table if exists public.content_translations;   (con el interruptor apagado no la usa nadie)
-- =============================================================================
create table if not exists public.content_translations (
  source      text not null check (char_length(btrim(source)) between 1 and 600),   -- texto español tal como está en el contenido
  locale      text not null check (locale in ('en', 'de', 'it')),
  target      text not null check (char_length(btrim(target)) between 1 and 600),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  primary key (source, locale)
);

alter table public.content_translations enable row level security;
revoke all on public.content_translations from public, anon, authenticated;
grant select, insert, update, delete on public.content_translations to service_role;

comment on table public.content_translations is
  'i18n · capa opcional texto español → traducción para contenido editable (sobres, misiones, sets, temporadas). La lee GET /api/content/i18n; sin fila, el juego muestra el español.';
