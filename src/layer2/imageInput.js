import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function createImageInputUrl(imageUrl, mimeType = null) {
  const url = new URL(imageUrl);

  if (url.protocol === 'file:') {
    const filePath = fileURLToPath(url);
    const buffer = await readFile(filePath);
    const inferredMimeType = mimeType ?? inferMimeType(filePath);
    return `data:${inferredMimeType};base64,${buffer.toString('base64')}`;
  }

  return imageUrl;
}

function inferMimeType(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}
