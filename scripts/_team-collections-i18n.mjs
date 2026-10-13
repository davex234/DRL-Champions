/**
 * COLECCIONES POR EQUIPO · traducciones de los textos nuevos a los 7 idiomas y poda de los que ya no existen.
 *   node scripts/_team-collections-i18n.mjs          (después de `npm run i18n:extract`)
 *   npm run i18n:bundles                             (después, para regenerar los trozos)
 * Idempotente. Solo toca los módulos que cambian: añade las claves que faltan (nunca pisa una traducción que ya existe)
 * y quita las huérfanas (texto que el código ya no pinta), que es lo que exige `npm run i18n:audit`.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "src/i18n/messages";
const LOCALES = ["en", "de", "it", "fr", "pt-PT", "pt-BR", "ja"];
const load = (l, f) => { try { return JSON.parse(readFileSync(join(DIR, l, f), "utf8")); } catch { return {}; } };

/** módulo → texto → [en, de, it, fr, pt-PT, pt-BR, ja] */
const T = {
  trophies: {
    "Cartas de equipo": ["Team cards", "Team-Karten", "Carte di squadra", "Cartes d'équipe", "Cartas de equipa", "Cartas de time", "チームカード"],
    "Completa la colección de un equipo consiguiendo todas sus cartas: cada edición cuenta por separado y las repetidas no sustituyen a las que faltan. Completa todos los equipos de una región para desbloquear su insignia.": [
      "Complete a team's collection by getting all of its cards: every edition counts separately and duplicates don't stand in for missing ones. Complete every team in a region to unlock its badge.",
      "Vervollständige die Sammlung eines Teams, indem du alle seine Karten holst: Jede Edition zählt einzeln und Duplikate ersetzen keine fehlenden Karten. Vervollständige alle Teams einer Region, um ihr Abzeichen freizuschalten.",
      "Completa la collezione di una squadra ottenendo tutte le sue carte: ogni edizione conta separatamente e i doppioni non sostituiscono quelle mancanti. Completa tutte le squadre di una regione per sbloccarne il distintivo.",
      "Termine la collection d'une équipe en obtenant toutes ses cartes : chaque édition compte séparément et les doublons ne remplacent pas celles qui manquent. Termine toutes les équipes d'une région pour débloquer son badge.",
      "Completa a coleção de uma equipa conseguindo todas as suas cartas: cada edição conta em separado e as repetidas não substituem as que faltam. Completa todas as equipas de uma região para desbloquear o seu emblema.",
      "Complete a coleção de um time conseguindo todas as cartas dele: cada edição conta separadamente e as repetidas não substituem as que faltam. Complete todos os times de uma região para desbloquear o emblema dela.",
      "チームの全カードを集めるとそのコレクションが完成します。エディションごとに別のカードとして数え、重複カードは足りないカードの代わりになりません。地域の全チームを完成させると、その地域のバッジが解除されます。",
    ],
    "Consigue todas las cartas de todos los equipos de una región para desbloquear su insignia.": [
      "Get every card of every team in a region to unlock its badge.",
      "Hol dir alle Karten aller Teams einer Region, um ihr Abzeichen freizuschalten.",
      "Ottieni tutte le carte di tutte le squadre di una regione per sbloccarne il distintivo.",
      "Obtiens toutes les cartes de toutes les équipes d'une région pour débloquer son badge.",
      "Consegue todas as cartas de todas as equipas de uma região para desbloquear o seu emblema.",
      "Consiga todas as cartas de todos os times de uma região para desbloquear o emblema dela.",
      "地域の全チームの全カードを集めると、その地域のバッジが解除されます。",
    ],
    "Demasiadas peticiones: espera unos segundos.": { from: "collectionSets" },
    "Tu sesión ha caducado: vuelve a entrar.": { from: "collectionSets" },
    "{n} de {total}": { from: "collection" },
    "Desbloqueada": ["Unlocked", "Freigeschaltet", "Sbloccato", "Débloqué", "Desbloqueada", "Desbloqueada", "解除済み"],
    "Ese equipo no tiene colección.": ["That team has no collection.", "Dieses Team hat keine Sammlung.", "Quella squadra non ha una collezione.", "Cette équipe n'a pas de collection.", "Essa equipa não tem coleção.", "Esse time não tem coleção.", "そのチームにはコレクションがありません。"],
    "Hacen falta todas las cartas del equipo: cada edición de cada jugador cuenta por separado.": [
      "You need every card of the team: each edition of each player counts separately.",
      "Du brauchst alle Karten des Teams: Jede Edition jedes Spielers zählt einzeln.",
      "Servono tutte le carte della squadra: ogni edizione di ogni giocatore conta separatamente.",
      "Il faut toutes les cartes de l'équipe : chaque édition de chaque joueur compte séparément.",
      "São precisas todas as cartas da equipa: cada edição de cada jogador conta em separado.",
      "É preciso ter todas as cartas do time: cada edição de cada jogador conta separadamente.",
      "チームの全カードが必要です。各選手のエディションごとに別のカードとして数えます。",
    ],
    "Insignia de {region}: {estado}. {owned} de {total} cartas.": [
      "{region} badge: {estado}. {owned} of {total} cards.",
      "Abzeichen {region}: {estado}. {owned} von {total} Karten.",
      "Distintivo {region}: {estado}. {owned} di {total} carte.",
      "Badge {region} : {estado}. {owned} cartes sur {total}.",
      "Emblema de {region}: {estado}. {owned} de {total} cartas.",
      "Emblema de {region}: {estado}. {owned} de {total} cartas.",
      "{region}のバッジ: {estado}。カード {owned} / {total}。",
    ],
    "Insignias regionales": ["Regional badges", "Regionale Abzeichen", "Distintivi regionali", "Badges régionaux", "Emblemas regionais", "Emblemas regionais", "地域バッジ"],
    "Las colecciones no están disponibles ahora mismo.": ["Collections aren't available right now.", "Die Sammlungen sind gerade nicht verfügbar.", "Le collezioni non sono disponibili in questo momento.", "Les collections ne sont pas disponibles pour le moment.", "As coleções não estão disponíveis neste momento.", "As coleções não estão disponíveis no momento.", "コレクションは現在利用できません。"],
    "Ningún equipo coincide con el filtro.": ["No team matches the filter.", "Kein Team passt zum Filter.", "Nessuna squadra corrisponde al filtro.", "Aucune équipe ne correspond au filtre.", "Nenhuma equipa corresponde ao filtro.", "Nenhum time corresponde ao filtro.", "フィルターに一致するチームはありません。"],
    "No se pudieron cargar tus colecciones.": ["Couldn't load your collections.", "Deine Sammlungen konnten nicht geladen werden.", "Impossibile caricare le tue collezioni.", "Impossible de charger tes collections.", "Não foi possível carregar as tuas coleções.", "Não foi possível carregar suas coleções.", "コレクションを読み込めませんでした。"],
    "Todavía no hay equipos con cartas en el catálogo.": ["There are no teams with cards in the catalog yet.", "Im Katalog gibt es noch keine Teams mit Karten.", "Nel catalogo non ci sono ancora squadre con carte.", "Il n'y a pas encore d'équipes avec des cartes dans le catalogue.", "Ainda não há equipas com cartas no catálogo.", "Ainda não há times com cartas no catálogo.", "カタログにはまだカードのあるチームがありません。"],
    "Todavía no hay equipos de esta región en el catálogo.": ["There are no teams from this region in the catalog yet.", "Im Katalog gibt es noch keine Teams aus dieser Region.", "Nel catalogo non ci sono ancora squadre di questa regione.", "Il n'y a pas encore d'équipes de cette région dans le catalogue.", "Ainda não há equipas desta região no catálogo.", "Ainda não há times desta região no catálogo.", "カタログにはまだこの地域のチームがありません。"],
    "Ver más equipos": ["Show more teams", "Mehr Teams anzeigen", "Mostra altre squadre", "Voir plus d'équipes", "Ver mais equipas", "Ver mais times", "チームをもっと見る"],
    "{done}/{teams} equipos completos": ["{done}/{teams} teams complete", "{done}/{teams} Teams vollständig", "{done}/{teams} squadre complete", "{done}/{teams} équipes terminées", "{done}/{teams} equipas completas", "{done}/{teams} times completos", "完成チーム {done}/{teams}"],
    "{n, plural, one {# carta} other {# cartas}}": ["{n, plural, one {# card} other {# cards}}", "{n, plural, one {# Karte} other {# Karten}}", "{n, plural, one {# carta} other {# carte}}", "{n, plural, one {# carte} other {# cartes}}", "{n, plural, one {# carta} other {# cartas}}", "{n, plural, one {# carta} other {# cartas}}", "{n, plural, one {#枚} other {#枚}}"],
    "· ×{copies} copias": ["· ×{copies} copies", "· ×{copies} Exemplare", "· ×{copies} copie", "· ×{copies} exemplaires", "· ×{copies} cópias", "· ×{copies} cópias", "· ×{copies}枚"],
  },
  admin: {
    "Cartas publicadas sin equipo:": ["Published cards with no team:", "Veröffentlichte Karten ohne Team:", "Carte pubblicate senza squadra:", "Cartes publiées sans équipe :", "Cartas publicadas sem equipa:", "Cartas publicadas sem time:", "チームのない公開済みカード:"],
    "Colecciones de equipo": ["Team collections", "Team-Sammlungen", "Collezioni di squadra", "Collections d'équipe", "Coleções de equipa", "Coleções de time", "チームコレクション"],
    "Equipos con cartas pero sin región (no cuentan para ninguna insignia regional):": [
      "Teams with cards but no region (they count toward no regional badge):",
      "Teams mit Karten, aber ohne Region (zählen für kein regionales Abzeichen):",
      "Squadre con carte ma senza regione (non contano per nessun distintivo regionale):",
      "Équipes avec des cartes mais sans région (elles ne comptent pour aucun badge régional) :",
      "Equipas com cartas mas sem região (não contam para nenhum emblema regional):",
      "Times com cartas, mas sem região (não contam para nenhum emblema regional):",
      "カードはあるが地域のないチーム（どの地域バッジにも数えません）:",
    ],
    "Equipos del registro sin cartas (no aparecen en Colecciones):": [
      "Registry teams with no cards (not shown in Collections):",
      "Teams im Register ohne Karten (erscheinen nicht in Sammlungen):",
      "Squadre del registro senza carte (non compaiono in Collezioni):",
      "Équipes du registre sans cartes (absentes de Collections) :",
      "Equipas do registo sem cartas (não aparecem em Coleções):",
      "Times do registro sem cartas (não aparecem em Coleções):",
      "カードのない登録チーム（コレクションには表示されません）:",
    ],
    "Equipos sin logo (se pintan con su etiqueta):": [
      "Teams with no logo (shown with their tag):", "Teams ohne Logo (werden mit ihrem Kürzel dargestellt):", "Squadre senza logo (mostrate con la loro sigla):",
      "Équipes sans logo (affichées avec leur tag) :", "Equipas sem logótipo (aparecem com a sua etiqueta):", "Times sem logo (aparecem com a tag):", "ロゴのないチーム（タグで表示）:",
    ],
    "Lo que ve el jugador en Colección → Colecciones: una colección por equipo con cartas publicadas, y una insignia por región. Sale del catálogo publicado; no hay lista fija.": [
      "What the player sees in Collection → Collections: one collection per team with published cards, and one badge per region. It comes from the published catalog; there is no fixed list.",
      "Was der Spieler unter Sammlung → Sammlungen sieht: eine Sammlung pro Team mit veröffentlichten Karten und ein Abzeichen pro Region. Stammt aus dem veröffentlichten Katalog; es gibt keine feste Liste.",
      "Ciò che il giocatore vede in Collezione → Collezioni: una collezione per ogni squadra con carte pubblicate e un distintivo per regione. Deriva dal catalogo pubblicato; non c'è una lista fissa.",
      "Ce que le joueur voit dans Collection → Collections : une collection par équipe ayant des cartes publiées, et un badge par région. Cela vient du catalogue publié ; il n'y a pas de liste fixe.",
      "O que o jogador vê em Coleção → Coleções: uma coleção por equipa com cartas publicadas e um emblema por região. Vem do catálogo publicado; não há lista fixa.",
      "O que o jogador vê em Coleção → Coleções: uma coleção por time com cartas publicadas e um emblema por região. Vem do catálogo publicado; não há lista fixa.",
      "プレイヤーが「コレクション → コレクションセット」で見る内容: 公開済みカードのあるチームごとに1つのコレクション、地域ごとに1つのバッジ。公開済みカタログから生成され、固定リストはありません。",
    ],
    "Regiones sin equipos (su insignia no se puede conseguir):": [
      "Regions with no teams (their badge can't be earned):", "Regionen ohne Teams (ihr Abzeichen ist nicht erreichbar):", "Regioni senza squadre (il loro distintivo non si può ottenere):",
      "Régions sans équipes (leur badge ne peut pas être obtenu) :", "Regiões sem equipas (o seu emblema não pode ser conseguido):", "Regiões sem times (o emblema delas não pode ser conquistado):", "チームのない地域（バッジは獲得できません）:",
    ],
    "{teams} equipos · {cards} cartas": ["{teams} teams · {cards} cards", "{teams} Teams · {cards} Karten", "{teams} squadre · {cards} carte", "{teams} équipes · {cards} cartes", "{teams} equipas · {cards} cartas", "{teams} times · {cards} cartas", "{teams}チーム · {cards}枚"],
  },
  api: {
    "Inicia sesión para ver tus colecciones": ["Log in to see your collections", "Melde dich an, um deine Sammlungen zu sehen", "Accedi per vedere le tue collezioni", "Connecte-toi pour voir tes collections", "Inicia sessão para ver as tuas coleções", "Entre para ver suas coleções", "コレクションを見るにはログインしてください"],
    "No se pudieron leer tus colecciones": ["Couldn't read your collections", "Deine Sammlungen konnten nicht gelesen werden", "Impossibile leggere le tue collezioni", "Impossible de lire tes collections", "Não foi possível ler as tuas coleções", "Não foi possível ler suas coleções", "コレクションを読み込めませんでした"],
  },
  server: {
    "Ese equipo no tiene colección": ["That team has no collection", "Dieses Team hat keine Sammlung", "Quella squadra non ha una collezione", "Cette équipe n'a pas de collection", "Essa equipa não tem coleção", "Esse time não tem coleção", "そのチームにはコレクションがありません"],
  },
};

