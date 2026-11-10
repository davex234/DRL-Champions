/**
 * FASE 44 · CAPTURAS BEFORE / AFTER (instrumento `_`, fuera de CI, SOLO LECTURA)
 *
 *   npx tsx scripts/_fase44-shots.ts <before|after> <credsFile> [--sizes=desktop,mobile] [--only=home,packs]
 *
 * App local en :3005 contra la BD real (túnel). Inicia sesión con la cuenta QA por el formulario de `/cuenta`,
 * recorre las pantallas principales (rutas reales) y las escenas de momentos de los arneses (fases 33/35/37/38/39/42,
 * y fase44 en AFTER), y por cada captura mide heurísticas «web-like»: desbordamiento, spinners genéricos, CTA de
 * JUGAR visible, primarios dominantes, controles < 44 px, textos técnicos y estado vacío sin acción.
 *
 * Nada de lo que hace escribe: no pulsa botones de compra/apertura/juego. La huella de BD se compara antes/después.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { launch, sleep, type Tab } from "./lib/cdp";

for (const f of [".env.local"]) { const p = join(process.cwd(), f); if (!existsSync(p)) continue; for (const line of readFileSync(p, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } }
/* eslint-disable @typescript-eslint/no-explicit-any */

const PHASE = process.argv[2] === "after" ? "after" : "before";
const CREDS = process.argv[3];
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
const OUT = process.env.F44_OUT ?? join(process.cwd(), "docs/product/qa/fase44", PHASE);
mkdirSync(OUT, { recursive: true });
const RUN = process.env.F44_RUN ? `-${process.env.F44_RUN}` : "";
const LOG = join(OUT, `shots${RUN}.log`);
writeFileSync(LOG, "");
const log = (s: string) => { console.log(s); appendFileSync(LOG, s + "\n"); };

export const SIZES = {
  desktop: [1440, 900], mobile: [390, 844], tablet: [1024, 800], tablet768: [768, 1024], wide: [1920, 1080],
} as const;
type Size = keyof typeof SIZES;

interface Target { id: string; screen: string; path: string; real: boolean; wait?: string; settle?: number; scroll?: string }

/** Pantallas reales (con sesión QA). `wait`: selector o texto que indica que la pantalla montó. */
const REAL: Target[] = [
  { id: "home", screen: "Home", path: "/", real: true, settle: 4500 },
  { id: "play", screen: "Play / modos", path: "/jugar", real: true, settle: 3500 },
  { id: "pve", screen: "PvE · preparación", path: "/duelos/jugar", real: true, settle: 4500 },
  { id: "duels", screen: "Duelos", path: "/duelos", real: true, settle: 3500 },
  { id: "ranked", screen: "Ranked", path: "/duelos/competitivo", real: true, settle: 4500 },
  { id: "campaign", screen: "Road to Champions", path: "/jugar/road-to-champions", real: true, settle: 4500 },
  { id: "draft", screen: "Draft Gauntlet", path: "/jugar/draft-gauntlet", real: true, settle: 4500 },
  { id: "shop", screen: "Tienda / sobres", path: "/tienda", real: true, settle: 4000 },
  { id: "packs", screen: "Catálogo de sobres", path: "/packs", real: true, settle: 3500 },
  { id: "inventory", screen: "Inventario de sobres", path: "/inventario", real: true, settle: 4000 },
  { id: "collection", screen: "Colección", path: "/coleccion", real: true, settle: 5000 },
  { id: "card-detail", screen: "Ficha de carta", path: "/coleccion/carta/__FIRST_OWNED__", real: true, settle: 4500 },
  { id: "decks", screen: "Equipos / constructor", path: "/duelos/mazos", real: true, settle: 5000 },
  { id: "season", screen: "Temporada", path: "/temporada", real: true, settle: 4500 },
  { id: "pass", screen: "Logros y pase", path: "/logros", real: true, settle: 4500 },
  { id: "progression", screen: "Progresión", path: "/progresion", real: true, settle: 3500 },
  { id: "events", screen: "Eventos (esports)", path: "/torneos", real: true, settle: 4000 },
  { id: "event-center", screen: "Centro de eventos", path: "/eventos", real: true, settle: 3500 },
  { id: "pickems", screen: "Pick'ems", path: "/pickems", real: true, settle: 4500 },
  { id: "profile", screen: "Perfil", path: "/jugador/me", real: true, settle: 4500 },
  { id: "account", screen: "Cuenta / ajustes", path: "/cuenta", real: true, settle: 3500 },
  { id: "social", screen: "Social", path: "/social", real: true, settle: 3500 },
  { id: "rewards", screen: "Recompensas", path: "/recompensas", real: true, settle: 3000 },
  { id: "not-found", screen: "404", path: "/esta-ruta-no-existe", real: true, settle: 2500 },
];

