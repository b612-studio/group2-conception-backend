import { EventSourceParserStream } from 'eventsource-parser/stream'
import * as v from 'valibot'

const message = process.argv.slice(2).join(' ') || 'List upcoming gaming events'
const userId =
  process.env.DEMO_USER_ID ?? '01900000-0000-7000-8000-000000000001'
const abort = new AbortController()
process.once('SIGINT', () => abort.abort())
const response = await fetch(
  `${process.env.API_URL ?? 'http://127.0.0.1:3000'}/chat`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ message }),
    signal: abort.signal,
  },
)
if (!response.ok || !response.body) {
  throw new Error(`HTTP ${response.status}: ${await response.text()}`)
}
const eventSchema = v.looseObject({
  type: v.string(),
  delta: v.optional(v.string()),
  message: v.optional(v.string()),
})
const events = response.body
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(new EventSourceParserStream())
let finished = false
const reader = events.getReader()
while (true) {
  const { value: event, done } = await reader.read()
  if (done) {
    break
  }
  if (event.data === '[DONE]') {
    continue
  }
  const chunk = v.parse(eventSchema, JSON.parse(event.data))
  if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
    process.stdout.write(chunk.delta ?? '')
  } else if (chunk.type.startsWith('TOOL_CALL_')) {
    console.error(`\n${chunk.type}: ${event.data}`)
  } else if (chunk.type === 'RUN_ERROR') {
    throw new Error(chunk.message ?? 'AI run failed')
  } else if (chunk.type === 'RUN_FINISHED') {
    finished = true
  }
}
console.log()
if (!finished) {
  throw new Error('Stream ended before RUN_FINISHED')
}
