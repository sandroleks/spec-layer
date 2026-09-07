let specification;
let report;
let timer;
const root = document.documentElement;
const $ = id => document.getElementById(id);
function announce(message) {
  $('copy-status').textContent = message;
  clearTimeout(timer);
  timer = setTimeout(() => { $('copy-status').textContent = ''; }, 3500);
}
function updatePreviews() {
  const theme = root.dataset.theme;
  const view = $('view-select').value;
  $('workflow-preview').src = `plugin-preview.html?view=${view}&state=ready&theme=${theme}`;
  $('workflow-preview').title = `Proposed ${$('view-select').selectedOptions[0].textContent} plugin preview`;
  $('workflow-caption').textContent = $('view-select').selectedOptions[0].textContent;
  $('library-preview').src = `plugin-preview.html?view=library&theme=${theme}`;
}
function renderColors() {
  if (!specification || !report) return;
  const theme = root.dataset.theme;
  const colors = specification.themes[theme];
  $('swatches').replaceChildren();
  for (const [role, label] of [['action','Action'],['on-action','On action'],['canvas','Canvas'],['surface','Surface'],['selected','Selection'],['control-border','Control boundary']]) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'swatch';
    button.setAttribute('aria-label', `Copy ${label} color ${colors[role]}`);
    button.innerHTML = `<span class="swatch-paint" style="background:${colors[role]}"></span><span class="swatch-meta"><strong>${label}</strong><code>${colors[role]}</code></span>`;
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(colors[role]); announce(`Copied ${colors[role]}`); }
      catch { announce(`${label}: ${colors[role]}. Clipboard is unavailable here.`); }
    });
    $('swatches').append(button);
  }
  $('contrast-summary').innerHTML = [['on-action','action','Action label'],['quiet','subdued','Supporting text'],['control-border','surface','Control boundary']].map(([fg,bg,label])=>{
    const c = report.checks.find(c=>c.theme===theme&&c.foreground===fg&&c.background===bg);
    return `<div class="contrast-row"><span>${label}</span><strong>${c.ratio.toFixed(2)}:1 / Pass</strong></div>`;
  }).join('');
}
$('theme-toggle').addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  $('theme-toggle').textContent = `${next[0].toUpperCase()+next.slice(1)} theme`;
  $('theme-toggle').setAttribute('aria-label', `Switch to ${next} theme`);
  renderColors(); updatePreviews();
});
$('view-select').addEventListener('change', updatePreviews);
$('width-select').addEventListener('change', () => {
  for (const id of ['workflow-preview','library-preview']) $(id).style.width = `${$('width-select').value}px`;
});
const choices = [...document.querySelectorAll('.section-check')];
function updateSelection() {
  const count = choices.filter(e=>e.checked).length;
  $('section-count').textContent = `${count} of ${choices.length} included`;
  $('all-sections').checked = count === choices.length;
  $('all-sections').indeterminate = count > 0 && count < choices.length;
}
for (const e of choices) e.addEventListener('change', updateSelection);
$('all-sections').addEventListener('change', () => { for (const e of choices) e.checked=$('all-sections').checked; updateSelection(); });
updateSelection();
$('create-demo').addEventListener('click', () => {
  const count=choices.filter(e=>e.checked).length;
  $('demo-feedback').textContent=count ? `Docs created with ${count} included sections. Sample result only.` : 'Include a section to create sample docs.';
});
$('refresh-demo').addEventListener('click', () => { $('demo-feedback').textContent='Library refreshed. Your sample docs are up to date.'; });
$('reset-demo').addEventListener('click', () => { choices.forEach((e,i)=>{e.checked=i<2;}); updateSelection();$('demo-feedback').textContent='Ready. This demo uses sample content.'; });
$('name-form').addEventListener('submit', e => {
  e.preventDefault();
  const name=$('library-name').value.trim();
  $('library-name').setAttribute('aria-invalid',String(!name));
  $('name-help').classList.toggle('error',!name);
  $('name-help').textContent=name?'Use a name your team will recognize.':'Enter a library name to continue.';
  $('name-feedback').textContent=name?`“${name}” saved in this demo.`:'Library name was not saved.';
  if(!name) $('library-name').focus();
});
Promise.all([fetch('tokens.json').then(r=>{if(!r.ok)throw Error('tokens');return r.json();}),fetch('contrast-report.json').then(r=>{if(!r.ok)throw Error('report');return r.json();})]).then(([a,b])=>{specification=a;report=b;renderColors();}).catch(()=>{announce('Open this catalog through the local preview server to load the token specimens.');});
