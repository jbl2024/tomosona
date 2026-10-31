/** Retries a page read after the caller has unlocked the requested page. */
import { isPageLockedError } from '../api/pageProtectionApi'

/** Leaves ordinary failures untouched and asks for each locked page independently. */
export async function readWithPageUnlock<T>(read: () => Promise<T>, unlock: (path: string) => Promise<void>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (!isPageLockedError(error)) throw error
    await unlock(error.path)
    return await read()
  }
}
