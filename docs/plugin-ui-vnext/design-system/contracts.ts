/**
 * Presentation contracts for the plugin UI redesign.
 *
 * These types do not replace the current plugin state or message protocol.
 * They define the exhaustive visual states that render.ts should map from
 * existing domain state.
 */

export type PluginView =
  | "component"
  | "foundations"
  | "library"
  | "settings"
  | "license";

export type ThemeMode = "light" | "dark";

export type AllowanceState =
  | { kind: "loading" }
  | { kind: "free"; remaining: number; limit: number; resetsAt: string }
  | { kind: "pro" }
  | { kind: "unknown"; message: string };

export type ComponentScreenState =
  | { kind: "empty" }
  | { kind: "reading"; componentName: string }
  | { kind: "ready"; componentName: string }
  | { kind: "building"; componentName: string; action: "create" | "download"; phase?: string }
  | {
      kind: "success";
      componentName: string;
      replaced: boolean;
      message?: string;
      warning?: boolean;
    }
  | { kind: "error"; componentName: string; message: string };

export type LibraryStatus =
  | "checking"
  | "inSync"
  | "updateAvailable"
  | "edited"
  | "orphaned";

export interface ChangeGroup {
  label: string;
  items: string[];
}

export interface LibraryRowView {
  docId: string;
  label: string;
  sourceLabel: string;
  ageLabel: string;
  status: LibraryStatus;
  expanded: boolean;
  canOpenFrame: boolean;
  canOpenSource: boolean;
  canDownload: boolean;
  canReconnect: boolean;
  canUpdate: boolean;
  canDetach: boolean;
  canRemove: boolean;
  /**
   * null means content-hash drift is known, but a reliable detailed comparison
   * is unavailable. Render the honest fallback instead of inventing changes.
   */
  changeGroups: ChangeGroup[] | null;
}

export type FoundationScreenState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "generating"; done: number; total: number }
  | { kind: "result"; created: number; replaced: number; error?: string };

export type LicenseState =
  | "free"
  | "checking"
  | "pro"
  | "expired"
  | "inactive"
  | "unknown"
  | "invalid"
  | "disabled"
  | "device-limit"
  | "unreachable"
  | "removing"
  | "removed";

export interface NavigationItem {
  id: PluginView;
  label: string;
  group: "create" | "library" | "settings";
  badge?: number;
}

export const navigation: readonly NavigationItem[] = [
  { id: "component", label: "Generate component docs", group: "create" },
  { id: "foundations", label: "Generate foundation docs", group: "create" },
  { id: "library", label: "Library", group: "library" },
  { id: "settings", label: "Settings", group: "settings" },
  { id: "license", label: "License", group: "settings" },
] as const;

export interface SectionOption {
  id: string;
  label: string;
  aiCapable: boolean;
  selected: boolean;
  disabled?: boolean;
}

export interface SectionGroupView {
  id: "usage" | "specs" | "a11y";
  label: "Usage" | "Specifications" | "Accessibility";
  expanded: boolean;
  included: number;
  total: number;
  options: SectionOption[];
}

export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${String(value)}`);
}
