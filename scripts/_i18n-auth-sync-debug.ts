/** Depuración (instrumento): con sesión, cambiar el idioma en la pestaña «Cuenta» ¿llega a la cuenta? */
import { chooseLocale, goto, loginUi, open, sleep, token } from "./_i18n-auth-lib";

async function main() {
  const c = await open(1440, { acceptLanguage: "ja-JP,ja" });
  try {
    await goto(c, "/cuenta", 1800);
    console.log("login", await loginUi(c, "PLAYER"));
    console.log("antes", (await token("PLAYER")).meta, await c.tab.js("localStorage.getItem('vr.locale')"));
    console.log("choose it", await chooseLocale(c, "it"));
    for (let i = 0; i < 8; i++) { await sleep(1000); console.log(i, (await token("PLAYER")).meta.locale, await c.tab.js("localStorage.getItem('vr.locale')"), await c.tab.js("document.documentElement.lang")); }
    console.log("errors", c.tab.takeErrors());
    console.log("choose de", await chooseLocale(c, "de"));
    await sleep(3000);
    console.log((await token("PLAYER")).meta, c.tab.takeErrors());
  } finally { await c.browser.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
