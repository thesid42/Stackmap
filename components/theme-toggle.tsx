"use client";

import { Moon, Sun } from "lucide-react";
import { useThemeContext } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme, mounted } = useThemeContext();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="glass-icon-btn"
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {!mounted ? (
        <Sun size={15} className="text-slate-500" />
      ) : theme === "dark" ? (
        <Sun size={15} className="text-amber-300" />
      ) : (
        <Moon size={15} className="text-slate-600" />
      )}
    </button>
  );
}
