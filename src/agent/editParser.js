const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const EDIT_INTENT_MODEL = 'gpt-4o-mini';

const EDIT_INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rooms', 'directive'],
  properties: {
    rooms: { type: 'array', items: { type: 'string' } },
    directive: { type: 'string' }
  }
};

export async function parseEditIntent(message, roomJobs, options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const roomList = roomJobs.map(({ room_id, room_name, room_type }) => ({ room_id, room_name, room_type }));
  const validRoomIds = new Set(roomJobs.map((r) => r.room_id));

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: options.model ?? EDIT_INTENT_MODEL,
      instructions: [
        'You parse edit requests for a real estate room visualization pipeline.',
        'Given a user message and a list of rooms, identify which rooms are affected and extract a concise visual directive.',
        'Rules:',
        '- rooms: array of room_id strings from the provided list only. Never invent room IDs.',
        '- If a specific room is mentioned by name, target only that room.',
        '- If the message is about the whole space or overall style, include all room IDs.',
        '- directive: a concise 3-15 word visual instruction (e.g., "warmer golden lighting", "add tall bookshelf on left wall").',
        '- Never include placement coordinates in the directive — those are passed separately.'
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                edit_message: message,
                available_rooms: roomList
              })
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'edit_intent',
          strict: true,
          schema: EDIT_INTENT_SCHEMA
        }
      }
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = body?.error?.message ?? `OpenAI edit intent failed with status ${response.status}.`;
    throw new Error(msg);
  }

  const outputText = body?.output_text ?? extractOutputText(body);
  if (typeof outputText !== 'string' || !outputText.trim()) {
    throw new Error('OpenAI edit intent response did not include output text.');
  }

  const parsed = JSON.parse(outputText);
  const rooms = (parsed.rooms ?? []).filter((id) => validRoomIds.has(id));

  return {
    rooms: rooms.length > 0 ? rooms : roomJobs.map((r) => r.room_id),
    directive: parsed.directive ?? message
  };
}

function extractOutputText(body) {
  if (!body?.output) return null;
  for (const item of body.output) {
    for (const part of item?.content ?? []) {
      if (part?.type === 'output_text') return part.text;
    }
  }
  return null;
}
