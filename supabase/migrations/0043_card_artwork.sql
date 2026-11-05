-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 0043 · ARTWORK MANUAL DE UNA VERSIÓN DE CARTA
--
-- ────────────────────────── QUÉ CAMBIA Y POR QUÉ ES TAN PEQUEÑO ──────────────────────────
--
-- Las cartas de NEXUS se DISEÑAN A MANO. El artwork final es un fichero que exporta una
-- persona, no algo que un renderizador reconstruya. Lo único que faltaba para poder guardarlo
-- era que el gestor de assets admitiera el sujeto «carta»: su modelo ya tiene todo lo demás
-- —bucket, ruta, checksum, versión de asset, `is_current`, estado de aprobación, licencia—.
--
-- Así que esto NO crea una segunda arquitectura de assets. Amplía DOS listas de valores
-- admitidos de la que ya existe. Nada más.
--
--   assets.subject_type  += 'card'           el sujeto es una carta
--   assets.kind          += 'card_artwork'   el asset es su ilustración final
--
-- ────────────────────────── CÓMO SE ATA A UNA VERSIÓN ──────────────────────────
--
-- `subject_id` guarda la clave COMPUESTA `<card_id>#v<N>`, y no solo el `card_id`.
--
-- Es deliberado y es lo que hace que la v1 y la v2 sean independientes de verdad: son dos
-- sujetos distintos para el gestor, con sus propias filas, su propio grupo de versiones de
-- asset y su propio `is_current`. Publicar la v2 no puede pisar el artwork de la v1 porque ni
-- siquiera comparten fila.
--
-- La alternativa —`subject_id = card_id` y la versión de la carta en `assets.version`— se
-- descartó: esa columna ya significa otra cosa (la versión DEL ASSET, la que sube `replace`
-- al reemplazar un fichero por otro mejor). Mezclar las dos habría hecho imposible reemplazar
-- el artwork de la v1 sin que pareciera el artwork de la v2.
--
-- `meta` guarda además `{cardId, cardVersion}` en claro, para poder consultarlo sin partir
-- cadenas.
--
-- ────────────────────────── RIESGO ──────────────────────────
--
-- `assets` tiene CERO filas hoy, así que ampliar sus `CHECK` no puede invalidar nada
-- existente. Y ampliar una lista de valores admitidos nunca rechaza lo que antes se aceptaba:
-- las fotos de jugador, los escudos y las plantillas siguen siendo válidos exactamente igual.
-- ═══════════════════════════════════════════════════════════════════════════════════════

begin;

-- ── El sujeto puede ser una carta ──
alter table public.assets drop constraint if exists assets_subject_type_check;
alter table public.assets add constraint assets_subject_type_check
  check (subject_type = any (array[
    'player'::text, 'team'::text, 'league'::text, 'tournament'::text,
    'country'::text, 'role'::text, 'variant'::text, 'none'::text,
    'card'::text
  ]));

-- ── El asset puede ser la ilustración final de una carta ──
alter table public.assets drop constraint if exists assets_kind_check;
alter table public.assets add constraint assets_kind_check
  check (kind = any (array[
    'player_photo'::text, 'team_logo'::text, 'league_logo'::text, 'tournament_logo'::text,
    'flag'::text, 'role'::text, 'card_template'::text, 'background'::text,
    'animation'::text, 'effect'::text,
    'card_artwork'::text
  ]));

/*
 * Índice para la pregunta que hace el juego y hace el panel: «¿cuál es el artwork VIGENTE de
 * esta carta en esta versión?». Sin él es un recorrido de tabla por cada carta pintada.
 *
 * Parcial sobre `is_current`: de un grupo de asset solo interesa la fila vigente, y las
 * anteriores —las que dejó atrás un `replace`— se conservan como historial pero no se
 * consultan al pintar.
 */
create index if not exists assets_card_artwork_idx
  on public.assets (subject_id)
  where subject_type = 'card' and kind = 'card_artwork' and is_current;

commit;