/** Cierre del cambio (0075): recompensa de XP, insignias permanentes, perfil y título «Colecciones». */
const T2 = {
  trophies: {
    "+{xp} XP de temporada.": ["+{xp} season XP.", "+{xp} Saison-XP.", "+{xp} XP stagione.", "+{xp} XP de saison.", "+{xp} XP de temporada.", "+{xp} XP de temporada.", "シーズンXP +{xp}。"],
    "Completa la colección de un equipo consiguiendo todas sus cartas: cada edición cuenta por separado y las repetidas no sustituyen a las que faltan. La primera vez que completas un equipo ganas {xp} XP de temporada. Completa todos los equipos de una región para desbloquear su insignia.": [
      "Complete a team's collection by getting all of its cards: every edition counts separately and duplicates don't stand in for missing ones. The first time you complete a team you earn {xp} season XP. Complete every team in a region to unlock its badge.",
      "Vervollständige die Sammlung eines Teams, indem du alle seine Karten holst: Jede Edition zählt einzeln und Duplikate ersetzen keine fehlenden Karten. Wenn du ein Team zum ersten Mal vervollständigst, erhältst du {xp} Saison-XP. Vervollständige alle Teams einer Region, um ihr Abzeichen freizuschalten.",
      "Completa la collezione di una squadra ottenendo tutte le sue carte: ogni edizione conta separatamente e i doppioni non sostituiscono quelle mancanti. La prima volta che completi una squadra ottieni {xp} XP stagione. Completa tutte le squadre di una regione per sbloccarne il distintivo.",
      "Termine la collection d'une équipe en obtenant toutes ses cartes : chaque édition compte séparément et les doublons ne remplacent pas celles qui manquent. La première fois que tu termines une équipe, tu gagnes {xp} XP de saison. Termine toutes les équipes d'une région pour débloquer son badge.",
      "Completa a coleção de uma equipa conseguindo todas as suas cartas: cada edição conta em separado e as repetidas não substituem as que faltam. Da primeira vez que completas uma equipa ganhas {xp} XP de temporada. Completa todas as equipas de uma região para desbloquear o seu emblema.",
      "Complete a coleção de um time conseguindo todas as cartas dele: cada edição conta separadamente e as repetidas não substituem as que faltam. Na primeira vez que você completa um time, ganha {xp} XP de temporada. Complete todos os times de uma região para desbloquear o emblema dela.",
      "チームの全カードを集めるとそのコレクションが完成します。エディションごとに別のカードとして数え、重複カードは足りないカードの代わりになりません。チームを初めて完成させるとシーズンXPを{xp}獲得できます。地域の全チームを完成させると、その地域のバッジが解除されます。",
    ],
    "Completada por primera vez el {fecha}.": ["First completed on {fecha}.", "Erstmals abgeschlossen am {fecha}.", "Completata per la prima volta il {fecha}.", "Terminée pour la première fois le {fecha}.", "Concluída pela primeira vez a {fecha}.", "Concluída pela primeira vez em {fecha}.", "初回完成日: {fecha}。"],
    "Complétala por primera vez y ganas {xp} XP de temporada.": ["Complete it for the first time to earn {xp} season XP.", "Vervollständige sie zum ersten Mal und erhalte {xp} Saison-XP.", "Completala per la prima volta e ottieni {xp} XP stagione.", "Termine-la pour la première fois et gagne {xp} XP de saison.", "Completa-a pela primeira vez e ganhas {xp} XP de temporada.", "Complete-a pela primeira vez e ganhe {xp} XP de temporada.", "初めて完成させるとシーズンXPを{xp}獲得できます。"],
    "Consigue todas las cartas de todos los equipos de una región para desbloquear su insignia. Una vez desbloqueada es tuya para siempre.": [
      "Get every card of every team in a region to unlock its badge. Once unlocked, it's yours forever.",
      "Hol dir alle Karten aller Teams einer Region, um ihr Abzeichen freizuschalten. Einmal freigeschaltet, gehört es dir für immer.",
      "Ottieni tutte le carte di tutte le squadre di una regione per sbloccarne il distintivo. Una volta sbloccato è tuo per sempre.",
      "Obtiens toutes les cartes de toutes les équipes d'une région pour débloquer son badge. Une fois débloqué, il est à toi pour toujours.",
      "Consegue todas as cartas de todas as equipas de uma região para desbloquear o seu emblema. Depois de desbloqueado, é teu para sempre.",
      "Consiga todas as cartas de todos os times de uma região para desbloquear o emblema dela. Depois de desbloqueado, ele é seu para sempre.",
      "地域の全チームの全カードを集めると、その地域のバッジが解除されます。一度解除したバッジはずっとあなたのものです。",
    ],
    "Destácalas en tu perfil desde {enlace}.": ["Feature them on your profile from {enlace}.", "Hebe sie in deinem Profil hervor über {enlace}.", "Mettili in evidenza sul tuo profilo da {enlace}.", "Mets-les en avant sur ton profil depuis {enlace}.", "Destaca-os no teu perfil em {enlace}.", "Destaque-os no seu perfil em {enlace}.", "{enlace}からプロフィールに表示できます。"],
    "Equipos": ["Teams", "Teams", "Squadre", "Équipes", "Equipas", "Times", "チーム"],
    "Sus {xp} XP se sumarán cuando haya una temporada activa.": ["Its {xp} XP will be added when a season is active.", "Die {xp} XP werden gutgeschrieben, sobald eine Saison aktiv ist.", "I suoi {xp} XP verranno aggiunti quando ci sarà una stagione attiva.", "Ses {xp} XP seront ajoutés dès qu'une saison sera active.", "Os seus {xp} XP serão somados quando houver uma temporada ativa.", "Os {xp} XP serão somados quando houver uma temporada ativa.", "{xp} XPはシーズン開始後に加算されます。"],
    "Tuya desde el {fecha}": ["Yours since {fecha}", "Deins seit {fecha}", "Tuo dal {fecha}", "À toi depuis le {fecha}", "Teu desde {fecha}", "Seu desde {fecha}", "{fecha}に獲得"],
    "editar perfil": ["edit profile", "Profil bearbeiten", "modifica profilo", "modifier le profil", "editar perfil", "editar perfil", "プロフィール編集"],
    "← Colecciones": ["← Collections", "← Sammlungen", "← Collezioni", "← Collections", "← Coleções", "← Coleções", "← コレクションセット"],
  },
  coleccion: {
    "+{xp} XP de temporada": ["+{xp} season XP", "+{xp} Saison-XP", "+{xp} XP stagione", "+{xp} XP de saison", "+{xp} XP de temporada", "+{xp} XP de temporada", "シーズンXP +{xp}"],
    "Cargando tus colecciones…": ["Loading your collections…", "Deine Sammlungen werden geladen…", "Caricamento delle tue collezioni…", "Chargement de tes collections…", "A carregar as tuas coleções…", "Carregando suas coleções…", "コレクションを読み込み中…"],
    "Insignia de {region} desbloqueada": ["{region} badge unlocked", "Abzeichen {region} freigeschaltet", "Distintivo {region} sbloccato", "Badge {region} débloqué", "Emblema de {region} desbloqueado", "Emblema de {region} desbloqueado", "{region}のバッジを解除"],
    "tus colecciones": ["your collections", "deine Sammlungen", "le tue collezioni", "tes collections", "as tuas coleções", "suas coleções", "コレクション"],
    "{equipo} completado": ["{equipo} completed", "{equipo} abgeschlossen", "{equipo} completata", "{equipo} terminée", "{equipo} concluída", "{equipo} concluído", "{equipo}を完成"],
    "{n} equipos completados": ["{n} teams completed", "{n} Teams abgeschlossen", "{n} squadre completate", "{n} équipes terminées", "{n} equipas concluídas", "{n} times concluídos", "{n}チームを完成"],
  },
  colecciones: {
    "Ir a Colecciones →": ["Go to Collections →", "Zu den Sammlungen →", "Vai a Collezioni →", "Aller aux Collections →", "Ir para Coleções →", "Ir para Coleções →", "コレクションセットへ →"],
    "Las colecciones de equipo y las insignias regionales están en Colecciones.": ["Team collections and regional badges are in Collections.", "Team-Sammlungen und regionale Abzeichen findest du unter Sammlungen.", "Le collezioni di squadra e i distintivi regionali sono in Collezioni.", "Les collections d'équipe et les badges régionaux sont dans Collections.", "As coleções de equipa e os emblemas regionais estão em Coleções.", "As coleções de time e os emblemas regionais estão em Coleções.", "チームコレクションと地域バッジは「コレクションセット」にあります。"],
  },
  collectionSets: {
    "Insignia regional": ["Regional badge", "Regionales Abzeichen", "Distintivo regionale", "Badge régional", "Emblema regional", "Emblema regional", "地域バッジ"],
  },
  cups: {
    "Puedes destacar tus trofeos de campeón en {perfil}.": ["You can feature your champion trophies on {perfil}.", "Du kannst deine Champion-Trophäen in {perfil} hervorheben.", "Puoi mettere in evidenza i tuoi trofei da campione sul {perfil}.", "Tu peux mettre en avant tes trophées de champion sur {perfil}.", "Podes destacar os teus troféus de campeão no {perfil}.", "Você pode destacar seus troféus de campeão no {perfil}.", "チャンピオントロフィーは{perfil}に表示できます。"],
    "Tu trofeo ya es tuyo: destácalo en {perfil}.": ["Your trophy is already yours: feature it on {perfil}.", "Deine Trophäe gehört dir schon: Hebe sie in {perfil} hervor.", "Il tuo trofeo è già tuo: mettilo in evidenza sul {perfil}.", "Ton trophée est déjà à toi : mets-le en avant sur {perfil}.", "O teu troféu já é teu: destaca-o no {perfil}.", "Seu troféu já é seu: destaque-o no {perfil}.", "トロフィーはすでにあなたのものです。{perfil}に表示しましょう。"],
    "tu perfil": ["your profile", "deinem Profil", "tuo profilo", "ton profil", "teu perfil", "seu perfil", "プロフィール"],
  },
  player: {
    "Aún no tienes insignias. Completa todos los equipos de una región en Colecciones.": ["You don't have any badges yet. Complete every team in a region in Collections.", "Du hast noch keine Abzeichen. Vervollständige unter Sammlungen alle Teams einer Region.", "Non hai ancora distintivi. Completa tutte le squadre di una regione in Collezioni.", "Tu n'as pas encore de badges. Termine toutes les équipes d'une région dans Collections.", "Ainda não tens emblemas. Completa todas as equipas de uma região em Coleções.", "Você ainda não tem emblemas. Complete todos os times de uma região em Coleções.", "まだバッジがありません。「コレクションセット」で地域の全チームを完成させましょう。"],
    "Colecciones": ["Collections", "Sammlungen", "Collezioni", "Collections", "Coleções", "Coleções", "コレクションセット"],
    "Insignias destacadas": ["Featured badges", "Hervorgehobene Abzeichen", "Distintivi in evidenza", "Badges mis en avant", "Emblemas em destaque", "Emblemas em destaque", "注目のバッジ"],
  },
  api: {
    "No se pudieron guardar tus recompensas de colección": ["Couldn't save your collection rewards", "Deine Sammlungsbelohnungen konnten nicht gespeichert werden", "Impossibile salvare le tue ricompense di collezione", "Impossible d'enregistrer tes récompenses de collection", "Não foi possível guardar as tuas recompensas de coleção", "Não foi possível salvar suas recompensas de coleção", "コレクション報酬を保存できませんでした"],
  },
  server: {
    "Las recompensas de colección aún no están disponibles": ["Collection rewards aren't available yet", "Sammlungsbelohnungen sind noch nicht verfügbar", "Le ricompense di collezione non sono ancora disponibili", "Les récompenses de collection ne sont pas encore disponibles", "As recompensas de coleção ainda não estão disponíveis", "As recompensas de coleção ainda não estão disponíveis", "コレクション報酬はまだ利用できません"],
  },
};
for (const [nsName, keys] of Object.entries(T2)) T[nsName] = { ...(T[nsName] ?? {}), ...keys };

