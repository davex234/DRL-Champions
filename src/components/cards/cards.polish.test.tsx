/**
 * LA CARTA COMO OBJETO — tests de la fase de polish.
 *
 * Cubren los cuatro problemas que la auditoría marcó como objetivos y, sobre todo, **impiden
 * que vuelvan**. El de `special` es el importante: no se arregló añadiendo un nombre a una
 * lista, se arregló cambiando el mecanismo, y estos tests comprueban la propiedad que hace
 * imposible el fallo —que la escalera de material sea monótona y total sobre el `rank`— en vez
 * de comprobar dos casos concretos.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { CardRenderer } from "./CardRenderer";
import { CardEffects, materialForRank, resolveDensity, MATERIAL_ORDER, type CardMaterial } from "./CardEffects";
import { VARIANTS, getVariant } from "@/domain/cards/variants";
import { allPlayers } from "@/data/catalog";
import { computeOvr } from "@/domain/cards/ovr";
import type { VariantId } from "@/domain/cards/types";

const player = allPlayers()[0]!;
const nivel = (m: CardMaterial): number => MATERIAL_ORDER.indexOf(m);
const materialDe = (id: VariantId): CardMaterial => materialForRank(getVariant(id).rank);

const pinta = (id: VariantId, extra: Partial<Parameters<typeof CardRenderer>[0]> = {}): string =>
  renderToStaticMarkup(
    <CardRenderer
      player={player}
      variant={getVariant(id)}
      stats={player.stats}
      ovr={computeOvr(player.stats)}
      size="sm"
      interactive={false}
      {...extra}
    />,
  );

/* ─────────────────────────── A1 · SPECIAL ─────────────────────────── */

test("A1 · Prime y Clutch King reciben material PREMIUM", () => {
  // Eran las dos variantes de animación `special`, que no estaba en ninguna lista de efectos.
  assert.equal(materialDe("prime" as VariantId), "premium");
  assert.equal(materialDe("clutch" as VariantId), "premium");
});

test("A1 · ninguna variante rara recibe menos material que una Plata", () => {
  const plata = nivel(materialDe("silver" as VariantId));
  const peores: string[] = [];
  for (const id of Object.keys(VARIANTS) as VariantId[]) {
    const v = getVariant(id);
    if (v.rank <= getVariant("silver" as VariantId).rank) continue;
    if (nivel(materialForRank(v.rank)) < plata) peores.push(`${id} (rank ${v.rank})`);
  }
  assert.deepEqual(peores, [], "una carta de rank alto no puede tener menos tratamiento que una Plata");
});

test("A1 · la escalera de material es MONÓTONA sobre el rank", () => {
  // Es la propiedad que hace estructuralmente imposible el fallo original.
  for (let r = 1; r < 40; r++) {
    assert.ok(
      nivel(materialForRank(r + 1)) >= nivel(materialForRank(r)),
      `rank ${r + 1} recibe menos material que ${r}`,
    );
  }
});

test("A1 · las 44 variantes (37 + 7 ediciones diseñadas) caen en un escalón conocido", () => {
  const ids = Object.keys(VARIANTS) as VariantId[];
  assert.equal(ids.length, 44, "37 del modelo anterior + 7 ediciones diseñadas (catálogo 2026-09-21)");
  for (const id of ids) {
    assert.ok(MATERIAL_ORDER.includes(materialDe(id)), `${id} sin material`);
  }
});

/* ─────────────────────────── A2 · LEGIBILIDAD ─────────────────────────── */

test("A2 · toda carta lleva la placa de datos, sea cual sea la paleta", () => {
  // La placa es lo que garantiza el contraste del texto blanco sobre paletas casi blancas.
  for (const id of ["bronze", "icon-series", "champion-edition", "mythic", "clutch"] as VariantId[]) {
    assert.match(pinta(id), /rgba\(6,8,14,0\.93\)/, `${id} sin placa de datos`);
  }
});

