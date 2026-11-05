/**
 * PACK WALKOUT 0.4 · identidad de la carta y arena de nueva generación (puro + contratos de código).
 *
 *   I01–I07  identidad: la carta (y su jugador) deciden nacionalidad, bandera, código, equipo, rol, OVR y arte;
 *            desconocida → región; país sin bandera → su código; cambios seguidos de carta sin restos; DEV rotulado.
 *   V01–V05  escena: la arena se viste con el tema derivado de la identidad, la persona realista por defecto, el
 *            contraluz que no toca el suelo, bloom con umbral y la mezcla del mixer que no deja restos de IK.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getCard, getPlayer } from "@/data/catalog";
import { NON_NATIONALITY_CODES, isNationalityFlag } from "@/data/flags";
import { applyDevOverrides, walkoutIdentityFromCard, type WalkoutCardIdentity } from "@/domain/walkout/input";
import { ISO3, countryArenaTheme } from "@/domain/walkout/countryTheme";
import { ISO3166_ALPHA3 } from "@/domain/walkout/iso3166";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const EDITION = { light: "#7fe9ff", accent: "#ff4fd8" };
const identity = (id: string): WalkoutCardIdentity => { const c = getCard(id); assert.ok(c, id); return walkoutIdentityFromCard(c, getPlayer(c.playerId)); };
const theme = (i: WalkoutCardIdentity) => countryArenaTheme({ flag: i.flag, region: i.region, nationality: i.nationality }, null, EDITION);

/* ───────── identidad ───────── */

test("I01 · Japón (Absol, ZETA), EE. UU. (trent, G2) y Turquía (Lar0k, BBL): país, bandera, código, equipo y OVR salen de la carta", () => {
  const cases = [
    { id: "absol__future-star", iso: "JP", code: "JPN", tag: "ZETA" },
    { id: "trent__masters-l", iso: "US", code: "USA", tag: "G2" },
    { id: "lar0k__future-star", iso: "TR", code: "TUR", tag: "BBL" },
  ];
  for (const c of cases) {
    const i = identity(c.id), card = getCard(c.id)!, player = getPlayer(card.playerId)!;
    assert.equal(player.country, c.iso, `${c.id}: el catálogo dice ${player.country}`);
    assert.equal(i.nationality.status, "country"); assert.equal(i.nationality.iso, c.iso); assert.equal(i.nationality.code, c.code);
    assert.equal(i.flag?.iso, c.iso); assert.match(i.flag!.src, new RegExp(`${c.iso.toLowerCase()}\\.svg$`));
    assert.equal(i.team.tag.toUpperCase(), c.tag);
    assert.equal(i.ovr, card.ovr); assert.equal(i.playerId, card.playerId); assert.equal(i.cardId, c.id);
    assert.equal(i.artwork, card.image ?? null);
    assert.deepEqual(i.overrides, []);
    const t = theme(i);
    assert.equal(t.kind, "country"); assert.equal(t.code, c.code); assert.equal(t.flagSrc, i.flag!.src);
  }
});

test("I02 · nacionalidad desconocida (VLR «UN»: suygetsu) → tema REGIONAL rotulado, nunca un país ni una bandera", () => {
  const i = identity("suygetsu__base");
  assert.equal(getPlayer(getCard("suygetsu__base")!.playerId)!.country, "UN");
  assert.equal(i.nationality.status, "unknown"); assert.equal(i.flag, null); assert.equal(i.nationality.code, null);
  const t = theme(i);
  assert.equal(t.kind, "region"); assert.equal(t.code, "EMEA"); assert.equal(t.flagSrc, null);
});

test("I03 · país real sin bandera local → su código y su nombre, sin bandera ajena; sin dato → región o neutral", () => {
  const base = getCard("absol__future-star")!;
  // ISO real del estándar que el juego no trae como bandera local (si algún día la trae, el caso pasa a «country»)
  const iso = Object.keys(ISO3166_ALPHA3).find((k) => !isNationalityFlag(k) && !NON_NATIONALITY_CODES.has(k))!;
  assert.ok(iso, "hay códigos ISO sin bandera local");
  const i = walkoutIdentityFromCard(base, { nick: "x", country: iso, region: "EMEA", role: "Duelist", team: "ZETA" } as never);
  assert.equal(i.nationality.status, "noflag"); assert.equal(i.flag, null); assert.equal(i.nationality.code, ISO3166_ALPHA3[iso]);
  const t = theme(i);
  assert.equal(t.kind, "country"); assert.equal(t.code, ISO3166_ALPHA3[iso]); assert.equal(t.flagSrc, null);
  const none = walkoutIdentityFromCard(base, { nick: "x", country: "", region: null, role: "Duelist", team: "ZETA" } as never);
  assert.equal(none.nationality.status, "missing"); assert.equal(theme(none).kind, "neutral");
});

