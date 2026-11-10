/**
 * FASE 45 · CAPTURAS DE LA ARENA POR LOTES (instrumento `_`, fuera de CI, SOLO LECTURA).
 *
 *   npx tsx scripts/_fase45-arena-shots.ts [baseUrl] [--batch=8] [--only=arena,turn]
 *
 * Recorre las 64 escenas del arnés `/design-system/fase45` en los anchos del encargo y deja un PNG por escena y
 * ancho. Es el hermano pequeño de `_fase45-shots.ts`: aquel además visita las rutas REALES (y por eso exige túnel y
 * cuenta QA); éste sólo mira el arnés, que es donde se ve el rediseño de la arena sin depender de una sesión.
 *
 * ────────────────────────── SEGURIDAD DE MEMORIA (lo aprendido en Fase 44.1) ──────────────────────────
 *
 *   · un Chrome POR LOTE, cerrado al terminar el lote (nada de un navegador vivo 40 minutos);
 *   · lotes de 8 escenas por defecto;
 *   · no arranca un lote sin 3 GB libres, y PARA si bajan de 2 GB;
 *   · la captura va a disco en cuanto se toma: no se acumulan buffers en memoria;
 *   · checkpoint por captura, así que una parada se reanuda donde estaba;
 *   · sólo mata los Chrome que ha lanzado él (por PID), NUNCA los del usuario.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";

const BASE = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:3005";
const BATCH = Math.max(1, Number(process.argv.find((a) => a.startsWith("--batch="))?.slice(8) ?? 8));
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
/**
 * Anchos a capturar. Existe por una razón medida: a 1920 y 2560 un Chrome sin cabeza se come ~700 MB, y en una
 * máquina con la app de producción levantada eso dispara la parada por memoria cada dos lotes. Con `--widths=1440,390`
 * se cubren los dos anchos que de verdad se revisan (escritorio y móvil) sin pelearse con el límite.
 */
const WIDTHS = process.argv.find((a) => a.startsWith("--widths="))?.slice(9).split(",").map(Number);
const OUT = join(process.cwd(), "docs/product/qa/fase45/arena");
mkdirSync(OUT, { recursive: true });
const CHECKPOINT = join(OUT, "checkpoint.json");

/** Umbrales de RAM, en MB. Son los de Fase 44.1 y no se negocian por ir más rápido. */
const START_FREE_MB = 3072;
const STOP_FREE_MB = 2048;
const freeMb = () => Math.round(freemem() / 1048576);

/** Las 64 escenas del arnés, agrupadas como las pide el encargo. */
const GRUPOS: Record<string, string[]> = {
  hub: ["hub", "hub-resume", "hub-no-deck", "hub-signed-out", "hub-offline", "hub-campaign-complete"],
  prematch: ["prematch", "prematch-versus", "prematch-first"],
  intro: ["intro", "intro-reduced"],
  arena: [
    "arena-idle", "arena-defense", "arena-mid", "arena-selected", "arena-locked",
    "arena-attacker-you", "arena-attacker-rival", "arena-reduced",
  ],
  turn: ["turn-win", "turn-loss", "turn-tie", "turn-history", "turn-timeline", "turn-detail"],
  clash: ["clash-undeclared", "clash-declared", "clash-imposed", "clash-resolved", "clash-same-axis"],
  score: ["score-lead", "score-behind", "score-tied", "final-turn", "match-point"],
  estado: ["waiting-rival", "resync", "offline", "reconnect"],
  complete: ["complete-win", "complete-loss", "complete-draw", "complete-reduced"],
  result: ["result-win", "result-loss", "result-draw", "result-ovr", "result-history", "result-reduced"],
  rewards: ["rewards", "no-rewards", "level-up"],
  ranked: ["ranked-win", "ranked-rating-up", "ranked-rating-down", "ranked-pending"],
  modos: ["campaign-result", "campaign-loss", "draft-result", "draft-economy"],
  movil: ["mobile-arena", "mobile-clash", "mobile-result", "mobile-complete"],
};

interface Toma { grupo: string; escena: string; ancho: number; reducido: boolean }

/** Los anchos del encargo. Las escenas «mobile-*» y «*-reduced» se piden en su propia condición. */
const tomas: Toma[] = [];
for (const [grupo, escenas] of Object.entries(GRUPOS)) {
  for (const escena of escenas) {
    const reducido = escena.endsWith("-reduced");
    const anchos = grupo === "movil" ? [390] : reducido ? [1440, 390] : [390, 768, 1440, 1920, 2560];
    for (const ancho of anchos) {
      if (WIDTHS && !WIDTHS.includes(ancho)) continue;
      tomas.push({ grupo, escena, ancho, reducido });
    }
  }
}

