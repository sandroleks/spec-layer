/** Parse "Style=Filled, State=Enabled" into { Style: 'Filled', State: 'Enabled' };
 *  null if any segment is not Axis=Value. */
export function parseVariantName(name: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const segment of name.split(',')) {
    const [axis, ...rest] = segment.split('=');
    if (!rest.length) return null;
    out[axis.trim()] = rest.join('=').trim();
  }
  return out;
}

/** Layer names carry Figma prop-binding artifacts like "icon-primary#" — strip them. */
export const cleanPartName = (name: string) => name.replace(/#+\s*$/, '').trim();
