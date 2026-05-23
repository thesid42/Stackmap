"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

function applyThemeClass(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("stackmap-theme") as Theme | null;
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial: Theme = stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light";
    applyThemeClass(initial);
    setThemeState(initial);
    setMounted(true);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyThemeClass(next);
    localStorage.setItem("stackmap-theme", next);
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === "light" ? "dark" : "light";
      applyThemeClass(next);
      localStorage.setItem("stackmap-theme", next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggleTheme, mounted };
}
