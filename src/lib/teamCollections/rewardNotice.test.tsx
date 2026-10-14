/**
 * COLECCIONES · el aviso de una recompensa guardada (en Colecciones o en segundo plano) llega al jugador una vez, esté
 * donde esté, sin tapar las rutas inmersivas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { summarizeSettle, useCollectionRewardStore } from "./rewardNotice";
import { CollectionRewardNotice, rewardText, REWARD_NOTICE_MS } from "@/components/trophies/CollectionRewardNotice";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("AVISO · resumen: solo lo nuevo (primeras compleciones, XP, insignias); nada nuevo → sin aviso", () => {
  assert.equal(summarizeSettle({ teams: [], regions: [], xpGained: 0 }), null);
  assert.equal(summarizeSettle(undefined), null);
  assert.equal(summarizeSettle({ teams: [{ title: "G2", first: false, xp: 300 }], regions: [], xpGained: 0 }), null, "XP ya cobrados no se anuncian otra vez");
  assert.deepEqual(summarizeSettle({ teams: [{ title: "G2", first: true }], regions: ["EMEA"], xpGained: 300 }), { first: ["G2"], xp: 300, regions: ["EMEA"] });
  assert.deepEqual(summarizeSettle({ teams: [{ title: "NAVI", first: false }], regions: [], xpGained: 300 }), { first: [], xp: 300, regions: [] }, "XP pendientes cobrados al empezar la temporada");
});

test("AVISO · el texto es el de Colecciones, en una frase", () => {
  assert.equal(rewardText({ first: ["G2"], xp: 300, regions: ["EMEA"] }), "G2 completado · +300 XP de temporada · Insignia de EMEA desbloqueada");
  assert.equal(rewardText({ first: ["G2", "NAVI"], xp: 600, regions: [] }), "2 equipos completados · +600 XP de temporada");
  assert.equal(REWARD_NOTICE_MS, 6500, "dura lo bastante para verse tras la cortinilla de arranque");
});

test("AVISO · dos liquidaciones sin enseñar se suman; enseñarlo lo borra (una sola vez)", () => {
  const s = useCollectionRewardStore.getState();
  s.take();
  s.push({ first: ["G2"], xp: 300, regions: [] });
  s.push({ first: ["NAVI"], xp: 300, regions: ["EMEA"] });
  assert.deepEqual(useCollectionRewardStore.getState().take(), { first: ["G2", "NAVI"], xp: 600, regions: ["EMEA"] });
  assert.equal(useCollectionRewardStore.getState().take(), null);
});

test("AVISO · lo monta el armazón normal y la portada (no sobres, duelos ni lanzador) y Colecciones avisa por el mismo camino", () => {
  const shell = read("src/components/layout/GameShell.tsx");
  const immersive = shell.slice(shell.indexOf("if (isImmersive(pathname))"), shell.indexOf("const cta = playCta(status);"));
  // En las rutas inmersivas, solo en la portada (donde se llega al iniciar sesión); nunca en sobres, duelos ni lanzador.
  assert.ok(immersive.includes(`{pathname === "/" && <CollectionRewardNotice />}`), "solo la portada");
  assert.equal((immersive.match(/<CollectionRewardNotice/g) ?? []).length, 1, "no tapa la apertura de un sobre ni un duelo");
  assert.match(shell.slice(shell.indexOf("const cta = playCta(status);")), /<CollectionRewardNotice \/>/);
  const page = read("src/app/coleccion/trofeos/page.tsx");
  assert.match(page, /useCollectionRewardStore\.getState\(\)\.push\(gained\)/);
  assert.ok(!/<Toast/.test(page), "un solo aviso: el del armazón");
  assert.match(read("src/lib/game/sync.ts"), /summarizeSettle\(r\)[\s\S]*useCollectionRewardStore\.getState\(\)\.push\(gained\)/);
  // Sin nada pendiente, el componente no pinta ningún aviso.
  useCollectionRewardStore.getState().take();
  assert.ok(!/game-toast/.test(renderToStaticMarkup(<CollectionRewardNotice />)));
});
