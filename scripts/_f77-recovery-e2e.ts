// F77 · instrumento (fuera de CI): E2E REAL de recuperación de contraseña contra https://valorosters.com.
// Chrome VISIBLE con perfil temporal propio (nunca el del usuario), manejado por CDP en 127.0.0.1.
// SOLO la cuenta QA autorizada (davidrololl0+f77qa@gmail.com). Contraseñas generadas aquí; viven en un fichero 600 del
// scratchpad y nunca se imprimen. No lee tokens de recuperación: el enlace lo pega el usuario en esta ventana.
//   npx tsx scripts/_f77-recovery-e2e.ts launch   → abre la ventana QA
//   npx tsx scripts/_f77-recovery-e2e.ts stage1   → registro, login, logout, login, logout, «Recuperar» (envía 1 correo)
//   npx tsx scripts/_f77-recovery-e2e.ts stage2   → tras pegar el enlace: nueva contraseña, antigua falla, nueva entra, F5, logout
//   npx tsx scripts/_f77-recovery-e2e.ts reuse    → tras pegar el MISMO enlace otra vez: debe rechazarse
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHROME_PATH } from "./lib/cdp";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "https://valorosters.com";
const EMAIL = "davidrololl0+f77qa@gmail.com";
const SP = "C:/Users/david/AppData/Local/Temp/claude/C--NEXUS-CENTRAL-DRLCards/bdae3aa0-518a-4d6b-b822-f373dd9ab292/scratchpad";
const PROFILE = join(SP, "f77-qa-chrome-profile");
const CREDS = join(SP, "f77-qa-creds.json");
const PORT = 9341;
const OUT = join(process.cwd(), "docs/product/qa/f77-auth");
mkdirSync(OUT, { recursive: true });
const J = JSON.stringify;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail: unknown = "") => { const d = typeof detail === "string" ? detail : J(detail); results.push({ id, ok, detail: d.slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d.slice(0, 200)}`); return ok; };

class Page {
  private ws!: WebSocket; private id = 0; private pending = new Map<number, (v: any) => void>();
  static async attach(pick: (t: any) => boolean): Promise<Page> {
    const targets: any[] = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const t = targets.filter((x) => x.type === "page").find(pick) ?? targets.find((x) => x.type === "page");
    if (!t) throw new Error("no page target");
    const p = new Page(); p.ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((r, j) => { p.ws.onopen = r; p.ws.onerror = j; });
    p.ws.onmessage = (m) => { const d = JSON.parse(String(m.data)); if (d.id && p.pending.has(d.id)) { p.pending.get(d.id)!(d); p.pending.delete(d.id); } };
    return p;
  }
  send(method: string, params: any = {}) { const id = ++this.id; this.ws.send(J({ id, method, params })); return new Promise<any>((r) => this.pending.set(id, r)); }
  async js<T = any>(expr: string): Promise<T> { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(`${r.result.exceptionDetails.text} ${r.result.exceptionDetails.exception?.description ?? ''}`.slice(0, 300)); return r.result?.result?.value as T; }
  async go(path: string, settle = 2500) { await this.send("Page.navigate", { url: BASE + path }); await sleep(settle); await this.waitFor(`document.readyState === 'complete'`, 15000); }
  async waitFor(expr: string, ms = 20000) { for (let i = 0; i < ms / 250; i++) { if (await this.js<boolean>(expr).catch(() => false)) return true; await sleep(250); } return false; }
  close() { this.ws.close(); }
}
const SET = `const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };`;
const clickText = (re: string, sel = "button") => `(() => { const b = [...document.querySelectorAll(${J(sel)})].find(x => new RegExp(${J(re)}, 'i').test((x.innerText||'').trim()) && !x.disabled && x.offsetParent !== null); if (!b) return false; b.click(); return true; })()`;
const hasSession = `!!Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))`;
const sessionUser = `(() => { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); if (!k) return null; try { return JSON.parse(localStorage.getItem(k)).user?.id ?? null } catch { return null } })()`;
const meStatus = `(async () => { const k = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k)); if (!k) return 0; const t = JSON.parse(localStorage.getItem(k)).access_token; return (await fetch('/api/game/me', { headers: { authorization: 'Bearer ' + t } })).status; })()`;
// La anon que el propio bundle usa (pública por diseño), para comprobar contraseñas por la API desde la página.
const anonFromPage = `(async () => { const b64 = s => JSON.parse(atob(s.replace(/-/g,'+').replace(/_/g,'/'))); for (const s of [...document.scripts].map(x => x.src).filter(Boolean)) { const t = await (await fetch(s)).text(); for (const m of t.matchAll(/eyJ[\\w-]+\\.eyJ[\\w-]+\\.[\\w-]+/g)) { try { if (b64(m[0].split('.')[1]).role === 'anon') return m[0]; } catch {} } } return null; })()`;

async function loginForm(p: Page, password: string) {
  await p.go("/cuenta");
  await p.js(clickText("^Entrar$")); await sleep(300);
  await p.js(`(() => { ${SET} set(document.querySelector('input[type="email"]'), ${J(EMAIL)}); set(document.querySelector('input[type="password"]'), ${J(password)}); document.querySelector('form button[type="submit"]').click(); })()`);
  return p.waitFor(hasSession, 15000);
}
async function logoutUi(p: Page) {
  await p.go("/cuenta");
  const clicked = await p.js<boolean>(clickText("^(Cerrar sesi[oó]n|Salir)$"));
  const gone = await p.waitFor(`!(${hasSession})`, 15000);
  return clicked && gone;
}
async function apiPassword(p: Page, password: string) {
  return p.js<number>(`(async () => { const a = await (${anonFromPage}); const r = await fetch('/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: a, 'content-type': 'application/json' }, body: JSON.stringify({ email: ${J(EMAIL)}, password: ${J(password)} }) }); return r.status; })()`);
}
const save = (name: string) => writeFileSync(join(OUT, `${name}.json`), J({ at: new Date().toISOString(), account: "QA davidrololl0+f77qa (alias)", results }, null, 2));

async function launch() {
  if (!CHROME_PATH) throw new Error("Chrome no encontrado");
  mkdirSync(PROFILE, { recursive: true });
  const proc = spawn(CHROME_PATH, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check", "--new-window", `${BASE}/cuenta`], { detached: true, stdio: "ignore" });
  proc.unref();
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) { console.log(`QA Chrome window open (temporary profile, CDP 127.0.0.1:${PORT})`); return; } } catch { /* starting */ } await sleep(250); }
  throw new Error("QA Chrome did not expose CDP");
}

