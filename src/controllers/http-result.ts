import type { Context } from 'hono'
import type { ApplicationError } from '#/application/ports.ts'
import { presentApplicationError } from '#/presentation/application-error.ts'
import { Failure, Result } from '#/shared-kernel/result.ts'
import { HttpStatusCode } from '#/presentation/http-code.ts'

export function httpFailure(context: Context, error: ApplicationError) {
  const { body, status } = presentApplicationError(error)
  return context.json(body, status)
}

export function httpError(context: Context, error: Failure<ApplicationError>) {
  const { body, status } = presentApplicationError(error.error)
  return context.json(body, status)
}

export function httpResult<Value>(
  context: Context,
  result: Result<Value, ApplicationError>,
  present: (value: Value) => object,
  status: HttpStatusCode.Created | HttpStatusCode.Ok = HttpStatusCode.Ok,
) {
  if (Result.isFailure(result)) {
    return httpFailure(context, result.error)
  }
  return context.json(present(result.value), status)
}