let added = 0, pruned = 0, missing = [];
for (const [li, locale] of LOCALES.entries()) {
  // Las claves reutilizadas se leen ANTES de podar nada.
  const reuse = {};
  for (const [nsName, keys] of Object.entries(T)) for (const [k, v] of Object.entries(keys)) if (!Array.isArray(v)) reuse[`${nsName}|${k}`] = load(locale, `${v.from}.json`)[k];
  for (const f of readdirSync(join(DIR, "es"))) {
    const nsName = f.slice(0, -5);
    const es = load("es", f), cur = load(locale, f), out = {};
    let changed = false;
    for (const k of Object.keys(es)) {
      if (cur[k]) { out[k] = cur[k]; continue; }
      const t = T[nsName]?.[k];
      const v = Array.isArray(t) ? t[li] : t ? reuse[`${nsName}|${k}`] : undefined;
      if (v) { out[k] = v; added++; changed = true; } else missing.push(`${locale} ${nsName}: ${k}`);
    }
    for (const k of Object.keys(cur)) if (!(k in es)) { pruned++; changed = true; }
    if (changed) writeFileSync(join(DIR, locale, f), JSON.stringify(out, null, 2) + "\n", "utf8");
  }
}
console.log(`añadidas ${added} · podadas ${pruned} · sin traducción ${missing.length}`);
if (missing.length) { console.log(missing.slice(0, 20).join("\n")); process.exit(1); }
