export const DEFAULT_CREATIVE_MODEL = 'gpt-5-mini';
export const DEFAULT_FAL_VIDEO_MODEL = 'fal-ai/kling-video/v1.6/pro/image-to-video';

export const CAMERA_MOTION_BY_ROOM_TYPE = {
  living_room: 'slow_dolly',
  bedroom: 'static_zoom',
  kitchen: 'aerial_drift',
  bathroom: 'static_zoom',
  office: 'slow_dolly',
  dining_room: 'slow_dolly',
  other: 'slow_dolly'
};

export const LUXURY_CAMERA_MOTION_BY_ROOM_TYPE = {
  living_room: 'orbital_pan',
  bedroom: 'slow_dolly',
  kitchen: 'slow_dolly',
  bathroom: 'static_zoom',
  office: 'slow_dolly',
  dining_room: 'orbital_pan',
  other: 'slow_dolly'
};

export const DEFAULT_NEGATIVE_PROMPT = [
  'no people',
  'no pets',
  'no visible brand logos',
  'no clutter',
  'no warped furniture',
  'no distorted architecture',
  'no unreadable text'
].join(', ');

export const OBJECT_LABELS = {
  standing_desk: 'standing desk',
  crib: 'crib',
  wine_rack: 'wine rack',
  bookshelf: 'bookshelf',
  yoga_mat: 'yoga mat',
  home_studio: 'home studio setup',
  dining_table: 'dining table',
  home_gym: 'home gym equipment'
};

export const OBJECT_ROOM_PREFERENCES = {
  standing_desk: ['office', 'bedroom', 'living_room'],
  crib: ['bedroom'],
  wine_rack: ['dining_room', 'kitchen', 'living_room'],
  bookshelf: ['living_room', 'office', 'bedroom'],
  yoga_mat: ['bedroom', 'living_room', 'office'],
  home_studio: ['office', 'bedroom'],
  dining_table: ['dining_room', 'kitchen'],
  home_gym: ['other', 'bedroom', 'office']
};
