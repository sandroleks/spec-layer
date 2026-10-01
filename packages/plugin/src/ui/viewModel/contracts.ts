/**
 * Presentation contracts: the exhaustive visual states screens/* map from
 * domain state. They do not replace the plugin state or message protocol.
 */

export type PluginView =
  | "component"
  | "foundations"
  | "library"
  | "settings"
  | "license";

// ThemeMode lives in theme.ts; do not redeclare it here.

export type AllowanceState =
  | { kind: "loading" }
  | { kind: "free"; remaining: number; limit: number; resetsAt: string }
  | { kind: "pro" }
  | { kind: "unknown"; message: string };

export type ComponentScreenState =
  /** `waiting`: the panel has opened and no selection report has landed yet. */
  | { kind: "empty"; waiting?: boolean }
  | { kind: "reading"; componentName: string }
  | { kind: "ready"; componentName: string }
  /** `phase` is the progress line under the button, always set by the build. */
  | { kind: "building"; componentName: string; action: "create"; phase: string }
  /** The outcome sentence is a native toast, so no copy here. */
  | { kind: "success"; componentName: string; replaced: boolean }
  | { kind: "error"; componentName: string; message: string };

export type FoundationScreenState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }
  | { kind: "generating"; done: number; total: number; phase?: string };

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
  { id: "component", label: "Create component docs", group: "create" },
  { id: "foundations", label: "Create foundation docs", group: "create" },
  { id: "library", label: "Library", group: "library" },
  { id: "settings", label: "Settings", group: "settings" },
  { id: "license", label: "License", group: "settings" },
] as const;

/** A `data-view` value is one of the rail's destinations, or it is ignored. */
export function isPluginView(value: string): value is PluginView {
  return navigation.some((item) => item.id === value);
}

export interface SectionOption {
  id: string;
  label: string;
  aiCapable: boolean;
  selected: boolean;
  disabled?: boolean;
  /** Why the row is disabled, as a muted suffix; the label stays the section's name. */
  note?: string;
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
