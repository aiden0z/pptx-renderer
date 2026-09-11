import { expect, test } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

test('visual stability waits for consecutive matching canvas frames', async ({ page }) => {
  await page.goto('/test/browser/blank.html');

  const result = await page.evaluate(async () => {
    const { waitForVisualStability } = await import('/test/pages/visualStability.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    document.body.appendChild(canvas);
    const context = canvas.getContext('2d')!;
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      context.fillStyle = `rgb(${frame}, ${frame * 3}, ${frame * 7})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }, 20);

    const startedAt = performance.now();
    let resolved = false;
    const stable = waitForVisualStability(document.body, {
      intervalMs: 30,
      stableSamples: 3,
      timeoutMs: 1_000,
    }).then(() => {
      resolved = true;
      return performance.now() - startedAt;
    });

    await new Promise((resolve) => setTimeout(resolve, 140));
    const resolvedWhileChanging = resolved;
    clearInterval(timer);
    const elapsedMs = await stable;
    return { resolvedWhileChanging, elapsedMs };
  });

  expect(result.resolvedWhileChanging).toBe(false);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(140);
  expect(result.elapsedMs).toBeLessThan(1_000);
});

test('visual stability timeout includes pending image decoding', async ({ page }) => {
  await page.goto('/test/browser/blank.html');

  const result = await page.evaluate(async () => {
    const { waitForVisualStability } = await import('/test/pages/visualStability.ts');
    const image = document.createElement('img');
    image.decode = () => new Promise(() => {});
    document.body.appendChild(image);

    const startedAt = performance.now();
    const outcome = await Promise.race([
      waitForVisualStability(document.body, {
        intervalMs: 10,
        stableSamples: 2,
        timeoutMs: 80,
      }).then(
        () => ({ status: 'resolved' }),
        (error) => ({ status: 'rejected', message: String(error) }),
      ),
      new Promise<{ status: string }>((resolve) =>
        setTimeout(() => resolve({ status: 'external-timeout' }), 300),
      ),
    ]);
    return { ...outcome, elapsedMs: performance.now() - startedAt };
  });

  expect(result.status).toBe('rejected');
  expect(result.message).toContain('80ms');
  expect(result.elapsedMs).toBeLessThan(300);
});

test('an obsolete stability rejection cannot overwrite the current slide', async ({ page }) => {
  await page.route('**/test/pages/visualStability.ts*', async (route) => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: `
        export function waitForVisualStability() {
          window.__stabilityCalls = (window.__stabilityCalls || 0) + 1;
          if (window.__stabilityCalls === 1) {
            return new Promise((resolve, reject) => {
              window.__rejectObsoleteWait = () => reject(new Error('obsolete slide timeout'));
            });
          }
          return Promise.resolve();
        }
      `,
    });
  });

  await page.goto(
    '/test/pages/render-slide.html?file=docs/example/1-chart-and-complex/source.pptx&slide=1',
  );
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __rejectObsoleteWait?: () => void }).__rejectObsoleteWait ===
      'function',
  );
  await page.selectOption('#slide-select', '0');
  await page.waitForFunction(
    () => (window as unknown as { __renderDone?: boolean }).__renderDone === true,
  );
  await page.evaluate(() => {
    (window as unknown as { __rejectObsoleteWait: () => void }).__rejectObsoleteWait();
  });
  await page.waitForTimeout(50);

  const state = await page.evaluate(() => ({
    selectedSlide: (document.querySelector('#slide-select') as HTMLSelectElement).value,
    renderDone: (window as unknown as { __renderDone?: boolean }).__renderDone,
    renderError: (window as unknown as { __renderError?: string }).__renderError,
    status: document.querySelector('#status')?.textContent,
    hasCurrentSlide: !!document.querySelector('#slide-container .slide-wrapper'),
  }));

  expect(state).toMatchObject({
    selectedSlide: '0',
    renderDone: true,
    renderError: undefined,
    hasCurrentSlide: true,
  });
  expect(state.status).toContain('Slide 1 / 2');
});

test('single-slide completion waits for an animated chart to become stable', async ({ page }) => {
  await page.goto(
    '/test/pages/render-slide.html?file=docs/example/1-chart-and-complex/source.pptx&slide=1',
  );
  await page.waitForFunction(
    () =>
      (window as unknown as { __renderDone?: boolean; __renderError?: string }).__renderDone ===
        true || (window as unknown as { __renderError?: string }).__renderError !== undefined,
    undefined,
    { timeout: 120_000 },
  );

  const result = await page.evaluate(async () => {
    const state = window as unknown as { __renderError?: string };
    const { echarts } = await import('/src/renderer/chart/echartsRuntime.ts');
    const host = [...document.querySelectorAll<HTMLElement>('#slide-container div')].find(
      (element) => echarts.getInstanceByDom(element) !== undefined,
    );
    const chart = host ? echarts.getInstanceByDom(host) : undefined;
    const canvas = host?.querySelector('canvas');
    const atCompletion = canvas?.toDataURL();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const afterCompletion = canvas?.toDataURL();
    return {
      renderError: state.__renderError,
      animation: chart?.getOption().animation,
      hasCanvas: !!canvas,
      stable: atCompletion === afterCompletion,
    };
  });

  expect(result.renderError).toBeUndefined();
  expect(result.hasCanvas).toBe(true);
  expect(result.animation).toBe('auto');
  expect(result.stable).toBe(true);
});
