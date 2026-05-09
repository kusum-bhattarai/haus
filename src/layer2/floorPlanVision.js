import { DEFAULT_FLOOR_PLAN_MODEL, ROOM_TYPES } from './constants.js';
import { createImageInputUrl } from './imageInput.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const FLOOR_PLAN_STRUCTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rooms', 'total_rooms', 'layout_type', 'confidence', 'notes'],
  properties: {
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'room_id',
          'name',
          'room_type',
          'area_estimate',
          'measured_dimensions',
          'measured_unit',
          'windows',
          'natural_light',
          'adjoins',
          'generation_priority'
        ],
        properties: {
          room_id: { type: 'string' },
          name: { type: 'string' },
          room_type: { type: 'string', enum: ROOM_TYPES },
          area_estimate: { type: 'string', enum: ['large', 'medium', 'small'] },
          measured_dimensions: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['width', 'length', 'area'],
            properties: {
              width: { type: 'number' },
              length: { type: 'number' },
              area: { type: 'number' }
            }
          },
          measured_unit: { type: ['string', 'null'], enum: ['ft', 'm', null] },
          windows: { type: 'string' },
          natural_light: { type: 'string', enum: ['high', 'medium', 'low', 'unknown'] },
          adjoins: {
            type: 'array',
            items: { type: 'string' }
          },
          generation_priority: { type: 'integer' }
        }
      }
    },
    total_rooms: { type: 'integer' },
    layout_type: { type: 'string', enum: ['open_plan', 'traditional', 'studio'] },
    confidence: { type: 'number' },
    notes: { type: ['string', 'null'] }
  }
};

export async function extractFloorPlanStructure({
  payload,
  model = process.env.OPENAI_FLOOR_PLAN_MODEL ?? DEFAULT_FLOOR_PLAN_MODEL,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for Layer 2 floor plan parsing.');
  }

  const imageUrl = await createImageInputUrl(
    payload.floor_plan_url,
    payload.floor_plan_metadata?.mime_type
  );

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: [
        'You are an architectural floor plan parser for an interior visualization pipeline.',
        'Use the provided structured measurements as context and do not contradict them.',
        'Create stable snake_case room ids. Prefer rooms useful for video generation.',
        'Return only schema-compliant JSON.'
      ].join(' '),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                task: 'Parse room structure, adjacency, light/window hints, and generation priority.',
                floor_plan_metadata: payload.floor_plan_metadata,
                floor_plan_measurements: payload.floor_plan_measurements
              })
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
          name: 'floor_plan_structure',
          strict: true,
          schema: FLOOR_PLAN_STRUCTURE_SCHEMA
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `OpenAI floor plan parsing failed with status ${response.status}.`;
    throw new Error(message);
  }

  const outputText = body?.output_text ?? extractOutputText(body);
  if (typeof outputText !== 'string' || outputText.trim() === '') {
    throw new Error('OpenAI floor plan response did not include output text.');
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
