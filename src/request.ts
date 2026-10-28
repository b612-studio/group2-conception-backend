import type * as v from 'valibot'
import type {
  ApplicationError,
  EventRepository,
} from '#/domain/event-repository.ts'
import type { UserId } from '#/domain/ids.ts'
import { InvalidInput, Unauthorized } from '#/domain/errors.ts'
import { parse, userIdSchema } from '#/validation.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export async function requestUser(
  repository: EventRepository,
  provided: Option<string>,
): Promise<Result<UserId, ApplicationError>> {
  if (Option.isNone(provided)) {
    return Result.fail(
      new Unauthorized('A known X-User-Id is required for this demo'),
    )
  }
  const parsed = parse(userIdSchema, provided.value)
  if (parsed._tag === 'Failure') {
    return parsed
  }
  if (!(await repository.userExists(parsed.value))) {
    return Result.fail(
      new Unauthorized('A known X-User-Id is required for this demo'),
    )
  }
  return Result.succeed(parsed.value)
}

export async function requestJson<Schema extends v.GenericSchema>(
  request: Request,
  schema: Schema,
): Promise<Result<v.InferOutput<Schema>, InvalidInput>> {
  const input = await Result.tryPromise(
    (): Promise<unknown> => request.json(),
    () => new InvalidInput('Request body must be valid JSON'),
  )
  if (input._tag === 'Failure') {
    return input
  }
  return parse(schema, input.value)
}
