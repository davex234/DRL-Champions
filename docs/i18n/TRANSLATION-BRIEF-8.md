# Translation brief — ES → FR / PT-PT / PT-BR / JA (2026-10-12)

Extends `docs/i18n/TRANSLATION-BRIEF.md` (read it first: it has the hard rules the build checks — placeholders,
ICU plurals, spaces, case, what must never be translated, numbers and odds). Everything there applies unchanged.
This file adds the four new target languages.

## What you receive / what you write

- Input chunk: `logs/i18n/work/<locale>/NNN.json` — JSON array of `{ "ns": "<module>", "es": "<Spanish text>" }`.
- Context (read-only): `logs/i18n/work-en/NNN.json` — JSON array of strings, same length and order: the reviewed
  **English** translation of each entry. Use it to disambiguate short fragments (`"de"`, `"Final"`, `"Entrar"`) and to see
  how a term was already localised. The Spanish text is still the source of truth for meaning; if English and Spanish
  disagree, follow the Spanish.
- Output: `logs/i18n/out/<locale>/NNN.json` — a JSON **array of strings**, same length, same order. Nothing else.
- `<locale>` is exactly one of `fr`, `pt-PT`, `pt-BR`, `ja`.
- After writing each file, verify it with the bundled checker (it validates length, placeholders and plural syntax):
  `npx tsx scripts/_i18n-check-chunk.ts <locale> NNN [NNN…]` → must print `OK`. Fix and re-run until it does.

## Plurals in these languages

Keep **exactly the plural keywords of the source** (`one`, `other`, `=0`…). Do not add or remove branches.
- **fr**: `one` is used for 0 and 1 (`0 carte`, `1 carte`, `2 cartes`). Write the `one` branch in the singular.
- **pt-PT / pt-BR**: `one` = singular, `other` = plural.
- **ja**: there is no grammatical plural. Keep both branches anyway and write the **same text** in each
  (`{n, plural, one {#枚のカード} other {#枚のカード}}`). Use counters naturally (枚 for cards, 個/パック for packs, 回, 人…).

## Voice

