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

export async function getBackendHealth(): Promise<BackendHealth> {
  const response = await fetch(`${apiRoot}/health`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Health check returned ${response.status}.`);
  return (await response.json()) as BackendHealth;
}

export async function enhanceImage(file: File, scale: number, mode: 'photo' | 'illustration'): Promise<EnhancementResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('scale', String(scale));
  form.append('mode', mode);

  let response: Response;
  try {
    response = await fetch(`${apiRoot}/api/v1/enhance`, { method: 'POST', body: form });
  } catch {
    throw new Error('PixPic could not reach the AI service. Start the backend or check its deployment URL, then try again.');
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
