import { logEvent } from '#/platform/observability/logging.ts'
import { startTelemetry } from '#/platform/observability/telemetry.ts'

// The application owns its resources. This boundary owns process signals and
// keeps telemetry alive until those resources and in-flight requests are closed.
export async function startObservedApplication(
  start: () => Promise<() => Promise<void>>,
) {
  const telemetry = startTelemetry()
  let stop: () => Promise<void>
  try {
    stop = await start()
    logEvent('info', 'application.started')
  } catch (error) {
    logEvent('error', 'application.startup.failed')
    await telemetry.shutdown().catch(console.error)
    throw error
  }

  let stopping = false
  async function shutdown() {
    if (stopping) {
      return
    }
    stopping = true
    let exitCode = 0
    try {
      await stop()
      logEvent('info', 'application.stopped')
    } catch (error) {
      console.error(error)
      logEvent('error', 'application.shutdown.failed')
      exitCode = 1
    } finally {
      await telemetry.shutdown().catch((error) => {
        console.error(error)
        exitCode = 1
      })
      process.exit(exitCode)
    }
  }
  process.once('SIGINT', () => {
    void shutdown()
  })
  process.once('SIGTERM', () => {
    void shutdown()
  })
}
