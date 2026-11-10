/**
 * I18N · REPARTO Y FUSIÓN DEL TRABAJO DE TRADUCCIÓN.
 *
 *   npx tsx scripts/i18n/translate-work.ts split [tamaño]   textos SIN traducir (únicos) → logs/i18n/work/<idioma>/NNN.json
 *   npx tsx scripts/i18n/translate-work.ts merge            logs/i18n/out/<idioma>/NNN.json → src/i18n/messages/<idioma>/<módulo>.json
 *
 * El trabajo viaja por ÍNDICE (lista de textos → lista de traducciones del mismo largo): quien traduce no reescribe
 * la clave española, así que un despiste al copiarla no puede descolocar nada. `merge` rechaza un trozo cuyo largo no
 * coincida y conserva lo ya traducido.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGES_DIR, ROOT, TARGET_LOCALES } from "./core";

const WORK = join(ROOT, "logs", "i18n", "work");
const OUT = join(ROOT, "logs", "i18n", "out");
const readJson = <T>(p: string, fallback: T): T => { try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return fallback; } };
const esDir = join(MESSAGES_DIR, "es");
const namespaces = readdirSync(esDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
const sortObj = (o: Record<string, string>) => Object.fromEntries(Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((k) => [k, o[k]]));

const mode = process.argv[2];
if (mode === "split") {
  const size = Number(process.argv[3] ?? 200);
  for (const locale of TARGET_LOCALES) {
    const known = new Map<string, string>(); // traducciones existentes en cualquier módulo: se reutilizan
    for (const n of namespaces) for (const [k, v] of Object.entries(readJson<Record<string, string>>(join(MESSAGES_DIR, locale, `${n}.json`), {}))) if (v?.trim() && !known.has(k)) known.set(k, v);
    const todo: { ns: string; es: string }[] = [];
    const seen = new Set<string>();
    for (const n of namespaces) for (const k of Object.keys(readJson<Record<string, string>>(join(esDir, `${n}.json`), {}))) {
      if (known.has(k) || seen.has(k)) continue;
      seen.add(k); todo.push({ ns: n, es: k });
    }
    const dir = join(WORK, locale);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(OUT, locale), { recursive: true });
    let n = 0;
    for (let i = 0; i < todo.length; i += size) writeFileSync(join(dir, `${String(++n).padStart(3, "0")}.json`), JSON.stringify(todo.slice(i, i + size), null, 1), "utf8");
    console.log(`${locale}: ${todo.length} textos pendientes en ${n} trozos`);
  }
} else if (mode === "merge") {
  for (const locale of TARGET_LOCALES) {
    const tr = new Map<string, string>();
    for (const n of namespaces) for (const [k, v] of Object.entries(readJson<Record<string, string>>(join(MESSAGES_DIR, locale, `${n}.json`), {}))) if (v?.trim() && !tr.has(k)) tr.set(k, v);
    let bad = 0, merged = 0;
    const dir = join(WORK, locale);
    for (const f of existsSync(dir) ? readdirSync(dir).sort() : []) {
      const work = readJson<{ ns: string; es: string }[]>(join(dir, f), []);
      const outFile = join(OUT, locale, f);
      if (!existsSync(outFile)) continue;
      const out = readJson<unknown>(outFile, null);
      if (!Array.isArray(out) || out.length !== work.length) { console.log(`  [${locale}] ${f}: RECHAZADO (largo ${Array.isArray(out) ? out.length : "?"} ≠ ${work.length})`); bad++; continue; }
      work.forEach((w, i) => { const v = out[i]; if (typeof v === "string" && v.trim()) { tr.set(w.es, v); merged++; } });
    }
    mkdirSync(join(MESSAGES_DIR, locale), { recursive: true });
    for (const n of namespaces) {
      const keys = Object.keys(readJson<Record<string, string>>(join(esDir, `${n}.json`), {}));
      // lo ya traducido EN ESTE MÓDULO manda (una palabra puede tener otro sentido aquí: «Entrar», «Final»);
      // solo lo que falta se toma de otro módulo o del trabajo recién entregado.
      const own = readJson<Record<string, string>>(join(MESSAGES_DIR, locale, `${n}.json`), {});
      const obj: Record<string, string> = {};
      for (const k of keys) { const v = own[k]?.trim() ? own[k] : tr.get(k); if (v) obj[k] = v; }
      writeFileSync(join(MESSAGES_DIR, locale, `${n}.json`), JSON.stringify(sortObj(obj), null, 2) + "\n", "utf8");
    }
    for (const f of readdirSync(join(MESSAGES_DIR, locale))) if (f.endsWith(".json") && !namespaces.includes(f.slice(0, -5))) rmSync(join(MESSAGES_DIR, locale, f));
    console.log(`${locale}: ${merged} traducciones fusionadas · ${bad} trozos rechazados`);
  }
} else {
  console.log("uso: translate-work.ts split [tamaño] | merge");
}
