/**
 * CARDVIEWER-VERIFY — comprobaciones puras del visor de cartas (datos derivados).
 *   npx tsx scripts/cardviewer-verify.ts
 */
import { ROLE_KIT, ACCOLADE_LABEL, accoladeLabels, recommendedAgent, buildDescription } from "../src/components/cards/cardLore";
import type { Player, VariantDef, RoleId, AccoladeId } from "../src/domain/cards/types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n} ${extra}`)); };

console.log("\n━━━ CARD VIEWER · VERIFY ━━━\n");

const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
console.log("Kit por rol:");
for (const r of ROLES) {
  const k = ROLE_KIT[r];
  ok(`${r}: agentes/habilidades/traits`, !!k && k.agents.length > 0 && k.abilities.length > 0 && k.traits.length > 0);
}
ok("recommendedAgent = primer agente del kit", recommendedAgent("Duelista") === ROLE_KIT.Duelista.agents[0]);
ok("recommendedAgent rol desconocido → —", recommendedAgent("XX" as RoleId) === "—");

console.log("\nPalmarés (accolades):");
const SAMPLE: AccoladeId[] = ["champions-mvp", "masters-winner", "icon", "tournament-clutch"];
for (const a of SAMPLE) ok(`label de ${a}`, typeof ACCOLADE_LABEL[a] === "string" && ACCOLADE_LABEL[a].length > 0);

const player = {
  id: "p1", nick: "Benjy", fullName: "Benjamín X", team: "Fnatic", teamTag: "FNC",
  region: "EMEA", role: "Duelista", country: "es",
  stats: { dmg: 80, scr: 80, com: 80, hs: 30, ast: 50, clu: 60 },
  accolades: ["champions-mvp", "masters-winner"] as AccoladeId[],
} as Player;
const variant = { id: "icon-series", label: "Icon Series", group: "exclusiva", animation: "icon", rank: 14, statBoost: 9, serialized: true, serialLimit: 100, palette: { primary: "#fff", secondary: "#fff", text: "#000", background: "#000" } } as VariantDef;

console.log("\nDerivados:");
ok("accoladeLabels mapea todos", accoladeLabels(player).length === 2 && accoladeLabels(player)[0] === ACCOLADE_LABEL["champions-mvp"]);
const d1 = buildDescription(player, variant, "Fnatic");
const d2 = buildDescription(player, variant, "Fnatic");
ok("buildDescription determinista", d1 === d2);
ok("buildDescription incluye nick y equipo", d1.includes("Benjy") && d1.includes("Fnatic"));
ok("buildDescription incluye edición", d1.includes("Icon Series"));

console.log(`\n━━━ Resultado: ${pass} ✓ / ${fail} ✗ ━━━\n`);
process.exit(fail === 0 ? 0 : 1);

// Señal de fallo para CI: sale con código !=0 si alguna comprobación falló.
if (fail > 0) process.exitCode = 1;