test("I04 · auditoría del catálogo entero: para CADA carta la arena luce exactamente la nacionalidad canónica de su jugador", () => {
  const seen = { country: 0, noflag: 0, unknown: 0, missing: 0 };
  for (const card of CARDS) {
    const p = getPlayer(card.playerId);
    const i = walkoutIdentityFromCard(card, p);
    seen[i.nationality.status]++;
    const iso = (p?.country ?? "").trim().toUpperCase();
    const t = theme(i);
    if (i.nationality.status === "country") {
      assert.equal(i.nationality.iso, iso, card.id); assert.equal(i.flag?.iso, iso, card.id);
      assert.equal(t.code, ISO3[iso], card.id); assert.equal(t.kind, "country", card.id);
    } else {
      assert.equal(i.flag, null, card.id);
      assert.equal(t.flagSrc, null, card.id);      // nunca una bandera sin país canónico
      if (i.nationality.status === "noflag") assert.equal(t.code, ISO3[iso], card.id);
      else assert.ok(t.kind === "region" || t.kind === "neutral", card.id);
    }
  }
  assert.ok(seen.country > 200, `cartas con país ${seen.country}`);
});

test("I05 · cambios seguidos de carta: cada identidad se deriva sola (TR → JP → UN → US → TR) sin heredar nada de la anterior", () => {
  const seq = ["lar0k__future-star", "absol__future-star", "suygetsu__base", "trent__masters-l", "lar0k__future-star"];
  const got = seq.map((id) => { const i = identity(id); const t = theme(i); return `${i.cardId}|${i.nationality.code ?? "-"}|${t.code}|${i.team.tag}`; });
  assert.deepEqual(got, [
    "lar0k__future-star|TUR|TUR|BBL", "absol__future-star|JPN|JPN|ZETA", "suygetsu__base|-|EMEA|KC", "trent__masters-l|USA|USA|G2", "lar0k__future-star|TUR|TUR|BBL",
  ]);
  // la escena re-crea la arena cuando cambia el país (dependencias del efecto) y la página re-monta por carta
  const stage = read("src/components/walkout/WalkoutStage.tsx");
  assert.match(stage, /\[kind, preset, particles, drama, humanDur, humanMode, celebrateAt, country, team, artwork\]/);
  assert.match(stage, /canvas\.dataset\.arenaCode = st\.theme\.code/);
  const dir = read("src/components/walkout/WalkoutDirector.tsx");
  assert.match(dir, /data-identity-card=\{input\.cardId\}/); assert.match(dir, /data-identity-code=\{input\.nationality\.code \?\? ""\}/);
});

