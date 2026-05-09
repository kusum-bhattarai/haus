import { DEFAULT_CREATIVE_MODEL } from './constants.js';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export const CREATIVE_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vibe_report', 'overall_mood', 'global_style_notes', 'negative_prompt', 'room_plans', 'warnings'],
  properties: {
    vibe_report: {
      type: 'object',
      additionalProperties: false,
      required: [
        'aesthetic_name',
        'summary',
        'palette_rationale',
        'lighting_mood',
        'materials',
        'textures',
        'furniture_language',
        'styling_rules',
        'avoid',
        'room_guidance',
        'confidence',
        'warnings'
      ],
      properties: {
        aesthetic_name: { type: 'string' },
        summary: { type: 'string' },
        palette_rationale: { type: 'string' },
        lighting_mood: { type: 'string' },
        materials: { type: 'array', items: { type: 'string' } },
        textures: { type: 'array', items: { type: 'string' } },
        furniture_language: { type: 'array', items: { type: 'string' } },
        styling_rules: { type: 'array', items: { type: 'string' } },
        avoid: { type: 'array', items: { type: 'string' } },
        room_guidance: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['room_id', 'headline', 'guidance', 'must_include', 'must_avoid'],
            properties: {
              room_id: { type: 'string' },
              headline: { type: 'string' },
              guidance: { type: 'string' },
              must_include: { type: 'array', items: { type: 'string' } },
              must_avoid: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        confidence: { type: 'number' },
        warnings: { type: 'array', items: { type: 'string' } }
      }
    },
    overall_mood: { type: 'string' },
    global_style_notes: { type: 'array', items: { type: 'string' } },
    negative_prompt: { type: 'string' },
    room_plans: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'room_id',
          'lighting_instruction',
          'dalle_scene_details',
          'video_prompt',
          'camera_motion',
          'duration_seconds',
          'must_include',
          'must_avoid'
        ],
        properties: {
          room_id: { type: 'string' },
          lighting_instruction: { type: 'string' },
          dalle_scene_details: { type: 'string' },
          video_prompt: { type: 'string' },
          camera_motion: {
            type: 'string',
            enum: ['slow_dolly', 'orbital_pan', 'aerial_drift', 'static_zoom']
          },
          duration_seconds: { type: 'integer' },
          must_include: { type: 'array', items: { type: 'string' } },
          must_avoid: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    warnings: { type: 'array', items: { type: 'string' } }
  }
};

export async function createCreativePlan({
  profile,
  model = process.env.OPENAI_CREATIVE_MODEL ?? DEFAULT_CREATIVE_MODEL,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch
}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for Layer 3 creative planning.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for Layer 3 creative planning.');
  }

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: [
        'You are a creative director for a luxury property visualization studio.',
        'Turn Pinterest aesthetic intelligence and floor plan structure into a structured vibe report plus room-level generation direction.',
        'Do not generate final DALL-E prompts; provide scene details that code can wrap in a consistent production template.',
        'Respect measured dimensions and room types. Avoid impossible staging.',
        'Return only schema-compliant JSON.'
      ].join(' '),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                task: 'Create a structured vibe report and per-room creative plan for real estate video generation.',
                source_payload: profile.source_payload,
                aesthetic_profile: profile.aesthetic_profile,
                cluster_summary: profile.cluster_summary,
                floor_plan: profile.floor_plan,
                representative_pins: profile.pins
                  .filter((pin) => pin.selected_for_mood_board)
                  .slice(0, 9)
                  .map((pin) => ({
                    pin_id: pin.pin_id,
                    title: pin.title,
                    description: pin.description,
                    cluster_label: pin.cluster_label,
                    hashtags: pin.hashtags
                  }))
              })
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'layer3_creative_plan',
          strict: true,
          schema: CREATIVE_PLAN_SCHEMA
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message ?? `OpenAI creative planning failed with status ${response.status}.`;
    throw new Error(message);
  }

  const outputText = body?.output_text ?? extractOutputText(body);
  if (typeof outputText !== 'string' || outputText.trim() === '') {
    throw new Error('OpenAI creative planning response did not include output text.');
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
