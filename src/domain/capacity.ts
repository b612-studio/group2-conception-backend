import { InvalidInput } from '#/domain/errors.ts'
import { Result } from '#/shared-kernel/result.ts'

export class Capacity {
  private constructor(readonly value: number) {}

  static create(value: number): Result<Capacity, InvalidInput> {
    if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
      return Result.fail(
        new InvalidInput('Capacity must be a positive 32-bit integer'),
      )
    }
    return Result.succeed(new Capacity(value))
  }

  accommodates(seats: number): boolean {
    return seats <= this.value
  }

  equals(other: Capacity): boolean {
    return this.value === other.value
  }
}
