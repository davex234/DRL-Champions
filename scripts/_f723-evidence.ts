/**
 * F72.3 · EVIDENCIA ESTÁTICA (fuera de CI, solo lectura): inventario de assets, banderas, logos, alias, auditoría de
 * información oculta PvE/PvP con CONTROL NEGATIVO, e invariantes de regresión. Escribe docs/product/qa/fase72-3/.
 *
 *   npx tsx scripts/_f723-evidence.ts
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CARDS, getPlayer } from "../src/data/catalog";
import { canonicalCardTeam, canonicalTeam, TEAM_IDENTITIES } from "../src/data/teamIdentities";
import { HINT_TEAM_LOGOS, hintTeamLogoSrc } from "../src/data/teamLogos";
import { FLAG_ICONS_SOURCE, LOCAL_FLAGS, NON_NATIONALITY_CODES, isNationalityFlag } from "../src/data/flags";
import { flagSrc } from "../src/lib/assets";
import { HINT_ICONS_AVAILABLE, VALORANT_ROLE_OF, visualHintValue, countryDisplayName } from "../src/lib/duel/hintVisuals";
import { rivalUnplayedCards } from "../src/domain/cardgame/hints";
import { qaRegistry, qaSimulate, qaSnapshot, qaView } from "../src/lib/duel/qaSimulation";
import { TACTICAL_AGENTS } from "../src/domain/tactics/roster";
import { GLOBAL_MARKET_ENABLED } from "../src/config/features";
import { PAYMENTS_ENABLED } from "../src/config/monetization";

const OUT = join(process.cwd(), "docs/product/qa/fase72-3");
mkdirSync(OUT, { recursive: true });
const w = (f: string, o: unknown) => writeFileSync(join(OUT, f), JSON.stringify(o, null, 2) + "\n");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const LIB = "C:/NEXUS-CENTRAL/NEXUSFICHAJES/players/EQUIPOS";
const teamReadme = readFileSync("public/hints/teams/README.md", "utf8");
const origin = (id: string) => teamReadme.match(new RegExp(`^\\| ${id} \\| ([^|]+) \\|`, "m"))?.[1].trim() ?? null;

// ── BANDERAS
const needed = new Map<string, number>();
for (const c of CARDS) { const k = (getPlayer(c.playerId)?.country ?? "").toUpperCase(); needed.set(k, (needed.get(k) ?? 0) + 1); }
const flags = {
  source: { ...FLAG_ICONS_SOURCE, repo: "https://github.com/lipis/flag-icons", npmTarball: "flag-icons-7.5.0.tgz", tarballSha1: "66462df3e8bc5ef3a283322a46bb9dde1b290505", npmIntegrity: "sha512-kd+MNXviFIg5hijH766tt+3x76ele1AXlo4zDdCxIvqWZhKt4T83bOtxUOOMlTx/EcFdUMH5yvQgYlFh1EqqFg==", copyright: "Copyright (c) 2013 Panayiotis Lipiridis", licenseFile: "public/flags/LICENSE-flag-icons.txt" },
  runtimeExternalDependency: false,
  files: [...LOCAL_FLAGS].sort().map((iso) => { const p = `public/flags/${iso.toLowerCase()}.svg`; return { iso, file: p, exists: existsSync(p), sha256: sha(p), cards: needed.get(iso) ?? 0, hintEligible: isNationalityFlag(iso), name: countryDisplayName(iso) }; }),
  nonNationality: [...NON_NATIONALITY_CODES],
  neededBy331: needed.size, missingFor331: [...needed.keys()].filter((k) => !LOCAL_FLAGS.has(k)),
  externalSrcFor331: CARDS.filter((c) => !(flagSrc(getPlayer(c.playerId)?.country ?? "") ?? "").startsWith("/flags/")).map((c) => c.id),
};
w("flags.json", flags);

// ── EQUIPOS
const printed = new Map<string, string[]>();
for (const c of CARDS) { const k = canonicalCardTeam(c, getPlayer(c.playerId)).key; printed.set(k, [...(printed.get(k) ?? []), c.id]); }
const teams = {
  rule: "equipo de la CARTA = canonicalCardTeam(card, player) (el impreso manda); logo por canonicalId",
  uniqueTeamsIn331: printed.size,
  imported: [...HINT_TEAM_LOGOS].sort().map((id) => { const p = `public/hints/teams/${id}.png`; const o = origin(id);
    return { canonicalId: id, displayName: TEAM_IDENTITIES.find((t) => t.canonicalId === id)?.displayName, file: p, sha256: sha(p), origin: o, originSha256: o && existsSync(join(LIB, o)) ? sha(join(LIB, o)) : null, byteIdentical: !!o && existsSync(join(LIB, o)) && sha(join(LIB, o)) === sha(p), cards: printed.get(id)?.length ?? 0 }; }),
  missing: [...printed].filter(([k]) => !HINT_TEAM_LOGOS.has(k)).sort().map(([k, ids]) => { const t = TEAM_IDENTITIES.find((x) => x.canonicalId === k); return { canonicalId: k, displayName: t?.displayName, region: t?.region, cards: ids.length, status: "NOT IMPORTED", reason: "rights/source pending" }; }),
  technicalIntegration: "APPROVED (25 local)", publicReleaseTrademarkStatus: "UNRESOLVED",
};
w("teams.json", { ...teams, cardsWithLogo: teams.imported.reduce((s, t) => s + t.cards, 0), cardsWithoutLogo: teams.missing.reduce((s, t) => s + t.cards, 0) });

// ── ALIAS
const aliases = TEAM_IDENTITIES.filter((t) => HINT_TEAM_LOGOS.has(t.canonicalId)).map((t) => {
  const names = [...new Set([t.displayName, t.tag, ...t.currentAliases, ...t.historicalAliases])];
  return { canonicalId: t.canonicalId, resolves: Object.fromEntries(names.map((n) => [n, canonicalTeam(n).identity?.canonicalId === t.canonicalId ? visualHintValue("TEAM", n) : `(otra identidad: ${canonicalTeam(n).identity?.canonicalId ?? "ninguna"})`])) };
});
const divergent = CARDS.map((c) => { const p = getPlayer(c.playerId)!; return { cardId: c.id, rosterTeam: p.team, rosterId: canonicalTeam(p.team).identity?.canonicalId, printedId: canonicalCardTeam(c, p).key, hint: visualHintValue("TEAM", p.team, { cardId: c.id }) }; }).filter((x) => x.rosterId !== x.printedId);
w("aliases.json", { example: { TH: visualHintValue("TEAM", "TH"), "Team Heretics": visualHintValue("TEAM", "Team Heretics") }, identities: aliases,
  rosterVsPrinted: { note: "F72.3 corrige: antes la pista usaba Player.team (roster actual); 11 cartas con logo habrían enseñado el logo de OTRO equipo", cards: divergent } });

// ── INVENTARIO
w("asset-inventory.json", {
  at: new Date().toISOString(),
  FLAGS: { source: "flag-icons 7.5.0", license: "MIT", runtimeExternalDependency: "NO", files: flags.files.length, hintEligible: flags.files.filter((f) => f.hintEligible).length, dir: "public/flags/" },
  "TEAM LOGOS — 25 LOCAL": { source: "existing NEXUSFICHAJES asset library (copied byte-identical)", technicalIntegration: "APPROVED", publicReleaseTrademarkLicenseStatus: "UNRESOLVED", files: teams.imported.length, dir: "public/hints/teams/" },
  "TEAM LOGOS — REMAINING": { status: "NOT IMPORTED", reason: "rights/source pending", teams: teams.missing.map((t) => t.canonicalId) },
  "VALORANT ROLE ICONS": { status: "NOT IMPORTED", reason: "Riot license required", available: [...HINT_ICONS_AVAILABLE].filter((x) => x.startsWith("roles/")), flexHasRole: VALORANT_ROLE_OF.Flex !== null },
  "VCT REGION ICONS": { status: "NOT IMPORTED", reason: "Riot license required", available: [...HINT_ICONS_AVAILABLE].filter((x) => x.startsWith("regions/")) },
  hintTypesEligibleToday: ["COUNTRY", "TEAM"],
});

// ── INFORMACIÓN OCULTA (PvE / PvP) con control negativo
function leaks(json: string, hidden: ReturnType<typeof rivalUnplayedCards>, own: readonly { cardId: string; playerId: string }[]) {
  const mine = new Set(own.flatMap((c) => [c.cardId, c.playerId, qaRegistry.player(c.playerId)?.nick ?? ""]));
  const out: string[] = [];
  for (const c of hidden) {
    if (json.includes(`"${c.uid}"`)) out.push(`uid:${c.uid}`);
    for (const s of [c.cardId, c.playerId, qaRegistry.player(c.playerId)?.nick ?? ""]) if (s && !mine.has(s) && json.includes(`"${s}"`)) out.push(s);
  }
  return out;
}
const m = qaSimulate(qaSnapshot(0, "qa-a", "QA A"), qaSnapshot(1, "qa-b", "QA B"), 3, "A", 11, false);
for (const [file, runs] of [["hidden-info-pve.json", [["A", "PVE"]]], ["hidden-info-pvp.json", [["A", "PVP"], ["B", "PVP"]]]] as const) {
  const rows = runs.map(([side, mode]) => {
    const v = qaView(m, side, mode);
    const hidden = rivalUnplayedCards(m, side);
    const own = side === "A" ? m.snapshotA.cards : m.snapshotB.cards;
    const json = JSON.stringify(v);
    const victim = hidden.find((c) => !own.some((o) => o.cardId === c.cardId))!;
    const tampered = JSON.stringify({ ...v, rivalHints: [...v.rivalHints, { type: "TEAM", value: "x", cardId: victim.cardId, uid: victim.uid }] });
    const keys = [...new Set(v.rivalHints.filter(Boolean).map((h) => Object.keys(h!).sort().join(",")))];
    return { side, mode, hiddenCards: hidden.length, hints: v.rivalHints, hintTypes: [...new Set(v.rivalHints.map((h) => h?.type ?? "null"))], hintKeys: keys, onlyTypeValue: keys.every((k) => k === "type,value"),
      forbiddenFieldsChecked: ["uid", "cardId", "playerId", "nick"], leaks: leaks(json, hidden, own), ovrOrStatsInHints: v.rivalHints.some((h) => h && /ovr|combat|stronghold|gamesense|entryfrag/i.test(JSON.stringify(h))),
      negativeControl: { injected: ["cardId", "uid"], detected: leaks(tampered, hidden, own) } };
  });
  w(file, { at: new Date().toISOString(), method: "vista real proyectada como en servidor (qaView/projectMatchFor + visualHintValue) sobre una partida de QA en curso; detector de fugas + control negativo", runs: rows, pass: rows.every((r) => r.onlyTypeValue && r.leaks.length === 0 && !r.ovrOrStatsInHints && r.negativeControl.detected.length >= 2) });
}

// ── REGRESIÓN
w("regression.json", {
  cards: CARDS.length, agents: TACTICAL_AGENTS.length, migrationHeadOnDisk: readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort().pop(),
  marketplaceEnabled: GLOBAL_MARKET_ENABLED, paymentsEnabled: PAYMENTS_ENABLED,
  f723TouchedDomainFile: "src/domain/cardgame/hints.ts (solo el puerto HintVisual recibe la carta; hash/orden/tipos intactos)",
  untouchedByF723: ["src/domain/cardgame/{match,combat,resolve.ts,opponent,rating,matchmaking}", "src/domain/economy", "src/data/packs.ts", "src/data/catalog.ts", "src/domain/tactics", "supabase/migrations"],
  note: "Estos ficheros tienen cambios SIN COMMIT de fases anteriores; F72.3 no los editó (ver informe, lista de ficheros).",
  migrationsAfter0058: readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f > "0058_hardening_grants.sql"),
});
console.log("evidencia F72.3 escrita en", OUT);
