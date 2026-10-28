const baseUrl = 'http://127.0.0.1:3000'
const eventId = '01900000-0000-7000-8000-000000000004'
const userId = '01900000-0000-7000-8000-000000000001'
const venueId = '01900000-0000-7000-8000-000000000003'
const reservationId = '{{reservationId}}'
const event = {
  title: 'Game night',
  category: 'gaming',
  startsAt: '2099-06-15T18:00:00Z',
  capacity: 20,
  venueId,
}
let requestId = 0

function request(
  name: string,
  method: string,
  path: string,
  body?: unknown,
  mcp = false,
  identity = true,
) {
  return {
    name,
    request: {
      method,
      url: `${baseUrl}${path}`,
      header: [
        ...(body === undefined
          ? []
          : [{ key: 'Content-Type', value: 'application/json' }]),
        ...(mcp
          ? [
              { key: 'Accept', value: 'application/json, text/event-stream' },
              { key: 'MCP-Protocol-Version', value: '2025-11-25' },
            ]
          : []),
        ...(identity ? [{ key: 'X-User-Id', value: userId }] : []),
      ],
      ...(body === undefined
        ? {}
        : {
            body: {
              mode: 'raw',
              raw: JSON.stringify(body, null, 2),
              options: { raw: { language: 'json' } },
            },
          }),
    },
  }
}

function tool(name: string, arguments_: unknown, identity = true) {
  return request(
    `MCP: ${name}`,
    'POST',
    '/mcp',
    {
      jsonrpc: '2.0',
      id: ++requestId,
      method: 'tools/call',
      params: { name, arguments: arguments_ },
    },
    true,
    identity,
  )
}

const collection = {
  info: {
    name: 'Day 2: REST and MCP side by side',
    description:
      'Run initialization first. Each workflow pairs its real REST endpoint with an MCP tool. Both write to the same database; running both write requests performs the action twice. Copy reservationId from a response before cancelling. Every request sends Alice identity. Chat requires OPENROUTER_API_KEY.',
    schema:
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [{ key: 'reservationId', value: 'REPLACE_WITH_RESERVATION_ID' }],
  item: [
    {
      name: '0. MCP handshake and discovery',
      item: [
        request(
          'Initialize',
          'POST',
          '/mcp',
          {
            jsonrpc: '2.0',
            id: ++requestId,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'yaak-demo', version: '1.0.0' },
            },
          },
          true,
        ),
        request(
          'Initialized notification: 202',
          'POST',
          '/mcp',
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          true,
        ),
        request(
          'Discover tools and JSON Schemas',
          'POST',
          '/mcp',
          { jsonrpc: '2.0', id: ++requestId, method: 'tools/list', params: {} },
          true,
        ),
      ],
    },
    {
      name: '1. List events',
      item: [
        request('REST: GET /events', 'GET', '/events?category=gaming'),
        tool('list_events', { category: 'gaming' }),
      ],
    },
    {
      name: '2. Create event',
      item: [
        request('REST: POST /events', 'POST', '/events', event),
        tool('create_event', event),
      ],
    },
    {
      name: '3. Read event',
      item: [
        request('REST: GET /events/:eventId', 'GET', `/events/${eventId}`),
        tool('get_event', { eventId }),
      ],
    },
    {
      name: '4. Update event',
      item: [
        request('REST: PATCH /events/:eventId', 'PATCH', `/events/${eventId}`, {
          capacity: 20,
        }),
        tool('update_event', { eventId, patch: { capacity: 20 } }),
      ],
    },
    {
      name: '5. Reserve seats as Alice',
      item: [
        request(
          'REST: POST /events/:eventId/reservations',
          'POST',
          `/events/${eventId}/reservations`,
          { quantity: 2 },
          false,
          true,
        ),
        tool('reserve_event', { eventId, quantity: 2 }, true),
      ],
    },
    {
      name: '6. Read Alice reservations from either transport',
      item: [
        request(
          'REST: GET /me/reservations',
          'GET',
          '/me/reservations',
          undefined,
          false,
          true,
        ),
        tool('list_my_reservations', {}, true),
      ],
    },
    {
      name: '7. Cancel: replace reservationId first',
      item: [
        request(
          'REST: POST /reservations/:reservationId/cancellation',
          'POST',
          `/reservations/${reservationId}/cancellation`,
          undefined,
          false,
          true,
        ),
        tool('cancel_reservation', { reservationId }, true),
      ],
    },
    {
      name: '8. Compare business failures',
      item: [
        request(
          'REST: overbooking returns HTTP 409',
          'POST',
          `/events/${eventId}/reservations`,
          { quantity: 21 },
          false,
          true,
        ),
        tool('reserve_event', { eventId, quantity: 21 }, true),
      ],
    },
    {
      name: '9. Compare invalid inputs',
      item: [
        request('REST: bad UUID returns HTTP 400', 'GET', '/events/invalid'),
        tool('get_event', { eventId: 'invalid' }),
      ],
    },
    {
      name: '10. TanStack AI chat via MCP: SSE',
      item: [
        request(
          'POST /chat: stream my reservations',
          'POST',
          '/chat',
          { message: 'Show my reservations using your tools' },
          false,
          true,
        ),
      ],
    },
  ],
}
await Bun.write(
  'demo/yaak.postman_collection.json',
  `${JSON.stringify(collection, null, 2)}\n`,
)
console.log('Generated demo/yaak.postman_collection.json')
