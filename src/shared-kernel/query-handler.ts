export interface QueryHandler<Query, Result> {
  execute(query: Query): Promise<Result>
}