/** Momentos: escenas de los arneses existentes (fixtures QA SYNTHETIC, sin red). */
const MOMENTS: Target[] = [
  ...["prematch-pve", "intro", "turn1-attack", "stat-reveal", "turn-win", "match-point", "final-turn", "match-win", "match-loss", "match-draw", "ranked-result", "rewards"]
    .map((s) => ({ id: `m33-${s}`, screen: `Partida · ${s}`, path: `/design-system/fase33?scene=${s}`, real: false, settle: 3200 })),
  ...["stage-ready", "stage-opening", "stage-hand-legendary", "reveal-back-legendary", "reveal-common", "reveal-rare", "reveal-epic", "reveal-legendary", "reveal-serial-one", "reveal-duplicate", "summary-mixed", "summary-open-another", "summary-no-more"]
    .map((s) => ({ id: `m38-${s}`, screen: `Sobre · ${s}`, path: `/design-system/fase38?scene=${s}`, real: false, settle: 3200 })),
  ...["map-mid", "node-available", "prematch-available"]
    .map((s) => ({ id: `m35-${s}`, screen: `Campaña · ${s}`, path: `/design-system/fase35?scene=${s}`, real: false, settle: 3000 })),
  ...["pick-1", "gauntlet-map", "win", "loss"]
    .map((s) => ({ id: `m39-${s}`, screen: `Draft · ${s}`, path: `/design-system/fase39?state=${s}`, real: false, settle: 3000 })),
  ...["hub-fresh", "hub-offline", "hub-error-stale"]
    .map((s) => ({ id: `m37-${s}`, screen: `Colección · ${s}`, path: `/design-system/fase37?scene=${s}`, real: false, settle: 3500 })),
];

/** AFTER: escenas nativas del arnés de la fase 44 (piezas nuevas) y estados especiales. */
const F44: Target[] = [
  "shell-menu", "shell-bars", "play-cta", "mode-select", "mode-locked", "mode-signed-out", "packs-inventory", "packs-empty", "deck-moments",
  "result-victory", "result-defeat", "result-draw", "result-level-up", "xp-levels", "rating-delta", "moments", "empty", "error", "not-found",
  "offline", "loading", "toasts", "motion-lab", "overlays", "audio", "reduced",
].map((s) => ({ id: `f44-${s}`, screen: `Arnés F44 · ${s}`, path: `/design-system/fase44?scene=${s}`, real: false, settle: 3500 }));
const SPECIAL: Target[] = [
  ...["hub-offline", "hub-error-stale", "hub-anon"].map((s) => ({ id: `m37-${s}`, screen: `Colección · ${s}`, path: `/design-system/fase37?scene=${s}`, real: false, settle: 3500 })),
  ...["offline", "error-stale", "partial", "anonymous", "fresh", "match-pve", "packs", "no-deck"].map((s) => ({ id: `m36-${s}`, screen: `Lobby · ${s}`, path: `/design-system/fase36?scene=${s}`, real: false, settle: 3500 })),
  ...["status-network-error", "status-offline", "status-missing"].map((s) => ({ id: `m38-${s}`, screen: `Sobre · ${s}`, path: `/design-system/fase38?scene=${s}`, real: false, settle: 3200 })),
  ...["return-7d", "after-match", "after-pack"].map((s) => ({ id: `m42-${s}`, screen: `Live · ${s}`, path: `/design-system/fase42?scene=${s}`, real: false, settle: 3500 })),
];

