// I18N · cierre final: traducciones puntuales escritas a mano (clave española → idioma) para los últimos defectos de QA.
// Instrumento: node scripts/_i18n-final-fixes.mjs   (después: npm run i18n:extract)
import { readFileSync, writeFileSync } from "node:fs";

const L = ["en", "de", "it", "fr", "pt-PT", "pt-BR", "ja"];
/** módulo → clave → [en, de, it, fr, pt-PT, pt-BR, ja] (null = no tocar ese idioma) */
const FIX = {
  admin: {
    "Turquía · Future Star 95 (WALKOUT) y hero": [
      "Turkey · Future Star 95 (WALKOUT) and hero", "Türkei · Future Star 95 (WALKOUT) und Hero", "Turchia · Future Star 95 (WALKOUT) e hero",
      "Turquie · Future Star 95 (WALKOUT) et hero", "Turquia · Future Star 95 (WALKOUT) e hero", "Turquia · Future Star 95 (WALKOUT) e hero", "トルコ · Future Star 95(WALKOUT)かつヒーロー"],
    "Japón · Future Star 87 (WALKOUT) que NO es la hero (Base 90)": [
      "Japan · Future Star 87 (WALKOUT) that is NOT the hero (Base 90)", "Japan · Future Star 87 (WALKOUT), NICHT die Hero (Base 90)", "Giappone · Future Star 87 (WALKOUT) che NON è la hero (Base 90)",
      "Japon · Future Star 87 (WALKOUT) qui n'est PAS la hero (Base 90)", "Japão · Future Star 87 (WALKOUT) que NÃO é a hero (Base 90)", "Japão · Future Star 87 (WALKOUT) que NÃO é a hero (Base 90)", "日本 · Future Star 87(WALKOUT)、ヒーローではない(Base 90)"],
    "Champions · 3 RARE con una repetida (TR ×2, KR)": [
      "Champions · 3 RARE with one duplicate (TR ×2, KR)", "Champions · 3 RARE, davon eine doppelt (TR ×2, KR)", "Champions · 3 RARE di cui una doppia (TR ×2, KR)",
      "Champions · 3 RARE dont un doublon (TR ×2, KR)", "Champions · 3 RARE com uma repetida (TR ×2, KR)", "Champions · 3 RARE com uma repetida (TR ×2, KR)", "Champions · RARE 3枚、うち重複あり(TR ×2, KR)"],
    "Champions · Filipinas MEGA (el caso reportado) → Turquía WALKOUT → Canadá WALKOUT (+2 RARE TR)": [
      "Champions · Philippines MEGA (the reported case) → Turkey WALKOUT → Canada WALKOUT (+2 RARE TR)", "Champions · Philippinen MEGA (der gemeldete Fall) → Türkei WALKOUT → Kanada WALKOUT (+2 RARE TR)", "Champions · Filippine MEGA (il caso segnalato) → Turchia WALKOUT → Canada WALKOUT (+2 RARE TR)",
      "Champions · Philippines MEGA (le cas signalé) → Turquie WALKOUT → Canada WALKOUT (+2 RARE TR)", "Champions · Filipinas MEGA (o caso reportado) → Turquia WALKOUT → Canadá WALKOUT (+2 RARE TR)", "Champions · Filipinas MEGA (o caso relatado) → Turquia WALKOUT → Canadá WALKOUT (+2 RARE TR)", "Champions · フィリピン MEGA(報告された事例)→ トルコ WALKOUT → カナダ WALKOUT(+2 RARE TR)"],
    "Sobre ICON · 1 carta: Filipinas MEGA": [
      "ICON Pack · 1 card: Philippines MEGA", "ICON-Pack · 1 Karte: Philippinen MEGA", "Pacchetto ICON · 1 carta: Filippine MEGA",
      "Pack ICON · 1 carte : Philippines MEGA", "Pacote ICON · 1 carta: Filipinas MEGA", "Pacote ICON · 1 carta: Filipinas MEGA", "ICONパック · 1枚:フィリピン MEGA"],
    "Sobre ICON Premium · 3 MEGA seguidos (PH, CZ, CA)": [
      "ICON Premium Pack · 3 MEGA in a row (PH, CZ, CA)", "ICON-Premium-Pack · 3 MEGA hintereinander (PH, CZ, CA)", "Pacchetto ICON Premium · 3 MEGA di fila (PH, CZ, CA)",
      "Pack ICON Premium · 3 MEGA à la suite (PH, CZ, CA)", "Pacote ICON Premium · 3 MEGA seguidos (PH, CZ, CA)", "Pacote ICON Premium · 3 MEGA seguidos (PH, CZ, CA)", "ICON Premiumパック · MEGA 3連続(PH, CZ, CA)"],
    "EE. UU. · Champions S 92 (RARE, hero) + Future Star 90 (WALKOUT)": [
      "USA · Champions S 92 (RARE, hero) + Future Star 90 (WALKOUT)", "USA · Champions S 92 (RARE, Hero) + Future Star 90 (WALKOUT)", "USA · Champions S 92 (RARE, hero) + Future Star 90 (WALKOUT)",
      "États-Unis · Champions S 92 (RARE, hero) + Future Star 90 (WALKOUT)", "EUA · Champions S 92 (RARE, hero) + Future Star 90 (WALKOUT)", "EUA · Champions S 92 (RARE, hero) + Future Star 90 (WALKOUT)", "アメリカ · Champions S 92(RARE、ヒーロー)+ Future Star 90(WALKOUT)"],
    "Corea · Future Star 95 (WALKOUT)": [
      "Korea · Future Star 95 (WALKOUT)", "Korea · Future Star 95 (WALKOUT)", "Corea · Future Star 95 (WALKOUT)",
      "Corée · Future Star 95 (WALKOUT)", "Coreia · Future Star 95 (WALKOUT)", "Coreia · Future Star 95 (WALKOUT)", "韓国 · Future Star 95(WALKOUT)"],
    "Champions · 5 especiales: 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)": [
      "Champions · 5 specials: 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)", "Champions · 5 Specials: 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)", "Champions · 5 speciali: 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)",
      "Champions · 5 spéciales : 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)", "Champions · 5 especiais: 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)", "Champions · 5 especiais: 1 MEGA (CZ) + 2 WALKOUT (KR, CA) + 2 RARE (KR)", "Champions · スペシャル5枚:MEGA 1(CZ)+ WALKOUT 2(KR, CA)+ RARE 2(KR)"],
    "Sin especiales: la apertura de siempre (control)": [
      "No specials: the usual opening (control)", "Keine Specials: die gewohnte Öffnung (Kontrolle)", "Nessuna speciale: l'apertura di sempre (controllo)",
      "Aucune spéciale : l'ouverture habituelle (contrôle)", "Sem especiais: a abertura de sempre (controlo)", "Sem especiais: a abertura de sempre (controle)", "スペシャルなし:通常の開封(コントロール)"],
  },
};
// correcciones adicionales por fichero JSON (se cargan si existen): logs/i18n/final/fix-*.json = { módulo: { clave: { idioma: texto } } }
import { readdirSync, existsSync } from "node:fs";
const extra = existsSync("logs/i18n/final") ? readdirSync("logs/i18n/final").filter((f) => /^fix-.*\.json$/.test(f)) : [];
const jobs = new Map(); // `${l}/${ns}` → { clave: texto }
const put = (l, ns, k, v) => { const id = `${l}/${ns}`; if (!jobs.has(id)) jobs.set(id, {}); jobs.get(id)[k] = v; };
for (const [ns, keys] of Object.entries(FIX)) for (const [k, arr] of Object.entries(keys)) arr.forEach((v, i) => { if (v != null) put(L[i], ns, k, v); });
for (const f of extra) for (const [ns, keys] of Object.entries(JSON.parse(readFileSync(`logs/i18n/final/${f}`, "utf8")))) for (const [k, by] of Object.entries(keys)) for (const [l, v] of Object.entries(by)) put(l, ns, k, v);

