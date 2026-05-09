export const MAX_FLOOR_PLAN_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

export const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

export const OBJECT_CATALOG = new Set([
  'standing_desk',
  'crib',
  'wine_rack',
  'bookshelf',
  'yoga_mat',
  'home_studio',
  'dining_table',
  'home_gym'
]);

export const PLATFORMS = new Set([
  'all',
  'instagram',
  'tiktok',
  'listing',
  'portfolio'
]);

export const DEFAULT_PLATFORM = 'all';

export const DEFAULT_CACHE_DIR = '.haus-cache';