const creds = CREDS && existsSync(CREDS) ? JSON.parse(readFileSync(CREDS, "utf8")) as { email: string; password: string; userId: string } : null;
const psql = (sql: string) => execFileSync("ssh", ["-i", join(homedir(), ".ssh", "id_ed25519"), "-o", "BatchMode=yes", "nexusadmin@212.95.40.144", "docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -At -c 'set default_transaction_read_only = on;' -f -"], { input: sql, encoding: "utf8" }).trim();
const fp = (u: string) => psql(`
select credits, xp from public.profiles where id = '${u}';
select count(*) from public.user_cards where user_id = '${u}';
select coalesce(md5(string_agg(pack_id || ':' || qty::text, ',' order by pack_id)), '') from public.user_packs where user_id = '${u}';
select coalesce(md5(string_agg(id::text || array_to_string(card_uids, ',') || updated_at::text, ';' order by id)), '') from public.duel_decks where user_id = '${u}';
select count(*) from public.duel_matches where user_id = '${u}';
select count(*), coalesce(sum(delta), 0) from public.credit_transactions where user_id = '${u}';
select coalesce((select md5(state::text) from public.user_pass where user_id = '${u}'), '');`);

const SIGNED_IN = `(() => !document.querySelector('input[type="password"]') && /cerrar sesión/i.test(document.body.innerText))()`;
const waitFor = async (tab: Tab, expr: string, ms = 20000) => { for (let i = 0; i < ms / 200; i++) { if (await tab.js<boolean>(expr).catch(() => false)) return true; await sleep(200); } return false; };

