/**
 * Names for generated platform outputs. Spec:
 * docs/superpowers/specs/2026-09-08-repository-delivery-design.md, 4.3.
 *
 * A token's identifier is the designer's declared code_syntax when the format
 * can use it, else a documented transform of its DTCG path. Two tokens that
 * reach one identifier are both omitted and reported; nothing picks a winner.
 */
import { compareCodeUnits } from '../diagnostics';
import type { DtcgExport, DtcgJson } from '../dtcg';

export type NameCase = 'kebab' | 'camel' | 'pascal' | 'snake' | 'constant';
export const NAME_CASES: readonly NameCase[] = ['kebab', 'camel', 'pascal', 'snake', 'constant'];

export interface OutputMapEntry { name: string; source: 'code_syntax' | 'derived' }

export type OutputReportCode =
  | 'code_syntax_not_usable' | 'name_collision' | 'reference_target_omitted'
  | 'mode_selector_shared' | 'value_converted' | 'not_expressible';

export interface OutputReportEntry {
  code: OutputReportCode;
  severity: 'error' | 'warning' | 'info';
  /** DTCG path, or a collection label for mode_selector_shared. */
  path: string;
  mode?: string;
  message: string;
  details: Record<string, DtcgJson>;
}

/**
 * A DTCG path segment as words: split on every run of characters outside
 * letters and digits and on every lowercase-to-uppercase boundary. Digits are
 * not a boundary, so `h1` stays one word.
 */
export function splitWords(segment: string): string[] {
  return segment
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Every word of a dot-joined DTCG path; a segment with no words becomes `_`. */
export function pathWords(path: string): string[] {
  return path.split('.').flatMap((seg) => {
    const words = splitWords(seg);
    return words.length > 0 ? words : ['_'];
  });
}

export function joinWords(words: string[], nameCase: NameCase): string {
  const lower = words.map((w) => w.toLowerCase());
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  switch (nameCase) {
    case 'kebab': return lower.join('-');
    case 'snake': return lower.join('_');
    case 'constant': return lower.join('_').toUpperCase();
    case 'camel': return lower.map((w, i) => (i === 0 ? w : cap(w))).join('');
    case 'pascal': return lower.map(cap).join('');
    default: {
      const exhaustive: never = nameCase;
      return exhaustive;
    }
  }
}

/** The derived identifier body for a path, before the format adds its affix. */
export function deriveName(path: string, nameCase: NameCase): string {
  return joinWords(pathWords(path), nameCase);
}

export interface NameRules {
  /** The code_syntax key this platform reads; null when Figma declares none. */
  codeSyntaxKey: string | null;
  /** The declared identifier as the format can use it, or null when it cannot. */
  acceptDeclared: (declared: string) => string | null;
  /** Wraps a derived body in the format's affix, e.g. `--` for CSS. */
  affix: (body: string) => string;
  nameCase: NameCase;
}

export interface ResolvedNames {
  /** DTCG path -> emitted identifier, for every token that survived. */
  names: Map<string, string>;
  map: Record<string, OutputMapEntry>;
  report: OutputReportEntry[];
}

export function sortReport(entries: OutputReportEntry[]): OutputReportEntry[] {
  return [...entries].sort((a, b) => compareCodeUnits(a.path, b.path)
    || compareCodeUnits(a.code, b.code) || compareCodeUnits(a.mode ?? '', b.mode ?? ''));
}

/** `paths` are the DTCG paths the output will emit, tokens and styles alike. */
export function resolveNames(
  paths: string[], meta: DtcgExport['meta'], rules: NameRules,
): ResolvedNames {
  const report: OutputReportEntry[] = [];
  const candidates = new Map<string, Array<{ path: string; source: OutputMapEntry['source'] }>>();
  for (const path of [...paths].sort(compareCodeUnits)) {
    let name: string | null = null;
    let source: OutputMapEntry['source'] = 'derived';
    const declared = rules.codeSyntaxKey ? meta[path]?.code_syntax?.[rules.codeSyntaxKey] : undefined;
    if (declared !== undefined) {
      name = rules.acceptDeclared(declared);
      if (name !== null) {
        source = 'code_syntax';
      } else {
        report.push({
          code: 'code_syntax_not_usable', severity: 'info', path,
          message: `The declared ${rules.codeSyntaxKey} identifier "${declared}" is not a name this format can use; the name was derived instead.`,
          details: { declared, platform: rules.codeSyntaxKey ?? '' },
        });
      }
    }
    if (name === null) name = rules.affix(deriveName(path, rules.nameCase));
    const list = candidates.get(name) ?? [];
    list.push({ path, source });
    candidates.set(name, list);
  }
  const names = new Map<string, string>();
  const map: Record<string, OutputMapEntry> = {};
  for (const [name, list] of candidates) {
    if (list.length > 1) {
      const collided = list.map((c) => c.path).sort(compareCodeUnits);
      for (const c of list) {
        report.push({
          code: 'name_collision', severity: 'error', path: c.path,
          message: `${list.length} tokens would share the name ${name}; all were omitted.`,
          details: { name, paths: collided },
        });
      }
      continue;
    }
    names.set(list[0].path, name);
    map[list[0].path] = { name, source: list[0].source };
  }
  const sortedMap = Object.fromEntries(Object.entries(map).sort(([a], [b]) => compareCodeUnits(a, b)));
  return { names, map: sortedMap, report: sortReport(report) };
}
