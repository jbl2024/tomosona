import { computed, ref } from 'vue'

export type HeadingNode = {
  level: 1 | 2 | 3
  text: string
}

export type FileEditorStatus = {
  dirty: boolean
  saving: boolean
  saveError: string
}

export function useEditorState() {
  const fileStatus = ref<Record<string, FileEditorStatus>>({})
  const activeOutline = ref<HeadingNode[]>([])
  const revealSnippetByPath = ref<Record<string, string>>({})

  const defaultStatus: FileEditorStatus = {
    dirty: false,
    saving: false,
    saveError: ''
  }

  function getStatus(path: string): FileEditorStatus {
    return fileStatus.value[path] ?? defaultStatus
  }

  function updateStatus(path: string, next: FileEditorStatus) {
    fileStatus.value = {
      ...fileStatus.value,
      [path]: next
    }
  }

  function clearStatus(path: string) {
    const next = { ...fileStatus.value }
    delete next[path]
    fileStatus.value = next
  }

  function setActiveOutline(outline: HeadingNode[]) {
    activeOutline.value = outline
  }

  function setRevealSnippet(path: string, snippet: string) {
    revealSnippetByPath.value = {
      ...revealSnippetByPath.value,
      [path]: snippet
    }
  }

  function consumeRevealSnippet(path: string): string {
    const snippet = revealSnippetByPath.value[path] ?? ''
    if (!snippet) return ''
    const next = { ...revealSnippetByPath.value }
    delete next[path]
    revealSnippetByPath.value = next
    return snippet
  }

  function movePath(fromPath: string, toPath: string) {
    if (!fromPath || !toPath || fromPath === toPath) return

    const status = fileStatus.value[fromPath]
    if (status) {
      const next = { ...fileStatus.value }
      delete next[fromPath]
      next[toPath] = status
      fileStatus.value = next
    }

    const snippet = revealSnippetByPath.value[fromPath]
    if (snippet) {
      const next = { ...revealSnippetByPath.value }
      delete next[fromPath]
      next[toPath] = snippet
      revealSnippetByPath.value = next
    }
  }

  const hasUnsaved = computed(() =>
    Object.values(fileStatus.value).some((status) => status.dirty)
  )

  return {
    fileStatus,
    activeOutline,
    hasUnsaved,
    getStatus,
    updateStatus,
    clearStatus,
    setActiveOutline,
    setRevealSnippet,
    consumeRevealSnippet,
    movePath
  }
}
