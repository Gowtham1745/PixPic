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

const CDN = 'https://cdn.jsdelivr.net/npm';
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
      reject(new Error('Could not load the free browser AI model. Check your internet connection and retry.'));
    };
    document.head.appendChild(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}

async function getBrowserUpscaler(scale: number): Promise<BrowserUpscaler> {
  const cached = upscalers.get(scale);
  if (cached) return cached;

  // All inference runs on the visitor's device. No image API or paid inference service is used.
  await loadScript(`${CDN}/@tensorflow/tfjs@4.22.0/dist/tf.min.js`);
  await loadScript(`${CDN}/@upscalerjs/esrgan-slim@1.0.0/dist/umd/${scale}x.min.js`);
  await loadScript(`${CDN}/upscaler@1.0.0/dist/browser/umd/upscaler.min.js`);

  const model = scale === 2 ? window.ESRGANSlim2x : window.ESRGANSlim4x;
  if (!window.Upscaler || !model) {
    throw new Error('The browser AI model did not initialize. Refresh the page and try again.');
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

async function enhanceInBrowser(file: File, scale: number): Promise<EnhancementResult> {
  const [upscaler, image] = await Promise.all([getBrowserUpscaler(scale), fileToImage(file)]);
  let output: string;
  try {
    output = await upscaler.upscale(image, { output: 'base64', patchSize: 64, padding: 2 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown model error';
    throw new Error(`Browser AI enhancement failed: ${detail}. Try a smaller image or use 2×.`);
  }
  if (typeof output !== 'string') throw new Error('The AI model returned an unexpected result.');
  const blob = base64ToBlob(output);
  const resultImage = await createImageBitmap(blob);
  const width = resultImage.width;
  const height = resultImage.height;
  resultImage.close();
  return { image: blob, width, height };
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