const vars = (s) => (s.match(/\{[A-Za-z_][A-Za-z0-9_]*/g) ?? []).sort().join();
let changed = 0, bad = 0;
for (const [id, keys] of jobs) {
  const [l, ns] = id.split("/"); const file = `src/i18n/messages/${l}/${ns}.json`;
  const es = JSON.parse(readFileSync(`src/i18n/messages/es/${ns}.json`, "utf8")); const cat = JSON.parse(readFileSync(file, "utf8"));
  for (const [k, v] of Object.entries(keys)) {
    if (!(k in es)) { bad++; console.log(`NO ES CLAVE ${id} «${k.slice(0, 70)}»`); continue; }
    if (!k.includes(", plural,") && vars(k) !== vars(v)) { bad++; console.log(`VARIABLES ${id} «${k.slice(0, 50)}» → «${v.slice(0, 50)}»`); continue; }
    if (cat[k] !== v) { cat[k] = v; changed++; }
  }
  const ordered = {}; for (const k of Object.keys(es)) if (k in cat) ordered[k] = cat[k];
  for (const k of Object.keys(cat)) if (!(k in ordered)) ordered[k] = cat[k];
  writeFileSync(file, JSON.stringify(ordered, null, 2) + "\n");
}
console.log(`${changed} entradas escritas · ${bad} rechazadas`);
