import { watch, type Ref } from 'vue'

/**
 * Module: useAppShellEchoesRefresh
 *
 * Purpose:
 * - Refresh note Echoes when workspace indexing becomes ready again.
 *
 * Boundary:
 * - The helper only reacts to shell indexing state.
 * - It does not own Echoes loading state or any workspace mutation logic.
 */

type AppShellEchoesRefreshIndexingState = 'indexed' | 'indexing' | 'out_of_sync'

type UseAppShellEchoesRefreshOptions = {
  indexingState: Readonly<Ref<AppShellEchoesRefreshIndexingState>>
  refreshEchoes: () => void | Promise<void>
}

/**
 * Re-runs the active note Echoes query after indexing returns to an indexed state.
 */
export function useAppShellEchoesRefresh(options: UseAppShellEchoesRefreshOptions) {
  watch(
    () => options.indexingState.value,
    (state, previousState) => {
      if (state !== 'indexed' || previousState === 'indexed') return
      void options.refreshEchoes()
    }
  )
}