const nombre = (t: Toma) => `${t.grupo}-${t.escena}-${t.ancho}${t.reducido ? "-reduced" : ""}.png`;
const alto = (w: number) => (w <= 430 ? 844 : w >= 2560 ? 1440 : w >= 1920 ? 1080 : 900);

type Estado = Record<string, "VALID" | "FAILED">;
const checkpoint: Estado = existsSync(CHECKPOINT) ? JSON.parse(readFileSync(CHECKPOINT, "utf8")) : {};
const guarda = () => writeFileSync(CHECKPOINT, JSON.stringify(checkpoint, null, 2));

async function main() {
  const pend = tomas.filter((t) => checkpoint[nombre(t)] !== "VALID" && (!ONLY || ONLY.includes(t.grupo)));
  console.log(`${tomas.length} tomas · pendientes ${pend.length} · RAM libre ${freeMb()} MB`);

  for (let i = 0; i < pend.length; i += BATCH) {
    if (freeMb() < STOP_FREE_MB) {
      console.log(`PARADA: RAM libre ${freeMb()} MB por debajo de ${STOP_FREE_MB}. Se reanuda con el checkpoint.`);
      break;
    }
    // No se arranca un lote sin margen: es más barato esperar que quedarse sin memoria a mitad.
    for (let espera = 0; freeMb() < START_FREE_MB && espera < 20; espera++) await sleep(3000);

    const lote = pend.slice(i, i + BATCH);
    const antes = freeMb();
    // UN navegador por lote. Se cierra en el `finally`, pase lo que pase.
    const browser = await launch({ args: ["--in-process-gpu", "--mute-audio", "--disk-cache-size=1"] });
    try {
      for (const t of lote) {
        try {
          await browser.tab.resize(t.ancho, alto(t.ancho), 1);
          // Chrome sin cabeza declara `reduce`: la condición se pide explícitamente en cada toma.
          await browser.tab.setMedia([
            { name: "prefers-reduced-motion", value: t.reducido ? "reduce" : "no-preference" },
          ]);
          await browser.tab.goto(`${BASE}/design-system/fase45?scene=${t.escena}`, 800);
          await sleep(600);
          await browser.tab.shot(join(OUT, nombre(t)));   // a disco ya: nada se acumula en memoria
          checkpoint[nombre(t)] = "VALID";
        } catch (e) {
          checkpoint[nombre(t)] = "FAILED";
          console.log(`  ✗ ${nombre(t)}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      await browser.close();
      guarda();
    }
    const ok = Object.values(checkpoint).filter((v) => v === "VALID").length;
    console.log(`lote ${Math.floor(i / BATCH) + 1} · ${lote.length} tomas · RAM ${antes}→${freeMb()} MB · válidas ${ok}/${tomas.length}`);
  }

  const ok = Object.values(checkpoint).filter((v) => v === "VALID").length;
  const ko = Object.values(checkpoint).filter((v) => v === "FAILED").length;

  /*
   * MANIFIESTO. El verificador no puede fiarse de contar ficheros en un directorio: necesita saber de qué BUILD es
   * cada captura, o una tanda vieja pasaría por nueva. Se escribe aquí, junto a las capturas, con el hash de las
   * fuentes que las producen.
   */
  const build = createHash("sha1")
    .update(["src/components/duel", "src/app/game-experience.css", "src/app/design-system/fase45"]
      .flatMap((d) => {
        const abs = join(process.cwd(), d);
        const listar = (x: string): string[] => {
          if (!existsSync(x)) return [];
          const st = statSync(x);
          if (!st.isDirectory()) return [`${x}:${st.size}:${Math.round(st.mtimeMs)}`];
          return readdirSync(x).flatMap((n) => listar(join(x, n)));
        };
        return listar(abs);
      }).sort().join("|"))
    .digest("hex").slice(0, 12);

  /*
   * Las filas salen del CHECKPOINT, no de `tomas`: `tomas` está filtrada por `--only` y `--widths`, así que una
   * ejecución parcial habría reescrito el manifiesto con sólo lo de esa tanda, borrando del registro todo lo
   * capturado antes. El checkpoint acumula; el nombre del fichero lleva grupo, escena y ancho.
   */
  const filas = Object.entries(checkpoint)
    .filter(([, v]) => v === "VALID")
    .map(([file]) => {
      const m = file.match(/^([a-z]+)-(.+)-(\d+)(-reduced)?\.png$/);
      return m
        ? { group: m[1], scene: m[2], size: m[3], reduced: !!m[4], file, build }
        : { group: "?", scene: file, size: "?", reduced: false, file, build };
    });
  writeFileSync(join(OUT, "shots.json"), JSON.stringify({ build, generado: new Date().toISOString(), rows: filas }, null, 2));

  console.log(`FIN · ${ok} válidas · ${ko} fallidas · manifiesto ${filas.length} filas · build ${build} · RAM libre ${freeMb()} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
