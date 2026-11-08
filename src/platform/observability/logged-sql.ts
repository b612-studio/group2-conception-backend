import type { SQL } from 'bun'
import { trace } from '@opentelemetry/api'
import { logEvent } from './logging.ts'

function recordStatement(statement: string) {
  const attributes = {
    'db.system.name': 'postgresql',
    'db.query.text': statement.trim(),
  }
  trace.getActiveSpan()?.setAttributes(attributes)
  logEvent('info', 'Executing SQL query', attributes)
}

// For scalar-bound templates only. Keep values out of telemetry and forward the
// original template to Bun unchanged. SQL helpers/fragments need driver-aware rendering.
export function loggedSql(sql: SQL) {
  function query<Value = Record<string, unknown>[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) {
    recordStatement(
      strings.reduce(
        (text, part, index) => text + (index === 0 ? '' : `$${index}`) + part,
        '',
      ),
    )
    return sql<Value>(strings, ...values)
  }

  // The caller must use placeholders, never concatenate user input into text.
  query.unsafe = <Value = Record<string, unknown>[]>(
    statement: string,
    values?: Parameters<SQL['unsafe']>[1],
  ) => {
    recordStatement(statement)
    return sql.unsafe<Value>(statement, values)
  }

  return query
}
