/** FASE 49 · captura del «antes» de /tienda (instrumento `_`, solo lectura, sin sesión). */
import { join } from "node:path";
import { launch, sleep } from "./lib/cdp";
const OUT = join(process.cwd(), "docs/product/qa/fase49");
(async () => {
  for (const W of [1440, 390]) {
    const H = W <= 430 ? 844 : 900;
    const b = await launch({ width: W, height: H, args: ["--in-process-gpu", "--mute-audio"] });
    try {
      await b.tab.resize(W, H, 1);
      await b.tab.goto("http://127.0.0.1:3005/tienda", 8000);
      await sleep(2500);
      await b.tab.shot(join(OUT, `antes-tienda-${W}.png`));
    } finally { await b.close(); }
  }
})();
