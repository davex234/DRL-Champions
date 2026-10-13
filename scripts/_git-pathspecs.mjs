// GIT · convierte la clasificación de `_git-proposal.mjs` en LISTAS DE RUTAS por commit (para `git add --pathspec-from-file`).
// Instrumento: solo lee ficheros y escribe listas en la carpeta de salida. NO ejecuta ningún comando que escriba en git.
//   node scripts/_git-pathspecs.mjs logs/i18n/final/git/proposal.json logs/i18n/final/git
import { readFileSync, writeFileSync, statSync } from "node:fs";
const [inFile, out] = process.argv.slice(2);
const b = JSON.parse(readFileSync(inFile, "utf8"));
const get = (re) => Object.entries(b).filter(([k]) => re.test(k)).flatMap(([, v]) => v);
/** Artefactos que no van a ningún commit: capturas de QA de las candidatas, copias, volcados, comprimidos. */
const ARTIFACT = /^docs\/product\/qa\/i18n-|\.(tgz|tar|tar\.gz|zip|dump|bak|log)$|(^|\/)backups?\//;
const SECRET = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|\bre_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|K00[0-9A-Za-z+/]{25,}/;
const sets = {
  "commit-0-base-produccion": [...get(/^0 · /), ...get(/^0b · /)],
  "commit-1-icon": get(/^1 · /),
  "commit-2-i18n": get(/^2 · /),
  "commit-3-qa": get(/^4 · /),
  "compartidos-icon-e-i18n": get(/^1\+2 · /),
  "aparte-f78": get(/^APARTE/),
  "sin-clasificar": get(/^otros|^borrados/),
};
const excluded = [...get(/^EXCLUIR/)];
const report = {};
for (const [name, list] of Object.entries(sets)) {
  const keep = [], secrets = [];
  let bytes = 0;
  for (const f of list.sort()) {
    if (ARTIFACT.test(f)) { excluded.push(f); continue; }
    const size = statSync(f).size; bytes += size;
    if (size < 3_000_000 && !/\.(png|jpe?g|webp|glb|bin|woff2?|ico|mp3|ogg|wav|mp4)$/i.test(f) && SECRET.test(readFileSync(f, "utf8"))) secrets.push(f);
    keep.push(f);
  }
  writeFileSync(`${out}/${name}.txt`, keep.join("\n") + (keep.length ? "\n" : ""));
  report[name] = { ficheros: keep.length, MB: +(bytes / 1048576).toFixed(1), posiblesSecretos: secrets };
}
writeFileSync(`${out}/EXCLUIDOS.txt`, excluded.sort().join("\n") + "\n");
report.EXCLUIDOS = { ficheros: excluded.length };
console.log(JSON.stringify(report, null, 1));
