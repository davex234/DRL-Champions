/**
 * VERIFICACIÓN DEL ASSET LIFECYCLE & UPDATE ENGINE (Artwork Pipeline · Fase 5/6).
 *
 * Solo administra el CICLO DE VIDA del registry (jamás genera/renderiza/descarga). Ejemplo
 * obligatorio: logo antiguo de Paper Rex → logo nuevo → actualización de SOLO ese asset →
 * invalidación de SOLO su cache → el Renderer reutiliza el recurso nuevo automáticamente →
 * rollback → se recupera EXACTAMENTE la versión anterior, sin afectar a ningún otro asset.
 * Comprueba: versionado · fingerprints (sin rutas) · diff · rollback · historial ·
 * cache · métricas · determinismo · rendimiento · integración Manager/Acquisition/Renderer
 * · cero pérdidas de historial · cero invalidaciones innecesarias · cero corruptos.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ArtworkEngine, makeAsset, teamAsset, playerAsset, validateAssets, artworkHash } from "@/artwork";
import { composeArtwork, type ArtworkComposition } from "@/artwork-composer";
import { ArtworkRenderer } from "@/artwork-renderer";
import { AcquisitionEngine, StaticManifestProvider } from "@/artwork-acquisition";
import {
  AssetLifecycleEngine, createLifecycleState, snapshotManager, diffStates, changesOf,
  contentChecksum, lifecycleFingerprint, currentVersion, historyOf, versionsOf, timeline,
  auditLifecycle, invalidationOf, affectedCompositions, SelectiveCache, computeLifecycleMetrics,
  type IncomingAsset, type LifecycleState,
} from "@/artwork-updater";
import { generateCards, type CardSpec } from "@/card-generator";
import { analyze } from "@/analyzer";
import { importSnapshot, makeClock, createIdentityResolver, buildRegistry, type ImportCtx, type RawSnapshot } from "@/importer";
import { allPlayers } from "@/data/catalog";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = ""): void => {
  console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

const NOW = 1_700_000_000_000;
const META = (n = 0, reason?: string) => ({ actor: "curator", at: NOW + n, reason });

const pngOf = (color: string, size = 256): Promise<Buffer> =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="40" fill="${color}"/><circle cx="${size / 2}" cy="${size / 2}" r="${size / 3}" fill="#fff" fill-opacity="0.85"/></svg>`))
    .ensureAlpha().png({ compressionLevel: 9 }).toBuffer();

/** Carta mínima REAL del Card Generator para el render de integración. */
function anySpec(): CardSpec {
  const FIX: RawSnapshot = {
    tournament: { id: "vct-demo", name: "VCT Demo 2026", type: "international", tier: "vct-international", status: "finished", startDate: "2026-01-01T00:00:00Z" },
    stages: [{ id: "s", name: "Playoffs", kind: "playoff", orderIdx: 0 }],
    teams: [{ id: "prx", name: "Paper Rex", region: "APAC", active: true }, { id: "b", name: "Rival Club", region: "APAC" }],
    players: [{ id: "p1", nick: "Jinggg", team: "Paper Rex", role: "duelist", agents: ["Raze"] }],
    coaches: [],
    matches: [{ id: "m1", stageId: "s", teamA: "Paper Rex", teamB: "Rival Club", status: "finished", format: "bo3", scoreA: 2, scoreB: 0, winner: "Paper Rex", round: "Grand Final", matchOrder: 1 }],
    maps: [{ id: "mm1", matchId: "m1", map: "Ascent", mapOrder: 1, scoreA: 13, scoreB: 5, winner: "Paper Rex" }],
    mapStats: [{ matchMapId: "mm1", matchId: "m1", player: "Jinggg", team: "Paper Rex", agent: "Raze", acs: 280, kills: 22, deaths: 9, assists: 5, kast: 82, adr: 168, fk: 4, fd: 1, clutches: 2 }],
    standings: [{ team: "Paper Rex", position: 1, wins: 1, losses: 0 }, { team: "Rival Club", position: 2, wins: 0, losses: 1 }],
    awards: { champion: "Paper Rex", runnerUp: "Rival Club" },
  };
  const ictx: ImportCtx = { clock: makeClock(NOW), identity: createIdentityResolver(buildRegistry([])) };
  const gen = generateCards(analyze(importSnapshot(FIX, ictx).model), { roster: allPlayers(), now: NOW });
  return gen.cards[0];
}

