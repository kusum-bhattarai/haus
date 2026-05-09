import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ALLOWED_IMAGE_EXTENSIONS,
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_FLOOR_PLAN_BYTES
} from './constants.js';
import { validationIssue } from './errors.js';

export function isRemoteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isFileUrl(value) {
  try {
    return new URL(value).protocol === 'file:';
  } catch {
    return false;
  }
}

export function getImageExtension(value) {
  const pathname = isRemoteUrl(value) || isFileUrl(value)
    ? new URL(value).pathname
    : value;
  return path.extname(pathname).toLowerCase();
}

export function detectImageMime(buffer) {
  if (buffer.length >= 8) {
    const pngSignature = '89504e470d0a1a0a';
    if (buffer.subarray(0, 8).toString('hex') === pngSignature) {
      return 'image/png';
    }
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  return 'application/octet-stream';
}

export function extractImageDimensions(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24) {
    return {
      width_px: buffer.readUInt32BE(16),
      height_px: buffer.readUInt32BE(20)
    };
  }

  if (mimeType === 'image/jpeg') {
    return extractJpegDimensions(buffer);
  }

  return null;
}

function extractJpegDimensions(buffer) {
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }

    if (offset + 2 > buffer.length) {
      return null;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return null;
    }

    const isStartOfFrame = (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    );

    if (isStartOfFrame && segmentLength >= 7) {
      return {
        width_px: buffer.readUInt16BE(offset + 5),
        height_px: buffer.readUInt16BE(offset + 3)
      };
    }

    offset += segmentLength;
  }

  return null;
}

export async function validateLocalImage(inputPath) {
  const resolvedPath = isFileUrl(inputPath)
    ? fileURLToPath(inputPath)
    : path.resolve(inputPath);
  const issues = [];
  const extension = getImageExtension(resolvedPath);

  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    issues.push(validationIssue('floor_plan_image', 'unsupported_extension', 'Floor plan must be a PNG or JPG image.'));
  }

  let fileStat;
  try {
    fileStat = await stat(resolvedPath);
  } catch {
    issues.push(validationIssue('floor_plan_image', 'not_found', 'Floor plan image file was not found.'));
    return { ok: false, issues };
  }

  if (!fileStat.isFile()) {
    issues.push(validationIssue('floor_plan_image', 'not_file', 'Floor plan image must be a file.'));
  }

  if (fileStat.size > MAX_FLOOR_PLAN_BYTES) {
    issues.push(validationIssue('floor_plan_image', 'too_large', 'Floor plan image must be 10MB or smaller.'));
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const buffer = await readFile(resolvedPath);
  const mimeType = detectImageMime(buffer);
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    issues.push(validationIssue('floor_plan_image', 'invalid_image_bytes', 'Floor plan file contents must be PNG or JPG.'));
  }

  const dimensions = extractImageDimensions(buffer, mimeType);
  if (!dimensions) {
    issues.push(validationIssue('floor_plan_image', 'dimensions_unreadable', 'Floor plan image dimensions could not be read.'));
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');

  return {
    ok: issues.length === 0,
    issues,
    image: {
      path: resolvedPath,
      extension,
      size_bytes: fileStat.size,
      mime_type: mimeType,
      dimensions,
      sha256,
      buffer
    }
  };
}

export function validateRemoteImageUrl(urlValue) {
  const issues = [];

  if (!isRemoteUrl(urlValue)) {
    issues.push(validationIssue('floor_plan_image', 'invalid_url', 'Remote floor plan must be an HTTP or HTTPS URL.'));
    return { ok: false, issues };
  }

  const extension = getImageExtension(urlValue);
  if (!ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    issues.push(validationIssue('floor_plan_image', 'unsupported_extension', 'Remote floor plan URL must end in PNG, JPG, or JPEG.'));
  }

  return {
    ok: issues.length === 0,
    issues,
    image: {
      url: urlValue,
      extension
    }
  };
}

export function toFileUrl(filePath) {
  return pathToFileURL(filePath).toString();
}
