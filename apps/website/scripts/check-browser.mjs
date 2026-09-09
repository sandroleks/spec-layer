// Optional release QA. See ACCEPTANCE.md for isolated Playwright/axe setup.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pages, pageUrl } from '../docs.config.mjs';
import { infoPages, infoPageUrl } from '../pages.config.mjs';

const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const axePath = process.env.AXE_SCRIPT;
const origin = process.env.WEBSITE_URL || 'http://127.0.0.1:4621';
const output = resolve(process.env.BROWSER_REPORT_DIR || '/tmp/spec-layer-browser-report');
await mkdir(output, { recursive: true });
const report = { date: new Date().toISOString(), origin, engines: [], checks: [], failures: [], limitations: ['Automated accessibility checks and keyboard testing do not replace a manual screen-reader session.', 'Layout at a 720px CSS viewport covers 200% desktop reflow; native browser zoom is not automated.'] };
const routes = ['/', ...pages.map(pageUrl), ...infoPages.map(infoPageUrl)];
const widths = [320, 390, 720, 760, 761, 768, 1120, 1121, 1440];
async function check(name, run) {
  console.log(`Checking: ${name}`);
  try { await run(); report.checks.push(name); }
  catch (error) { report.failures.push({ name, error: error.message }); console.error(`Failed: ${name}: ${error.message}`); }
}
for (const engine of (process.env.BROWSER_ENGINES || 'chromium,webkit').split(',')) {
  const browser = await playwright[engine].launch({ ...(engine === 'chromium' && process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  report.engines.push({ engine, version: browser.version() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const route of routes) {
    await check(`${engine} ${route} layout, links and accessibility`, async () => {
      const response = await page.goto(origin + route);
      assert.equal(response.status(), 200);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('main').count(), 1);
      assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), 'https://spec-layer.com' + route);
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
        const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(overflow.scroll <= overflow.viewport + 1, `${width}px: page overflows to ${overflow.scroll}px`);
        if ([390, 1440].includes(width) && ['/', '/docs/cli/', '/privacy'].includes(route)) {
          await page.screenshot({ path: resolve(output, `${engine}-${route.replaceAll('/', '-') || 'home'}-${width}.png`) });
        }
      }
      if (engine === 'chromium' && axePath) {
        await page.addScriptTag({ path: axePath });
        const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })));
        assert.deepEqual(violations, [], JSON.stringify(violations));
      }
    });
    console.log(`${engine}: ${route}`);
  }
  await check(`${engine} mobile menu close, focus and resize`, async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin);
    const menu = page.locator('.menu-button');
    await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    assert.equal(await menu.evaluate(el => el === document.activeElement), true);
    await menu.click();
    await page.locator('.hero-bottom p').click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await menu.click();
    await page.locator('#navigation a').first().click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    await menu.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => document.querySelector('.menu-button').getAttribute('aria-expanded') === 'false');
  });
  await check(`${engine} billing, checkout and FAQ`, async () => {
    await page.goto(origin);
    for (const period of ['yearly', 'monthly', 'yearly', 'monthly']) {
      await page.locator(`[data-billing=${period}]`).click();
      assert.equal(await page.locator('#price-amount').textContent(), period === 'yearly' ? '$79.99' : '$7.99');
      assert.equal(await page.locator(`[data-billing=${period}]`).getAttribute('aria-pressed'), 'true');
      assert.ok((await page.locator('#checkout').getAttribute('href')).endsWith(period === 'yearly' ? '90f8ba94-3613-4c5d-929e-4ac8faa3fd42' : '077cd029-d066-4d03-9e12-4ec25a114ba6'));
    }
    const faq = page.locator('.faqs details').first();
    await faq.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await faq.evaluate(el => el.open), true);
    await page.keyboard.press('Space');
    assert.equal(await faq.evaluate(el => el.open), false);
  });
  await check(`${engine} gallery selection, image failure and recovery`, async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin);
    // Exercise failure before this browser has decoded the same image.
    // WebKit may reuse a decoded image without making an interceptable request.
    await page.route('**/screenshots/foundations.png*', route => route.abort());
    await page.locator('[data-gallery="1"]').click();
    await page.waitForFunction(() => document.querySelector('#gallery-caption').textContent.includes('could not load'));
    await page.unroute('**/screenshots/foundations.png*');
    await page.locator('[data-gallery="2"]').click();
    await page.waitForFunction(() => document.querySelector('#gallery-image').naturalWidth > 0);
    assert.ok(!(await page.locator('#gallery-caption').textContent()).includes('could not load'));
    for (const n of [1, 2, 0]) {
      await page.locator(`[data-gallery="${n}"]`).click();
      await page.waitForFunction(() => document.querySelector('#gallery-image').complete && document.querySelector('#gallery-image').naturalWidth > 0);
      assert.equal(await page.locator(`[data-gallery="${n}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#gallery-image').getAttribute('src'), await page.locator('#full-image').getAttribute('href'));
      assert.equal(await page.locator('#gallery-image').getAttribute('src'), await page.locator('#gallery-link').getAttribute('href'));
    }

    await page.setViewportSize({ width: 390, height: 844 });
    for (const n of [1, 2, 0]) {
      await page.locator(`[data-gallery="${n}"]`).click();
      await page.waitForFunction(() => {
        const image = document.querySelector('#gallery-image');
        return image.complete && image.currentSrc === image.src && image.naturalWidth === 1440 && image.naturalHeight === 900;
      });
      assert.match(new URL(await page.locator('#gallery-image').evaluate(el => el.currentSrc)).pathname, /\/screenshots\/(createdoc|foundations|library)\.png$/);
    }
  });
  await check(`${engine} docs navigation, contents, deep link and keyboard`, async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin + '/docs/quickstart/#publish-pull');
    const position = await page.locator('#publish-pull').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(position >= 84, `Heading covered by header: ${position}`);
    await page.locator('.docs-toc a[href="#commands"]').click();
    await page.waitForFunction(() => document.querySelector('.docs-toc a[href="#commands"]').getAttribute('aria-current') === 'location');
    await page.reload();
    assert.equal(new URL(page.url()).hash, '#commands');
    await page.goto(origin + '/docs/');
    const tabKey = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
    await page.keyboard.press(tabKey);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Skip to content');
    await page.keyboard.press('Enter');
    await page.keyboard.press(tabKey);
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('main')), true);
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
    await page.keyboard.press(engine === 'webkit' ? 'Shift+Alt+Tab' : 'Shift+Tab');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/docs/cli/');
    const nav = page.locator('.docs-nav-disclosure');
    assert.equal(await nav.evaluate(el => el.open), false);
    await nav.locator('summary').click();
    assert.equal(await nav.evaluate(el => el.open), true);
    await page.locator('.docs-sidebar a[href="/docs/outputs/"]').click();
    assert.ok(page.url().endsWith('/docs/outputs/'));
    await page.locator('.docs-mobile-toc > summary').click();
    assert.equal(await page.locator('.docs-mobile-toc').evaluate(el => el.open), true);
    await page.locator('.docs-mobile-toc a').last().click();
    assert.ok(new URL(page.url()).hash.length > 1);
  });
  await check(`${engine} all documentation navigation destinations`, async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(origin + '/docs/');
    for (const entry of pages) {
      await page.locator(`.docs-sidebar a[href="${pageUrl(entry)}"]`).click();
      assert.equal(new URL(page.url()).pathname, pageUrl(entry));
      assert.equal(await page.locator('.docs-sidebar a[aria-current=page]').getAttribute('href'), pageUrl(entry));
    }
  });
  await check(`${engine} docs sidebar padding, section spacing and focus`, async () => {
    await page.goto(origin + '/docs/');
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 761 ? 844 : 900 });
      await page.locator('.docs-nav-disclosure').evaluate(el => { el.open = true; });
      const layout = await page.locator('.docs-sidebar').evaluate(sidebar => {
        const bounds = sidebar.getBoundingClientRect();
        const groups = [...sidebar.querySelectorAll('.docs-nav-group')];
        return groups.map((group, index) => {
          const heading = group.querySelector('strong');
          const headingLeft = heading.getBoundingClientRect().left + parseFloat(getComputedStyle(heading).paddingLeft);
          return {
            gap: index ? group.getBoundingClientRect().top - groups[index - 1].getBoundingClientRect().bottom : null,
            links: [...group.querySelectorAll('a')].map(link => {
              const box = link.getBoundingClientRect();
              const style = getComputedStyle(link);
              return { left: box.left - bounds.left, right: bounds.right - box.right, padding: parseFloat(style.paddingLeft), alignment: Math.abs(box.left + parseFloat(style.paddingLeft) - headingLeft), height: box.height };
            })
          };
        });
      });
      for (const group of layout) {
        if (group.gap !== null) assert.ok(group.gap >= 18, `${width}px: sections run together`);
        for (const link of group.links) {
          assert.ok(link.left >= 0 && link.right >= 0, `${width}px: sidebar clips a navigation row`);
          assert.ok(link.padding >= 12 && link.alignment <= 1, `${width}px: link and heading padding do not align`);
          assert.ok(link.height >= (width < 761 ? 44 : 40), `${width}px: navigation row is too short`);
        }
      }
      const active = page.locator('.docs-sidebar a[aria-current=page]');
      await active.focus();
      assert.notEqual(await active.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
      assert.ok(await active.evaluate(el => {
        const sidebar = el.closest('.docs-sidebar');
        if (getComputedStyle(sidebar).overflowX === 'visible') return true;
        const style = getComputedStyle(el);
        const inset = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        const link = el.getBoundingClientRect();
        const bounds = sidebar.getBoundingClientRect();
        return link.left - inset >= bounds.left && link.right + inset <= bounds.right;
      }), `${width}px: sidebar clips the keyboard focus outline`);
      if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `${engine}-docs-menu-${width}.png`) });
    }
  });
  await check(`${engine} clipboard denial feedback`, async () => {
    await page.goto(origin + '/docs/quickstart/');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } }));
    await page.locator('[data-copy]').first().click();
    await page.waitForFunction(() => document.querySelector('#copy-status').textContent.includes('Could not copy'));
    assert.equal(await page.locator('#copy-status').getAttribute('role'), 'status');
  });
  if (engine === 'chromium') await check(`${engine} native clipboard success`, async () => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(origin + '/docs/quickstart/');
    await page.locator('[data-copy]').first().click();
    await page.waitForFunction(() => document.querySelector('#copy-status').textContent === 'Command copied to clipboard.');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npx spec-layer pull');
  });
  if (engine === 'webkit') await check(`${engine} native clipboard write feedback`, async () => {
    await page.goto(origin + '/docs/quickstart/');
    await page.locator('[data-copy]').first().click();
    await page.waitForFunction(() => document.querySelector('#copy-status').textContent === 'Command copied to clipboard.');
  });
  await check(`${engine} downloads and HTTP errors`, async () => {
    await page.goto(origin + '/docs/outputs/');
    const downloads = await page.locator('a[download]').evaluateAll(links => links.map(a => a.href));
    assert.ok(downloads.length > 0);
    for (const url of downloads) {
      const response = await context.request.get(url);
      assert.equal(response.status(), 200, url);
      assert.ok((await response.body()).length > 0, url);
    }
    await page.goto(origin + '/docs/quickstart/');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('a[download]').first().click();
    assert.equal((await downloadEvent).suggestedFilename(), 'example-button.yaml');
    for (const route of ['/not-a-page', '/docs/not-a-page/']) {
      const response = await page.goto(origin + route);
      assert.equal(response.status(), 404);
      assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /noindex/);
      assert.ok(await page.locator('a[href="/"]').count());
    }
    await page.goto(origin + '/docs.html?from=bookmark#publish-pull');
    assert.equal(new URL(page.url()).pathname, '/docs/quickstart/');
    assert.equal(new URL(page.url()).search, '?from=bookmark');
    assert.equal(new URL(page.url()).hash, '#publish-pull');
    await page.goto(origin + '/docs/?from=preview#figma');
    await page.waitForURL('**/docs/quickstart/?from=preview#figma');
  });
  await check(`${engine} no uncaught JavaScript errors`, () => assert.deepEqual(errors, []));
  await browser.close();
}
await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${report.checks.length} passed, ${report.failures.length} failed. Report: ${output}/results.json`);
if (report.failures.length) { console.error(JSON.stringify(report.failures, null, 2)); process.exitCode = 1; }
