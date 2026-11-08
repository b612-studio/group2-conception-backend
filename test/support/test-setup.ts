import { setDefaultTimeout } from 'bun:test'

// Integration setup may need to pull and start PostgreSQL and Valkey containers.
const testTimeoutMillis = 120_000

setDefaultTimeout(testTimeoutMillis)
