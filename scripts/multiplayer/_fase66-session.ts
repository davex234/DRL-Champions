/** F66 · sesión: dos dispositivos, logout a mitad, relogin. Solo QA (C). No abre partidas: usa la cola y el PvE. */
import { writeFileSync } from "node:fs";
import { api, login } from "./_qa";
/* eslint-disable @typescript-eslint/no-explicit-any */
const env = Object.fromEntries(require("node:fs").readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l: string) => /^[A-Z_]+=/.test(l)).map((l: string) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
(async () => {
  const dev1 = await login("C"), dev2 = await login("C");
  const before = { dev1: (await api(dev1, "/api/game/duel", { action: "active" })).status, dev2: (await api(dev2, "/api/game/duel", { action: "active" })).status };
  // Logout del dispositivo 2 (revoca SU sesión en GoTrue).
  const out = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${dev2.token}` } });
  const after = { dev1: (await api(dev1, "/api/game/duel", { action: "active" })).status, dev2: (await api(dev2, "/api/game/duel", { action: "active" })).status, dev2Pvp: (await api(dev2, "/api/game/duel/pvp", { action: "abandon", matchId: "00000000-0000-4000-8000-000000000000" })).status };
  const relog = await login("C");
  const res = { twoDevices: before, logoutStatus: out.status, afterLogout: after, relogin: (await api(relog, "/api/game/duel", { action: "active" })).status,
    note: "getSession valida el Bearer contra GoTrue: un token de una sesión cerrada responde 401; el otro dispositivo sigue; volver a entrar recupera la partida (el estado está en el servidor)." };
  writeFileSync("docs/product/qa/fase66-multiplayer/session.json", JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res));
})();