async function stage1() {
  const p = await Page.attach((t) => t.url.startsWith(BASE));
  await p.send("Page.enable");
  check("QA window has NO prior session (clean profile)", !(await p.js<boolean>(hasSession)));
  const oldPw = randomBytes(18).toString("base64url");
  const username = `qaf77r${randomBytes(2).toString("hex")}`;
  writeFileSync(CREDS, J({ email: EMAIL, username, old: oldPw }), { mode: 0o600 });
  await p.go("/cuenta");
  await p.js(clickText("^Registro$")); await sleep(400);
  await p.js(`(() => { ${SET} const u = [...document.querySelectorAll('form input')].find(i => i.type === 'text'); if (u) set(u, ${J(username)}); set(document.querySelector('input[type="email"]'), ${J(EMAIL)}); set(document.querySelector('input[type="password"]'), ${J(oldPw)}); document.querySelector('form button[type="submit"]').click(); })()`);
  const signed = await p.waitFor(hasSession, 20000);
  const uid = await p.js<string | null>(sessionUser);
  check("A · SIGNUP through the public form → session (auto-confirm kept)", signed && !!uid, { user: uid?.slice(0, 8) });
  writeFileSync(CREDS, J({ email: EMAIL, username, old: oldPw, userId: uid }), { mode: 0o600 });
  check("A · /api/game/me with the new session → 200", (await p.js<number>(meStatus)) === 200);
  check("C · LOGOUT via UI", await logoutUi(p));
  check("B · LOGIN via form with the original password", await loginForm(p, oldPw));
  check("C · LOGOUT via UI again", await logoutUi(p));
  await requestRecovery(p);
  p.close(); save("stage1");
}

