/**
 * F72.6 → F72.8 · LA PISTA ES EL ASSET ORIGINAL SOBRE EL DORSO — arquitectura protegida sobre el marcado real.
 *
 * F72.6 corrigió la sombra del dorso VECINO que caía sobre la pista. F72.8 va a la raíz: la pista es un `<img>` del
 * fichero original, sin NINGÚN tratamiento, dentro de una capa limpia; y en toda su cadena de antepasados de la mano
 * (dorso, envoltorio, abanico) no hay filtro, sombra exterior, opacidad, blend ni giro —nada que la rasterice dentro
 * de una superficie filtrada o la re-muestree—. El halo del dorso existe, pero es un elemento propio DETRÁS del abanico.
 *
 *   A · la imagen: `<img>` local, `filter:none`, `mix-blend-mode:normal`, `opacity:1`, sin clases de sombra, opacidad,
 *       filtro, redondeo ni transform, `object-contain`;
 *   B · la capa: placa neutra DEBAJO y la imagen como ÚLTIMA capa del dorso (nada se pinta después);
 *   C · antepasados hasta la raíz del abanico: ni filtro, ni sombra exterior, ni opacidad, ni blend, ni giro, ni
 *       desplazamientos fraccionarios; en el tablero entero, ningún antepasado la tiñe;
 *   D · vecinos: fuera del recorte de cada dorso solo el halo pinta, y va antes que las cartas y detrás (`-z-10`);
 *   E · el dorso sigue siendo NEXUS: borde rojo, fondo rojo, emblema, neón interior y halo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchBoard } from "./MatchBoard";
import { RivalHand, RIVAL_BACK_HALO, RIVAL_HAND_HALO_SHADOW } from "./arena/HandFan";
import { fase45Fixtures } from "@/app/design-system/fase45/fixtures";
import type { DuelMatchView, RivalCardHint } from "@/lib/duel/types";

/* ── Un árbol mínimo sobre el marcado estático de React (bien formado, sin scripts). ── */
interface Node { tag: string; attrs: Record<string, string>; children: Node[]; parent: Node | null; order: number }
const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "col", "wbr", "embed", "track"]);
function parse(html: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [], parent: null, order: -1 };
  let cur = root, order = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g)) {
    const [, close, tag, rawAttrs, self] = m;
    if (close) { if (cur.parent) cur = cur.parent; continue; }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) attrs[a[1]] = (a[2] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const n: Node = { tag, attrs, children: [], parent: cur, order: order++ };
    cur.children.push(n);
    if (!self && !VOID.has(tag)) cur = n;
  }
  return root;
}
const all = (n: Node): Node[] => [n, ...n.children.flatMap(all)];
const ancestors = (n: Node): Node[] => (n.parent ? [n.parent, ...ancestors(n.parent)] : []);
const classes = (n: Node) => (n.attrs.class ?? "").split(/\s+/).filter((c) => c && !c.includes(":")).map((c) => c.replace(/^!/, ""));
const style = (n: Node) => n.attrs.style ?? "";
const decl = (n: Node, prop: string) => style(n).match(new RegExp(`(?:^|;)\\s*${prop}:([^;]*)`))?.[1]?.trim() ?? null;

/** Todo lo que altera o re-muestrea los píxeles de un elemento y de sus hijos. */
function treatments(n: Node, { allowInsetShadow = false } = {}): string[] {
  const out: string[] = [];
  const f = decl(n, "filter");
  if (f && f !== "none") out.push(`filter:${f}`);
  const bs = decl(n, "box-shadow");
  if (bs && !(allowInsetShadow && bs.split(/,(?![^(]*\))/).every((x) => /\binset\b/.test(x)))) out.push(`box-shadow:${bs}`);
  const bl = decl(n, "mix-blend-mode");
  if (bl && bl !== "normal") out.push(`mix-blend-mode:${bl}`);
  if (decl(n, "backdrop-filter")) out.push("backdrop-filter");
  const op = decl(n, "opacity");
  if (op !== null && Number(op) < 1) out.push(`opacity:${op}`);
  const tf = decl(n, "transform");
  if (tf && (/rotate|scale|skew|matrix/.test(tf) || /translate[XY]?\([^)]*\d\.\d/.test(tf))) out.push(`transform:${tf}`);
  for (const c of classes(n)) {
    if (/^(drop-shadow|shadow|mix-blend-|opacity-|blur|backdrop-|brightness-|saturate-|contrast-|hue-rotate-|grayscale|sepia|invert|rotate-|-?translate-|scale-)/.test(c)) out.push(c);
  }
  return out;
}

