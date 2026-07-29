/**
 * Shared work-in-progress presentation for vNext screens.
 *
 * The sparkle, shimmer, and cycling phase copy come from the original plugin
 * loader. A determinate bar is added only when the host has real counts.
 */

export interface ProgressPresentation {
  label: string;
  detail?: string;
  current?: number;
  total?: number;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function progressMarkup(progress: ProgressPresentation): string {
  const determinate =
    progress.total !== undefined &&
    progress.total > 0 &&
    progress.current !== undefined;
  const current = determinate
    ? Math.max(0, Math.min(progress.current!, progress.total!))
    : 0;
  const percent = determinate ? Math.round((current / progress.total!) * 100) : 0;
  const count = determinate ? `${current} of ${progress.total}` : '';
  const detail = progress.detail
    ? `<small>${esc(progress.detail)}</small>`
    : '';
  const bar = determinate
    ? (
      '<span class="sl-work-progress">' +
      `<span class="sl-progress-track" role="progressbar" aria-valuemin="0" ` +
      `aria-valuemax="${progress.total}" aria-valuenow="${current}" ` +
      `aria-label="${esc(progress.label)}"><i style="width:${percent}%"></i></span>` +
      `<span class="sl-work-count">${count}</span></span>`
    )
    : '';

  return (
    '<div class="sl-work-status" role="status" aria-live="polite">' +
    '<span class="sl-work-spark" aria-hidden="true"></span>' +
    '<span class="sl-work-copy">' +
    '<span class="sl-work-line">' +
    `<strong>${esc(progress.label)}</strong>` +
    '<span class="sl-work-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '</span>' +
    detail +
    bar +
    '</span></div>'
  );
}

export function loadingRowsMarkup(count = 4): string {
  return (
    '<div class="sl-loading-rows" aria-hidden="true">' +
    Array.from({ length: count }, (_, index) => (
      '<span class="sl-loading-row">' +
      '<i class="sl-skeleton sl-loading-icon"></i>' +
      '<span>' +
      `<i class="sl-skeleton sl-loading-title" style="width:${index % 2 ? 48 : 61}%"></i>` +
      `<i class="sl-skeleton sl-loading-meta" style="width:${index % 3 ? 67 : 78}%"></i>` +
      '</span></span>'
    )).join('') +
    '</div>'
  );
}
