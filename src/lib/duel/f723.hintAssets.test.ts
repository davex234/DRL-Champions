/**
 * F72.3 · ASSETS LOCALES DE LAS PISTAS — banderas (flag-icons, MIT) y los 25 logos de la biblioteca de trabajo.
 *
 * Integridad (registro ≡ carpeta ≡ hashes del README), cobertura de las 331 cartas, identidad canónica del equipo (el
 * impreso manda; alias → mismo logo), los 16 equipos pendientes NO disponibles, cero URL externa, reparto COUNTRY/TEAM
 * y la prueba de fugas con su CONTROL NEGATIVO (el detector tiene que saltar si se le mete un dato oculto).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { CARDS, getPlayer } from "@/data/catalog";
import { canonicalCardTeam, canonicalTeam, TEAM_IDENTITIES } from "@/data/teamIdentities";
import { HINT_TEAM_LOGOS, HINT_TEAM_LOGO_DIR, TEAM_LOGOS_AVAILABLE, hintTeamLogoSrc } from "@/data/teamLogos";
import { FLAGS_DIR, LOCAL_FLAGS, NON_NATIONALITY_CODES, isNationalityFlag } from "@/data/flags";
import { flagSrc } from "@/lib/assets";
import { hintForCard, rivalUnplayedCards, HINT_TYPES, type HintSource } from "@/domain/cardgame/hints";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { hintArt, visualHintValue } from "./hintVisuals";
import { qaRegistry, qaSimulate, qaSnapshot, qaView } from "./qaSimulation";

const ROOT = process.cwd();
const PUBLIC = resolve(ROOT, "public");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const publicFile = (src: string) => resolve(PUBLIC, "." + src);

/** Los 25 logos auditados en F72.2 (identidad canónica), y los 16 que NO existen (docs/product/qa/fase72-2/asset-sourcing.md). */
const EXPECTED_LOGOS = [
  "100t", "bbl", "c9", "dragon-ranger-gaming", "eg", "envy", "eternal-fire", "fnatic", "furia", "fut", "g2", "giantx",
  "karmine-corp", "kru", "leviatan", "loud", "m8", "mibr", "navi", "nrg", "pcific", "sentinels", "team-heretics",
  "team-liquid", "vitality",
];
const PENDING_LOGOS = [
  "all-gamers", "detonation-focusme", "drx", "edward-gaming", "full-sense", "ge", "gen-g", "ns", "paper-rex", "rrq", "t1",
  "team-secret", "tyl", "vl", "xlg", "zeta-division",
];

const cardTeamId = (c: (typeof CARDS)[number]) => canonicalCardTeam(c, getPlayer(c.playerId)).key;
const src = (c: (typeof CARDS)[number]): HintSource => {
  const p = getPlayer(c.playerId)!;
  return { uid: `u:${c.id}`, cardId: c.id, playerId: c.playerId, team: p.team, region: p.region, role: c.role ?? p.role };
};
const countryOf = (pid: string) => getPlayer(pid)?.country ?? "";