/** Heurísticas «web-like». No deciden solas: acompañan a la revisión visual. */
export const METRICS = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
  const interactive = [...document.querySelectorAll('a[href], button, [role="button"], summary')].filter(visible);
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\\s+/g, ' ');
  const play = interactive.filter((el) => /^(jugar|continuar partida|jugar ahora|jugar otra|volver a jugar|jugar ranked|jugar con este equipo)/i.test(label(el)));
  const playInView = play.filter(inView);
  const primaries = [...document.querySelectorAll('[data-cta="primary"], [data-game-cta]')].filter(visible).filter(inView);
  const spinners = [...document.querySelectorAll('.animate-spin')].filter(visible).length;
  const small = interactive.filter(inView).filter((el) => { const r = el.getBoundingClientRect(); return r.height < 32 && r.width < 200; }).length;
  const text = document.body.innerText;
  const technical = [...(text.match(/(Failed to fetch|Internal Server Error|Error 500|Something went wrong|TypeError|Unexpected token|PGRST\\d*|HTTP \\d{3})/gi) || []), ...(text.match(/\\b(undefined|null|NaN)\\b|\\bJSON\\b|supabase/g) || [])].slice(0, 5);
  const genericToast = (text.match(/\\b(Success|Updated successfully|Saved!?|Actualizado correctamente|Guardado correctamente)\\b/g) || []).length;
  const overflow = document.documentElement.scrollWidth > vw + 1;
  const clipped = [...document.querySelectorAll('button, a[href]')].filter(visible).filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).length;
  return {
    overflow, clipped, spinners, small, technical, genericToast,
    playCount: play.length, playInView: playInView.length, playLabel: playInView[0] ? label(playInView[0]).slice(0, 40) : null,
    primaries: primaries.length, marketplace: /mercado/i.test([...document.querySelectorAll('nav a')].map((a) => a.innerText).join(' ')),
    docHeight: document.documentElement.scrollHeight, tables: document.querySelectorAll('table').length,
    gameError: !!document.querySelector('[data-testid="game-error"]'), rateLimited: /Demasiadas solicitudes/i.test(text),
  };
})()`;

async function main() {
  const sizes = (arg("sizes") ?? "desktop,mobile").split(",") as Size[];
  const only = arg("only") ? new Set(arg("only")!.split(",")) : null;
  const groups = process.env.F44_GROUPS ? new Set(process.env.F44_GROUPS.split(",")) : null;
  const pick = (name: string, list: Target[]) => (!groups || groups.has(name) ? list : []);
  const extra = PHASE === "after" ? [...pick("f44", F44), ...pick("special", SPECIAL)] : [];
  const adhoc: Target[] = (arg("paths") ?? "").split(",").filter(Boolean).map((p, i) => ({ id: `peek${i}-${p.replace(/[^a-z0-9]+/gi, "_")}`, screen: p, path: p, real: true, settle: Number(process.env.F44_SETTLE ?? 4500) }));
  const targets = adhoc.length ? adhoc : [...pick("real", REAL), ...pick("moments", MOMENTS), ...extra].filter((t) => !only || only.has(t.id) || [...only].some((o) => t.id.startsWith(o)));
  const u = creds?.userId ?? "";
  const f0 = u ? fp(u) : "";
  log(`FASE 44 · capturas ${PHASE.toUpperCase()} · ${targets.length} pantallas × ${sizes.join("/")} · cuenta ${u.slice(0, 8) || "—"}`);
  const profile = CREDS ? join(CREDS, "..", `f44-chrome-profile`) : undefined;
  const b = await launch({ width: 1440, height: 900, userDataDir: profile });
  const tab = b.tab;
  const rows: Record<string, unknown>[] = [];
  try {
    if (creds) {
      await tab.goto(`${BASE}/cuenta`, 3500);
      if (!(await tab.js<boolean>(SIGNED_IN))) {
        const esc = (s: string) => JSON.stringify(s);
        await tab.js(`(() => { const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }; set(document.querySelector('input[type="email"]'), ${esc(creds.email)}); set(document.querySelector('input[type="password"]'), ${esc(creds.password)}); document.querySelector('form button[type="submit"]').click(); })()`);
      }
      log(`sesión QA: ${(await waitFor(tab, SIGNED_IN, 25000)) ? "OK" : "FALLO"}`);
    }
    let firstOwned = "";
    for (const size of sizes) {
      const reduced = process.env.F44_REDUCED === "1";
      const [w, h] = SIZES[size];
      await tab.resize(w, h);
      await tab.setMedia([{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }]);
      for (const t of targets) {
        let path = t.path;
        if (path.includes("__FIRST_OWNED__")) {
          if (!firstOwned) {
            await tab.goto(`${BASE}/coleccion`, 5000);
            firstOwned = await tab.js<string>(`(() => { const a = [...document.querySelectorAll('a[href*="/coleccion/carta/"]')][0]; return a ? a.getAttribute('href').split('/').pop().split('?')[0] : ''; })()`) || "kaajak__base";
          }
          path = path.replace("__FIRST_OWNED__", firstOwned);
        }
        tab.takeErrors();
        const t0 = Date.now();
        await tab.goto(`${BASE}${path}`, t.settle ?? 3500);
        if (t.scroll) { await tab.js(`document.querySelector('${t.scroll}')?.scrollIntoView({ block: "start" })`); await sleep(500); }
        const m = await tab.js<any>(METRICS).catch((e) => ({ error: String(e) }));
        const errors = tab.takeErrors().filter((e) => !/favicon|DevTools|Failed to load resource: .*404/i.test(e)).slice(0, 3);
        const file = `${t.id}-${size}${reduced ? "-reduced" : ""}.png`;
        await tab.shot(join(OUT, file));
        rows.push({ file, id: t.id, screen: t.screen, path, size, real: t.real, reduced, ms: Date.now() - t0, ...m, consoleErrors: errors });
        log(`  📸 ${file} · play ${m.playInView ?? "?"}/${m.playCount ?? "?"} · spin ${m.spinners ?? "?"} · small ${m.small ?? "?"} · ovf ${m.overflow ? "SÍ" : "no"}${m.technical?.length ? ` · técnico ${m.technical.join("|")}` : ""}${m.gameError ? " · ERROR DE CARGA" : ""}${m.rateLimited ? " · 429" : ""}${errors.length ? ` · consola ${errors.length}` : ""}`);
      }
    }
  } finally {
    await b.close();
  }
  const f1 = u ? fp(u) : "";
  const zeroWrites = f0 === f1;
  const L0 = f0.split("\n"), L1 = f1.split("\n");
  const FP = ["perfil créditos|xp", "cartas", "sobres", "equipos", "partidas", "transacciones", "pase (rotación de misiones)"];
  const changed = FP.filter((_, i) => L0[i] !== L1[i]);
  if (changed.length) log(`huella: cambió ${changed.join(", ")}`);
  writeFileSync(join(OUT, `shots${RUN}.json`), JSON.stringify({ phase: PHASE, run: process.env.F44_RUN ?? null, generatedAt: new Date().toISOString(), account: u.slice(0, 8), zeroWrites, changed, count: rows.length, rows }, null, 2) + "\n");
  log(`\n${rows.length} capturas · huella BD ${zeroWrites ? "idéntica (0 escrituras)" : "CAMBIÓ"}`);
}
void main();
