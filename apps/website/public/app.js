const menu = document.querySelector('.menu-button');
const navigation = document.querySelector('#navigation');

function closeMenu() {
  menu?.setAttribute('aria-expanded', 'false');
  navigation?.classList.remove('open');
}

menu?.addEventListener('click', () => {
  const expanded = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(expanded));
  navigation?.classList.toggle('open', expanded);
});
navigation?.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.nav-shell')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
  }
});
window.matchMedia('(min-width: 761px)').addEventListener('change', closeMenu);

const galleryItems = [
  {
    src: 'screenshots/createdoc.png?v=20260908-gallery-v3',
    width: 1440, height: 900,
    closeup: 'screenshots/createdoc.png?v=20260908-gallery-v3',
    alt: 'Spec Layer beside generated buttonPrimary documentation in Figma, showing usage guidance, anatomy, and component documentation controls.',
    caption: 'Create component documentation alongside your design, with usage guidance, anatomy, and specifications.'
  },
  {
    src: 'screenshots/foundations.png?v=20260908-gallery-v3',
    width: 1440, height: 900,
    closeup: 'screenshots/foundations.png?v=20260908-gallery-v3',
    alt: 'Spec Layer beside generated foundation color documentation in Figma, showing color swatches, token values, variable collections, and text styles.',
    caption: 'Document your variable collections and text styles with color swatches, token values, and references on the Figma canvas.'
  },
  {
    src: 'screenshots/library.png?v=20260908-gallery-v3',
    width: 1440, height: 900,
    closeup: 'screenshots/library.png?v=20260908-gallery-v3',
    alt: 'Spec Layer Library beside component variant documentation in Figma, showing a token change, update statuses, and the Update all docs action.',
    caption: 'Review component and token changes in the Library, then update the connected documentation.'
  }
];

document.querySelectorAll('[data-gallery]').forEach(button => {
  button.addEventListener('click', () => {
    const item = galleryItems[Number(button.dataset.gallery)];
    const image = document.querySelector('#gallery-image');
    if (!item || !image) return;
    image.width = item.width;
    image.height = item.height;
    image.src = item.src;
    image.alt = item.alt;
    document.querySelector('#gallery-caption').textContent = item.caption;
    document.querySelector('#full-image').href = item.closeup;
    document.querySelector('#gallery-link').href = item.closeup;
    document.querySelectorAll('[data-gallery]').forEach(other => {
      const selected = other === button;
      other.setAttribute('aria-pressed', String(selected));
      other.classList.toggle('selected', selected);
    });
  });
});
document.querySelector('#gallery-image')?.addEventListener('error', () => {
  document.querySelector('#gallery-caption').textContent =
    'This screenshot could not load. Choose another view or try opening the full-size image.';
});

const checkout = {
  monthly: 'https://speclayer-docs.lemonsqueezy.com/checkout/buy/077cd029-d066-4d03-9e12-4ec25a114ba6',
  yearly: 'https://speclayer-docs.lemonsqueezy.com/checkout/buy/90f8ba94-3613-4c5d-929e-4ac8faa3fd42'
};

document.querySelectorAll('[data-billing]').forEach(button => {
  button.addEventListener('click', () => {
    const yearly = button.dataset.billing === 'yearly';
    document.querySelectorAll('[data-billing]').forEach(other => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    document.querySelector('#price-amount').textContent = yearly ? '$79.99' : '$7.99';
    document.querySelector('#price-period').textContent = yearly ? '/ year' : '/ month';
    document.querySelector('#billing-note').textContent = yearly
      ? 'Billed yearly. Cancel anytime.'
      : 'Billed monthly. Cancel anytime.';
    document.querySelector('#checkout').href = checkout[button.dataset.billing];
  });
});

let statusTimer;
const copyTimers = new WeakMap();
document.querySelectorAll('[data-copy]').forEach(button => {
  const label = button.textContent;
  button.addEventListener('click', async () => {
    const status = document.querySelector('#copy-status');
    clearTimeout(statusTimer);
    clearTimeout(copyTimers.get(button));
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
      status.textContent = 'Command copied to clipboard.';
    } catch {
      button.textContent = label;
      status.textContent = 'Could not copy. Select the command and use your device’s Copy action.';
    }
    copyTimers.set(button, setTimeout(() => { button.textContent = label; }, 2500));
    statusTimer = setTimeout(() => { status.textContent = ''; }, 6000);
  });
});

// Each page has a desktop and mobile contents list. Keep both in sync.
const docsDisclosure = document.querySelector('.docs-nav-disclosure');
if (docsDisclosure) {
  const smallScreen = window.matchMedia('(max-width: 760px)');
  const updateDisclosure = () => { docsDisclosure.open = !smallScreen.matches; };
  smallScreen.addEventListener('change', updateDisclosure);
  updateDisclosure();
}
const contentsLinks = [...document.querySelectorAll('[data-toc] a[href^="#"]')];
const contents = [...new Set(contentsLinks.map(link => link.hash))].map(hash => ({
  links: contentsLinks.filter(link => link.hash === hash),
  section: document.getElementById(hash.slice(1))
})).filter(item => item.section);
if (contents.length) {
  let scheduled = false;
  function updateContents() {
    let active = contents[0];
    for (const item of contents) {
      if (item.section.getBoundingClientRect().top <= 155) active = item;
    }
    for (const item of contents) {
      for (const link of item.links) {
        if (item === active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
    scheduled = false;
  }
  function scheduleContents() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateContents);
  }
  window.addEventListener('scroll', scheduleContents, { passive: true });
  window.addEventListener('resize', scheduleContents);
  window.addEventListener('load', scheduleContents, { once: true });
  scheduleContents();
}
// Some static preview hosts normalize /docs.html to /docs/ before applying
// redirect files. Recover the original quickstart section from those bookmarks.
const legacyQuickstartSections = new Set(['figma', 'copy-for-ai', 'publish-pull', 'commands', 'keys', 'contribute']);
if (['/docs', '/docs/'].includes(window.location.pathname) && legacyQuickstartSections.has(window.location.hash.slice(1))) {
  window.location.replace('/docs/quickstart/' + window.location.search + window.location.hash);
}
