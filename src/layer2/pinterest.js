import { DEFAULT_APIFY_TIMEOUT_SECONDS, DEFAULT_PIN_LIMIT } from './constants.js';

const APIFY_BASE_URL = 'https://api.apify.com/v2';

export async function scrapePinterestBoard({
  boardUrl,
  limit = DEFAULT_PIN_LIMIT,
  actorId = process.env.APIFY_PINTEREST_ACTOR_ID,
  token = process.env.APIFY_TOKEN,
  fetchImpl = globalThis.fetch
}) {
  if (!actorId) {
    throw new Error('APIFY_PINTEREST_ACTOR_ID is required for Pinterest scraping.');
  }

  if (!token) {
    throw new Error('APIFY_TOKEN is required for Pinterest scraping.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for Pinterest scraping.');
  }

  const encodedActorId = encodeURIComponent(actorId).replaceAll('%7E', '~');
  const url = new URL(`${APIFY_BASE_URL}/acts/${encodedActorId}/run-sync-get-dataset-items`);
  url.searchParams.set('token', token);
  url.searchParams.set('format', 'json');
  url.searchParams.set('clean', 'true');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('timeout', String(DEFAULT_APIFY_TIMEOUT_SECONDS));
  url.searchParams.set('maxItems', String(limit));

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      startUrls: [{ url: boardUrl }],
      maxItems: limit,
      maxPins: limit,
      proxyConfiguration: { useApifyProxy: true }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `Apify Pinterest scrape failed with status ${response.status}.`;
    throw new Error(message);
  }

  return normalizePinterestPins(body).slice(0, limit);
}

export function normalizePinterestPins(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => normalizePinterestPin(item, index))
    .filter((pin) => pin.image_url)
    .sort((left, right) => (right.save_count ?? 0) - (left.save_count ?? 0));
}

function normalizePinterestPin(item, index) {
  const imageUrl = firstString(
    item.image_url,
    item.imageUrl,
    item.image,
    item.imageURL,
    item.media?.images?.orig?.url,
    item.images?.orig?.url
  );

  const sourceUrl = firstString(item.source_url, item.sourceUrl, item.url, item.pinUrl, item.link) ?? imageUrl;
  const title = firstString(item.title, item.name, item.grid_title);
  const description = firstString(item.description, item.descriptionText, item.altText, item.closeup_description);
  const saveCount = firstNumber(item.save_count, item.saveCount, item.repin_count, item.repinCount);

  return {
    pin_id: firstString(item.pin_id, item.pinId, item.id) ?? `pin_${String(index + 1).padStart(3, '0')}`,
    source_url: sourceUrl,
    image_url: imageUrl,
    title: title ?? null,
    description: description ?? null,
    save_count: saveCount,
    hashtags: extractHashtags([title, description, ...(Array.isArray(item.hashtags) ? item.hashtags : [])]),
    cluster_label: null,
    selected_for_mood_board: index < 9
  };
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim() !== '')?.trim();
}

function firstNumber(...values) {
  const value = values.find((candidate) => typeof candidate === 'number' && Number.isFinite(candidate));
  return value ?? null;
}

function extractHashtags(values) {
  const tags = new Set();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/#([A-Za-z0-9_]+)/g)) {
      tags.add(match[1].toLowerCase());
    }
  }
  return [...tags];
}
