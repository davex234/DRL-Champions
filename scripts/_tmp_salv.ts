import { CARDS } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { marketValue } from "@/domain/economy/pricing";
import { MAIN_PACK_LINE, PACK_CLASS_ORDER, mainPackDistribution, packCardClass } from "@/domain/packs/packClass";
const cur = { estandar:384/1000, premium:771/2500 } ;
const r5 = (x:number, fl:number) => { const step = x < 100 ? 5 : x < 1000 ? 10 : 50; return Math.max(fl, Math.round(x/step)*step); };
for (const X of [0.04,0.05,0.06,0.08,0.10]) for (const FL of [5,10]) {
  const sv = (c:any) => r5(X*marketValue(c), FL);
  const byC:any = {}; for (const k of PACK_CLASS_ORDER) { const v = CARDS.filter(c=>packCardClass(c)===k).map(sv).sort((a,b)=>a-b); byC[k] = { med: v[Math.floor(v.length/2)], mean: +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(1), min:v[0], max:v[v.length-1] }; }
  const maxRatio = Math.max(...CARDS.map(c=>sv(c)/marketValue(c)));
  const packs = MAIN_PACK_LINE.map(id => { const t = mainPackDistribution(id)!, p = getPack(id)!; const ev = PACK_CLASS_ORDER.reduce((a,k)=>a+(t[k]/100)*byC[k].mean,0)*p.cardCount; return `${id}:${(ev/p.price*100).toFixed(1)}%`; });
  const medsOk = PACK_CLASS_ORDER.every((k,i)=> i===0 || byC[k].med > byC[PACK_CLASS_ORDER[i-1]].med);
  const meansOk = PACK_CLASS_ORDER.every((k,i)=> i===0 || byC[k].mean > byC[PACK_CLASS_ORDER[i-1]].mean);
  console.log(`X=${X} FL=${FL} maxSv/mv=${maxRatio.toFixed(3)} medsOk=${medsOk} meansOk=${meansOk} | ${packs.join(" ")}`);
  if (X===0.06 && FL===5) console.log(JSON.stringify(byC));
}
