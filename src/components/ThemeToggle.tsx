"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { Theme, useTheme } from "./ThemeProvider";

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

/**
 * Theme control in two shapes:
 *  - default: a segmented light / dark / system picker for settings panels.
 *  - compact: a single button that cycles, for the narrow app rail where a
 *    three-up segment would not fit.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();

  if (compact) {
    const index = OPTIONS.findIndex((o) => o.value === theme);
    const current = OPTIONS[index === -1 ? 2 : index];
    const next = OPTIONS[(index === -1 ? 2 : index + 1) % OPTIONS.length];
    const { Icon } = current;

    return (
      <button
        onClick={() => setTheme(next.value)}
        title={`Theme: ${current.label} — switch to ${next.label}`}
        aria-label={`Theme: ${current.label}. Switch to ${next.label}.`}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
      >
        <Icon className="h-[17px] w-[17px]" strokeWidth={2} />
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={[
              "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5",
              "text-xs font-medium transition-colors",
              active
                ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
