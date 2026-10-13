/**
 * FASE 37 · COLLECTION ROOM — contratos de seguridad, rendimiento, economía, reutilización y render.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getPlayer } from "@/data/catalog";
import { qaSerializedCard } from "@/app/design-system/serialFixture";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection";
import { getVariant } from "@/domain/cards/variants";
import { buildCollectionSnapshot, packsThatCanContain, playerVariants, type CollectionPersonalFacts } from "@/domain/collection/room";
import { RATE_POLICY } from "@/server/services/rateLimit";
import { CardDetailView } from "./CardDetailView";
import { CardBack } from "./CardBack";
import { StatBars } from "./StatBars";
import { CollectionBook } from "./CollectionBook";
import { CollectionHero } from "./CollectionHero";
import { CardCompareView } from "./CardCompareView";
import { AlbumGrid } from "@/components/album/AlbumGrid";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);

const ROUTE = read("src/app/api/game/collection/route.ts");
const SERVICE = read("src/server/services/collection.ts");
const CLIENT = read("src/lib/collection/client.ts");
// La ruta conecta sesión y URL; la pantalla (compartida con el arnés QA) hace búsqueda, orden y paginado.
const PAGE = read("src/app/coleccion/page.tsx") + read("src/components/collectionRoom/CollectionRoomScreen.tsx");
const DETAIL_PAGE = read("src/app/coleccion/carta/[cardId]/page.tsx");
const COMPARE_PAGE = read("src/app/coleccion/comparar/page.tsx");
const ROOM_DIR = "src/components/collectionRoom";
const UI = readdirSync(join(ROOT, ROOM_DIR)).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => read(`${ROOM_DIR}/${f}`)).join("\n");
const HOOK = read(`${ROOM_DIR}/useCollectionRoom.ts`);
const MIG = read("supabase/migrations/0052_collection_favorites.sql");

const none: CollectionPersonalFacts = { instances: [], favorites: [], showcaseUids: [], decks: [] };
const A = CARDS[0];
const PA = getPlayer(A.playerId)!;
const serialized = qaSerializedCard() /* catálogo diseñado sin serializadas: carta local de QA */;
const PS = getPlayer(serialized.playerId)!;

/* ───────────── API ───────────── */

test("API · GET sin parámetros (?userId= → 400) y con sesión obligatoria; POST de cuerpo cerrado", () => {
  assert.ok(ROUTE.includes('if ([...new URL(req.url).searchParams.keys()].length > 0) return bad("Parámetro no válido");'));
  assert.ok(ROUTE.includes('if (!session) return bad("Inicia sesión para ver tu colección", "UNAUTHENTICATED", 401);'));
  assert.ok(ROUTE.includes('favorite: ["action", "cardId", "favorite"]'));
  assert.ok(ROUTE.includes('if (Object.keys(body).some((k) => !allowed.includes(k))) return bad("Campo no permitido", "FIELD_NOT_ALLOWED");'));
  assert.ok(!/body\.userId|searchParams\.get\("userId"\)/.test(code(ROUTE)));
});

test("API · el usuario sale del token en las dos operaciones; nunca del cuerpo", () => {
  assert.ok(ROUTE.includes("getCollectionPersonal(session.admin, session.userId)"));
  assert.ok(ROUTE.includes("setFavorite(session.admin, session.userId, body.cardId, body.favorite)"));
});

test("API · límites de lectura y escritura propios y razonables; no-store", () => {
  assert.ok(ROUTE.includes('"collection_read"') && ROUTE.includes('"collection_write"'));
  assert.ok(RATE_POLICY.collection_read.limit >= 10 && RATE_POLICY.collection_read.limit <= 120);
  assert.ok(RATE_POLICY.collection_write.limit >= 10 && RATE_POLICY.collection_write.limit <= 120);
  assert.ok(ROUTE.includes('const NO_STORE = { "cache-control": "no-store" };'));
});

test("API · errores internos genéricos y cuerpo acotado", () => {
  assert.ok(ROUTE.includes('"No se pudo completar la operación"'));
  assert.ok(ROUTE.includes("if (raw.length > 2_000)"));
  assert.ok(!/error: e\.message|String\(e\)/.test(code(ROUTE)));
});

