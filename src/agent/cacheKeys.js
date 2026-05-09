import { createHash } from 'node:crypto';

export function hashJson(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function hashString(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}
