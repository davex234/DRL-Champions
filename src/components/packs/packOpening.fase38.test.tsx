/**
 * FASE 38 · THE REVEAL — contratos de la ruta, accesibilidad, movimiento reducido, rendimiento y render de las piezas
 * (`PackSummary`, `CardReveal`, `PackStage`, `PackStatus`) con planes construidos sobre el catálogo REAL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { getPack, PACKS } from "@/data/packs";
import { getVariant } from "@/domain/cards/variants";
import type { CardDef } from "@/domain/cards/types";
import { rarityOf, teamKeyOf, type OwnedInstanceFact } from "@/domain/collection/room";
import type { RarityBucket } from "@/domain/packs/types";
import { buildRevealPlan, type OpenedInstance, type RevealItem } from "@/domain/packs/reveal";
import type { OpenedResult } from "@/store/useGameStore";
import { PackSummary } from "./PackSummary";
import { CardReveal } from "./CardReveal";
import { PackStage } from "./PackStage";
import { PackStatus } from "./PackStatus";
import { MAX_BURST, rarityCeremony } from "./ceremony";
import { qaSerializedCard } from "@/app/design-system/serialFixture";
// ANTES de cualquier captura de `CARDS`: la carta de QA se da de alta y todo el proceso ve el mismo catálogo.
const SERIALIZED = qaSerializedCard() /* catálogo diseñado sin serializadas: carta local de QA */;

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const ROUTE = read("src/app/api/game/packs/route.ts");
const CEREMONY = read("src/components/packs/PackOpeningExperience.tsx");
const STAGE = read("src/components/packs/PackStage.tsx");
const REVEAL = read("src/components/packs/CardReveal.tsx");
const SUMMARY = read("src/components/packs/PackSummary.tsx");
const STATUS = read("src/components/packs/PackStatus.tsx");
const UI = [CEREMONY, STAGE, REVEAL, SUMMARY, STATUS].join("\n");

const CAT = { cards: CARDS, getCard, getPlayer };
const of = (r: RarityBucket) => CARDS.find((c) => rarityOf(c) === r)!;
let n = 0;
const op = (c: CardDef, serial: number | null = null): OpenedInstance => ({ uid: `u-${++n}`, cardId: c.id, serial, mintedVersion: 3 });
const own = (c: CardDef): OwnedInstanceFact => ({ uid: `o-${++n}`, cardId: c.id, serial: null, mintedVersion: 1 });
const asResult = (it: RevealItem): OpenedResult => ({ uid: it.uid, card: it.card, serial: it.serial ?? undefined, mintedVersion: it.mintedVersion, isNew: it.status === "new", value: 0 });
const summary = (plan: ReturnType<typeof buildRevealPlan>, extra: Partial<Parameters<typeof PackSummary>[0]> = {}) =>
  html(<PackSummary packName="Sobre Estándar" plan={plan} available={0} packsLeft={0} onNavigate={() => {}} {...extra} />);

/* ───────────── ruta ───────────── */

