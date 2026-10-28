import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const client = new Client({ name: 'events-cli', version: '1.0.0' })
try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`${process.env.API_URL ?? 'http://127.0.0.1:3000'}/mcp`),
      {
        requestInit: {
          headers: {
            'X-User-Id':
              process.env.DEMO_USER_ID ??
              '01900000-0000-7000-8000-000000000001',
          },
        },
      },
    ),
  )
  const name = process.argv[2]
  if (!name) {
    console.log(JSON.stringify(await client.listTools(), null, 2))
  } else {
    const result = await client.callTool({
      name,
      arguments: JSON.parse(process.argv[3] ?? '{}'),
    })
    console.log(JSON.stringify(result, null, 2))
    if (result.isError) {
      process.exitCode = 1
    }
  }
} finally {
  await client.close()
}
