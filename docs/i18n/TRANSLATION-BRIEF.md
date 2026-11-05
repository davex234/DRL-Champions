# Translation brief — ES → EN / DE / IT

You are localising a **video game**: a Valorant-esports collectible card game played in the browser
(open packs of pro-player cards, build a 5-card team, play turn-based card duels vs AI or other players,
ranked ladder, seasons/battle pass, missions, crafting, tournaments, Pick'ems on real esports matches,
a tactical "Coach" mode, plus an admin panel). The source language is **Spanish (Spain)**.

The result must read as if it had been **written originally in the target language by a game studio** —
not as a literal translation. Short, confident UI copy. Players are 16–35, used to FIFA Ultimate Team,
Valorant, Hearthstone, Marvel Snap.

## What you receive / what you write

- Input chunk: `logs/i18n/work/<locale>/NNN.json` — a JSON array of `{ "ns": "<module>", "es": "<Spanish text>" }`.
  `ns` is only context (the game module the text lives in: `packs`, `duel`, `store`, `admin`, `server` = API error messages…).
- Output: `logs/i18n/out/<locale>/NNN.json` — a JSON **array of strings**, **same length, same order**:
  element *i* is the translation of input element *i*. Nothing else in the file. Valid JSON (escape `"` and `\`).
- Never skip, merge, split or reorder entries. If a text must stay identical (a brand, a symbol), repeat it unchanged.
- After writing each file, verify it: `node -e "const a=require('./logs/i18n/work/<locale>/NNN.json'),b=require('./logs/i18n/out/<locale>/NNN.json');console.log(a.length,b.length,Array.isArray(b)&&b.every(x=>typeof x==='string'&&x.length>0))"` → the two numbers must match and the last value be `true`.

## Hard rules (the build checks these)

1. **Placeholders** `{name}` are variables. Keep every placeholder, with the **exact same name**, exactly once per
   occurrence in the source (you may move it to where the target grammar needs it). Never translate the name inside braces.
2. **Plurals** use ICU syntax: `{n, plural, one {# carta} other {# cartas}}`. Keep `{n, plural, …}`, the keywords
   (`one`, `other`, `=0`…) and `#` (the number); translate only the text inside the inner braces. Always keep an `other` branch.
3. **Leading/trailing spaces** are significant: if the Spanish text starts or ends with a space, so must yours.
   Keep trailing punctuation style (`:` stays `:`, `…` stays `…`), and keep symbols/emojis/arrows (`·`, `→`, `★`, `✓`, `×`) where they are.
4. **Case**: if the Spanish is ALL CAPS, the translation is ALL CAPS. If it is lowercase mid-sentence fragment, keep it lowercase
   (German nouns still capitalised). Many strings are **fragments** that the UI concatenates with numbers or other
   fragments (e.g. `"de"`, `"cartas"`, `"Te faltan"`, `"para reclamar"`): translate them as the natural fragment.
5. **Do not translate**: player nicknames, team names, agent names (Jett, Sage, Omen…), map names (Ascent, Bind…),
   tournament names (Champions, Masters, VCT, EWC…), brands and product terms: **DRL Credits, DRL Champions, NEXUS, Valorosters,
   ICON, WALKOUT, Pick'em / Pick'ems, OVR, XP, MVP, ACE, clutch, eco, Flex, PvP, PvE, ELO/rating, Top 500, Road to Champions,
   Draft Gauntlet, Hall of Fame, Battle Pass tier names**. Card class names are proper names of products:
   Bronce → Bronze (en/de) / Bronzo (it); Plata → Silver / Silber / Argento; Oro → Gold / Gold / Oro; Masters, Champions and ICON stay.
   Code-looking tokens, ids, URLs, file names and technical words inside admin texts stay as they are.
6. **Numbers, percentages, prices, odds and conditions must keep their exact meaning.** Never round, reorder or
   soften a probability or a purchase condition. `%` stays attached to its number as in the source.
7. No added explanations, no quotes around the output, no trailing dots that the source does not have.

## Voice

| | Register | Notes |
|---|---|---|
| **en** | International English, US spelling (color, favorite). Imperative UI verbs ("Open pack", "Claim"). | Sentence case like the source; no "please". |
| **de** | Natural German, informal **du**. Prefer short UI forms; infinitive for buttons ("Pack öffnen", "Abholen"). | German runs long: choose the **shortest idiomatic** wording for buttons, tabs, labels (≤ ~1.3× the Spanish length when possible). Keep common gaming anglicisms (Pack, Deck, Shop, Match, Team, Level, Ranked, Coach, Crafting). |
| **it** | Natural Italian, informal **tu**. Imperative 2nd person for buttons ("Apri pacchetto", "Riscatta"). | Keep common gaming anglicisms where Italian players use them (deck, match, round, ranking is "classifica"). |

## Glossary (use these consistently)

| Español | English | Deutsch | Italiano |
|---|---|---|---|
| sobre / sobres (card pack) | pack / packs | Pack / Packs | pacchetto / pacchetti |
| Abrir sobre | Open pack | Pack öffnen | Apri pacchetto |
| carta / cartas | card / cards | Karte / Karten | carta / carte |
| Colección / Mi colección | Collection / My collection | Sammlung / Meine Sammlung | Collezione / La mia collezione |
| Colecciones (sets to complete) | Collections | Sammlungen | Collezioni |
| Probabilidades | Probabilities | Wahrscheinlichkeiten | Probabilità |
| Continuar | Continue | Weiter | Continua |
| Siguiente | Next | Nächste | Avanti |
| Omitir | Skip | Überspringen | Salta |
| Ajustes | Settings | Einstellungen | Impostazioni |
| Tienda | Shop | Shop | Negozio |
| créditos | credits | Credits | crediti |
| equipo (your 5-card lineup) / Mis equipos | team / My teams | Team / Meine Teams | squadra / Le mie squadre |
| mazo | deck | Deck | mazzo |
| duelo / Duelos | duel / Duels | Duell / Duelle | duello / Duelli |
| partida | match | Match | partita |
| ronda / turno | round / turn | Runde / Zug | round / turno |
| rival | opponent | Gegner | avversario |
| Jugar | Play | Spielen | Gioca |
| Temporada | Season | Saison | Stagione |
| Pase de batalla | Battle Pass | Battle Pass | Pass Battaglia |
| Misiones | Missions | Missionen | Missioni |
| Objetivos | Objectives | Ziele | Obiettivi |
| Logros | Achievements | Erfolge | Traguardi |
| recompensa(s) | reward(s) | Belohnung(en) | ricompensa / ricompense |
| Reclamar | Claim | Abholen | Riscatta |
| Crafteo | Crafting | Crafting | Crafting |
| Forja / forjar | Forge / forge | Schmiede / schmieden | Forgia / forgiare |
| desguazar / desguace | salvage | zerlegen / Zerlegung | smantellare / smantellamento |
| receta | recipe | Rezept | ricetta |
| plano (forge blueprint) | blueprint | Bauplan | progetto |
| Clasificación | Leaderboard | Rangliste | Classifica |
| Competitivo | Competitive | Kompetitiv | Competitivo |
| rango | rank | Rang | grado |
| colocación (placement matches) | placement | Platzierung | piazzamento |
| Torneos | Tournaments | Turniere | Tornei |
| Eventos | Events | Events | Eventi |
| cuadro (bracket) | bracket | Turnierbaum | tabellone |
| Entrenador | Coach | Coach | Allenatore |
| Inventario | Inventory | Inventar | Inventario |
| rareza | rarity | Seltenheit | rarità |
| edición | edition | Edition | edizione |
| favorito(s) | favorite(s) | Favorit(en) | preferito / preferiti |
| repetida / duplicada (card) | duplicate | Duplikat | doppione |
| nueva (card) | new | neu | nuova |
| Iniciar sesión / Cerrar sesión | Log in / Log out | Anmelden / Abmelden | Accedi / Esci |
| Crear cuenta / Registrarse | Sign up | Registrieren | Registrati |
| Cuenta / Perfil | Account / Profile | Konto / Profil | Account / Profilo |
| Victoria / Derrota / Empate | Victory / Defeat / Draw | Sieg / Niederlage / Unentschieden | Vittoria / Sconfitta / Pareggio |
| nivel | level | Level | livello |
| Sala de Trofeos | Trophy Room | Trophäenraum | Sala dei trofei |
| amigos / reto (friend challenge) | friends / challenge | Freunde / Herausforderung | amici / sfida |
| Cancelar / Confirmar / Reintentar | Cancel / Confirm / Retry | Abbrechen / Bestätigen / Erneut versuchen | Annulla / Conferma / Riprova |
| Cargando… | Loading… | Lädt… | Caricamento… |
| Guardar / Cerrar / Volver | Save / Close / Back | Speichern / Schließen / Zurück | Salva / Chiudi / Indietro |
| Cinemática 3D / Automático / Reducidas | 3D cinematic / Automatic / Reduced | 3D-Sequenz / Automatisch / Reduziert | Cinematica 3D / Automatico / Ridotte |
| atacante / defensor | attacker / defender | Angreifer / Verteidiger | attaccante / difensore |
| Duelista / Iniciador / Controlador / Centinela | Duelist / Initiator / Controller / Sentinel | Duellant / Initiator / Taktiker / Wächter | Duellante / Iniziatore / Stratega / Sentinella |
| borrador / publicado / retirado (admin lifecycle) | draft / published / retired | Entwurf / veröffentlicht / zurückgezogen | bozza / pubblicato / ritirato |
| sanción / suspender (admin) | sanction / suspend | Sanktion / sperren | sanzione / sospendere |

When a term is not in the glossary, pick the wording a native player would expect and **use it consistently**
across all your chunks.
