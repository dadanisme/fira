import { Monitor, Moon, Sun } from 'lucide-react';
import { IconButton } from '../components/IconButton';
import { setThemePreference, useThemePreference, type ThemePreference } from '../lib/theme';

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: Monitor, light: Sun, dark: Moon };

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const preference = useThemePreference();
  const Icon = ICON[preference];
  return (
    <IconButton label={`Theme: ${preference}`} onClick={() => setThemePreference(NEXT[preference])}>
      <Icon size="0.9375rem" />
    </IconButton>
  );
}
