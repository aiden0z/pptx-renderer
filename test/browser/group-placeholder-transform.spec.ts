import { expect, test } from '@playwright/test';

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });
for (const lazySlides of [false, true]) {
  for (const explicit of [true, false]) {
    test(`${lazySlides ? 'lazy' : 'eager'} group ${explicit ? 'explicit' : 'inherited'} bounds remap real children`, async ({
      page,
    }) => {
      await page.goto('/test/browser/blank.html');
      const result = await page.evaluate(
        async ({ lazySlides, explicit }) => {
          const { groupPlaceholderFiles, groupXml } =
            await import('/test/fixtures/group-placeholder-transform.ts');
          const { buildPresentation } = await import('/src/model/Presentation.ts');
          const { renderSlide } = await import('/src/renderer/SlideRenderer.ts');
          // Inverse: preserve child coordinates but inherit the omitted outer offset/extent.
          const p = buildPresentation(groupPlaceholderFiles(explicit ? groupXml() : groupXml('')), {
            lazySlides,
          });
          const h = renderSlide(p, p.slides[0]);
          document.body.style.margin = '0';
          document.body.append(h.element);
          await h.ready;
          const root = h.element.getBoundingClientRect();
          const group = h.element.lastElementChild!;
          const bounds = (el: Element) => {
            const b = el.getBoundingClientRect();
            return { x: b.x - root.x, y: b.y - root.y, w: b.width, h: b.height };
          };
          return {
            group: bounds(group),
            children: [...group.children].map(bounds),
            order: [...group.children].map((el) =>
              el.querySelector('svg path')?.getAttribute('fill'),
            ),
          };
        },
        { lazySlides, explicit },
      );
      expect(result.group).toEqual(
        explicit ? { x: 200, y: 100, w: 240, h: 120 } : { x: 10, y: 20, w: 600, h: 300 },
      );
      expect(result.children).toEqual(
        explicit
          ? [
              { x: 220, y: 120, w: 60, h: 20 },
              { x: 320, y: 160, w: 60, h: 20 },
            ]
          : [
              { x: 60, y: 70, w: 150, h: 50 },
              { x: 310, y: 170, w: 150, h: 50 },
            ],
      );
      expect(result.order).toEqual(['#FF0000', '#0000FF']);
    });
  }
}
