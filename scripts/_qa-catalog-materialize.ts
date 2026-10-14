/**
 * QA · CATÁLOGO SERVIDO DESDE LA BASE EN EL STACK AISLADO — genera SQL; no se conecta a nada.
 *
 *   npx tsx scripts/_qa-catalog-materialize.ts up   > up.sql     (docker exec -i vrqa_db psql … < up.sql)
 *   npx tsx scripts/_qa-catalog-materialize.ts down > down.sql
 *
 * Por qué: la base de QA no tiene `content_*` (la app de QA sirve el catálogo del código), así que no se puede probar
 * una carta publicada desde el panel con un equipo nuevo. Producción sí sirve el catálogo desde la base.
 *
 * `up` inserta jugadores, las 331 cartas y su versión 1 con las MISMAS funciones del juego (`toPlayerRow`,
 * `toCardRow`), como el paso 3 de `cartas-db-replace.ts`, pero SIN borrar nada: ni propiedad, ni mazos, ni pools. Se
 * niega si `content_cards` no está vacía. `down` borra exactamente esas filas (por id) y deja la base como estaba.
 * SOLO para el stack de QA aislado.
 */
import { CARDS, getPlayer } from "../src/data/catalog";
import { toCardRow, toPlayerRow } from "../src/server/catalog/rows";

const mode = process.argv[2];
if (mode !== "up" && mode !== "down") { console.error("uso: _qa-catalog-materialize.ts up|down"); process.exit(1); }
const json = (v: unknown) => `$qa$${JSON.stringify(v)}$qa$::jsonb`;
const players = [...new Set(CARDS.map((c) => c.playerId))].map((id) => toPlayerRow(getPlayer(id)!));
const cards = CARDS.map((c, i) => toCardRow(c, i));
const versions = cards.map((r) => ({ card_id: r.card_id, version: 1, player_id: r.player_id, variant_id: r.variant_id, ovr: r.ovr, combat: r.combat, stats: r.stats, stat_boost: r.stat_boost, rarity_rank: r.rarity_rank, rarity_bucket: r.rarity_bucket, data_version: r.data_version, source: r.source, generated_at: r.generated_at, checksum: r.checksum, effective_from: r.generated_at }));
const cols = (rows: object[]) => Object.keys(rows[0]).join(", ");
const L: string[] = ["\\set ON_ERROR_STOP on", "begin;"];
if (mode === "up") {
  L.push(`do $$ begin if (select count(*) from public.content_cards) > 0 then raise exception 'content_cards no está vacía: no se materializa nada'; end if; end $$;`);
  L.push(`insert into public.content_players (${cols(players)}) select ${cols(players)} from jsonb_populate_recordset(null::public.content_players, ${json(players)}) on conflict (id) do nothing;`);
  L.push(`insert into public.content_cards (${cols(cards)}) select ${cols(cards)} from jsonb_populate_recordset(null::public.content_cards, ${json(cards)});`);
  L.push(`insert into public.content_card_versions (${cols(versions)}) select ${cols(versions)} from jsonb_populate_recordset(null::public.content_card_versions, ${json(versions)});`);
  L.push("set constraints all immediate;");
  L.push("select 'catálogo materializado · versión ' || public._bump_catalog();");
  L.push(`do $$ begin if (select count(*) from public.content_cards where lifecycle = 'PUBLISHED') <> ${cards.length} then raise exception 'recuento de cartas distinto'; end if; end $$;`);
} else {
  const ids = (xs: string[]) => `(${xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(", ")})`;
  L.push(`delete from public.content_card_versions where card_id in ${ids(cards.map((c) => c.card_id))};`);
  L.push(`delete from public.content_cards where card_id in ${ids(cards.map((c) => c.card_id))};`);
  L.push(`delete from public.content_players p where p.id in ${ids(players.map((p) => p.id))} and not exists (select 1 from public.content_cards c where c.player_id = p.id);`);
  L.push("select 'catálogo retirado · versión ' || public._bump_catalog() || ' · cartas ' || (select count(*) from public.content_cards) || ' · jugadores ' || (select count(*) from public.content_players);");
}
L.push("commit;");
process.stdout.write(L.join("\n") + "\n");
