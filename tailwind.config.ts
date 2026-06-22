import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Paleta DRL Champions — oscura, esports, neón
        base: {
          900: "#06070d",
          800: "#0b0d18",
          700: "#11131f",
          600: "#171a2b",
          500: "#1f2336",
        },
        drl: {
          // Acento principal (rojo/magenta esports)
          DEFAULT: "#ff2e63",
          glow: "#ff5c8a",
          cyan: "#19e3ff",
          gold: "#ffd35c",
        },
        // Colores por rareza
        rarity: {
          bronze: "#cd7f32",
          silver: "#c8d2dc",
          gold: "#ffce4f",
          prime: "#7b5cff",
          winner: "#19e3ff",
          mvp: "#ff2e63",
          mastersMvp: "#ff8a3d",
          championsMvp: "#ffd35c",
          icon: "#f5f0e6",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(255,46,99,0.45)",
        "glow-gold": "0 0 32px rgba(255,211,92,0.5)",
        card: "0 18px 50px -12px rgba(0,0,0,0.75)",
      },
      keyframes: {
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-glow": {
          "0%,100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        float: "float 4s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
