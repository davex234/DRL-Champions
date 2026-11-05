// F79.2 · material para el E2E: la cuenta QA compra y abre sobres ESTÁNDAR con SUS créditos QA (juego normal, sin admin)
// hasta tener `F792_WANT` copias libres de Base→Plata o quedarse sin créditos.
import { api, exchangeMaterial, g, login, sleep } from "./_f79-2-lib";
(async () => {
  const who = await login(process.env.F792_WHO ?? "C");
  const want = Number(process.env.F792_WANT ?? 35);
  for (let i = 0; i < 20; i++) {
    const m = (await exchangeMaterial(who)).find((x) => x.recipeId === "card-base-plata")!;
    const free = m.free.filter((f) => !f.protectedBy.length).length;
    if (free >= want) { console.log(`material OK: ${free} libres`); return; }
    const b = await api(who, "/api/game/packs", { action: "buy_and_open", packId: "estandar", ref: g("mat") });
    if (b.status !== 200) { console.log(`compra ${i + 1}: ${b.status} ${JSON.stringify(b.json).slice(0, 80)} · libres ${free}`); return; }
    console.log(`sobre ${i + 1} abierto · libres antes ${free}`);
    await sleep(300);
  }
})();
