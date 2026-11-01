/** Coordinates page protection with editor saves and status refreshes. */
import { changePagePassword, lockPage, protectPage, unprotectPage } from '../../shared/api/pageProtectionApi'

/** Dependencies owned by the shell and editor rather than the native API. */
export type PageProtectionActionOptions = {
  currentPath: () => string
  canProtect: (path: string) => boolean
  isUnsaved: () => boolean
  save: () => Promise<void>
  reload: () => Promise<void>
  refresh: (path: string) => Promise<void>
  prompt: (title: string, action: (password: string) => Promise<void>, options?: { confirm?: boolean }) => Promise<void>
  reportError: (message: string) => void
}

/** Performs protection changes only after pending edits have been saved. */
export function usePageProtectionActions(options: PageProtectionActionOptions) {
  async function run(action: 'protect' | 'unprotect' | 'change' | 'lock') {
    const path = options.currentPath()
    if (!path || !options.canProtect(path)) return
    const ensureSaved = () => {
      if (options.currentPath() !== path || options.isUnsaved()) throw new Error('Save the page before changing its protection.')
    }
    try {
      if (action === 'lock') {
        if (options.isUnsaved()) await options.save()
        ensureSaved()
        await lockPage(path)
      } else {
        if (options.isUnsaved()) await options.save()
        ensureSaved()
        if (action === 'protect') {
          await options.prompt('Choose a password (it cannot be recovered)', async (password) => {
            if (!password) throw 'Enter a password.'
            ensureSaved()
            await protectPage(path, password)
          }, { confirm: true })
        } else if (action === 'unprotect') {
          await options.prompt('Remove protection', (password) => {
            ensureSaved()
            return unprotectPage(path, password)
          })
        } else {
          let nextPassword = ''
          await options.prompt('Choose a new password', async (password) => {
            if (!password) throw 'Enter a password.'
            nextPassword = password
          }, { confirm: true })
          try {
            await options.prompt('Enter current password', (password) => {
              ensureSaved()
              return changePagePassword(path, password, nextPassword)
            })
          } finally {
            nextPassword = ''
          }
        }
        if (options.currentPath() === path) await options.reload()
      }
      window.dispatchEvent(new Event('page-protection-changed'))
      await options.refresh(path)
    } catch (error) {
      if (error instanceof Error && error.message === 'Password entry cancelled.') return
      options.reportError(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Page protection failed.')
    }
  }
  /**
   * Locks a note that is not the active document.
   *
   * Such a tab has no live editor, so there is nothing to save and no reload to
   * perform: only the native lock and the badge refresh apply.
   */
  async function lockPath(path: string) {
    if (!path || !options.canProtect(path)) return
    try {
      await lockPage(path)
      window.dispatchEvent(new Event('page-protection-changed'))
      await options.refresh(path)
    } catch (error) {
      options.reportError(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Page protection failed.')
    }
  }
  return { run, lockPath }
}
