/** WCAG sRGB contrast. Reject malformed colors rather than reporting a pass. */
export function contrastRatio(foreground, background) {
  function luminance(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected six-digit hex color: ${hex}`);
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Pairs permitted by the shared component contract, not a full UI audit. */
export function checkContrast(themes) {
  const checks = [];
  for (const theme of ['dark', 'light']) {
    const colors = themes[theme];
    function add(foreground, background, minimum, kind) {
      const ratio = contrastRatio(colors[foreground], colors[background]);
      checks.push({ theme, foreground, background, ratio: +ratio.toFixed(3), minimum, pass: ratio >= minimum, kind });
    }
    for (const background of ['canvas', 'chrome', 'surface', 'subdued', 'raised', 'hover', 'pressed']) {
      for (const foreground of ['text', 'muted', 'quiet', 'accent-text', 'success', 'warning', 'danger']) {
        add(foreground, background, 4.5, 'text');
      }
      add('control-border', background, 3, 'control boundary');
      add('focus', background, 3, 'focus');
    }
    for (const background of ['action', 'action-hover', 'action-pressed']) {
      add('on-action', background, 4.5, 'action text');
      add('thumb', background, 3, 'switch thumb');
    }
    add('thumb', 'control-border', 3, 'off switch thumb');
    add('accent-text', 'selected', 4.5, 'selected text');
    add('on-danger', 'danger-fill', 4.5, 'danger action');
    for (const role of ['success', 'warning', 'danger']) add(role, `${role}-soft`, 4.5, 'status text');
    add('warning-graphic', 'raised', 3, 'quota graphic');
  }
  return { status: checks.every(check => check.pass) ? 'passed' : 'failed', checks };
}
