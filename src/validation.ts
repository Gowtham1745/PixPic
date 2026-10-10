export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 6000;
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_OUTPUT_SIDE = 8192;
export const MAX_OUTPUT_PIXELS = 40_000_000;

export type ImageDetails = {
  width: number;
  height: number;
  size: number;
  file: File;
};

export async function inspectImage(file: File): Promise<ImageDetails> {
  const allowedTypes = ['image/jpeg', 'image/png'];
  const extension = file.name.split('.').pop()?.toLowerCase();
  const allowedExtensions = ['jpg', 'jpeg', 'png'];

  if (!allowedTypes.includes(file.type) || !extension || !allowedExtensions.includes(extension)) {
    throw new Error('Choose a JPG, JPEG, or PNG image.');
  }
  if (file.size === 0) {
    throw new Error('This file is empty. Choose another image.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('This image is larger than 12 MB. Choose a smaller file.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('We could not read this image. Try a different JPG or PNG file.');
  }

  const { width, height } = bitmap;
  bitmap.close();

  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE) {
    throw new Error(`Image dimensions must be no larger than ${MAX_IMAGE_SIDE.toLocaleString()} px on either side.`);
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new Error('This image has too many pixels to process. Choose a smaller image.');
  }

  return { width, height, size: file.size, file };
}

export function outputSizeError(width: number, height: number, scale: number): string | null {
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  if (outputWidth > MAX_OUTPUT_SIDE || outputHeight > MAX_OUTPUT_SIDE || outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
    return `At ${scale}×, this image would exceed the processing limits. Try a smaller image or a lower scale.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
