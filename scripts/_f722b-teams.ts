/**
 * F72.2b · AUDITORÍA DE LOGOS DE EQUIPO (fuera de CI, solo lectura).
 *
 * Cruza las 331 cartas con su identidad CANÓNICA de equipo (equipo impreso → `canonicalCardTeam`, alias resueltos) y busca
 * un logo INDEPENDIENTE en: public/teams (repo), TEAM_LOGOS_AVAILABLE, y la biblioteca fuente de diseño
 * `C:/NEXUS-CENTRAL/NEXUSFICHAJES/players/EQUIPOS/<región>/<TAG>/logo.png` (por tag canónico, tag impreso y alias).
 * Escribe docs/product/qa/fase72-2/team-logo-audit.json.
 */
import { existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CARDS, getPlayer } from "../src/data/catalog";
import { canonicalCardTeam, TEAM_IDENTITIES } from "../src/data/teamIdentities";
import { TEAM_LOGOS_AVAILABLE } from "../src/data/teamLogos";

const LIB = "C:/NEXUS-CENTRAL/NEXUSFICHAJES/players/EQUIPOS";
const REGIONS = ["AMERICAS", "CHINA", "EMEA", "PACIFIC"];
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const folders = REGIONS.flatMap((r) => existsSync(join(LIB, r)) ? readdirSync(join(LIB, r), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ region: r, name: d.name, path: join(LIB, r, d.name) })) : []);

(async () => {
  const byKey = new Map<string, { key: string; label: string; tag: string | null; region: string | null; printed: Set<string>; cards: number; aliases: string[] }>();
  for (const c of CARDS) {
    const p = getPlayer(c.playerId);
    const t = canonicalCardTeam(c, p);
    const row = byKey.get(t.key) ?? { key: t.key, label: t.label, tag: t.identity?.tag ?? null, region: t.identity?.region ?? null, printed: new Set<string>(), cards: 0, aliases: [] as string[] };
    row.printed.add(c.team ?? p?.team ?? "?"); row.cards++;
    if (t.identity) row.aliases = [...new Set([t.identity.tag, t.identity.displayName, ...((t.identity as { aliases?: string[] }).aliases ?? [])])];
    byKey.set(t.key, row);
  }
  const out = [];
  for (const r of [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const names = new Set([r.tag ?? "", ...r.printed, ...r.aliases].filter(Boolean).map(norm));
    const folder = folders.find((f) => names.has(norm(f.name))) ?? null;
    let logo: string | null = null; let meta: Record<string, unknown> | null = null; let others: string[] = [];
    if (folder) {
      const files = readdirSync(folder.path, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
      const lf = files.find((f) => /^logo\.(png|svg|webp)$/i.test(f)) ?? null;
      others = files.filter((f) => f !== lf && /\.(png|svg|webp)$/i.test(f));
      if (lf) {
        logo = join(folder.path, lf).replace(/\\/g, "/");
        const m = await sharp(logo).metadata();
        meta = { format: m.format, width: m.width, height: m.height, alpha: m.hasAlpha };
      }
    }
    out.push({
      canonicalId: r.key, displayName: r.label, tag: r.tag, region: r.region, printedOnCards: [...r.printed], cards: r.cards,
      inRepo: TEAM_LOGOS_AVAILABLE.has(r.key), sourceFolder: folder ? `${folder.region}/${folder.name}` : null, localLogo: logo, meta,
      otherImagesInFolder: others.slice(0, 6),
    });
  }
  const dir = join(process.cwd(), "docs/product/qa/fase72-2"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "team-logo-audit.json"), JSON.stringify({ cards: CARDS.length, identities: out.length, registryIdentities: TEAM_IDENTITIES.length, withLocalLogo: out.filter((o) => o.localLogo).length, teams: out }, null, 2) + "\n");
  console.log(`cartas=${CARDS.length} identidades usadas=${out.length} (registro=${TEAM_IDENTITIES.length}) con logo local=${out.filter((o) => o.localLogo).length}`);
  for (const o of out) console.log([o.canonicalId, o.tag, o.region, o.printedOnCards.join("|"), o.cards, o.sourceFolder ?? "-", o.meta ? `${o.meta.format} ${o.meta.width}x${o.meta.height} alpha=${o.meta.alpha}` : "SIN LOGO", o.otherImagesInFolder.join(",")].join(" · "));
})();
