export interface CommandHandler<Command, Result> {
  execute(command: Command): Promise<Result>
}
