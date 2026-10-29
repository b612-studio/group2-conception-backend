import type * as v from 'valibot'
import type { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type { ApplicationError } from '#/features/events/application/ports.ts'
import type { UserId } from '#/features/events/domain/ids.ts'
import { InvalidInput } from '#/features/events/domain/errors.ts'
import {
  parse,
  parseOption,
  userIdSchema,
} from '#/features/events/validation.ts'
import type { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export async function requestUser(
  identity: DemoIdentity,
  provided: Option<string>,
): Promise<Result<UserId, ApplicationError>> {
  const parsed = parseOption(userIdSchema, provided)
  if (Result.isFailure(parsed)) {
    return parsed
  }
  return identity.requireUser(parsed.value)
}

export async function requestJson<Schema extends v.GenericSchema>(
  request: Request,
  schema: Schema,
): Promise<Result<v.InferOutput<Schema>, InvalidInput>> {
  const input = await Result.tryPromise(
    (): Promise<unknown> => request.json(),
    () => new InvalidInput('Request body must be valid JSON'),
  )
  if (Result.isFailure(input)) {
    return input
  }
  return parse(schema, input.value)
}
