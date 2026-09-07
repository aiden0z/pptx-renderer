export interface VisualStabilityOptions {
  intervalMs?: number;
  stableSamples?: number;
  timeoutMs?: number;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function timeoutError(timeoutMs: number): Error {
  return new Error(`Visual output did not stabilize within ${timeoutMs}ms`);
}

async function waitWithinDeadline<T>(
  work: Promise<T>,
  deadline: number,
  timeoutMs: number,
): Promise<T> {
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) throw timeoutError(timeoutMs);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(timeoutError(timeoutMs)), remainingMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function waitForImages(root: ParentNode): Promise<void> {
  await Promise.all(
    [...root.querySelectorAll('img')].map(async (image) => {
      if (image.complete && image.naturalWidth > 0) return;
      try {
        await image.decode();
      } catch {
        // A failed image remains visible as a browser placeholder and must not
        // keep the screenshot harness pending indefinitely.
      }
    }),
  );
}

function canvasFingerprint(canvas: HTMLCanvasElement): string {
  if (canvas.width <= 0 || canvas.height <= 0) return `${canvas.width}x${canvas.height}:empty`;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return `${canvas.width}x${canvas.height}:no-context`;

  try {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    let checksum = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const pixel =
        pixels[index] |
        (pixels[index + 1] << 8) |
        (pixels[index + 2] << 16) |
        (pixels[index + 3] << 24);
      hash ^= pixel;
      hash = Math.imul(hash, 16777619);
      checksum = (checksum + Math.imul(pixel ^ index, 2654435761)) | 0;
    }
    return `${canvas.width}x${canvas.height}:${hash >>> 0}:${checksum >>> 0}`;
  } catch {
    // Cross-origin bitmap content can taint a canvas. Image readiness and two
    // animation frames still provide a bounded fallback for those rare cases.
    return `${canvas.width}x${canvas.height}:tainted`;
  }
}

function canvasState(root: ParentNode): string {
  return [...root.querySelectorAll('canvas')].map(canvasFingerprint).join('|');
}

/**
 * Wait until visible canvas output stops changing across consecutive samples.
 * This is used by the screenshot/oracle page; it does not change SlideHandle.ready.
 */
export async function waitForVisualStability(
  root: ParentNode,
  options: VisualStabilityOptions = {},
): Promise<void> {
  const intervalMs = Math.max(1, options.intervalMs ?? 50);
  const stableSamples = Math.max(2, options.stableSamples ?? 3);
  const timeoutMs = Math.max(intervalMs * stableSamples, options.timeoutMs ?? 5_000);
  const deadline = performance.now() + timeoutMs;

  if (document.fonts?.ready) {
    await waitWithinDeadline(document.fonts.ready, deadline, timeoutMs);
  }
  await waitWithinDeadline(waitForImages(root), deadline, timeoutMs);
  await waitWithinDeadline(nextFrame(), deadline, timeoutMs);
  await waitWithinDeadline(nextFrame(), deadline, timeoutMs);

  if (root.querySelectorAll('canvas').length === 0) return;

  let previous = canvasState(root);
  let matchingSamples = 1;
  while (performance.now() < deadline) {
    await waitWithinDeadline(
      new Promise((resolve) => setTimeout(resolve, intervalMs)),
      deadline,
      timeoutMs,
    );
    await waitWithinDeadline(nextFrame(), deadline, timeoutMs);
    const current = canvasState(root);
    if (current === previous) {
      matchingSamples += 1;
      if (matchingSamples >= stableSamples) return;
    } else {
      previous = current;
      matchingSamples = 1;
    }
  }

  throw timeoutError(timeoutMs);
}