async function main(): Promise<void> {
  console.log("# Verificación del Asset Lifecycle & Update Engine — DRL Champions (Artwork Fase 5/6)\n");

  const root = mkdtempSync(join(tmpdir(), "drl-lifecycle-"));
  const assetsRoot = join(root, "public");
  mkdirSync(join(assetsRoot, "teams"), { recursive: true });

  try {
    // ── 1. VERSIONADO ──
    console.log("## 1. Versionado");
    const artwork = new ArtworkEngine();
    const engine = new AssetLifecycleEngine(artwork);
    const prxOld = makeAsset({
      id: "team:paper-rex", category: "team", name: "Paper Rex (logo clásico)",
      path: "/teams/paper-rex.png", format: "png", width: 256, height: 256,
      aliases: ["paper-rex", "prx"], subjectId: "paper-rex",
    });
    const jing = playerAsset("jinggg");
    const oldPng = await pngOf("#e91e63");
    const newPng = await pngOf("#00bcd4");
    writeFileSync(join(assetsRoot, "teams", "paper-rex.png"), oldPng);
    const v1: IncomingAsset[] = [
      { asset: prxOld, checksum: artworkHash(oldPng), provider: "event-official", license: "official" },
      { asset: jing, checksum: "fnv1a:aaaa1111", provider: "event-official", license: "official" },
    ];
    const r1 = engine.sync(v1, META(0, "alta inicial"));
    check("alta inicial: todos añadidos como v1 (CreatedAt/UpdatedAt lógicos, proveedor, licencia, checksum)",
      r1.diff.added.length === 2 && engine.state.assets["team:paper-rex"].current === 1 &&
      currentVersion(engine.state.assets["team:paper-rex"]).license === "official" &&
      currentVersion(engine.state.assets["team:paper-rex"]).createdAt === NOW);
    check("estado 100% serializable", (() => {
      const j = JSON.parse(JSON.stringify(engine.state)) as LifecycleState;
      return j.seq === engine.state.seq && Object.keys(j.assets).length === 2;
    })());

    // ── 2. FINGERPRINTS (jamás por ruta) ──
    console.log("\n## 2. Fingerprints");
    const moved = { ...prxOld, path: "/teams/renombrado/paper-rex.png" };
    check("renombrar la RUTA no cambia el fingerprint (contenido+dimensiones+formato+metadatos)",
      lifecycleFingerprint(moved, artworkHash(oldPng), "official") ===
      lifecycleFingerprint(prxOld, artworkHash(oldPng), "official"));
    check("cambiar el CONTENIDO sí lo cambia",
      lifecycleFingerprint(prxOld, artworkHash(newPng), "official") !==
      lifecycleFingerprint(prxOld, artworkHash(oldPng), "official"));
    check("los recursos virtuales llevan el contenido en su declaración (checksum determinista)",
      contentChecksum({ asset: makeAsset({ id: "icon:x", category: "icon", name: "", path: "css:x", format: "css" }) }) ===
      contentChecksum({ asset: makeAsset({ id: "icon:y", category: "icon", name: "", path: "css:x", format: "css" }) }));

    // ── 3. DIFF ──
    console.log("\n## 3. Diff");
    const prev = currentVersion(engine.state.assets["team:paper-rex"]);
    check("detecta cada tipo de cambio",
      changesOf(prev, { asset: prxOld, checksum: artworkHash(newPng), provider: "event-official", license: "official" }).includes("content-changed") &&
      changesOf(prev, { asset: { ...prxOld, name: "PRX" }, checksum: artworkHash(oldPng), provider: "event-official", license: "official" }).includes("renamed") &&
      changesOf(prev, { asset: prxOld, checksum: artworkHash(oldPng), provider: "otro", license: "official" }).includes("provider-changed") &&
      changesOf(prev, { asset: { ...prxOld, aliases: ["prx"] }, checksum: artworkHash(oldPng), provider: "event-official", license: "official" }).includes("alias-changed") &&
      changesOf(prev, { asset: prxOld, checksum: artworkHash(oldPng), provider: "event-official", license: "cc" }).includes("license-changed") &&
      changesOf(prev, { asset: { ...prxOld, hash: "fnv1a:00000000" }, checksum: artworkHash(oldPng), provider: "event-official", license: "official" }).includes("hash-changed") &&
      changesOf(prev, { asset: prxOld, checksum: artworkHash(oldPng), provider: "event-official", license: "official" }).length === 0);
    const dRemoved = diffStates(engine.state, [v1[0]]);
    check("detecta eliminados y sin-cambios", dRemoved.removed.includes("player:jinggg") && dRemoved.unchanged.includes("team:paper-rex"));
    const dObsolete = diffStates(engine.state, v1, { players: ["jinggg"], teams: [], countries: [], tournaments: [], collections: [], badges: [] });
    check("detecta obsoletos (sujeto sin referencias vivas) SIN eliminarlos",
      dObsolete.obsolete.includes("team:paper-rex") && !dObsolete.removed.includes("team:paper-rex"));

    // ── 4. EJEMPLO OBLIGATORIO: LOGO DE PAPER REX ──
    console.log("\n## 4. Ejemplo obligatorio — logo de Paper Rex");
    const spec = anySpec();
    const comp: ArtworkComposition = composeArtwork(spec, artwork, { nick: "Jinggg", teamSlug: "paper-rex", generationId: "GEN-DEMO" });
    const otherComp = composeArtwork(spec, artwork, { nick: "Jinggg", teamSlug: "otro-equipo", generationId: "GEN-DEMO" });
    const reader = (rel: string): Uint8Array => readFileSync(join(assetsRoot, rel.replace(/^\//, "")));
    const render = async (dir: string): Promise<string> => {
      const r = new ArtworkRenderer(artwork, { outputDir: join(root, dir), now: NOW, generationId: "GEN-DEMO", reader });
      const out = await r.renderCard(comp);
      return out.files.find((f) => f.kind === "png")!.sha256;
    };
    const shaOld = await render("r1");

    // Logo NUEVO (fichero versionado nuevo; el registry decide cuál es el vigente).
    writeFileSync(join(assetsRoot, "teams", "paper-rex-v2.png"), newPng);
    const prxNew = makeAsset({
      id: "team:paper-rex", category: "team", name: "Paper Rex (logo clásico)",
      path: "/teams/paper-rex-v2.png", format: "png", width: 256, height: 256,
      aliases: ["paper-rex", "prx"], subjectId: "paper-rex",
    });
    const r2 = engine.sync([
      { asset: prxNew, checksum: artworkHash(newPng), provider: "event-official", license: "official" },
      v1[1],
    ], META(10, "rebrand oficial"));
    check("se actualiza ÚNICAMENTE ese asset (v2; el resto sin cambios)",
      r2.diff.modified.length === 1 && r2.diff.modified[0].assetId === "team:paper-rex" &&
      r2.diff.unchanged.includes("player:jinggg") && engine.state.assets["team:paper-rex"].current === 2 &&
      engine.state.assets["player:jinggg"].current === 1);
    check("se invalida ÚNICAMENTE su cache (cero invalidaciones innecesarias)",
      r2.invalidated.assetIds.length === 1 && r2.invalidated.assetIds[0] === "team:paper-rex" &&
      !r2.invalidated.assetIds.includes("player:jinggg"));
    const cache = new SelectiveCache<string>();
    cache.set("team:paper-rex", "render-viejo");
    cache.set("player:jinggg", "intacto");
    cache.invalidate(r2.invalidated);
    check("la cache selectiva conserva TODO lo no afectado (jamás se vacía entera)",
      cache.get("team:paper-rex") === undefined && cache.get("player:jinggg") === "intacto" && cache.size === 1);
    const affected = affectedCompositions([comp, otherComp], r2.invalidated);
    check("puente con el Renderer: SOLO las composiciones que usan ese asset se re-renderizan",
      affected.length === 1 && affected[0] === comp.cardId &&
      affectedCompositions([otherComp], r2.invalidated).length === 0);
    const shaNew = await render("r2");
    check("el Renderer reutiliza AUTOMÁTICAMENTE el recurso nuevo (misma composición, bytes nuevos)",
      shaNew !== shaOld);

    // Rollback: volver EXACTAMENTE a la versión anterior sin tocar nada más.
    const rb = engine.rollback("team:paper-rex", 1, META(20, "el rebrand se pospone"));
    const shaBack = await render("r3");
    check("rollback: v1 vuelve a ser la vigente (checksum EXACTO de la versión antigua)",
      rb.ok && engine.state.assets["team:paper-rex"].current === 1 &&
      currentVersion(engine.state.assets["team:paper-rex"]).checksum === artworkHash(oldPng));
    check("el render tras rollback es BYTE A BYTE el original", shaBack === shaOld);
    check("ningún otro asset se vio afectado",
      engine.state.assets["player:jinggg"].current === 1 && historyOf(engine.state, "player:jinggg").length === 1);
    check("rollback inválido → error sin mutar",
      !engine.rollback("team:paper-rex", 99, META(21)).ok && !engine.rollback("nadie", 1, META(22)).ok);

    // ── 5. HISTORIAL (jamás se pierde ni sobrescribe) ──
    console.log("\n## 5. Historial");
    const h = historyOf(engine.state, "team:paper-rex");
    check("historial completo: alta → content-changed(+hash) → rolled-back (usuario/fecha/motivo/proveedor)",
      h.length === 4 && h[0].kind === "added" && h.some((e) => e.kind === "content-changed") &&
      h[h.length - 1].kind === "rolled-back" &&
      h.every((e) => e.actor === "curator" && e.at >= NOW) && h[1].reason === "rebrand oficial");
    check("TODAS las versiones se conservan tras el rollback (v1 y v2)",
      versionsOf(engine.state, "team:paper-rex").length === 2);
    check("cero pérdidas: auditoría íntegra (seq monótona, versiones sin huecos, current válido)",
      auditLifecycle(engine.state).length === 0 && timeline(engine.state).length === 5);

    // ── 6. MÉTRICAS ──
    console.log("\n## 6. Métricas");
    const m = computeLifecycleMetrics(engine.state, r2);
    check("activos/obsoletos/eliminados/actualizados/cache/versiones/eventos",
      m.active === 2 && m.removed === 0 && m.updated === 1 && m.cacheInvalidated === 1 && m.versions === 3 && m.events === 5);

    // ── 7. INTEGRACIÓN CON ACQUISITION ──
    console.log("\n## 7. Integración con Acquisition");
    const acqArt = new ArtworkEngine();
    const acq = new AcquisitionEngine(acqArt, {
      providers: [new StaticManifestProvider("cfg", [
        { category: "team", subjectId: "paper-rex", url: "mem://prx.png", license: "official" },
      ], async () => await pngOf("#8e44ad", 300))],
      assetsRoot: join(root, "acq"), now: NOW,
    });
    const acquired = await acq.acquireTarget({ category: "team", subjectId: "paper-rex", searchTerms: ["Paper Rex"] });
    const incoming: IncomingAsset[] = [{
      asset: acquired.asset!, checksum: acquired.contentHash,
      provider: acquired.providerId, license: "official",
    }];
    const lc2 = new AssetLifecycleEngine(acqArt);
    const rAcq = lc2.sync(incoming, META(30, "salida real del Acquisition Engine"));
    check("la salida REAL de Acquisition entra al ciclo de vida (checksum de contenido incluido)",
      acquired.outcome === "downloaded" && rAcq.diff.added.length === 1 &&
      currentVersion(lc2.state.assets["team:paper-rex"]).checksum === acquired.contentHash &&
      !currentVersion(lc2.state.assets["team:paper-rex"]).checksum!.startsWith("unverified:"));
    check("snapshot del Manager: los placeholders NO entran al ciclo de vida",
      snapshotManager(acqArt).every((i) => !i.asset.placeholder));

    // ── 8. DETERMINISMO ──
    console.log("\n## 8. Determinismo");
    const replay = (): string => {
      const a = new ArtworkEngine();
      const e = new AssetLifecycleEngine(a);
      e.sync(v1, META(0, "alta inicial"));
      e.sync([{ asset: prxNew, checksum: artworkHash(newPng), provider: "event-official", license: "official" }, v1[1]], META(10, "rebrand oficial"));
      e.rollback("team:paper-rex", 1, META(20, "el rebrand se pospone"));
      return JSON.stringify(e.state);
    };
    check("misma secuencia ⇒ estado byte a byte", replay() === replay());
    check("mismo estado final que el flujo real", replay() === JSON.stringify(engine.state));

    // ── 9. RENDIMIENTO ──
    console.log("\n## 9. Rendimiento");
    const big: IncomingAsset[] = Array.from({ length: 1000 }, (_, i) => ({
      asset: teamAsset(`t${i}`), checksum: `fnv1a:${(i * 2654435761 >>> 0).toString(16).padStart(8, "0")}`,
    }));
    const bigEngine = new AssetLifecycleEngine(new ArtworkEngine());
    const t0 = Date.now();
    bigEngine.sync(big, META(40));
    const changed = big.map((x, i) => i < 50 ? { ...x, checksum: `fnv1a:${(i + 7).toString(16).padStart(8, "0")}` } : x);
    const rBig = bigEngine.sync(changed, META(41));
    const ms = Date.now() - t0;
    check("1000 assets: alta + diff con 50 cambios en tiempo razonable",
      rBig.diff.modified.length === 50 && rBig.diff.unchanged.length === 950 &&
      rBig.invalidated.assetIds.length === 50 && ms < 2000, `${ms} ms`);

    // ── 10. CERO ASSETS CORRUPTOS ──
    console.log("\n## 10. Cero assets corruptos");
    check("todo asset vigente valida en el Artwork Manager",
      validateAssets(artwork.registry.list()).ok && auditLifecycle(bigEngine.state).length === 0);

    console.log(`\n${fail === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${fail} COMPROBACIÓN(ES) FALLARON`} — ${pass}/${pass + fail}`);
    if (fail > 0) process.exitCode = 1;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
