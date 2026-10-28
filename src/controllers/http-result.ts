import type { Context } from 'hono'
import type { ApplicationError } from '#/application/ports.ts'
import { Conflict, NotFound, Unauthorized } from '#/domain/errors.ts'
import type { Result } from '#/shared-kernel/result.ts'

export function httpFailure(context: Context, error: ApplicationError) {
  if (error instanceof Conflict) {
    return context.json(
      { error: { code: 'CONFLICT', message: error.message } },
      409,
    )
  }
  if (error instanceof NotFound) {
    return context.json(
      { error: { code: 'NOT_FOUND', message: error.message } },
      404,
    )
  }
  if (error instanceof Unauthorized) {
    return context.json(
      { error: { code: 'UNAUTHORIZED', message: error.message } },
      401,
    )
  }
  return context.json(
    { error: { code: 'INVALID_INPUT', message: error.message } },
    400,
  )
}

export function httpResult<Value>(
  context: Context,
  result: Result<Value, ApplicationError>,
  present: (value: Value) => object,
  status: 200 | 201 = 200,
) {
  if (result._tag === 'Failure') {
    return httpFailure(context, result.error)
  }
  return context.json(present(result.value), status)
}
