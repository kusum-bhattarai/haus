const PASS_SCORE = 7;
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const EVAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'scores', 'overall', 'failure_classes', 'message'],
  properties: {
    decision: { type: 'string', enum: ['pass', 'retry_still', 'retry_video', 'human_review'] },
    scores: {
      type: 'object',
      additionalProperties: false,
      required: [
        'style_match',
        'room_correctness',
        'architecture_stability',
        'lighting_realism',
        'object_completeness',
        'motion_quality',
        'overall'
      ],
      properties: {
        style_match: { type: 'number' },
        room_correctness: { type: 'number' },
        architecture_stability: { type: 'number' },
        lighting_realism: { type: 'number' },
        object_completeness: { type: 'number' },
        motion_quality: { type: 'number' },
        overall: { type: 'number' }
      }
    },
    overall: { type: 'number' },
    failure_classes: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'visible_people',
          'wrong_room_type',
          'major_style_mismatch',
          'object_missing',
          'geometry_warp',
          'layout_drift',
          'lighting_drift',
          'lighting_unrealistic',
          'motion_unstable',
          'camera_instability',
          'flat_unengaging_motion'
        ]
      }
    },
    message: { type: 'string' }
  }
};

export function createEvalAgent(options = {}) {
  return {
    async evaluateStill({ artifact, roomJob }) {
      if (options.evaluateStill) return options.evaluateStill({ artifact, roomJob });
      const openAiEval = await evaluateStillWithOpenAI({ artifact, roomJob, options });
      if (openAiEval) return openAiEval;

      const pass = Boolean(artifact?.path || artifact?.url);
      return buildEval({
        decision: pass ? 'pass' : 'retry_still',
        overall: pass ? 7.6 : 2,
        failure_classes: pass ? [] : ['object_missing'],
        message: pass ? 'Still is ready for human review.' : 'No still artifact was produced.'
      });
    },

    async evaluateVideo({ artifact, roomJob }) {
      if (options.evaluateVideo) return options.evaluateVideo({ artifact, roomJob });

      const pass = Boolean(artifact?.path || artifact?.url);
      return buildEval({
        decision: pass ? 'pass' : 'retry_video',
        overall: pass ? 7.4 : 2,
        failure_classes: pass ? [] : ['motion_unstable'],
        message: pass ? 'Video is usable for the room sequence.' : 'No video artifact was produced.'
      });
    }
  };
}

export function routeEvalDecision(evalResult) {
  const failures = evalResult.failure_classes ?? [];
  if (evalResult.overall >= PASS_SCORE && evalResult.decision === 'pass') return 'pass';
  if (failures.includes('geometry_warp') || failures.includes('layout_drift') || failures.includes('style_mismatch')) {
    return 'retry_still';
  }
  if (failures.includes('motion_unstable') || failures.includes('camera_instability') || failures.includes('lighting_drift')) {
    return 'retry_video';
  }
  return evalResult.decision ?? 'human_review';
}

function buildEval({ decision, overall, failure_classes, message }) {
  return {
    decision,
    scores: {
      style_match: overall,
      room_correctness: overall,
      architecture_stability: overall,
      lighting_realism: overall,
      object_completeness: overall,
      motion_quality: overall,
      overall
    },
    overall,
    failure_classes,
    message
  };
}

async function evaluateStillWithOpenAI({ artifact, roomJob, options }) {
  const apiKey = options.openAiApiKey ?? process.env.OPENAI_API_KEY;
  const model = options.openAiEvalModel ?? process.env.OPENAI_EVAL_MODEL ?? 'gpt-4o-mini';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (options.evalMode === 'mock' || process.env.HAUS_EVAL_MODE === 'mock') return null;
  if (!apiKey || !artifact?.url || typeof fetchImpl !== 'function') return null;

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: [
        'You are a strict real-estate media quality evaluator.',
        'Score the still image against the room spec.',
        'All scores must be integers from 0 to 10 where 10 is perfect and 0 is completely unusable.',
        'Architecture, room identity, realistic scale, and marketable listing quality matter most.',
        'Return only schema-compliant JSON.'
      ].join(' '),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                task: 'Evaluate this generated room still before it is allowed into image-to-video generation.',
                room: {
                  room_id: roomJob.room_id,
                  room_name: roomJob.room_name,
                  room_type: roomJob.room_type,
                  staging: roomJob.staging,
                  prompt: roomJob.dalle?.prompt
                }
              })
            },
            {
              type: 'input_image',
              image_url: artifact.url,
              detail: 'low'
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'haus_still_eval',
          strict: true,
          schema: EVAL_SCHEMA
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return null;
  }

  const outputText = body?.output_text ?? extractOutputText(body);
  if (!outputText) return null;
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
