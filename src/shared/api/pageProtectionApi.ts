/** Typed IPC operations for password-protected pages. */
import { invoke } from '@tauri-apps/api/core'

/** Protection state of a workspace page. */
export type PageProtectionStatus = { path: string; isProtected: boolean; isLocked: boolean }

/** Structured error returned when a page needs its password. */
export type PageLockedError = { code: 'PageLocked'; path: string }

/** Identifies the locked-page response from the native backend. */
export function isPageLockedError(error: unknown): error is PageLockedError {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'PageLocked' && 'path' in error && typeof error.path === 'string'
}

/** Encrypts a plain page with its new password. */
export async function protectPage(path: string, password: string): Promise<void> {
  await invoke('protect_page', { path, password })
}

/** Unlocks a page for the current session. */
export async function unlockPage(path: string, password: string): Promise<void> {
  await invoke('unlock_page', { path, password })
}

/** Requires the password again for future decryptions. */
export async function lockPage(path: string): Promise<void> {
  await invoke('lock_page', { path })
}

/** Removes protection after verifying the current password. */
export async function unprotectPage(path: string, password: string): Promise<void> {
  await invoke('unprotect_page', { path, password })
}

/** Re-encrypts a page with a new password. */
export async function changePagePassword(path: string, currentPassword: string, nextPassword: string): Promise<void> {
  await invoke('change_page_password', { path, currentPassword, nextPassword })
}

/** Returns protection and lock states for workspace paths. */
export async function pageProtectionStatus(paths: string[]): Promise<PageProtectionStatus[]> {
  return await invoke('page_protection_status', { paths })
}