test("I06 · DEV: forzar país/equipo/rol/OVR queda anotado y la escena lo rotula «DEV · forzado»; sin ajustes, la carta manda", () => {
  const i = identity("lar0k__future-star");
  assert.equal(applyDevOverrides(i, {}), i);
  const f = applyDevOverrides(i, { flag: { iso: "ES", src: "/flags/es.svg", name: "España" }, ovr: 80 });
  assert.equal(f.nationality.code, "ESP"); assert.equal(f.ovr, 80);
  assert.deepEqual(f.overrides.map((o) => o.field), ["flag", "ovr"]);
  assert.equal(i.nationality.code, "TUR", "la identidad real no se toca");
  const none = applyDevOverrides(i, { flag: "none" });
  assert.equal(none.flag, null); assert.equal(none.nationality.status, "missing");
  const dir = read("src/components/walkout/WalkoutDirector.tsx");
  assert.match(dir, /input\.overrides\.length > 0 && \(/); assert.match(dir, /data-testid="walkout-dev-forced"/); assert.match(dir, /DEV · forzado/);
});

test("I07 · ISO 3166-1 completo: 249 códigos alfa-2 → alfa-3 únicos (cualquier nacionalidad futura tiene su código)", () => {
  const e = Object.entries(ISO3166_ALPHA3);
  assert.equal(e.length, 249);
  assert.equal(new Set(e.map(([, v]) => v)).size, 249);
  for (const [k, v] of e) { assert.match(k, /^[A-Z]{2}$/); assert.match(v, /^[A-Z]{3}$/); }
  for (const [k, v] of [["ES", "ESP"], ["JP", "JPN"], ["US", "USA"], ["TR", "TUR"], ["KR", "KOR"], ["BR", "BRA"]]) assert.equal(ISO3[k], v);
});

/* ───────── escena 0.4 (contratos de código: three solo vive en el navegador) ───────── */

test("V01 · arena 0.4: túnel con cercha, pancartas LED (bandera, retrato del arte de la carta, chevrones), público instanciado, portal con escalinata y pantalla gigante", () => {
  const a = read("src/components/walkout/arena3d.ts");
  for (const s of ["paintFlagBanner", "paintPortraitBanner", "paintChevronBanner", "crowdAtlas", "InstancedMesh", "PZ = -14.5", "PlaneGeometry(13, 6.5)", "HUMO de CO2"]) assert.ok(a.includes(s), s);
  // el portal no es un rectángulo blanco plano: textura con listones por debajo del umbral del resplandor
  assert.match(a, /portalTex/); assert.match(a, /map: portalTex/);
  // el suelo brillante no es un espejo de focos (con 0,16 devolvía el contraluz como una mancha blanca)
  const r = Number(/color: 0x040406, roughness: ([\d.]+)/.exec(a)?.[1]); assert.ok(r >= 0.3, `rugosidad ${r}`);
});

test("V02 · luz 0.4: el contraluz blanco sigue a la persona por detrás con alcance corto (su cono nunca llega al suelo de delante) y el resplandor tiene umbral", () => {
  const s = read("src/components/walkout/stage3d.ts");
  const m = /new THREE\.SpotLight\(0xffffff, 0, ([\d.]+), [\d.]+, [\d.]+, [\d.]+\); this\.portalLight/.exec(s);
  assert.ok(m && Number(m[1]) <= 4, `alcance ${m?.[1]}`);
  assert.match(s, /this\.portalLight\.position\.set\(hx, 1\.7, hz - 2\.6\)/);
  assert.match(s, /UnrealBloomPass\(/); assert.match(s, /this\.bloom\.dispose\(\); this\.composer\.dispose\(\);/);
});

test("V03 · persona: Rocketbox por defecto con perfil propio de esqueleto; Quaternius sigue disponible como respaldo", () => {
  const h = read("src/components/walkout/human3d.ts");
  assert.match(h, /HUMAN_ASSET_URL = HUMAN_ASSETS\.rocketbox/);
  assert.match(h, /ROCKETBOX_PROFILE/); assert.match(h, /QUATERNIUS_PROFILE/);
});

test("V04 · mixer: la pose del clip se reescribe en cada fotograma (three solo escribe lo que cambió) y la bisagra del dedo es una por dedo", () => {
  const h = read("src/components/walkout/human3d.ts");
  assert.match(h, /mixer\.update\(0\);\n\s+forceApply\(mixer\);/);
  assert.match(h, /hinge \?\?= dir\.clone\(\)\.cross\(palm\)/);
});

test("V05 · la ruta interna sigue cerrada en producción y three solo lo importan los tres módulos de escena", () => {
  const page = read("src/app/design-system/pack-walkout/page.tsx");
  assert.match(page, /qaHarnessBlocked|notFound/);
  for (const f of ["WalkoutDirector.tsx", "WalkoutStage.tsx", "Reveals.tsx"]) assert.doesNotMatch(read("src/components/walkout", f), /from "three"/, f);
});

test("V06 · un lienzo nuevo por escena: cambiar solo país/equipo/arte recrea la escena 3D sin caer al 2D (contexto perdido)", () => {
  const s = read("src/components/walkout/WalkoutStage.tsx");
  assert.match(s, /<canvas key=\{sceneKey\}/);
  assert.match(s, /const sceneKey = useMemo\(\(\) => JSON\.stringify\(\[kind, preset, particles, drama, humanDur, humanMode, celebrateAt, country, team, artwork\]\)/);
  assert.match(read("src/components/walkout/stage3d.ts"), /this\.renderer\.forceContextLoss\(\);/);
});

test("V07 · pasos audibles de la persona realista: zancada y ciclo = los del asset, ritmo de crucero regular y los tres apoyos de la frenada antes de la llegada", async () => {
  const { ROCKETBOX_STEPS, footfallsWithStop, stopPlan, walkSpecFromExtras } = await import("@/domain/walkout/walk");
  const spec = walkSpecFromExtras(JSON.parse(read("public/walkout/human/rocketbox-player.gltf")).asset.extras)!;
  assert.ok(Math.abs(spec.stride - ROCKETBOX_STEPS.stride) < 1e-3 && Math.abs(spec.cycle - ROCKETBOX_STEPS.cycle) < 1e-3 && spec.stop!.duration === ROCKETBOX_STEPS.stopDuration);
  const dur = 6, steps = footfallsWithStop(dur);
  const P = stopPlan(dur, spec);
  const cruise = steps.filter((t) => t < P.tStop), gaps = cruise.slice(2).map((t, i) => t - cruise[i + 1]);
  for (const g of gaps) assert.ok(g > 0.45 && g < 0.65, `paso cada ${g}`);
  assert.equal(steps.filter((t) => t >= P.tStop).length, 3);
  assert.ok(steps[steps.length - 1] < dur);
  assert.match(read("src/components/walkout/WalkoutDirector.tsx"), /footfallsWithStop\(dur\)/);
});