| | Register | Notes |
|---|---|---|
| **fr** | French (France), informal **tu**. Infinitive for buttons and menu actions ("Ouvrir le pack", "Récupérer"). | French typography: a space before `:` `;` `!` `?` **only when the source is a full sentence**; for a label ending in `:` keep it tight if the Spanish has no space and the UI concatenates a value — prefer `Label :` with a normal space. Use `« »` only where the Spanish uses `« »`. Keep gaming anglicisms French players use (pack, deck, match, round, ranked, coach, crafting, clutch). French runs long: pick the shortest idiomatic wording for buttons and tabs. |
| **pt-PT** | European Portuguese, informal **tu** (2nd person: "Abre", "Tens", "Reclama"). | European vocabulary and spelling: *equipa, ecrã, utilizador, palavra-passe, iniciar sessão, definições, guardar, telemóvel, ficheiro, partilhar, registo, a carregar…*. Gerund → `a + infinitivo` ("A carregar…"). Never Brazilian forms (*você, time, tela, senha, usuário, baixar, cadastro*). |
| **pt-BR** | Brazilian Portuguese, **você** (3rd person verbs: "Abra", "Você tem", "Resgate"). | Brazilian vocabulary and spelling: *time* (your lineup) / *equipe* (pro org), *tela, usuário, senha, entrar / sair, configurações, salvar, celular, arquivo, compartilhar, cadastro, carregando…*. Gerund is natural ("Carregando…"). Never European forms (*equipa, ecrã, utilizador, palavra-passe, definições*). |
| **ja** | Natural Japanese game UI. Polite **です/ます** in sentences and messages; **noun or dictionary-form** for buttons, tabs and labels (開封, 受け取る, キャンセル, 次へ). No pronouns for "you". | Katakana for established gaming loanwords (パック, カード, デッキ, ショップ, ランク, シーズン, ミッション, バトルパス, クラフト, コーチ, トーナメント, プロフィール). Full-width punctuation `、。「」` in sentences; keep `:` `·` `→` `%` and digits as in the source (half-width digits, `%` attached). No spaces between Japanese words; keep a space around Latin tokens only where it reads naturally. ALL-CAPS Spanish has no Japanese equivalent: just translate normally. Player nicknames, team names, agent/map names, product names (ICON, WALKOUT, OVR, XP, Pick'em, DRL Credits, Masters, Champions) stay in Latin script. Keep strings **short**: Japanese labels must fit buttons designed for Spanish. |

## Glossary (use these consistently)

| Español | Français | Português (PT) | Português (BR) | 日本語 |
|---|---|---|---|---|
| sobre / sobres (card pack) | pack / packs | pack / packs | pacote / pacotes | パック |
| Abrir sobre | Ouvrir le pack | Abrir pack | Abrir pacote | パックを開封 |
| carta / cartas | carte / cartes | carta / cartas | carta / cartas | カード |
| Colección / Mi colección | Collection / Ma collection | Coleção / A minha coleção | Coleção / Minha coleção | コレクション / マイコレクション |
| Colecciones (sets) | Collections | Coleções | Coleções | コレクションセット |
| Probabilidades | Probabilités | Probabilidades | Probabilidades | 排出率 |
| Continuar | Continuer | Continuar | Continuar | 続ける |
| Siguiente | Suivant | Seguinte | Próximo | 次へ |
| Omitir | Passer | Saltar | Pular | スキップ |
| Ajustes | Paramètres | Definições | Configurações | 設定 |
| Tienda | Boutique | Loja | Loja | ショップ |
| créditos | crédits | créditos | créditos | クレジット |
| equipo (your 5-card lineup) / Mis equipos | équipe / Mes équipes | equipa / As minhas equipas | time / Meus times | チーム / マイチーム |
| mazo | deck | baralho | deck | デッキ |
| duelo / Duelos | duel / Duels | duelo / Duelos | duelo / Duelos | デュエル |
| partida | match | partida | partida | マッチ |
| ronda / turno | round / tour | ronda / turno | rodada / turno | ラウンド / ターン |
| rival | adversaire | adversário | adversário | 対戦相手 |
| Jugar | Jouer | Jogar | Jogar | プレイ |
| Temporada | Saison | Temporada | Temporada | シーズン |
| Pase de batalla | Passe de combat | Passe de Batalha | Passe de Batalha | バトルパス |
| Misiones | Missions | Missões | Missões | ミッション |
| Objetivos | Objectifs | Objetivos | Objetivos | 目標 |
| Logros | Succès | Conquistas | Conquistas | 実績 |
| recompensa(s) | récompense(s) | recompensa(s) | recompensa(s) | 報酬 |
| Reclamar | Récupérer | Reclamar | Resgatar | 受け取る |
| Crafteo | Crafting | Crafting | Crafting | クラフト |
| Forja / forjar | Forge / forger | Forja / forjar | Forja / forjar | 鍛造 / 鍛造する |
| desguazar / desguace | recycler / recyclage | desmantelar / desmantelamento | desmontar / desmonte | 分解する / 分解 |
| receta | recette | receita | receita | レシピ |
| plano (forge blueprint) | plan | projeto | projeto | 設計図 |
| Clasificación | Classement | Classificação | Classificação | ランキング |
| Competitivo | Compétitif | Competitivo | Competitivo | ランクマッチ |
| rango | rang | patente | ranque | ランク |
| colocación (placement) | placement | colocação | classificatórias | 認定戦 |
| Torneos | Tournois | Torneios | Torneios | トーナメント |
| Eventos | Événements | Eventos | Eventos | イベント |
| cuadro (bracket) | tableau | quadro | chave | トーナメント表 |
| Entrenador | Coach | Treinador | Treinador | コーチ |
| Inventario | Inventaire | Inventário | Inventário | インベントリ |
| rareza | rareté | raridade | raridade | レアリティ |
| edición | édition | edição | edição | エディション |
| favorito(s) | favori(s) | favorito(s) | favorito(s) | お気に入り |
| repetida / duplicada (card) | doublon | repetida | repetida | 重複 |
| nueva (card) | nouvelle | nova | nova | NEW |
| Iniciar sesión / Cerrar sesión | Se connecter / Se déconnecter | Iniciar sessão / Terminar sessão | Entrar / Sair | ログイン / ログアウト |
| Crear cuenta / Registrarse | S'inscrire | Criar conta | Criar conta | アカウント作成 |
| Cuenta / Perfil | Compte / Profil | Conta / Perfil | Conta / Perfil | アカウント / プロフィール |
| Victoria / Derrota / Empate | Victoire / Défaite / Égalité | Vitória / Derrota / Empate | Vitória / Derrota / Empate | 勝利 / 敗北 / 引き分け |
| nivel | niveau | nível | nível | レベル |
| Sala de Trofeos | Salle des trophées | Sala de Troféus | Sala de Troféus | トロフィールーム |
| amigos / reto (friend challenge) | amis / défi | amigos / desafio | amigos / desafio | フレンド / 挑戦 |
| Cancelar / Confirmar / Reintentar | Annuler / Confirmer / Réessayer | Cancelar / Confirmar / Tentar de novo | Cancelar / Confirmar / Tentar novamente | キャンセル / 確認 / 再試行 |
| Cargando… | Chargement… | A carregar… | Carregando… | 読み込み中… |
| Guardar / Cerrar / Volver | Enregistrer / Fermer / Retour | Guardar / Fechar / Voltar | Salvar / Fechar / Voltar | 保存 / 閉じる / 戻る |
| Cinemática 3D / Automático / Reducidas | Cinématique 3D / Automatique / Réduites | Cinemática 3D / Automático / Reduzidas | Cinemática 3D / Automático / Reduzidas | 3Dシネマティック / 自動 / 簡易 |
| atacante / defensor | attaquant / défenseur | atacante / defensor | atacante / defensor | アタッカー / ディフェンダー |
| Duelista / Iniciador / Controlador / Centinela | Duelliste / Initiateur / Contrôleur / Sentinelle | Duelista / Iniciador / Controlador / Sentinela | Duelista / Iniciador / Controlador / Sentinela | デュエリスト / イニシエーター / コントローラー / センチネル |
| Bronce / Plata / Oro (card classes) | Bronze / Argent / Or | Bronze / Prata / Ouro | Bronze / Prata / Ouro | ブロンズ / シルバー / ゴールド |
| garantizada (guaranteed card) | garantie | garantida | garantida | 確定 |
| borrador / publicado / retirado (admin) | brouillon / publié / retiré | rascunho / publicado / retirado | rascunho / publicado / retirado | 下書き / 公開済み / 終了 |
| sanción / suspender (admin) | sanction / suspendre | sanção / suspender | sanção / suspender | 制裁 / 停止する |

Masters, Champions, Prime, ICON, Future Star, Record Breaker, Moments stay as they are in every language.

When a term is not in the glossary, pick the wording a native player would expect and **use it consistently** across
all your chunks. Admin-panel texts (`ns: "admin"`) may be more literal and technical; keep table names, ids, file paths,
SQL words and code tokens untouched.