test("A2 · el nick y la variante se pintan DENTRO de la placa", () => {
  // Ojo: las mayúsculas las pone CSS (`uppercase`), así que en el marcado van tal cual.
  const html = pinta("icon-series" as VariantId);
  const placa = html.indexOf("rgba(6,8,14,0.93)");
  assert.ok(placa > 0, "la placa existe");
  assert.ok(html.indexOf(player.nick) > placa, "el nick va después de abrirse la placa");
  assert.ok(html.indexOf("Icon Series") > placa, "la etiqueta de variante también");
});

test("A2 · el retrato no aporta texto alternativo sobre el arte", () => {
  /*
   * El `alt` del retrato llevaba el nick, y un `<img>` roto pinta su texto alternativo: el
   * nick aparecía sobre el arte, encabalgado con el OVR, hasta que saltaba `onError`.
   * La bandera y el escudo SÍ deben conservar su `alt` — lo que no puede haber es el nick.
   */
  const html = pinta("gold" as VariantId);
  const alts = [...html.matchAll(/<img[^>]*alt="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(!alts.includes(player.nick), `el retrato no debe anunciar el nick (alts: ${alts.join(" · ")})`);
});

/* ─────────────────────────── A4 · UN SOLO TILT ─────────────────────────── */

test("A4 · sin `interactive` la carta no monta su propio brillo de puntero", () => {
  const conMovimiento = pinta("gold" as VariantId, { interactive: true });
  const sinMovimiento = pinta("gold" as VariantId, { interactive: false });
  assert.match(conMovimiento, /radial-gradient\(circle at/, "con interactive sí hay brillo propio");
  assert.ok(!/radial-gradient\(circle at/.test(sinMovimiento), "sin interactive no debe haber brillo propio");
});

test("A4 · el vestíbulo pasa interactive={false} a su abanico", () => {
  /*
   * Comprobación de FUENTE a propósito: el fallo era exactamente que a esta llamada le
   * faltaba el flag, y no hay forma de verlo renderizando el componente por separado.
   *
   * FASE 4: el abanico dejó de vivir en `app/page.tsx` y pasó a `LobbyShowcase`, que es su
   * sitio. La invariante no cambia —el movimiento lo pone `Card3D`, y solo él—, solo el
   * fichero donde se comprueba.
   */
  const src = readFileSync(new URL("../lobby/LobbyShowcase.tsx", import.meta.url), "utf8");
  const fan = /<PlayerCard card=\{c\.def\}([^/]*)\/>/.exec(src);
  assert.ok(fan, "no se encontró el abanico del vestíbulo");
  assert.match(fan[1], /interactive=\{false\}/, "el abanico debe delegar el movimiento en Card3D");
});

/* ─────────────────────────── B4 · COSTE DE LOS EFECTOS ─────────────────────────── */

const efectos = (id: VariantId, density: "detail" | "grid" | "list"): string =>
  renderToStaticMarkup(<CardEffects variant={getVariant(id)} density={density} />);

test("B4 · en rejilla NINGÚN material usa mix-blend-mode", () => {
  // Era el coste medido en /mercado: 39 capas con mezcla y bucle infinito a la vez.
  for (const id of Object.keys(VARIANTS) as VariantId[]) {
    assert.ok(!/mix-blend/i.test(efectos(id, "grid")), `${id} mezcla en rejilla`);
  }
});

test("B4 · en detalle las rarezas altas SÍ recuperan la mezcla", () => {
  // La optimización es contextual: la carta protagonista no pierde su tratamiento.
  assert.match(efectos("icon-series" as VariantId, "detail"), /mix-blend/i);
});

test("B4 · en lista solo queda el tinte: una capa", () => {
  const html = efectos("mythic" as VariantId, "list");
  assert.equal((html.match(/<div/g) ?? []).length, 1);
});

test("B4 · en rejilla se conserva el MATERIAL y solo se cae el sabor", () => {
  /*
   * La garantía de que optimizar no degrada la rareza. En rejilla se dejan de montar los
   * rayos y las partículas —el «sabor», que es lo caro y lo que menos se mira— pero el
   * material sigue entero: una Mythic conserva su holo y su filo, quietos.
   */
  const grid = efectos("mythic" as VariantId, "grid");
  const capas = (h: string): number => (h.match(/<div/g) ?? []).length;
  assert.match(grid, /linear-gradient\(115deg/, "el holo de LEGENDARIA sigue ahí");
  assert.match(grid, /inset 0 0 0 1\.5px/, "y el filo de PREMIUM también");
  assert.ok(
    capas(grid) > capas(efectos("bronze" as VariantId, "grid")),
    "una Mythic en rejilla sigue teniendo más capas que un Bronce en rejilla",
  );
  assert.ok(
    capas(efectos("mythic" as VariantId, "detail")) > capas(grid),
    "y en detalle recupera el sabor que la rejilla no paga",
  );
});

/* ─────────────────────────── REDUCED MOTION ─────────────────────────── */

test("REDUCED · con movimiento reducido, hasta el detalle se dibuja quieto", () => {
  assert.equal(resolveDensity("detail", undefined, true), "grid");
  assert.equal(resolveDensity("detail", true, true), "grid", "ni siquiera `rich` lo fuerza");
  assert.equal(resolveDensity("grid", undefined, true), "grid");
});

test("REDUCED · quieto NO significa sin rareza: el material se conserva", () => {
  /*
   * Es la diferencia entre respetar la preferencia y castigarla. Una Mythic con movimiento
   * reducido sigue llevando holo y filo; lo único que pierde son los bucles.
   */
  const quieta = renderToStaticMarkup(<CardEffects variant={getVariant("mythic" as VariantId)} density="grid" />);
  assert.match(quieta, /linear-gradient\(115deg/, "holo");
  assert.match(quieta, /inset 0 0 0 1\.5px/, "filo");
  assert.ok(!/mix-blend/i.test(quieta), "y sin mezcla ni bucles");
});

test("REDUCED · la lista sigue siendo lista", () => {
  assert.equal(resolveDensity("list", undefined, true), "list");
});

/* ─────────────────────────── B2 · GEOMETRÍA NEXUS ─────────────────────────── */

test("B2 · la carta usa el chaflán de NEXUS, no una esquina redondeada", () => {
  const html = pinta("gold" as VariantId);
  assert.match(html, /nx-clip/, "la carta debe llevar el corte del sistema");
  assert.match(html, /--nx-chamfer/, "y a su propia escala, no la de 18 px del producto");
});

test("B2 · la carta tiene canto: un marco con relleno propio", () => {
  assert.match(pinta("gold" as VariantId), /data-card-frame/);
});

/* ─────────────────────────── REGRESIÓN ─────────────────────────── */

test("REGRESIÓN · ni un dato de variante ha cambiado", () => {
  const esperado: [VariantId, number, number | undefined][] = [
    ["mythic" as VariantId, 16, 25],
    ["icon-series" as VariantId, 14, 100],
    ["champion-edition" as VariantId, 13, 75],
    ["clutch" as VariantId, 12, 120],
    ["top-rating" as VariantId, 12, 120],
    ["prime" as VariantId, 10, 300],
    ["bronze" as VariantId, 1, undefined],
  ];
  for (const [id, rank, limit] of esperado) {
    const v = getVariant(id);
    assert.equal(v.rank, rank, `${id}: rank`);
    assert.equal(v.serialLimit, limit, `${id}: serie`);
  }
});

test("REGRESIÓN · la carta sigue enseñando OVR, nick y estadísticas", () => {
  const html = pinta("emea" as VariantId);
  assert.ok(html.includes(String(computeOvr(player.stats))), "OVR");
  assert.ok(html.includes(player.nick.toUpperCase()) || html.includes(player.nick), "nick");
  assert.match(html, /aspect-\[5\/7\]/, "proporción de carta");
});
