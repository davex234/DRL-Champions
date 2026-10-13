"use client";

/**
 * TIENDA 4.0 · PESTAÑAS (Fase 49). Navegan a su sección (scroll suave; sin él con reduced-motion) y se
 * marcan solas según la sección visible. En móvil se desplazan en horizontal.
 */
import { useEffect, useState } from "react";
import { playSound } from "@/lib/sound";
import { css } from "./storeClasses";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("store");

export interface StoreTab { id: string; label: string; count?: number }

export function StoreTabs({ tabs }: { tabs: StoreTab[] }) {
  useLocale();
  const [active, setActive] = useState(tabs[0]?.id ?? "");

  useEffect(() => {
    const els = tabs.map((t) => document.getElementById(t.id)).filter((e): e is HTMLElement => !!e);
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id);
    }, { rootMargin: "-140px 0px -55% 0px", threshold: 0 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [tabs]);

  function go(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
    playSound("ui.confirm");
  }

  return (
    <nav aria-label={tr("Secciones de la tienda")} className={`${css.tabs} sticky top-topbar z-30 -mx-4 px-4 py-2.5 md:-mx-8 md:px-8`}>
      <ul className="flex gap-2 overflow-x-auto lg:justify-center" style={{ scrollbarWidth: "none" }}>
        {tabs.map((t) => (
          <li key={t.id} className="shrink-0">
            <button
              type="button"
              onClick={() => go(t.id)}
              aria-current={active === t.id ? "true" : undefined}
              className={`${css.tab} ${active === t.id ? css.tabActive : ""} nx-focus flex min-h-[44px] items-center gap-2 px-5 font-display text-label font-bold uppercase tracking-wide2 text-ink-secondary sm:min-w-[132px] sm:justify-center`}
            >
              {td(t.label)}
              {t.count !== undefined && <span className="tabular-nums text-label text-white/45">{t.count}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