test("RUTA · solo POST (sin GET/PUT/DELETE exportados)", () => {
  assert.match(ROUTE, /export async function POST\(/);
  assert.ok(!/export (async )?function (GET|PUT|PATCH|DELETE)/.test(ROUTE));
});

test("RUTA · cuerpo acotado (413) y campos cerrados: el cliente no elige carta, rareza, serial, versión, pool ni odds", () => {
  assert.ok(ROUTE.includes("if (raw.length > MAX_BODY)") && ROUTE.includes("status: 413"));
  assert.ok(ROUTE.includes('const ALLOWED = ["action", "packId", "ref", "expectedPrice"];')); // ICON 2026-10-09: precio visto (solo bloquea)
  assert.ok(ROUTE.includes('return NextResponse.json({ error: "Campo no permitido" }, { status: 400 });'));
});

test("RUTA · 5xx genérico: ni el mensaje de la RPC ni el de la excepción llegan al cliente", () => {
  assert.ok(ROUTE.includes("if (result.status >= 500)"));
  assert.ok(!/error: e instanceof Error \? e\.message/.test(code(ROUTE)));
  assert.ok(ROUTE.includes('const GENERIC = "No se pudo completar la operación";'));
});

test("RUTA · la clave de gesto tiene formato cerrado y el usuario sale del token", () => {
  assert.ok(ROUTE.includes("/^[\\w:-]{1,128}$/.test(body.ref)"));
  assert.ok(ROUTE.includes("openPackForUser(session.admin, session.userId, packId, ref)"));
});

/* ───────────── autoridad y economía en la UI ───────────── */

test("UI · la ceremonia no sortea, no pone precios ni seriales, no concede nada y no crea ledger", () => {
  const c = code(UI);
  assert.ok(!/Math\.random|makeRng|PackEngine|weights|\.price\b|app_grant|credit_transactions|claim[A-Z]\w*\(/.test(c));
});

test("UI · sin venta rápida, valor en monedas, mercado ni «vender repetidas»", () => {
  assert.ok(!/quickSell|\bvender\b|\bventa\b|🪙|formatCredits|\bmercado\b|valor total/i.test(code(UI)));
});

test("UI · un sobre de equipo nunca se presenta como «garantizado»", () => {
  assert.ok(!/garantiz/i.test(code(STAGE + SUMMARY + REVEAL + STATUS)));
});

test("UI · telemetría solo con el flujo ya existente `pack_ceremony`", () => {
  for (const m of UI.matchAll(/trackFlow\("([a-z_]+)"/g)) assert.equal(m[1], "pack_ceremony");
});

/* ───────────── movimiento, fotosensibilidad y rendimiento ───────────── */

test("MOVIMIENTO REDUCIDO · sin mitades, partículas, onda, destello ni corona", () => {
  // Fase 57.1 · con movimiento reducido las mitades SÍ se ven (si no, la apertura no se entiende y parecía la antigua),
  // pero no vuelan ni giran: se separan 14 px y se desvanecen en su sitio. Pin reescrito a su intención.
  assert.ok(STAGE.includes("reduced ? { x: dir * 14, y: -10, rotate: 0, opacity: 0 }"), "mitades sin vuelo ni giro");
  assert.ok(STAGE.includes("{!reduced && <ParticleBurst"), "partículas de la rotura");
  assert.ok(/\{!reduced && \(\s*<motion\.div aria-hidden className="absolute inset-0 bg-white"/.test(STAGE), "velo");
  assert.ok(REVEAL.includes("{revealed && spec.rays && !reduced && ("), "corona");
  assert.ok(STAGE.includes("{ambient && !reduced && <AmbientParticles"), "polvo ambiente");
});

test("FOTOSENSIBILIDAD · un único velo suave (≤ 0,3 de opacidad, ≥ 0,6 s), sin estroboscopio", () => {
  const m = STAGE.match(/opacity: \[0, ([\d.]+), 0\] \}\} transition=\{\{ duration: ([\d.]+)/)!;
  assert.ok(Number(m[1]) <= 0.3 && Number(m[2]) >= 0.6, m[0]);
  assert.ok(!/repeat: Infinity[^}]*bg-white|bg-white[^>]*repeat: Infinity/.test(STAGE));
});

test("RENDIMIENTO · ninguna ráfaga supera MAX_BURST partículas y ninguna rareza la pide", () => {
  assert.equal(MAX_BURST, 40);
  for (const r of ["common", "uncommon", "rare", "epic", "legendary"] as const) assert.ok(rarityCeremony(r).burst <= MAX_BURST, r);
  for (const m of UI.matchAll(/count=\{(\d+)\}/g)) assert.ok(Number(m[1]) <= MAX_BURST, m[0]);
});

test("RENDIMIENTO · sin confeti y el resumen pinta las cartas en estático (sin inclinación por carta)", () => {
  assert.ok(!/Confetti/.test(code(UI)));
  assert.ok(!/mode="(hover|legendary|selected|showcase)"/.test(SUMMARY));
});

test("RAREZA · la receta por rareza no canta tiers inventados (sin heraldo propio, lo pone el plan)", () => {
  for (const r of ["common", "uncommon", "rare", "epic", "legendary"] as const) assert.equal(rarityCeremony(r).herald, "");
});

/* ───────────── accesibilidad ───────────── */

test("A11Y · anuncio por carta, cara oculta a lectores hasta girar, salto y cierre con nombre", () => {
  assert.ok(REVEAL.includes('aria-live="polite" data-testid="reveal-announcement"'));
  assert.ok(REVEAL.includes("aria-hidden={!revealed}"));
  assert.ok(CEREMONY.includes('aria-label="Saltar la animación y ver todas las cartas"'));
  assert.ok(CEREMONY.includes('aria-label="Cerrar la apertura"'));
});

test("A11Y · botones propios con diana de 44 px", () => {
  for (const m of UI.matchAll(/<button[\s\S]*?className="([^"]*)"/g)) assert.match(m[1], /min-h-\[44px\]/, m[0].slice(0, 80));
});

/* ───────────── render · resumen ───────────── */

const [c1, c2, c3] = CARDS.filter((c) => rarityOf(c) === "common");
const baseline = CARDS.filter((c) => rarityOf(c) === "uncommon").slice(0, 27).map(own);

test("RESUMEN · todas las cartas con su ficha y sus datos de instancia", () => {
  const opened = [op(c1), op(c2, null), op(SERIALIZED, 12)];
  const h = summary(buildRevealPlan(opened, baseline, CAT));
  assert.equal((h.match(/data-testid="summary-card"/g) ?? []).length, 3);
  for (const o of opened) assert.match(h, new RegExp(`data-uid="${o.uid}" data-card-id="${o.cardId}"`));
  assert.equal((h.match(/Ver carta →/g) ?? []).length, 3);
  assert.match(h, /data-minted="3"/);
});

test("RESUMEN · nuevas: colección X → Y / TOTAL con recuento exacto", () => {
  const h = summary(buildRevealPlan([op(c1), op(c2), op(c3)], baseline, CAT));
  assert.match(h, /data-before="27" data-after="30" data-total="772"|data-before="27" data-after="30" data-total="\d+"/);
  assert.match(h, /3 cartas nuevas en tu colección/);
});

test("RESUMEN · todas duplicadas: X → X y se dice, sin fingir progreso", () => {
  const dup = baseline.slice(0, 3).map((f) => op(getCard(f.cardId)!));
  const h = summary(buildRevealPlan(dup, baseline, CAT));
  assert.match(h, /data-before="27" data-after="27"/);
  assert.match(h, /Sin cartas nuevas: 3 duplicadas\./);
});

test("RESUMEN · primera legendaria y serial #1 como reconocimiento (sin recompensa)", () => {
  const h = summary(buildRevealPlan([op(of("legendary")), op(SERIALIZED, 1)], baseline, CAT));
  assert.match(h, /Primera legendaria/);
  assert.match(h, /Serial #1/);
  assert.ok(!/créditos|XP|recompensa/i.test(h.replace(/no cambia stats ni da recompensas/g, "")));
});

test("RESUMEN · set completado con esta apertura", () => {
  const by = new Map<string, CardDef[]>();
  for (const c of CARDS) { const k = teamKeyOf(getPlayer(c.playerId)!.team).key; by.set(k, [...(by.get(k) ?? []), c]); }
  const team = [...by.values()].filter((v) => v.length >= 5).sort((a, b) => a.length - b.length)[0];
  const h = summary(buildRevealPlan([op(team[team.length - 1])], team.slice(0, -1).map(own), CAT));
  assert.match(h, /Set completado · /);
});

test("RESUMEN · sin foto de colección: las cartas sí, el progreso se declara no disponible", () => {
  const h = summary(buildRevealPlan([op(c1)], null, CAT));
  assert.match(h, /El progreso de tu colección no está disponible/);
  assert.ok(!/data-testid="summary-collection"/.test(h));
  assert.equal((h.match(/data-testid="summary-card"/g) ?? []).length, 1);
});

test("RESUMEN · destacada con criterio escrito", () => {
  // F81 · la destacada es la HERO (mayor OVR); el criterio completo va en el title, sin romper la escena.
  const out = summary(buildRevealPlan([op(c1), op(of("epic"))], baseline, CAT));
  assert.match(out, /Destacada · mayor OVR del sobre/);
  assert.match(out, /title="Mayor OVR; a igualdad, una sola elegida al azar y fija para esta apertura"/);
});

test("RESUMEN · abrir otro solo si queda otro de ESTE sobre; si no, inventario o sobres", () => {
  const plan = buildRevealPlan([op(c1)], baseline, CAT);
  assert.match(summary(plan, { available: 3, onOpenAnother: () => {} }), /Abrir otro sobre · 3/);
  assert.match(summary(plan, { available: 0, packsLeft: 4 }), /Abrir mis sobres · 4/);
  const none = summary(plan, { available: 0, packsLeft: 0 });
  assert.match(none, /Ver sobres/);
  assert.ok(!/Abrir otro sobre/.test(none));
});

test("RESUMEN · recuperado o repetido: se dice que el sobre ya se abrió (no otro)", () => {
  assert.match(summary(buildRevealPlan([op(c1)], baseline, CAT), { recovered: true }), /El sobre ya se abrió correctamente/);
});

/* ───────────── render · revelado ───────────── */

const revealHtml = (it: RevealItem, revealed: boolean) => html(
  <CardReveal result={asResult(it)} item={it} index={it.index} total={5} onNext={() => {}} revealed={revealed} reducedOverride />,
);

test("REVELADO · la carta es su instancia (uid, carta, serial) y la rareza se dice en texto", () => {
  const it = buildRevealPlan([op(SERIALIZED, 7)], baseline, CAT).items[0];
  const h = revealHtml(it, true);
  assert.match(h, new RegExp(`data-uid="${it.uid}" data-card-id="${it.cardId}" data-serial="7"`));
  assert.match(h, new RegExp(`data-badge="rarity"[^>]*>${it.rarityLabel}<`));
  assert.match(h, new RegExp(it.serialText!.replace("/", "\\/")));
  assert.match(h, /data-prestige="TOP_10"/);
});

test("REVELADO · nueva / nueva variante / duplicada ×N con su texto", () => {
  const multi = (() => { const by = new Map<string, CardDef[]>(); for (const c of CARDS) by.set(c.playerId, [...(by.get(c.playerId) ?? []), c]); return [...by.values()].find((v) => v.length >= 2 && v[0].playerId !== c1.playerId)!; })();
  const p = buildRevealPlan([op(c1), op(multi[1]), op(c1)], [own(multi[0])], CAT);
  assert.match(revealHtml(p.items[0], true), /Nueva en tu colección/);
  assert.match(revealHtml(p.items[1], true), /Nueva variante/);
  assert.match(revealHtml(p.items[2], true), /Duplicada · ×2/);
});

test("REVELADO · serial #1: halo propio y «Serial #1», con la aclaración de que no da nada", () => {
  const it = buildRevealPlan([op(SERIALIZED, 1)], baseline, CAT).items[0];
  const h = revealHtml(it, true);
  assert.match(h, /data-moment="serial-one"/);
  assert.match(h, />Serial #1</);
  assert.match(h, /El serial es prestigio: no cambia stats ni da recompensas\./);
});

test("REVELADO · boca abajo no se lee la cara ni las insignias; el anuncio dice «Revelando»", () => {
  const it = buildRevealPlan([op(of("common"))], baseline, CAT).items[0];
  const h = revealHtml(it, false);
  assert.match(h, /data-face="front"|aria-hidden="true"[^>]*data-face="front"/);
  assert.match(h, /aria-hidden="true" data-face="front"/);
  assert.ok(!/data-testid="reveal-badges"/.test(h));
  assert.match(h, /Carta 1 de 5\. Revelando\./);
});

test("REVELADO · anuncio completo al girar", () => {
  const it = buildRevealPlan([op(of("rare"))], baseline, CAT).items[0];
  assert.match(revealHtml(it, true), new RegExp(`Carta 1 de 1\\. ${getPlayer(it.card.playerId)!.nick}\\.`));
});

test("REVELADO · stats de combate del catálogo, no inventadas", () => {
  const it = buildRevealPlan([op(of("epic"))], baseline, CAT).items[0];
  const h = revealHtml(it, true);
  assert.match(h, new RegExp(`SH ${it.card.combat!.stronghold} · GS ${it.card.combat!.gamesense} · EF ${it.card.combat!.entryfrag}`));
});

/* ───────────── render · escenario y estados ───────────── */

const STD = getPack("estandar")!;

test("ESCENARIO · antes de abrir: nombre y número REALES de cartas del sobre y la acción", () => {
  const h = html(<PackStage pack={STD} stage="ready" count={STD.cardCount} slots={[]} tease={null} reduced />);
  assert.match(h, new RegExp(`>${STD.name}<`));
  assert.match(h, new RegExp(`>${STD.cardCount} cartas<`));
  assert.match(h, /Abrir sobre/);
});

test("ESCENARIO · esperando al servidor: sin acción de abrir y sin colores de rareza", () => {
  const h = html(<PackStage pack={STD} stage="requesting" count={STD.cardCount} slots={[]} tease={{ color: "#ffd35c", level: "high", rays: true }} reduced={false} />);
  assert.match(h, /data-testid="pack-requesting"/);
  assert.ok(!/Abrir sobre/.test(h));
  assert.ok(!/#ffd35c/i.test(h), "la señal de rareza no existe hasta tener resultado");
});

test("ESTADOS · error con reintento; sin sobre explica la otra pestaña; recuperando no ofrece acciones", () => {
  const err = html(<PackStatus kind="error" title="No se pudo abrir" message="m" packsLeft={0} onNavigate={() => {}} onRetry={() => {}} layout="inline" />);
  assert.match(err, /Reintentar/);
  const rec = html(<PackStatus kind="recovering" title="Recuperando tu sobre" message="m" packsLeft={2} onNavigate={() => {}} layout="inline" />);
  assert.ok(!/<button/.test(rec));
  assert.match(rec, /role="status"/);
  assert.match(STATUS, /Ver mi colección/);
});

test("CICLO DE VIDA · la ceremonia no abre un DRAFT por la ruta pública y el catálogo real lo tiene", () => {
  assert.ok(CEREMONY.includes("!isPubliclyOpenable(pack) && results.length === 0"));
  assert.ok(PACKS.some((p) => p.lifecycle === "DRAFT"));
});