async function requestRecovery(p: Page) {
  // D · «¿Has olvidado tu contraseña?» → pestaña Recuperar (UNA sola petición)
  await p.go("/cuenta", 3000);
  await p.waitFor(`[...document.querySelectorAll('button')].some(b => /^Recuperar$/i.test((b.innerText||'').trim()))`, 15000);
  check("D · recover tab available", await p.js<boolean>(clickText("^Recuperar$")));
  await p.waitFor(`/Enviar enlace/i.test(document.querySelector('form button[type="submit"]')?.innerText || '') && !document.querySelector('form input[type="password"]')`, 10000);
  const sent = await p.js<boolean>(`(() => { ${SET} const e = document.querySelector('form input[type="email"]'); const b = document.querySelector('form button[type="submit"]'); if (!e || !b || !/Enviar enlace/i.test(b.innerText)) return false; set(e, ${J(EMAIL)}); b.click(); return true; })()`);
  check("D · FORGOT PASSWORD submitted via the real form (ONE request)", sent);
  const okMsg = await p.waitFor(`/enlace de recuperaci/i.test(document.body.innerText)`, 15000);
  const text = await p.js<string>(`([...document.querySelectorAll('p')].map(e => e.innerText).find(t => /enlace|error/i.test(t)) || '').slice(0, 120)`);
  check("D · confirmation shown to the user", okMsg, text);
  check("D · still logged out while waiting for the email", !(await p.js<boolean>(hasSession)));
}

async function recoverOnly() {
  const p = await Page.attach((t) => t.url.startsWith(BASE));
  await p.send("Page.enable");
  check("pre · logged out", !(await p.js<boolean>(hasSession)));
  await requestRecovery(p);
  p.close(); save("stage1-recover");
}

async function stage2() {
  const c = JSON.parse(readFileSync(CREDS, "utf8"));
  const p = await Page.attach((t) => t.url.startsWith(BASE));
  await p.send("Page.enable");
  const href = await p.js<string>("location.origin + location.pathname");
  check("J · the recovery link landed on https://valorosters.com", href.startsWith(BASE + "/"), href);
  check("K · recovery session accepted → «Nueva contraseña» form shown", await p.waitFor(`!!document.querySelector('[data-testid="password-recovery"]')`, 15000));
  check("K · tokens no longer in the address bar", !(await p.js<boolean>(`/access_token|refresh_token|token=/.test(location.href)`)));
  check("K · recovery session belongs to the QA account", (await p.js<string | null>(sessionUser)) === c.userId);
  const newPw = randomBytes(18).toString("base64url");
  writeFileSync(CREDS, J({ ...c, new: newPw }), { mode: 0o600 });
  await p.js(`(() => { ${SET} const [a, b] = document.querySelectorAll('[data-testid="password-recovery"] input[type="password"]'); set(a, ${J(newPw)}); set(b, ${J(newPw)}); document.querySelector('[data-testid="password-recovery"] button[type="submit"]').click(); })()`);
  check("L · new password saved («Contraseña actualizada»)", await p.waitFor(`/Contraseña actualizada/i.test(document.body.innerText)`, 15000));
  check("M · LOGOUT via UI", await logoutUi(p));
  check("N · OLD password rejected by Auth (400)", (await apiPassword(p, c.old)) === 400);
  check("O · NEW password accepted by Auth (200)", (await apiPassword(p, newPw)) === 200);
  const loggedIn = await loginForm(p, newPw);
  check("O · LOGIN via form with the NEW password", loggedIn && (await p.js<string | null>(sessionUser)) === c.userId);
  await p.go("/coleccion");
  await p.send("Page.reload", {}); await sleep(3500);
  check("P · F5 keeps the session (me → 200)", (await p.js<number>(meStatus)) === 200);
  check("Q · final LOGOUT via UI", await logoutUi(p));
  p.close(); save("stage2");
}

async function reuse() {
  const p = await Page.attach((t) => t.url.startsWith(BASE));
  await sleep(2500);
  const session = await p.js<boolean>(hasSession);
  const recoveryForm = await p.js<boolean>(`!!document.querySelector('[data-testid="password-recovery"]')`);
  const msg = await p.js<string>(`(document.body.innerText.match(/[^\\n]*(caduc|usad|inválid|expir)[^\\n]*/i) || [''])[0].slice(0, 140)`);
  check("REUSE · the same recovery link is rejected (no session, no password form)", !session && !recoveryForm, { session, recoveryForm, msg });
  p.close(); save("reuse");
}

const mode = process.argv[2];
(mode === "launch" ? launch() : mode === "stage1" ? stage1() : mode === "stage2" ? stage2() : mode === "reuse" ? reuse() : mode === "recover" ? recoverOnly() : Promise.reject(new Error("launch|stage1|stage2|reuse")))
  .then(() => process.exit(results.some((r) => !r.ok) ? 1 : 0))
  .catch((e) => { console.error(String(e?.message ?? e)); process.exit(3); });
