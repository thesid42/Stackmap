import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        panel: "#f8fafc",
        line: "#d8dee8",
        accent: "#2563eb",
        mint: "#0f9f6e",
        amber: "#b45309",
        rose: "#be123c"
      }
    }
  },
  plugins: []
};

export default config;
