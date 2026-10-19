/**
 * Writes a one-line description into Figma's own field for a variable, a
 * style, a component, or a slot property, behind a host interface so every
 * branch is tested without Figma (the pattern syncFigma.ts uses). The text
 * is source: nothing claims it as the doc's own, so the next extraction reads
 * it like any designer's description. One mark only: AI text saved without an
 * edit is recorded by hash in plugin data. Nothing reads the mark yet.
 * Nothing here enters a hash or an artifact.
 */
import { contentHash } from '@spec-layer/extractor';

export interface DescriptionWrite {
  kind: 'variable' | 'style' | 'component' | 'slot';
  id: string;
  /** Slot only. */
  propertyName?: string;
  text: string;
  origin: 'person' | 'ai';
}

/** pluginData on a variable, style or component: JSON `{ [field]: hash }` of
 *  AI text saved unedited. `field` is `description` or the slot property name. */
export const AI_DESCRIPTION_KEY = 'specLayerAiDescription';

export interface WritableDescribed {
  description: string;
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
}
export interface WritableComponent extends WritableDescribed {
  editComponentProperty(propertyName: string, newValue: { description?: string }): string;
}
export interface DescriptionHost {
  variable(id: string): Promise<WritableDescribed | null>;
  style(id: string): Promise<WritableDescribed | null>;
  component(id: string): Promise<WritableComponent | null>;
}
export interface WriteOutcome { written: string[]; failed: { key: string; message: string }[] }

export function writeKey(item: Pick<DescriptionWrite, 'kind' | 'id' | 'propertyName'>): string {
  return item.kind === 'slot' ? `slot:${item.id}:${item.propertyName ?? ''}` : `${item.kind}:${item.id}`;
}

const GONE: Record<DescriptionWrite['kind'], string> = {
  variable: 'That variable is no longer in this file.',
  style: 'That style is no longer in this file.',
  component: 'That component is no longer in this file.',
  slot: 'That component is no longer in this file.',
};

function readMarks(node: WritableDescribed): Record<string, string> {
  try {
    const raw = node.getPluginData(AI_DESCRIPTION_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch { return {}; }
}

function writeMarks(node: WritableDescribed, marks: Record<string, string>): void {
  node.setPluginData(AI_DESCRIPTION_KEY, Object.keys(marks).length ? JSON.stringify(marks) : '');
}

/** Best effort: the field write already landed, so a refused plugin data
 *  write must not report the description as unwritten. */
function mark(node: WritableDescribed, field: string, item: DescriptionWrite): void {
  try {
    const marks = readMarks(node);
    if (item.origin === 'ai') marks[field] = contentHash(item.text);
    else delete marks[field];
    writeMarks(node, marks);
  } catch { /* the mark is a note, not the write */ }
}

async function target(host: DescriptionHost, item: DescriptionWrite): Promise<WritableDescribed | WritableComponent | null> {
  switch (item.kind) {
    case 'variable': return host.variable(item.id);
    case 'style': return host.style(item.id);
    case 'component':
    case 'slot': return host.component(item.id);
  }
}

/** Each item on its own: one refusal never blocks the rest. */
export async function writeDescriptions(host: DescriptionHost, items: readonly DescriptionWrite[]): Promise<WriteOutcome> {
  const out: WriteOutcome = { written: [], failed: [] };
  for (const raw of items) {
    const item = { ...raw, text: raw.text.trim() };
    const key = writeKey(item);
    if (item.text === '') { out.failed.push({ key, message: 'Nothing to write.' }); continue; }
    let node: WritableDescribed | WritableComponent | null;
    try { node = await target(host, item); } catch { node = null; }
    if (!node) { out.failed.push({ key, message: GONE[item.kind] }); continue; }
    try {
      if (item.kind === 'slot') {
        if (!item.propertyName) throw new Error('No slot property named.');
        (node as WritableComponent).editComponentProperty(item.propertyName, { description: item.text });
        mark(node, item.propertyName, item);
      } else {
        node.description = item.text;
        mark(node, 'description', item);
      }
      out.written.push(key);
    } catch (err) {
      out.failed.push({ key, message: err instanceof Error && err.message ? err.message : 'Figma refused the write.' });
    }
  }
  return out;
}
