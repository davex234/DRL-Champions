/** Sonda de exploración (instrumento): inicia sesión en el stack de QA, visita una ruta y evalúa una expresión.
 *   QA_ENV=… PROBE_PATH=/tienda PROBE_JS="document.title" [PROBE_LOCALE=de] [PROBE_WHO=ADMIN] npx tsx scripts/_i18n-auth-probe.ts */
import { open, goto, loginUi, chooseLocale, probe, sleep, type Loc, type Who } from "./_i18n-auth-lib";

async function main() {
const c = await open(Number(process.env.PROBE_WIDTH ?? 1440));
try {
  await goto(c, "/cuenta", 1500);
  if (process.env.PROBE_LOCALE) console.log("locale", await chooseLocale(c, process.env.PROBE_LOCALE as Loc));
  console.log("login", await loginUi(c, (process.env.PROBE_WHO ?? "PLAYER") as Who));
  for (const step of (process.env.PROBE_PATH ?? "/").split(",")) {
    await goto(c, step, Number(process.env.PROBE_WAIT ?? 2500));
    if (process.env.PROBE_CLICK) { console.log("click", await c.tab.js(process.env.PROBE_CLICK)); await sleep(2500); }
    console.log(`── ${step}`);
    console.log(JSON.stringify(await c.tab.js(process.env.PROBE_JS ?? "document.body.innerText.slice(0, 1500)"), null, 1));
    if (process.env.PROBE_SHOT) await c.tab.shot(process.env.PROBE_SHOT);
    if (process.env.PROBE_STD) console.log(JSON.stringify(await probe(c)));
  }
  console.log("errors", c.errors);
} finally { await c.browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
