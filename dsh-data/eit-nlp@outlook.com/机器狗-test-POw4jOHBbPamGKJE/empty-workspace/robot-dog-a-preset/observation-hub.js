// Host-level registry of live observation instances.
//
// The observation plugin itself lives inside the robot-dog preset, so one copy
// exists per session. The Web UI routes live on the host and need to reach the
// most recently registered instance; this hub is that bridge.

export const name = 'observation-hub'

export function apply(ctx) {
  const stack = []

  ctx.root.provide('observation-hub', {
    register(handle) {
      stack.push(handle)
      return () => {
        const index = stack.indexOf(handle)
        if (index >= 0) stack.splice(index, 1)
      }
    },
    current() {
      return stack.at(-1) ?? null
    },
    // Release the live requirement only when it matches the expected mode, so
    // one session's task ending never disturbs another mode.
    releaseMode(mode) {
      const handle = stack.at(-1)
      return handle?.releaseMode?.(mode) ?? false
    },
  })
}
