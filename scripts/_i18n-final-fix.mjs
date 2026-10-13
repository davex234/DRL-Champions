/** I18N · cierre: correcciones manuales sobre frases nuevas (intención de los revisores que apuntaba a fragmentos ya retirados). */
import fs from "node:fs";
const DIR = "src/i18n/messages";
let n = 0;
function fix(l, mod, match, fn) {
  const f = `${DIR}/${l}/${mod}.json`;
  const raw = fs.readFileSync(f, "utf8"); const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  const j = JSON.parse(raw);
  const keys = Object.keys(j).filter((k) => (typeof match === "string" ? k === match : match.test(k)));
  if (!keys.length) throw new Error(`sin clave: ${l}/${mod} ${match}`);
  for (const k of keys) { const v = fn(j[k], k); if (v !== j[k]) { j[k] = v; n++; } }
  fs.writeFileSync(f, JSON.stringify(j, null, 2).split("\n").join(nl) + nl);
}
const sub = (a, b) => (v) => { if (!v.includes(a)) throw new Error(`no contiene «${a}»: ${v.slice(0, 80)}`); return v.split(a).join(b); };

// admin · huecos {unen} / {calculan}
fix("de", "admin", /^Cuando un sobre tiene \{varios\}/, sub("gilt für seine Karten: {unen}.", "werden seine Karten {unen}."));
fix("de", "admin", /^El sobre empezará a repartir estas cartas/, sub("gilt für beide: {unen}.", "werden beide {unen}."));
fix("de", "admin", /^El nivel, la XP y la maestría de cada jugador se \{calculan\}/, sub("Die Regeln dieses Dokuments {calculan} Level, XP und Meisterschaft jedes Spielers aus seinem echten Verlauf.", "Level, XP und Meisterschaft jedes Spielers werden mit den Regeln dieses Dokuments aus seinem echten Verlauf {calculan}."));
fix("en", "admin", "unen", () => "merged");
fix("en", "admin", "UNEN", () => "MERGED");
fix("en", "admin", /^Cuando un sobre tiene \{varios\}/, sub("its cards {unen}.", "its cards are {unen}."));
fix("en", "admin", /^El sobre empezará a repartir estas cartas/, sub("the two {unen}.", "the two are {unen}."));
// admin · asientos del libro, cruce, partido
fix("de", "admin", "asientos sin intercambio", () => "Buchungen ohne Rating-Austausch");
fix("it", "admin", "asientos sin intercambio", () => "registrazioni senza scambio di rating");
fix("de", "admin", /^Σ partidas de temporada/, sub("Plätze mit Saison", "Einträge mit Saison"));
fix("it", "admin", /^Σ partidas de temporada/, sub("posti con stagione", "registrazioni con stagione"));
fix("it", "admin", "{partidas} partidas puntuadas / {horas} h", sub("partite valutate", "partite con rating"));
fix("de", "admin", "{ronda} · cruce {n}", sub("Paarung", "Begegnung"));
fix("it", "admin", "{ronda} · cruce {n}", sub("incrocio", "incontro"));
fix("it", "admin", "{formato} · {partidos} partidos · {jugadores} jugadores", sub("partite", "match"));
fix("it", "admin", "{nombre} · {n} partidos · detectado: {formato}", sub("partite", "match"));
// juego
fix("en", "duel", /^Diez cartas: dos por rol \(Duelista/, sub("«Autofill team»", "“Autofill team”"));
fix("de", "duel", /^Solo jugadores reales: la cola ranked \{sinbots\}/, sub("Ranked-Warteschlange", "Ranked-Queue"));
fix("de", "competitive", /^Carril competitivo del pase · \{n\}/, sub("Kompetitiv-Spur", "Kompetitiv-Pfad"));
fix("de", "packs", "Te quedan {n} unidades de «{sobre}» sin abrir.", sub("«{sobre}»", "„{sobre}“"));
console.log("correcciones manuales", n);