test("API · sin endpoints de precio, venta, mercado ni intercambio", () => {
  assert.ok(!/sell|market|trade|price|precio|venta|vender|quick/i.test(code(ROUTE + SERVICE)));
  assert.equal(readdirSync(join(ROOT, "src/app/api/game/collection")).length, 1);
});

/* ───────────── servicio ───────────── */

test("SERVICIO · lectura con columnas propias (uid, carta, serial, versión): sin dueño, correo ni origen", () => {
  const s = code(SERVICE);
  assert.ok(s.includes('.select("uid, card_id, serial, minted_version")'));
  assert.ok(s.includes('.eq("user_id", userId)'));
  assert.ok(!/email|is_admin|origin|obtained_at|credits/.test(s));
});

test("SERVICIO · sin N+1: cuatro lecturas en paralelo, instancias paginadas por rango", () => {
  const s = code(SERVICE);
  assert.ok(s.includes("await Promise.all(["));
  assert.ok(s.includes(".range(from, from + PAGE - 1)"));
  assert.ok(!/for \(const [a-z]+ of [a-z.]+\) \{[^}]*await sb/.test(s));
});

test("SERVICIO · la única escritura es la tabla de favoritos (insert/delete), nada más", () => {
  const writes = [...code(SERVICE).matchAll(/from\("([a-z_]+)"\)\.(insert|update|upsert|delete)\(/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual([...new Set(writes)].sort(), ["user_card_favorites.delete", "user_card_favorites.insert"]);
  assert.ok(!/\.rpc\(/.test(code(SERVICE)));
});

test("SERVICIO · favoritos validan formato Y existencia en el catálogo del servidor, con tope", () => {
  const s = code(SERVICE);
  assert.ok(s.includes("if (!isValidCardId(cardId))") && s.includes("if (!getCard(cardId))") && s.includes("FAVORITES_MAX = 200"));
});

/* ───────────── migración 0052 ───────────── */

test("0052 · aditiva, con RLS de lectura propia, sin escritura del cliente, tope con cerrojo y formato de carta", () => {
  // Fase 37.1: aplicada en el VPS con backup previo; sin registro en schema_migrations.
  assert.ok(MIG.includes("— APLICADA (VPS 2026-09-15 19:32Z, Fase 37.1).") && MIG.includes("No tocar `schema_migrations`"));
  assert.ok(MIG.includes("perform pg_advisory_xact_lock(hashtextextended('user_card_favorites:' || new.user_id::text, 0));"), "dos altas concurrentes no pueden dejar 201");
  assert.ok(MIG.includes("set search_path = pg_catalog, public") && !/security definer/i.test(MIG));
  assert.ok(MIG.includes("create table if not exists public.user_card_favorites"));
  assert.ok(MIG.includes("primary key (user_id, card_id)"));
  assert.ok(MIG.includes("enable row level security"));
  assert.ok(MIG.includes("revoke all on public.user_card_favorites from anon, authenticated;"));
  assert.ok(MIG.includes("grant select on public.user_card_favorites to authenticated;"));
  assert.ok(MIG.includes("using (auth.uid() = user_id)"));
  assert.ok(MIG.includes("FAVORITES_LIMIT") && MIG.includes(">= 200"));
  assert.ok(MIG.includes("card_id ~ '^[a-z0-9-]{1,64}__[a-z0-9-]{1,32}$'"));
  assert.ok(!/drop table (?!if exists public\.user_card_favorites)|alter table public\.(?!user_card_favorites)|insert into|update public/i.test(code(MIG.replace(/^--.*$/gm, ""))));
});

/* ───────────── cliente y páginas ───────────── */

test("CLIENTE · Bearer, tiempo máximo, sin userId y SIN localStorage como persistencia de favoritos", () => {
  assert.ok(CLIENT.includes("authorization: `Bearer ${token}`") && CLIENT.includes("COLLECTION_TIMEOUT_MS = 8_000"));
  assert.ok(!/userId|localStorage|sessionStorage/.test(code(CLIENT + UI + HOOK + PAGE + DETAIL_PAGE + COMPARE_PAGE)));
});

test("CLIENTE · favoritos optimistas con reversión; sin red no se muta nada", () => {
  assert.ok(CLIENT.includes("Sin conexión: los favoritos se guardan en el servidor"));
  assert.ok(CLIENT.includes("setData((d) => d && d.favorites ? { ...d, favorites: was ?"));
});

test("PÁGINA · búsqueda/filtros/orden en la URL, sin pedir al servidor por tecla", () => {
  assert.ok(PAGE.includes("parseCollectionQuery(") && PAGE.includes("serializeCollectionQuery(q)") && PAGE.includes("router.replace("));
  assert.ok(PAGE.includes("SEARCH_DEBOUNCE_MS = 250"));
  assert.ok(!/fetch\(|fetchCollectionPersonal\(/.test(code(PAGE)));
});

test("RENDIMIENTO · la rejilla pinta de 48 en 48 y con Card3D estático (sin inclinación por carta)", () => {
  assert.ok(PAGE.includes("const COLLECTION_PAGE = 48;") && PAGE.includes("results.slice(0, shown)"));
  const grid = read("src/components/album/AlbumGrid.tsx");
  assert.ok(grid.includes('mode="static"'));
  assert.ok(!/mode="(hover|legendary|selected|showcase)"/.test(grid));
  assert.equal((UI.match(/mode="hover"/g) ?? []).length, 1, "una sola carta con profundidad en la sala (la de la cabecera)");
});

test("RENDIMIENTO · la foto y la consulta se memorizan; nada se calcula por carta en el servidor", () => {
  assert.ok(HOOK.includes("useMemo(() => buildCollectionSnapshot(") && PAGE.includes("useMemo(() => runCollectionQuery("));
});

test("REUTILIZACIÓN · sin segundo renderizador de cartas, sin segundo constructor, sin segunda vitrina", () => {
  assert.ok(!/function [A-Z][A-Za-z]*CardRenderer|<svg[^>]*card-face/.test(UI));
  assert.ok(UI.includes("@/components/cards/PlayerCard") && UI.includes("@/components/visual/Card3D"));
  assert.ok(DETAIL_PAGE.includes('import { AddToDeckSheet } from "@/components/deck/AddToDeckSheet";'));
  assert.ok(DETAIL_PAGE.includes('import { saveShowcase } from "@/lib/player/client";'));
  assert.ok(!/from\("duel_decks"\)|player_profile_customization/.test(code(DETAIL_PAGE + UI)));
});

test("ECONOMÍA · la colección no enseña precio, valor, venta, mercado ni venta rápida", () => {
  const all = code(PAGE + DETAIL_PAGE + COMPARE_PAGE + UI);
  assert.ok(!/instanceValue|quickSellValue|marketValue|quickSell|listForSale|precio|Vender|Mercado|🪙|valor estimado/i.test(all));
});

test("VERDAD · sin «conseguidas hoy» por obtained_at y sin procedencia inventada", () => {
  const all = code(PAGE + DETAIL_PAGE + UI + HOOK);
  // `obtainedAt: 0` es el campo obligatorio de `OwnedCard` que el motor exige; se rellena a 0 y nunca se enseña ni ordena.
  assert.ok(!/obtainedAt(?!: 0)|obtained_at|recentlyAcquired|Recientes|Conseguida del sobre|Conseguidas hoy/.test(all));
  assert.ok(UI.includes("No es una garantía: depende del sorteo de cada sobre."));
});

test("VERDAD · el serial no da stats ni recompensas, y se dice", () => {
  assert.ok(UI.includes("El número de serie es prestigio: no cambia las stats ni da recompensas."));
});

test("PERFIL · /jugador/[id] es el perfil de USUARIO: la ficha no enlaza a un profesional ahí", () => {
  assert.ok(!/\/jugador\//.test(code(DETAIL_PAGE)) || code(DETAIL_PAGE).includes("/jugador/me?editar=1") === false);
  assert.ok(!/href=\{`\/jugador\/\$\{/.test(UI));
});

test("SOBRE → COLECCIÓN · la hero abre SU ficha («Ver carta →») e «Ir a mi colección» lleva a la colección", () => {
  // Fase 38: el resumen navega al `href` del plan, que es `cardHref(card.id)` de la instancia real. Pack Opening 3.0: la
  // ficha de la hero se abre desde su propio enlace; la acción secundaria del dock va a /coleccion.
  const summary = read("src/components/packs/PackSummary.tsx");
  assert.ok(summary.includes('<Link href={featured.href}'));
  assert.ok(summary.includes('onClick={() => onNavigate("/coleccion")} data-testid="summary-view-collection"'));
  assert.ok(read("src/domain/packs/reveal.ts").includes("href: cardHref(card.id),"));
});

test("RUTAS · ficha estable y comparador existen; la ficha valida el id antes de usarlo", () => {
  assert.ok(existsSync(join(ROOT, "src/app/coleccion/carta/[cardId]/page.tsx")));
  assert.ok(existsSync(join(ROOT, "src/app/coleccion/comparar/page.tsx")));
  assert.ok(DETAIL_PAGE.includes("isValidCardId(id) ? getCard(id) : undefined"));
  assert.ok(COMPARE_PAGE.includes("isValidCardId(rawA) ? getCard(rawA) : undefined"));
});

/* ───────────── sobres abiertos (P2 de 36.1) ───────────── */

test("SOBRES ABIERTOS · Meta Hub y perfil propio leen user_game.packs_opened, no profiles.packs_opened", () => {
  const meta = code(read("src/server/services/meta.ts"));
  assert.ok(meta.includes('admin.from("user_game").select("packs_opened").eq("user_id", userId).maybeSingle()'));
  assert.ok(!/packsOpened: p\?\.packs_opened|packsOpened: p\.packs_opened/.test(meta));
  const identity = code(read("src/server/services/playerIdentity.ts"));
  assert.ok(identity.includes('sb.from("user_game").select("packs_opened").eq("user_id", playerId).maybeSingle()'));
  assert.ok(identity.includes("packsOpened: isSelf ? ((gameRes.data as { packs_opened: number } | null)?.packs_opened ?? 0) : null"));
});

/* ───────────── render ───────────── */

const ownedSnap = buildCollectionSnapshot(CARDS, getPlayer, {
  ...none,
  instances: [{ uid: "u-1", cardId: serialized.id, serial: 1, mintedVersion: 1 }, { uid: "u-2", cardId: serialized.id, serial: 57, mintedVersion: 1 }],
  showcaseUids: ["u-2"],
  decks: [{ id: "d1", name: "Equipo 2", active: true, cardUids: ["u-1"] }],
});
const detail = (o: Partial<Parameters<typeof CardDetailView>[0]> = {}) => html(
  <CardDetailView
    def={serialized} player={PS} access="server" ownership={ownedSnap.byCard.get(serialized.id)!}
    variants={playerVariants(CARDS, serialized.playerId, ownedSnap)} availability={packsThatCanContain(new CardRegistry(), PACKS, serialized)}
    sets={{ team: null, region: null }} decks={[{ id: "d1", name: "Equipo 2", active: true, cardUids: ["u-1"] }]}
    favorite={{ available: true, active: false }} showcase={{ available: true, count: 1 }} onAddToDeck={() => {}} {...o}
  />,
);

test("FICHA · poseída: copias con serial canónico, prestigio #1, vitrina, equipo activo y acciones", () => {
  const h = detail();
  assert.match(h, /data-owned="true"/);
  assert.match(h, new RegExp(`#1/${getVariant(serialized.variantId).serialLimit}`));
  assert.match(h, />#1</);
  assert.match(h, /En vitrina/);
  assert.match(h, /En Equipo 2 \(activo\)/);
  assert.match(h, /Añadir a favoritos/);
  assert.match(h, /Añadir al equipo/);
  assert.match(h, /Comparar/);
  assert.match(h, /Usada en 1 equipo, incluido tu equipo activo/);
});

test("FICHA · no poseída: «No conseguida», sin serial y sin copias fingidas", () => {
  const h = detail({ ownership: null });
  assert.match(h, /data-owned="false"/);
  assert.match(h, /No conseguida/);
  assert.ok(!/#1\//.test(h));
  assert.match(h, /Todavía no tienes ninguna copia/);
});

test("FICHA · sin sesión: definición pública, invitación a entrar y ni un dato privado", () => {
  const h = detail({ access: "anon", ownership: null, decks: null, favorite: { available: false, active: false } });
  assert.match(h, /Inicia sesión/);
  assert.ok(!/Favorito|Añadir al equipo|Poner en vitrina|No conseguida|En vitrina/.test(h));
});

test("FICHA · sin conexión: mutaciones desactivadas y aviso textual", () => {
  const h = detail({ offline: true });
  assert.match(h, /Sin conexión: favoritos, vitrina y equipos vuelven/);
  assert.match(h, /<button[^>]*disabled=""[^>]*data-testid="card-favorite"|<button[^>]*data-testid="card-favorite"[^>]*disabled=""|data-testid="card-favorite"[^>]*disabled/);
});

test("FICHA · vitrina llena: no se ofrece añadir, se lleva al editor del perfil", () => {
  const h = detail({ showcase: { available: true, count: 3 } });
  assert.match(h, /Vitrina llena · editar en tu perfil/);
  assert.ok(!/Poner en vitrina/.test(h));
});

test("FICHA · stats de combate accesibles y girar la carta con aria-pressed", () => {
  const h = detail();
  const bars = h.match(/role="progressbar"[^>]*aria-label="(Stronghold|Gamesense|Entryfrag)[^"]*"/g) ?? [];
  assert.equal(bars.length, 3);
  assert.match(h, /data-testid="card-flip"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-testid="card-flip"/);
});

test("FICHA · dónde puede salir: sobres activos reales y sin garantía", () => {
  const h = detail();
  assert.match(h, /Dónde puede salir/);
  assert.match(h, /No es una garantía/);
});

test("REVERSO · diseño propio con hechos del catálogo y etiqueta accesible", () => {
  const h = html(<CardBack def={A} player={PA} />);
  assert.match(h, /role="img"/);
  assert.match(h, new RegExp(`Reverso de la carta ${PA.nick}`));
  assert.match(h, new RegExp(A.id));
  assert.ok(!/biograf|historia|lore/i.test(h));
});

test("STATS · tres barras con número visible", () => {
  const h = html(<StatBars def={A} />);
  assert.equal((h.match(/role="progressbar"/g) ?? []).length, 3);
  assert.match(h, new RegExp(`>${A.combat!.stronghold}<`));
});

test("LIBRO · cada set es un botón con progreso textual y estado (completo/casi) en texto", () => {
  const h = html(<CollectionBook snap={ownedSnap} onPick={() => {}} initial="rarity" />);
  assert.equal((h.match(/data-set="rarity:/g) ?? []).length, 5);
  assert.match(h, /aria-label="Legendaria: \d+ de \d+ cartas/);
});

test("CABECERA · álbum X / Y con porcentaje y barra; sin sesión no enseña copias", () => {
  const server = html(<CollectionHero snap={ownedSnap} bestDef={serialized} mode="server" />);
  assert.match(server, new RegExp(`/ ${CARDS.length} cartas`));
  assert.match(server, /Duplicadas/);
  assert.match(server, /Tu carta de mayor OVR/);
  const anon = html(<CollectionHero snap={buildCollectionSnapshot(CARDS, getPlayer, none)} bestDef={null} mode="anon" />);
  assert.ok(!/Duplicadas|Copias/.test(anon));
});

test("COMPARADOR · tabla con A − B en texto y frase accesible; primero tus cartas", () => {
  const b = CARDS[300];
  const h = html(<CardCompareView a={A} b={b} candidates={CARDS.slice(0, 40)} ownedIds={new Set([CARDS[5].id])} onPickB={() => {}} />);
  assert.match(h, /data-testid="compare-table"/);
  assert.match(h, /Sin veredicto/);
  assert.match(h, /OVR: \d+ frente a \d+/);
  const firstCandidate = h.indexOf("Tuya");
  assert.ok(firstCandidate > 0 && firstCandidate < h.indexOf("No conseguida"));
});

test("REJILLA · una carta no conseguida también se abre y lo dice en su etiqueta", () => {
  const h = html(<AlbumGrid cards={[{ cardId: A.id, def: A, owned: false, count: 0, label: `${PA.nick}, OVR ${A.ovr}, no conseguida. Abrir ficha` }]} onOpen={() => {}} remaining={0} onMore={() => {}} />);
  assert.match(h, /No conseguida/);
  assert.match(h, /aria-label="[^"]*no conseguida\. Abrir ficha"/);
  assert.ok(!/<button[^>]*disabled/.test(h), "no se desactiva");
});

test("REJILLA · marcas de estado limitadas a favorita, vitrina y equipo activo", () => {
  const h = html(<AlbumGrid cards={[{ cardId: A.id, def: A, owned: true, count: 2, favorite: true, inShowcase: true, inActiveDeck: true }]} onOpen={() => {}} remaining={0} onMore={() => {}} />);
  assert.match(h, /★/);
  assert.match(h, /Vitrina/);
  assert.match(h, /Equipo/);
});
