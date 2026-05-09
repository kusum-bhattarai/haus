import { createHash } from 'node:crypto';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_VISION_MODEL = 'gpt-4.1-mini';

const FLOOR_PLAN_MEASUREMENTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'unit', 'scale', 'rooms', 'notes'],
  properties: {
    source: {
      type: 'string',
      enum: ['ml_parser']
    },
    unit: {
      type: ['string', 'null'],
      enum: ['ft', 'm', null]
    },
    scale: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['pixels', 'units'],
      properties: {
        pixels: { type: 'number' },
        units: { type: 'number' }
      }
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['room_id', 'name', 'dimensions', 'unit', 'confidence'],
        properties: {
          room_id: { type: ['string', 'null'] },
          name: { type: 'string' },
          dimensions: {
            type: 'object',
            additionalProperties: false,
            required: ['width', 'length', 'area'],
            properties: {
              width: { type: 'number' },
              length: { type: 'number' },
              area: { type: 'number' }
            }
          },
          unit: {
            type: ['string', 'null'],
            enum: ['ft', 'm', null]
          },
          confidence: {
            type: ['number', 'null']
          }
        }
      }
    },
    notes: {
      type: ['string', 'null']
    }
  }
};

export function createFloorPlanVisionCacheKey(floorPlanUrl, floorPlanMetadata) {
  if (floorPlanMetadata?.cache_key) {
    return floorPlanMetadata.cache_key;
  }

  return createHash('sha256').update(floorPlanUrl).digest('hex');
}

export async function extractFloorPlanMeasurementsWithVision({
  floorPlanUrl,
  localImage,
  model = process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for Layer 1 floor plan dimension extraction.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for OpenAI vision extraction.');
  }

  const imageUrl = localImage
    ? `data:${localImage.mime_type};base64,${localImage.buffer.toString('base64')}`
    : floorPlanUrl;

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: [
        'You are a precise architectural floor plan measurement extractor.',
        'Extract only room dimensions visibly printed or clearly inferable from a labeled scale on the floor plan.',
        'Do not guess dimensions. If dimensions are absent or unreadable, return an empty rooms array.',
        'Normalize room names but preserve their meaning. Use feet for ft/feet/inches plans and meters for metric plans.',
        'Return JSON that matches the provided schema.'
      ].join(' '),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'Read this floor plan and extract structured architectural room measurements.',
                'For each room with visible dimensions, return width, length, computed area, unit, and confidence from 0 to 1.',
                'If a room label is visible but dimensions are not, omit that room from rooms.',
                'If there is a printed scale, include it as pixels-to-units only when it can be determined confidently.'
              ].join(' ')
            },
            {
              type: 'input_image',
              image_url: imageUrl,
              detail: 'high'
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'floor_plan_measurements',
          strict: true,
          schema: FLOOR_PLAN_MEASUREMENTS_SCHEMA
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `OpenAI vision request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const outputText = body?.output_text ?? extractOutputText(body);
  if (typeof outputText !== 'string' || outputText.trim() === '') {
    throw new Error('OpenAI vision response did not include output text.');
  }

  return JSON.parse(outputText);
}

function extractOutputText(responseBody) {
  const output = responseBody?.output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    const textItem = item.content.find((content) => content.type === 'output_text');
    if (typeof textItem?.text === 'string') {
      return textItem.text;
    }
  }

  return null;
}
