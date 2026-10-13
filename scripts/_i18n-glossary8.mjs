// I18N · añade fr / pt-PT / pt-BR / ja al glosario obligatorio (src/i18n/glossary.json) y, con --apply, alinea los
// catálogos con él (solo las claves EXACTAS del glosario). Instrumento: node scripts/_i18n-glossary8.mjs [--apply]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const G = {
  "Abrir sobre": ["Ouvrir le pack", "Abrir pack", "Abrir pacote", "パックを開封"],
  "Mi colección": ["Ma collection", "A minha coleção", "Minha coleção", "マイコレクション"],
  "Colección": ["Collection", "Coleção", "Coleção", "コレクション"],
  "Probabilidades": ["Probabilités", "Probabilidades", "Probabilidades", "排出率"],
  "Continuar": ["Continuer", "Continuar", "Continuar", "続ける"],
  "Omitir": ["Passer", "Saltar", "Pular", "スキップ"],
  "Ajustes": ["Paramètres", "Definições", "Configurações", "設定"],
  "Tienda": ["Boutique", "Loja", "Loja", "ショップ"],
  "Jugar": ["Jouer", "Jogar", "Jogar", "プレイ"],
  "Temporada": ["Saison", "Temporada", "Temporada", "シーズン"],
  "Pase de batalla": ["Passe de combat", "Passe de Batalha", "Passe de Batalha", "バトルパス"],
  "Objetivos": ["Objectifs", "Objetivos", "Objetivos", "目標"],
  "Crafteo": ["Crafting", "Crafting", "Crafting", "クラフト"],
  "Clasificación": ["Classement", "Classificação", "Classificação", "ランキング"],
  "Competitivo": ["Compétitif", "Competitivo", "Competitivo", "ランクマッチ"],
  "Torneos": ["Tournois", "Torneios", "Torneios", "トーナメント"],
  "Eventos": ["Événements", "Eventos", "Eventos", "イベント"],
  "Entrenador": ["Coach", "Treinador", "Treinador", "コーチ"],
  "Inventario": ["Inventaire", "Inventário", "Inventário", "インベントリ"],
  "Duelos": ["Duels", "Duelos", "Duelos", "デュエル"],
  "Equipos": ["Équipes", "Equipas", "Times", "チーム"],
  "Mis equipos": ["Mes équipes", "As minhas equipas", "Meus times", "マイチーム"],
  "Mis cartas": ["Mes cartes", "As minhas cartas", "Minhas cartas", "マイカード"],
  "Reclamar": ["Récupérer", "Reclamar", "Resgatar", "受け取る"],
  "Cancelar": ["Annuler", "Cancelar", "Cancelar", "キャンセル"],
  "Confirmar": ["Confirmer", "Confirmar", "Confirmar", "確認"],
  "Reintentar": ["Réessayer", "Tentar de novo", "Tentar novamente", "再試行"],
  "Cerrar sesión": ["Se déconnecter", "Terminar sessão", "Sair", "ログアウト"],
  "Iniciar sesión": ["Se connecter", "Iniciar sessão", "Entrar", "ログイン"],
  "Victoria": ["Victoire", "Vitória", "Vitória", "勝利"],
  "Derrota": ["Défaite", "Derrota", "Derrota", "敗北"],
  "Empate": ["Égalité", "Empate", "Empate", "引き分け"],
  "Logros": ["Succès", "Conquistas", "Conquistas", "実績"],
  "Misiones": ["Missions", "Missões", "Missões", "ミッション"],
  "Recompensas": ["Récompenses", "Recompensas", "Recompensas", "報酬"],
  "Perfil": ["Profil", "Perfil", "Perfil", "プロフィール"],
  "Cuenta": ["Compte", "Conta", "Conta", "アカウント"],
  "Cinemática 3D": ["Cinématique 3D", "Cinemática 3D", "Cinemática 3D", "3Dシネマティック"],
  "Automático": ["Automatique", "Automático", "Automático", "自動"],
  "Reducidas": ["Réduites", "Reduzidas", "Reduzidas", "簡易"],
};
const LOCS = ["fr", "pt-PT", "pt-BR", "ja"];
const p = "src/i18n/glossary.json";
const g = JSON.parse(readFileSync(p, "utf8"));
const missing = Object.keys(g).filter((k) => !G[k]); if (missing.length) throw new Error("términos sin entrada: " + missing.join(", "));
for (const [k, v] of Object.entries(G)) LOCS.forEach((l, i) => { g[k][l] = v[i]; });
writeFileSync(p, JSON.stringify(g, null, 2) + "\n");
let diff = 0;
for (const [i, l] of LOCS.entries()) for (const f of readdirSync(`src/i18n/messages/${l}`)) {
  const file = `src/i18n/messages/${l}/${f}`; const tr = JSON.parse(readFileSync(file, "utf8")); let touched = false;
  for (const [k, v] of Object.entries(G)) if (k in tr && tr[k] !== v[i]) { diff++; console.log(`[${l}] ${f.replace(".json", "")}: «${k}» ${tr[k]} → ${v[i]}`); if (process.argv.includes("--apply")) { tr[k] = v[i]; touched = true; } }
  if (touched) writeFileSync(file, JSON.stringify(tr, null, 2) + "\n");
}
console.log(`${diff} diferencias con el glosario${process.argv.includes("--apply") ? " (alineadas)" : ""}`);
