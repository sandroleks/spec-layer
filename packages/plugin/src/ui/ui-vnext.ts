/**
 * ui-vnext.ts — entry point for the new shell.
 *
 * The flag selects an entry point rather than branching inside ui.ts, so the
 * legacy UI and the new shell can never both run: the legacy module is not in
 * this bundle at all. Screens are wired in here as later plans land them.
 */

import { mountShell, wireShellTheme } from './shell/shell';

wireShellTheme(mountShell());
