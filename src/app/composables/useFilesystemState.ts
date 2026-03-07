import { computed, ref } from 'vue'

type NotificationTone = 'error' | 'success' | 'info'

type NotificationState = {
  message: string
  tone: NotificationTone
  sticky: boolean
}

export function useFilesystemState() {
  const workingFolderPath = ref('')
  const notification = ref<NotificationState | null>(null)
  const selectedCount = ref(0)
  const indexingState = ref<'indexing' | 'indexed' | 'out_of_sync'>('indexed')
  let notificationTimer: ReturnType<typeof setTimeout> | null = null

  const hasWorkspace = computed(() => Boolean(workingFolderPath.value))
  const notificationMessage = computed(() => notification.value?.message ?? '')
  const notificationTone = computed<NotificationTone>(() => notification.value?.tone ?? 'info')

  const errorMessage = computed({
    get: () => notificationMessage.value,
    set: (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) {
        clearNotification()
        return
      }
      notifyError(trimmed)
    }
  })

  function setWorkspacePath(path: string) {
    workingFolderPath.value = path
  }

  function clearWorkspacePath() {
    workingFolderPath.value = ''
  }

  function clearNotificationTimer() {
    if (!notificationTimer) return
    clearTimeout(notificationTimer)
    notificationTimer = null
  }

  function clearNotification() {
    clearNotificationTimer()
    notification.value = null
  }

  function showNotification(
    message: string,
    tone: NotificationTone,
    options: { sticky?: boolean; timeoutMs?: number } = {}
  ) {
    const sticky = Boolean(options.sticky)
    const timeoutMs = options.timeoutMs ?? (tone === 'error' ? 6000 : 3500)
    clearNotificationTimer()
    notification.value = {
      message,
      tone,
      sticky
    }
    if (!sticky) {
      notificationTimer = setTimeout(() => {
        notification.value = null
        notificationTimer = null
      }, Math.max(800, timeoutMs))
    }
  }

  function notifyError(message: string, options: { sticky?: boolean; timeoutMs?: number } = {}) {
    showNotification(message, 'error', options)
  }

  function notifySuccess(message: string, options: { sticky?: boolean; timeoutMs?: number } = {}) {
    showNotification(message, 'success', options)
  }

  function notifyInfo(message: string, options: { sticky?: boolean; timeoutMs?: number } = {}) {
    showNotification(message, 'info', options)
  }

  return {
    workingFolderPath,
    notification,
    notificationMessage,
    notificationTone,
    errorMessage,
    selectedCount,
    indexingState,
    hasWorkspace,
    setWorkspacePath,
    clearWorkspacePath,
    clearNotification,
    showNotification,
    notifyError,
    notifySuccess,
    notifyInfo
  }
}