const isClip = (n: Node) => classes(n).includes("overflow-hidden") && classes(n).some((c) => c.startsWith("aspect-"));
const arts = (root: Node) => all(root).filter((n) => "data-hint-art" in n.attrs);

/* Una mano rival con banderas y logos reales de los assets locales (F72.3). */
const HINTS: RivalCardHint[] = [
  { type: "COUNTRY", value: "JP" }, { type: "TEAM", value: "fnatic" }, { type: "COUNTRY", value: "TR" },
  { type: "COUNTRY", value: "CN" }, { type: "TEAM", value: "c9" }, { type: "COUNTRY", value: "KR" },
  { type: "COUNTRY", value: "US" }, { type: "COUNTRY", value: "ID" }, { type: "TEAM", value: "g2" },
];
// (España no tiene bandera local: ninguna carta del catálogo es de nacionalidad ES; F72.3 importó solo las usadas.)

function checkHand(hand: Node, label: string) {
  const found = arts(hand);
  assert.ok(found.length >= 1, `${label}: hay pistas que comprobar`);
  const clips = all(hand).filter(isClip);
  const halo = all(hand).filter((n) => "data-hand-halo" in n.attrs);
  assert.equal(halo.length, 1, `${label}: el halo del dorso existe, una vez`);

  // D · fuera de los recortes, solo el halo pinta; y va antes que las cartas, detrás.
  for (const n of all(hand)) {
    if (n === hand || halo.includes(n) || clips.some((c) => c === n || ancestors(n).includes(c))) continue;
    assert.deepEqual(treatments(n), [], `${label}: <${n.tag} class="${n.attrs.class ?? ""}"> trata la imagen o pinta sobre los vecinos`);
  }
  assert.ok(classes(halo[0]).includes("-z-10") && halo[0].order < Math.min(...clips.map((c) => c.order)), `${label}: el halo va detrás de las cartas`);
  assert.ok(decl(halo[0], "box-shadow")?.includes("255,46,99"), `${label}: el halo es rosa NEXUS`);
  assert.deepEqual(treatments(hand), [], `${label}: la raíz del abanico no lleva filtro (F72.8)`);

  for (const a of found) {
    // A · la imagen, tal cual.
    assert.equal(a.tag, "img", `${label}: la pista es un <img>`);
    assert.match(a.attrs.src ?? "", /^\/(flags\/[a-z]{2}\.svg|hints\/teams\/[a-z0-9-]+\.png)$/, `${label}: asset LOCAL`);
    assert.equal(a.attrs.alt, "", `${label}: decorativa (el nombre va en el aria-label del dorso)`);
    assert.equal(decl(a, "filter"), "none");
    assert.equal(decl(a, "mix-blend-mode"), "normal");
    assert.equal(decl(a, "opacity"), "1");
    assert.ok(classes(a).includes("object-contain"), `${label}: object-fit: contain`);
    assert.deepEqual(treatments(a), [], `${label}: la imagen no lleva ningún tratamiento`);
    assert.ok(!classes(a).some((c) => c.startsWith("rounded")), `${label}: sin recortar las esquinas del fichero`);
    // B · la capa limpia: placa debajo, imagen la última; y la capa es lo último del dorso.
    const layer = a.parent!;
    assert.ok("data-hint-layer" in layer.attrs, `${label}: la imagen vive en su capa`);
    assert.equal(layer.children[layer.children.length - 1], a, `${label}: la imagen es la ÚLTIMA capa`);
    const plate = layer.children.find((c) => "data-hint-plate" in c.attrs);
    assert.ok(plate && plate.order < a.order, `${label}: placa neutra DEBAJO de la imagen`);
    assert.ok(classes(plate!).some((c) => /^bg-\[#0b0c12\]$/.test(c)), `${label}: la placa es neutra (sin rojo)`);
    const clip = ancestors(a).find(isClip)!;
    assert.ok(clip, `${label}: recortada por su dorso`);
    const after = all(clip).filter((n) => n.order > a.order && !ancestors(n).includes(a));
    assert.deepEqual(after.map((n) => n.attrs.class ?? n.tag), [], `${label}: nada se pinta después de la pista`);
    // C · la cadena hasta la raíz del abanico, limpia (el dorso puede llevar neón INTERIOR: se pinta bajo sus hijos).
    for (const n of ancestors(a)) {
      if (n === hand.parent) break;
      assert.deepEqual(treatments(n, { allowInsetShadow: n === clip }), [], `${label}: <${n.tag} class="${n.attrs.class ?? ""}"> trata la imagen`);
    }
  }
}

test("F72.8 C1 · RivalHand: cada pista es el <img> original en una capa limpia; nada la filtra, gira, tiñe ni tapa", () => {
  const h = renderToStaticMarkup(<RivalHand count={HINTS.length} hints={HINTS} />);
  const hand = all(parse(h)).find((n) => n.attrs["data-testid"] === "rival-hand")!;
  assert.deepEqual(arts(hand).map((a) => a.attrs["data-hint-art"]), ["flag", "logo", "flag", "flag", "logo", "flag", "flag", "flag", "logo"], "COUNTRY y TEAM siguen siendo imagen");
  assert.deepEqual(arts(hand).map((a) => a.attrs.src), [
    "/flags/jp.svg", "/hints/teams/fnatic.png", "/flags/tr.svg", "/flags/cn.svg", "/hints/teams/c9.png",
    "/flags/kr.svg", "/flags/us.svg", "/flags/id.svg", "/hints/teams/g2.png",
  ]);
  checkHand(hand, "mano");
  // E · el dorso NEXUS no se ha neutralizado.
  assert.match(h, /border-color:rgba\(255,46,99,0\.75\)/);
  assert.match(h, /#2a0714/);
  assert.match(h, /icon-mono\.svg/);
  assert.match(h, /box-shadow:inset 0 0 12px rgba\(255,46,99,0\.45\)/, "neón interior del dorso");
  assert.ok(RIVAL_HAND_HALO_SHADOW.includes("255,46,99"));
  // Sin texto visible.
  assert.equal(h.replace(/<[^>]+>/g, "").trim(), "");
});

test("F72.8 C2 · sin pistas cada dorso conserva su propio halo y su giro (el aspecto de siempre)", () => {
  const root = parse(renderToStaticMarkup(<RivalHand count={6} />));
  const hand = all(root).find((n) => n.attrs["data-testid"] === "rival-hand")!;
  const wrappers = hand.children;
  assert.equal(wrappers.length, 6);
  for (const w of wrappers) { assert.ok(style(w).includes(`filter:${RIVAL_BACK_HALO}`)); assert.match(style(w), /rotate\(/); }
  assert.ok(!all(hand).some((n) => "data-hand-halo" in n.attrs));
});

test("F72.8 C3 · en el tablero real, ningún antepasado de la pista la trata, y la mano cumple el contrato", () => {
  const fx = fase45Fixtures();
  const v = [fx.attack, fx.defense, fx.mid].find((x: DuelMatchView) => x.rivalHints.length > 0 && x.rivalHints.length === x.rivalRemaining);
  assert.ok(v, "las fixtures traen pistas");
  const root = parse(renderToStaticMarkup(<MatchBoard view={v!} onPlay={() => {}} busy={false} error={null} onDismissError={() => {}} hudInTopBar />));
  const hand = all(root).find((n) => n.attrs["data-testid"] === "rival-hand")!;
  assert.ok(hand, "el tablero pinta la mano del rival");
  checkHand(hand, "tablero");
  // Por encima de la mano, en todo el tablero: nada que tiña (inline o clase) hasta la raíz.
  for (const a of arts(hand)) {
    for (const n of ancestors(hand)) {
      const t = treatments(n).filter((x) => !/^(shadow|drop-shadow|-?translate-|scale-|rotate-)/.test(x) && !/^box-shadow|^transform/.test(x));
      assert.deepEqual(t, [], `tablero: <${n.tag} class="${n.attrs.class ?? ""}"> tiñe la pista`);
    }
    void a;
  }
});
