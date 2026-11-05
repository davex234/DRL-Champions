"use client";

/**
 * LAUNCHER — BARRA SUPERIOR.
 *
 * Marca, navegación principal, estado del servicio y usuario. Es también la zona de arrastre
 * de la ventana nativa (`nx-drag`): en el cliente de escritorio se toma de aquí para mover la
 * ventana, y los controles se marcan como `nx-no-drag` para que sigan siendo pulsables.
 *
 * El subrayado de la pestaña activa se desplaza con `layoutId`: una sola pieza que viaja, no
 * cinco subrayados que se encienden y apagan.
 */
import { motion } from "framer-motion";
import { BrandMark } from "@/branding/Logo";
import { PRESENCE_TONE, type LauncherUser } from "@/launcher";
import { cn } from "@/lib/format";
import type { LauncherView } from "@/store/useLauncherStore";
import { Badge, StatusDot } from "@/components/ui/Badge";
import { Avatar } from "./primitives";
import { ns, td, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("launcher");

const NAV: { id: LauncherView; label: string }[] = [
  { id: "home", label: "Inicio" },
  { id: "game", label: "Juegos" },
  { id: "news", label: "Novedades" },
  { id: "store", label: "Tienda" },
];

export function TopBar({
  view, onView, user, version, channelLabel, online, updateAvailable, onProfileToggle, profileOpen, children,
}: {
  view: LauncherView;
  onView: (v: LauncherView) => void;
  user: LauncherUser;
  version: string;
  channelLabel: string;
  online: boolean;
  updateAvailable: boolean;
  onProfileToggle: () => void;
  profileOpen: boolean;
  /** El menú de usuario se monta aquí para anclarse al avatar. */
  children?: React.ReactNode;
}) {
  useLocale();
  return (
    <header className="nx-drag relative z-chrome flex h-[58px] shrink-0 items-center gap-6 border-b border-white/[0.06] bg-black/40 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <BrandMark size={30} />
        <div className="leading-none">
          <p className="font-display text-[15px] font-black uppercase tracking-[0.14em] text-white">
            {t("NE")}<span className="text-drl">{t("XUS")}</span>
          </p>
          <p className="mt-[3px] font-display text-[8.5px] font-bold uppercase tracking-[0.3em] text-white/30">
            {t("Client")} {td(version)}
          </p>
        </div>
      </div>

      <nav className="nx-no-drag flex items-center gap-1">
        {NAV.map((item) => {
          const active = view === item.id || (item.id === "game" && view === "game");
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onView(item.id)}
              className={cn(
                "relative px-3.5 py-2 font-display text-[12px] font-bold uppercase tracking-[0.18em] transition-colors duration-fast",
                active ? "text-white" : "text-white/40 hover:text-white/80",
              )}
            >
              {tdIn("launcher", item.label)}
              {active && (
                <motion.span
                  layoutId="nav-underline"
                  className="absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full bg-drl"
                  style={{ boxShadow: "0 0 12px #ff2e63" }}
                  transition={{ type: "spring", stiffness: 480, damping: 38 }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="nx-no-drag ml-auto flex items-center gap-3">
        <span className="hidden items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-white/40 lg:flex">
          <StatusDot tone={online ? "ok" : "warn"} size={6} pulse={online} />
          {online ? t("Servicios operativos") : t("Sin conexión")}
          <span className="text-white/15">·</span>
          <span className="text-white/30">{td(channelLabel)}</span>
        </span>

        {updateAvailable && (
          <button
            type="button"
            onClick={() => onView("settings")}
            className="nx-focus transition hover:brightness-125"
          >
            <Badge tone="gold" dot pulse>{t("Cliente")}</Badge>
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={onProfileToggle}
            aria-expanded={profileOpen}
            aria-haspopup="menu"
            className={cn(
              "nx-clip-sm flex items-center gap-2.5 py-1 pl-1 pr-2.5 transition-colors",
              profileOpen ? "bg-white/10" : "hover:bg-white/[0.06]",
            )}
          >
            <Avatar name={user.name} color={user.color} size={32} />
            <span className="hidden text-left sm:block">
              <span className="block font-display text-[12px] font-bold uppercase tracking-wide text-white">{user.name}</span>
              <span className="flex items-center gap-1 text-[9.5px] uppercase tracking-wider text-white/35">
                <StatusDot tone={PRESENCE_TONE[user.presence]} size={5} />
                {t("Nivel")} {user.level}
              </span>
            </span>
            <span aria-hidden className={cn("text-[9px] text-white/40 transition-transform duration-fast", profileOpen && "rotate-180")}>
              ▼
            </span>
          </button>
          {children}
        </div>
      </div>
    </header>
  );
}
