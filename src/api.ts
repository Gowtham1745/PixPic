const configuredApiUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? '';
const apiRoot = configuredApiUrl.replace(/\/+$/, '');

export type BackendHealth = {
  status: string;
  inference_available: boolean;
  models: Record<string, { ready: boolean; reason?: string }>;
};

export type EnhancementResult = {
  image: Blob;
  width: number | null;
  height: number | null;
};

type BrowserUpscaler = {
  upscale: (image: HTMLImageElement, options?: { output?: 'base64'; patchSize?: number; padding?: number }) => Promise<string>;
  dispose?: () => void;
};

declare global {
  interface Window {
    Upscaler?: new (options?: { model?: unknown }) => BrowserUpscaler;
    ESRGANSlim2x?: unknown;
    ESRGANSlim4x?: unknown;
  }
}

const loadedScripts = new Map<string, Promise<void>>();
const upscalers = new Map<number, BrowserUpscaler>();

function loadScript(src: string): Promise<void> {
  const existing = loadedScripts.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadedScripts.delete(src);
      reject(new Error(`Could not load script: ${src}`));
    };
    document.head.appendChild(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

async function loadScriptFromAny(urls: string[]): Promise<void> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      await loadScript(url);
      return;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : url);
    }
  }
  throw new Error(
    `Unable to download the free AI model libraries. Tried jsDelivr and unpkg. Check your internet connection or browser Shields/ad-blocker settings, then retry. Details: ${failures.join(' | ')}`,
  );
}

async function getBrowserUpscaler(scale: number): Promise<BrowserUpscaler> {
  const cached = upscalers.get(scale);
  if (cached) return cached;

  // All inference runs on the visitor's device. No image API or paid inference service is used.
  await loadScriptFromAny([
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js',
    'https://unpkg.com/@tensorflow/tfjs@latest/dist/tf.min.js',
  ]);
  await loadScriptFromAny([
    `https://cdn.jsdelivr.net/npm/@upscalerjs/esrgan-slim@latest/dist/umd/${scale}x.min.js`,
    `https://unpkg.com/@upscalerjs/esrgan-slim@latest/dist/umd/${scale}x.min.js`,
  ]);
  await loadScriptFromAny([
    'https://cdn.jsdelivr.net/npm/upscaler@latest/dist/browser/umd/upscaler.min.js',
    'https://unpkg.com/upscaler@latest/dist/browser/umd/upscaler.min.js',
  ]);

  const model = scale === 2 ? window.ESRGANSlim2x : window.ESRGANSlim4x;
  if (!window.Upscaler || !model) {
    throw new Error('The AI libraries loaded, but the ESRGAN model did not initialize. Refresh the page and try again.');
  }

  const instance = new window.Upscaler({ model });
  upscalers.set(scale, instance);
  return instance;
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected image could not be decoded by the browser.'));
    };
    image.src = url;
  });
}

function base64ToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('The AI model returned an invalid image.');
  const header = dataUrl.slice(0, comma);
  const mime = header.match(/^data:([^;]+)/)?.[1] ?? 'image/png';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not prepare an image tile for AI processing.'));
    image.src = canvas.toDataURL('image/png');
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export the enhanced image.'));
    }, 'image/png');
  });
}

async function enhanceInBrowser(file: File, scale: number): Promise<EnhancementResult> {
  const [upscaler, image] = await Promise.all([getBrowserUpscaler(scale), fileToImage(file)]);
  // Process bounded overlapping tiles instead of sending a huge source image into one
  // model call. This avoids TensorFlow/browser maximum-size errors on large photos.
  const tileSize = 512;
  const overlap = 16;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = image.naturalWidth * scale;
  outputCanvas.height = image.naturalHeight * scale;
  const context = outputCanvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the output canvas.');

  try {
    for (let y = 0; y < image.naturalHeight; y += tileSize) {
      for (let x = 0; x < image.naturalWidth; x += tileSize) {
        const coreWidth = Math.min(tileSize, image.naturalWidth - x);
        const coreHeight = Math.min(tileSize, image.naturalHeight - y);
        const left = Math.max(0, x - overlap);
        const top = Math.max(0, y - overlap);
        const right = Math.min(image.naturalWidth, x + coreWidth + overlap);
        const bottom = Math.min(image.naturalHeight, y + coreHeight + overlap);
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = right - left;
        tileCanvas.height = bottom - top;
        const tileContext = tileCanvas.getContext('2d');
        if (!tileContext) throw new Error('Your browser could not prepare an image tile.');
        tileContext.drawImage(image, left, top, tileCanvas.width, tileCanvas.height, 0, 0, tileCanvas.width, tileCanvas.height);
        const tileImage = await canvasToImage(tileCanvas);
        const output = await upscaler.upscale(tileImage, { output: 'base64', patchSize: 64, padding: 2 });
        if (typeof output !== 'string') throw new Error('The AI model returned an unexpected result.');
        const tileBlob = base64ToBlob(output);
        const enhancedTile = await createImageBitmap(tileBlob);
        const sourceX = (x - left) * scale;
        const sourceY = (y - top) * scale;
        context.drawImage(
          enhancedTile,
          sourceX, sourceY, coreWidth * scale, coreHeight * scale,
          x * scale, y * scale, coreWidth * scale, coreHeight * scale,
        );
        enhancedTile.close();
        tileImage.src = '';
        tileCanvas.width = 0;
        tileCanvas.height = 0;
      }
    }
    const blob = await canvasToBlob(outputCanvas);
    return { image: blob, width: outputCanvas.width, height: outputCanvas.height };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown model error';
    throw new Error(`Browser AI enhancement failed: ${detail}. Try 2× or a smaller image if your device runs out of memory.`);
  } finally {
    outputCanvas.width = 0;
    outputCanvas.height = 0;
  }
}

export async function getBackendHealth(): Promise<BackendHealth> {
  if (!apiRoot) {
    return {
      status: 'browser',
      inference_available: true,
      models: {
        photo_2x: { ready: true },
        photo_4x: { ready: true },
        illustration_4x: { ready: true, reason: 'Uses the general ESRGAN Slim 4× model in browser mode.' },
      },
    };
  }
  const response = await fetch(`${apiRoot}/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
  return (await response.json()) as BackendHealth;
}

export async function enhanceImage(file: File, scale: number, mode: 'photo' | 'illustration'): Promise<EnhancementResult> {
  if (!apiRoot) {
    if (mode === 'illustration' && scale !== 4) throw new Error('Illustration mode requires 4× enhancement.');
    return enhanceInBrowser(file, scale);
  }

  const form = new FormData();
  form.append('file', file);
  form.append('scale', String(scale));
  form.append('mode', mode);

  let response: Response;
  try {
    response = await fetch(`${apiRoot}/api/v1/enhance`, { method: 'POST', body: form });
  } catch {
    throw new Error('PixPic could not reach the configured AI service. Check its deployment URL, then try again.');
  }

  if (!response.ok) {
    let message = `The AI service returned an error (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {
      // Keep the status-based message if the service did not return JSON.
    }
    throw new Error(message);
  }

  const image = await response.blob();
  if (!image.type.startsWith('image/')) {
    throw new Error('The AI service returned an unexpected response. No image was saved.');
  }

  const width = Number(response.headers.get('X-Output-Width')) || null;
  const height = Number(response.headers.get('X-Output-Height')) || null;
  return { image, width, height };
}
