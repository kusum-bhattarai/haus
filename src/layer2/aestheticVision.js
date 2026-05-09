import {
  DEFAULT_AESTHETIC_MODEL,
  DENSITY_TYPES,
  LIGHTING_TYPES,
  PALETTES,
  STYLE_ERAS
} from './constants.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const AESTHETIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'palette',
    'lighting',
    'density',
    'style_era',
    'dominant_colors',
    'mood_words',
    'pinterest_cluster_labels',
    'cluster_summary',
    'confidence'
  ],
  properties: {
    palette: { type: 'string', enum: PALETTES },
    lighting: { type: 'string', enum: LIGHTING_TYPES },
    density: { type: 'string', enum: DENSITY_TYPES },
    style_era: { type: 'string', enum: STYLE_ERAS },
    dominant_colors: {
      type: 'array',
      items: { type: 'string' }
    },
    mood_words: {
      type: 'array',
      items: { type: 'string' }
    },
    pinterest_cluster_labels: {
      type: 'array',
      items: { type: 'string' }
    },
    cluster_summary: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'pin_ids', 'visual_notes', 'weight'],
        properties: {
          label: { type: 'string' },
          pin_ids: {
            type: 'array',
            items: { type: 'string' }
          },
          visual_notes: { type: 'string' },
          weight: { type: 'number' }
        }
      }
    },
    confidence: { type: 'number' }
  }
};

export async function extractAestheticProfile({
  pins,
  model = process.env.OPENAI_AESTHETIC_MODEL ?? DEFAULT_AESTHETIC_MODEL,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for Layer 2 aesthetic extraction.');
  }

  if (!Array.isArray(pins) || pins.length === 0) {
    throw new Error('At least one Pinterest pin is required for aesthetic extraction.');
  }

  const content = [
    {
      type: 'input_text',
      text: [
        'Analyze these Pinterest inspiration pins for an interior design generation pipeline.',
        'Return a concise structured aesthetic profile.',
        'Use the provided pin ids in cluster_summary.pin_ids.',
        'dominant_colors must be 3 to 6 hex colors.',
        'mood_words and cluster labels should be specific enough to guide room staging.'
      ].join(' ')
    },
    ...pins.map((pin) => ({
      type: 'input_image',
      image_url: pin.image_url,
      detail: 'low'
    })),
    {
      type: 'input_text',
      text: JSON.stringify({
        pins: pins.map((pin) => ({
          pin_id: pin.pin_id,
          title: pin.title,
          description: pin.description,
          save_count: pin.save_count,
          hashtags: pin.hashtags
        }))
      })
    }
  ];

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: [
        'You are an interior design aesthetic analyst.',
        'Be precise, avoid generic labels, and return only schema-compliant JSON.',
        'Classify using the allowed enum values even when the board is mixed.'
      ].join(' '),
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'pinterest_aesthetic_profile',
          strict: true,
          schema: AESTHETIC_SCHEMA
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `OpenAI aesthetic extraction failed with status ${response.status}.`;
    throw new Error(message);
  }

  const outputText = body?.output_text ?? extractOutputText(body);
  if (typeof outputText !== 'string' || outputText.trim() === '') {
    throw new Error('OpenAI aesthetic response did not include output text.');
  }

  return JSON.parse(outputText);
}

function extractOutputText(responseBody) {
  const output = responseBody?.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    const textItem = item.content?.find((content) => content.type === 'output_text');
    if (typeof textItem?.text === 'string') return textItem.text;
  }

  return null;
}
