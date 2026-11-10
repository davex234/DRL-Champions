/** F76 · qué personas QA tienen equipo legal y en qué estado está su cola (instrumento, fuera de CI). */
import { BASE, login, legalDeck, mm } from "./_f76-lib";
(async () => {
  for (const p of ["A", "B", "C", "D", "F", "G", "H", "I", "J"]) {
    try {
      const w = await login(p);
      const d = await legalDeck(w).catch((e) => `-(${e.message.slice(0, 30)})`);
      const s = (await mm(w)).json;
      console.log(p, w.userId.slice(0, 8), "deck:", String(d).slice(0, 8), "queue:", s?.code, s?.entry?.state ?? "-", BASE);
    } catch (e) { console.log(p, "ERR", (e as Error).message.slice(0, 60)); }
  }
})();
