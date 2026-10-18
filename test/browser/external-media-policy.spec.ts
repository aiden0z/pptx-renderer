import { expect, test } from '@playwright/test';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=',
  'base64',
);

for (const lazy of [false, true]) {
  for (const policy of [undefined, 'allow', 'block'] as const) {
    test(`externalMedia=${policy ?? 'default'}, lazyMedia=${lazy}: browser requests obey policy`, async ({
      page,
    }) => {
      const requested: string[] = [];
      await page.route('https://external-media.example.test/**', async (route) => {
        requested.push(new URL(route.request().url()).pathname);
        await route.fulfill({ contentType: 'image/png', body: png });
      });
      await page.goto('/test/browser/blank.html');
      const result = await page.evaluate(
        async ({ lazy, policy }) => {
          const { externalMediaOrigin, externalMediaPresentation } =
            await import('/test/fixtures/external-media-policy.ts');
          const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
          const p = externalMediaPresentation(lazy);
          const handle = renderSlide(p, p.slides[0], { externalMedia: policy, pdfjs: false });
          document.body.appendChild(handle.element);
          await handle.ready;
          await Promise.all(
            [...handle.element.querySelectorAll('img')].map((img) => img.decode().catch(() => {})),
          );
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return {
            hasExternalReferences: handle.element.outerHTML.includes(externalMediaOrigin),
            embeddedImages: handle.element.querySelectorAll('img[src^="blob:"]').length,
          };
        },
        { lazy, policy },
      );
      await page.waitForLoadState('networkidle');
      expect(result.embeddedImages).toBeGreaterThan(0);
      if (policy === 'block') {
        expect(result.hasExternalReferences).toBe(false);
        expect(requested).toEqual([]);
      } else {
        expect(result.hasExternalReferences).toBe(true);
        for (const resource of [
          'picture',
          'linked',
          'background',
          'shape',
          'text',
          'group',
          'layout',
          'master',
          'poster',
          'svg',
        ]) {
          expect(requested, `${resource} should exercise a real browser request`).toContain(
            `/${resource}.png`,
          );
        }
      }
    });
  }
}
