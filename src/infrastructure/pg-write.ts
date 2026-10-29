import { DatabaseError } from 'pg'
import type { ApplicationError } from '#/application/ports.ts'
import { InvalidInput } from '#/domain/errors.ts'
import { Result } from '#/shared-kernel/result.ts'

// Drizzle wraps driver errors in a query error; Kysely exposes them directly.
function isForeignKeyViolation(cause: unknown): boolean {
  if (cause instanceof DatabaseError) {
    return cause.code === '23503'
  }
  return cause instanceof Error && cause.cause !== undefined
    ? isForeignKeyViolation(cause.cause)
    : false
}

export async function pgWrite<Value>(
  operation: () => Promise<Result<Value, ApplicationError>>,
): Promise<Result<Value, ApplicationError>> {
  const result = await Result.tryPromise(operation, (cause) => {
    if (isForeignKeyViolation(cause)) {
      return new InvalidInput('Referenced venue or user does not exist')
    }
    throw cause
  })
  return Result.flatten(result)
}
