// A recipient is not an Events user. Notifications owns preferences and inbox state.
export interface Recipient {
  readonly id: string
  readonly bookingUserRef: string
  readonly inboxEnabled: boolean
}

export interface Notification {
  readonly id: string
  readonly recipientId: string
  readonly sourceMessageId: string
  readonly bookingRef: string
  readonly subject: string
  readonly body: string
  readonly createdAt: Date
  readonly readAt: Date | null
}

export interface BookingNotice {
  readonly sourceMessageId: string
  readonly bookingUserRef: string
  readonly bookingRef: string
  readonly kind: 'confirmed' | 'cancelled'
  readonly seats: number
  readonly occurredAt: Date
}

export function composeNotification(
  notice: BookingNotice,
  recipient: Recipient,
  id: string,
): Notification {
  return {
    id,
    recipientId: recipient.id,
    sourceMessageId: notice.sourceMessageId,
    bookingRef: notice.bookingRef,
    subject:
      notice.kind === 'confirmed' ? 'Booking confirmed' : 'Booking cancelled',
    body: `${notice.seats} seat(s). Booking reference: ${notice.bookingRef}.`,
    createdAt: notice.occurredAt,
    readAt: null,
  }
}
