import React from "react"; void React;
import { renderToStaticMarkup } from "react-dom/server";
import { getPack } from "@/data/packs";
import { packStats } from "@/data/packStats";
import { packOddsFor } from "@/domain/packs/odds";
import { PackOddsPanel } from "@/components/packs/PackOdds";
const h = renderToStaticMarkup(<PackOddsPanel odds={packOddsFor(getPack(process.argv[2] ?? "icon")!, packStats(process.argv[2] ?? "icon") ?? null, 0)} />);
console.log(h.slice(h.indexOf("data-icon-odds") - 20, h.indexOf("data-icon-odds") + 1400));