test("A1 · logos: registro ≡ carpeta ≡ los 25 auditados; cada fichero existe, es PNG y su hash es el del README (copia sin modificar)", () => {
  const dir = join(PUBLIC, "hints", "teams");
  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""));
  assert.deepEqual([...HINT_TEAM_LOGOS].sort(), [...onDisk].sort());
  assert.deepEqual([...HINT_TEAM_LOGOS].sort(), [...EXPECTED_LOGOS].sort());
  const readme = read("public/hints/teams/README.md");
  for (const id of HINT_TEAM_LOGOS) {
    const f = join(dir, `${id}.png`);
    assert.ok(readFileSync(f).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${id} es PNG`);
    assert.ok(readme.includes(`| ${id} |`) && readme.includes(sha(f)), `${id}: hash del README`);
    assert.ok(TEAM_IDENTITIES.some((t) => t.canonicalId === id), `${id} es una identidad canónica`);
  }
  // Sin duplicados conflictivos: ningún par de logos es el mismo fichero bajo dos identidades.
  const hashes = [...HINT_TEAM_LOGOS].map((id) => sha(join(dir, `${id}.png`)));
  assert.equal(new Set(hashes).size, hashes.length);
  // El registro de monogramas de `TeamLogo` (F64, otra carpeta) no se toca.
  assert.equal(TEAM_LOGOS_AVAILABLE.size, 0);
});

test("A2 · los 16 equipos pendientes NO aparecen como disponibles (ni placeholder): su carta nunca lleva pista TEAM", () => {
  for (const id of PENDING_LOGOS) {
    assert.ok(TEAM_IDENTITIES.some((t) => t.canonicalId === id), id);
    assert.equal(hintTeamLogoSrc(id), null, id);
    assert.equal(hintArt({ type: "TEAM", value: id }), null, id);
    assert.ok(!existsSync(join(PUBLIC, "hints", "teams", `${id}.png`)), id);
  }
  // Las 331 cartas: 41 identidades impresas = 25 con logo + los 16 pendientes, sin tercera categoría.
  const ids = new Set(CARDS.map(cardTeamId));
  assert.equal(CARDS.length, 331);
  assert.deepEqual([...ids].filter((i) => !HINT_TEAM_LOGOS.has(i)).sort(), [...PENDING_LOGOS].sort());
  assert.equal(ids.size, 41);
  for (const c of CARDS.filter((x) => !HINT_TEAM_LOGOS.has(cardTeamId(x)))) {
    for (let s = 0; s < 40; s++) assert.notEqual(hintForCard(`m${s}`, src(c), countryOf, visualHintValue)?.type, "TEAM", c.id);
  }
});

test("A3 · alias e identidad: TH ≡ Team Heretics → mismo logo; la pista usa el equipo IMPRESO de la carta, no el roster actual", () => {
  assert.equal(visualHintValue("TEAM", "TH"), "team-heretics");
  assert.equal(visualHintValue("TEAM", "Team Heretics"), "team-heretics");
  // Todo alias de una identidad con logo resuelve a ESE logo.
  for (const t of TEAM_IDENTITIES.filter((x) => HINT_TEAM_LOGOS.has(x.canonicalId))) {
    for (const a of [t.displayName, t.tag, ...t.currentAliases, ...t.historicalAliases]) {
      const id = canonicalTeam(a).identity?.canonicalId;
      if (id === t.canonicalId) assert.equal(visualHintValue("TEAM", a), t.canonicalId, a);
    }
  }
  // Las cartas cuyo roster actual difiere del impreso (Derke: Fnatic hoy, VIT impreso) → el logo del impreso.
  let divergent = 0;
  for (const c of CARDS) {
    const p = getPlayer(c.playerId)!;
    const expected = HINT_TEAM_LOGOS.has(cardTeamId(c)) ? cardTeamId(c) : null;
    assert.equal(visualHintValue("TEAM", p.team, { cardId: c.id }), expected, c.id);
    if (canonicalTeam(p.team).identity?.canonicalId !== cardTeamId(c)) divergent++;
  }
  assert.ok(divergent > 0, "hay cartas con roster distinto al impreso (la prueba no es trivial)");
  const derke = CARDS.find((c) => c.id === "derke__base");
  if (derke) assert.equal(visualHintValue("TEAM", getPlayer(derke.playerId)!.team, { cardId: derke.id }), "vitality");
});

test("A4 · banderas: registro ≡ carpeta; hashes del README; licencia MIT presente; TODOS los países de las 331 cartas en local", () => {
  const dir = join(PUBLIC, "flags");
  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.replace(/\.svg$/, "").toUpperCase());
  assert.deepEqual([...LOCAL_FLAGS].sort(), [...onDisk].sort());
  const readme = read("public/flags/README.md");
  for (const iso of LOCAL_FLAGS) assert.ok(readme.includes(sha(join(dir, `${iso.toLowerCase()}.svg`))), `${iso}: hash del README`);
  const lic = read("public/flags/LICENSE-flag-icons.txt");
  assert.match(lic, /MIT/); assert.match(lic, /Panayiotis Lipiridis/);
  const needed = new Set(CARDS.map((c) => (getPlayer(c.playerId)?.country ?? "").toUpperCase()));
  for (const iso of needed) assert.ok(LOCAL_FLAGS.has(iso), `falta la bandera local de ${iso}`);
  // Solo lo que se usa: ni una bandera de más.
  assert.deepEqual([...LOCAL_FLAGS].sort(), [...needed].sort());
  // `UN` tiene fichero (la capa Flag de la carta la pinta) pero NO es pista.
  for (const code of NON_NATIONALITY_CODES) assert.equal(isNationalityFlag(code), false, code);
});

test("A5 · cero URL externa: toda pista de las 331 cartas (y toda bandera) es una ruta LOCAL dentro de public/ que existe", () => {
  const seen = new Set<string>();
  for (const c of CARDS) {
    for (let s = 0; s < 24; s++) {
      const h = hintForCard(`seed-${s}`, src(c), countryOf, visualHintValue);
      if (!h) continue;
      const art = hintArt(h);
      assert.ok(art, `${c.id}: ${h.type}:${h.value} sin asset`);
      seen.add(art.src);
    }
    const f = flagSrc(countryOf(c.playerId));
    assert.ok(f, `${c.id}: bandera`);
    seen.add(f);
  }
  for (const s of seen) {
    assert.match(s, /^\/(flags|hints\/teams)\/[a-z0-9-]+\.(svg|png)$/, s);
    const file = publicFile(s);
    assert.ok(file.startsWith(PUBLIC + sep), `${s} escapa de public/`);
    assert.ok(existsSync(file), `${s} no existe`);
  }
  assert.ok([...seen].some((s) => s.startsWith(HINT_TEAM_LOGO_DIR)) && [...seen].some((s) => s.startsWith(FLAGS_DIR)));
  // Ni el resolvedor ni el dorso ni los registros llevan un host (flagcdn, CDN, GitHub, valorant-api, VLR, Liquipedia…).
  const code = ["src/lib/duel/hintVisuals.ts", "src/lib/duel/hintDisplay.ts", "src/data/flags.ts", "src/data/teamLogos.ts", "src/lib/assets.ts", "src/components/duel/DuelCard.tsx"]
    .map((p) => read(p).replace(/^\s*(\*|\/\/).*$/gm, "")).join("\n");
  assert.ok(!/https?:\/\/|flagcdn|valorant-api|valorantesports|vlr\.gg|liquipedia|githubusercontent|jsdelivr|unpkg/i.test(code));
});

test("A6 · reparto: el algoritmo NO cambia (hash % 4 + salto cíclico) y reparte ~50/50 COUNTRY/TEAM en cada carta con ambos", () => {
  const both = CARDS.filter((c) => isNationalityFlag(countryOf(c.playerId)) && HINT_TEAM_LOGOS.has(cardTeamId(c)));
  assert.ok(both.length > 150);
  const N = 400;
  for (const c of both.slice(0, 40)) {
    let team = 0;
    for (let s = 0; s < N; s++) if (hintForCard(`d-${s}`, src(c), countryOf, visualHintValue)?.type === "TEAM") team++;
    assert.ok(team / N > 0.4 && team / N < 0.6, `${c.id}: TEAM ${team}/${N}`);
  }
  assert.deepEqual([...HINT_TYPES], ["COUNTRY", "REGION", "TEAM", "ROLE"]);
});

/** Detector de fugas: lo oculto del rival (uid, cardId, playerId, nick, OVR como campo) no puede aparecer en lo que viaja. */
function leaks(json: string, hidden: ReturnType<typeof rivalUnplayedCards>, own: readonly { cardId: string; playerId: string }[]): string[] {
  const mine = new Set(own.flatMap((c) => [c.cardId, c.playerId, qaRegistry.player(c.playerId)?.nick ?? ""]));
  const out: string[] = [];
  for (const c of hidden) {
    if (json.includes(`"${c.uid}"`)) out.push(`uid ${c.uid}`);
    for (const secret of [c.cardId, c.playerId, qaRegistry.player(c.playerId)?.nick ?? ""]) {
      if (secret && !mine.has(secret) && json.includes(`"${secret}"`)) out.push(secret);
    }
  }
  return out;
}

test("A7 · fugas PvE y PvP con logos reales: solo { type, value } — y CONTROL NEGATIVO: el detector salta si se cuela un dato", () => {
  const m = qaSimulate(qaSnapshot(0, "qa-a", "QA A"), qaSnapshot(1, "qa-b", "QA B"), 3, "A", 11, false);
  for (const [side, mode] of [["A", "PVE"], ["A", "PVP"], ["B", "PVP"]] as const) {
    const v = qaView(m, side, mode);
    const hidden = rivalUnplayedCards(m, side);
    const own = side === "A" ? m.snapshotA.cards : m.snapshotB.cards;
    assert.equal(v.rivalHints.length, hidden.length);
    for (const h of v.rivalHints) if (h) assert.deepEqual(Object.keys(h).sort(), ["type", "value"]);
    const json = JSON.stringify(v);
    assert.deepEqual(leaks(json, hidden, own), [], `${mode} ${side}`);
    // Control negativo: meter el cardId / uid de una oculta DEBE detectarse.
    const victim = hidden.find((c) => !own.some((o) => o.cardId === c.cardId))!;
    const tampered = JSON.stringify({ ...v, rivalHints: [...v.rivalHints, { type: "TEAM", value: "x", cardId: victim.cardId, uid: victim.uid }] });
    assert.ok(leaks(tampered, hidden, own).length >= 2, "el detector no detecta una fuga inyectada");
  }
  // PvP: los dos lados de la misma partida ven la misma pista para la misma carta (la proyección es la del servidor).
  const a = projectMatchFor(m, "A", countryOf, visualHintValue).rivalHints;
  assert.deepEqual(a, projectMatchFor(JSON.parse(JSON.stringify(m)), "A", countryOf, visualHintValue).rivalHints);
});
