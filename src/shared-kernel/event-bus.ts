export type MessageListener<Message> = (
  message: Message,
) => Promise<void> | void
export type Unsubscribe = () => void

export interface EventBus<Message> {
  subscribe(listener: MessageListener<Message>): Unsubscribe
  publish(message: Message): Promise<void>
}
