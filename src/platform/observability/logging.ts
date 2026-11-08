import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import type { Attributes } from '@opentelemetry/api'

export function logEvent(
  severity: 'info' | 'error',
  message: string,
  attributes: Attributes = {},
) {
  // The SDK attaches the active trace and span IDs to the record.
  logs.getLogger('events-application').emit({
    severityNumber:
      severity === 'error' ? SeverityNumber.ERROR : SeverityNumber.INFO,
    severityText: severity.toUpperCase(),
    body: message,
    attributes,
  })
}
