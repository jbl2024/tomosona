import { ref, type Ref } from 'vue'
import { collectAffectedCodeBlocks } from '../lib/editorPerf'

/**
 * useCodeBlockUi
 *
 * Purpose:
 * - Encapsulate EditorJS code-block DOM decoration and interactions.
 *
 * Responsibilities:
 * - Autosize code textareas.
 * - Provide wrap toggle and copy-to-clipboard controls.
 * - React to editor DOM mutations and refresh affected code blocks.
 *
 * Boundaries:
 * - Operates only on DOM under the provided holder ref.
 * - Does not own editor persistence/state beyond local UI preferences.
 */
export function useCodeBlockUi(options: { holder: Ref<HTMLDivElement | null> }) {
  const codeWrapEnabled = ref(true)
  const codeCopyResetTimers = new WeakMap<HTMLButtonElement, number>()
  const pendingCodeUiBlocks = new Set<HTMLElement>()

  let codeUiObserver: MutationObserver | null = null
  let codeUiFrame: number | null = null
  let codeUiNeedsGlobalRefresh = false

  /**
   * Loads persisted code UI preferences from localStorage.
   */
  function initFromStorage() {
    codeWrapEnabled.value = window.localStorage.getItem('tomosona:editor:code-wrap') !== '0'
  }

  function autosizeCodeTextarea(textarea: HTMLTextAreaElement) {
    textarea.style.height = '0px'
    const next = Math.max(52, textarea.scrollHeight)
    textarea.style.height = `${next}px`
  }

  function setCodeWrapEnabled(next: boolean) {
    codeWrapEnabled.value = next
    window.localStorage.setItem('tomosona:editor:code-wrap', next ? '1' : '0')
  }

  function setCodeCopyState(button: HTMLButtonElement, copied: boolean) {
    if (copied) {
      button.classList.add('is-copied')
      button.setAttribute('aria-label', 'Copied')
    } else {
      button.classList.remove('is-copied')
      button.setAttribute('aria-label', 'Copy code')
    }
  }

  function setCodeWrapButtonState(button: HTMLButtonElement) {
    button.classList.toggle('is-active', codeWrapEnabled.value)
    button.setAttribute('aria-pressed', codeWrapEnabled.value ? 'true' : 'false')
    button.setAttribute('aria-label', codeWrapEnabled.value ? 'Disable word wrap' : 'Enable word wrap')
    button.title = codeWrapEnabled.value ? 'Disable word wrap' : 'Enable word wrap'
  }

  function applyCodeWrapToBlock(block: HTMLElement) {
    block.classList.toggle('tomosona-code-wrap-enabled', codeWrapEnabled.value)
    const textarea = block.querySelector('.ce-code__textarea') as HTMLTextAreaElement | null
    if (!textarea) return
    textarea.wrap = codeWrapEnabled.value ? 'soft' : 'off'
    autosizeCodeTextarea(textarea)
  }

  function refreshCodeWrapUi() {
    if (!options.holder.value) return
    ensureCodeBlockUi(options.holder.value)
    const buttons = Array.from(options.holder.value.querySelectorAll('.tomosona-code-wrap-btn')) as HTMLButtonElement[]
    buttons.forEach((button) => setCodeWrapButtonState(button))
  }

  async function copyCodeFromBlock(block: HTMLElement, button: HTMLButtonElement) {
    const textarea = block.querySelector('.ce-code__textarea') as HTMLTextAreaElement | null
    if (!textarea) return
    const text = textarea.value ?? ''

    try {
      await navigator.clipboard.writeText(text)
      setCodeCopyState(button, true)
      const prev = codeCopyResetTimers.get(button)
      if (typeof prev === 'number') window.clearTimeout(prev)
      const timer = window.setTimeout(() => {
        setCodeCopyState(button, false)
        codeCopyResetTimers.delete(button)
      }, 2000)
      codeCopyResetTimers.set(button, timer)
    } catch {
      setCodeCopyState(button, false)
    }
  }

  function initCodeTextarea(textarea: HTMLTextAreaElement) {
    if (textarea.dataset.tomosonaCodeInit === '1') return
    textarea.dataset.tomosonaCodeInit = '1'
    textarea.rows = 1
    textarea.spellcheck = false
    textarea.addEventListener('input', () => autosizeCodeTextarea(textarea))
  }

  function decorateCodeBlock(block: HTMLElement) {
    const textarea = block.querySelector('.ce-code__textarea') as HTMLTextAreaElement | null
    if (textarea) {
      initCodeTextarea(textarea)
      textarea.wrap = codeWrapEnabled.value ? 'soft' : 'off'
      autosizeCodeTextarea(textarea)
    }

    applyCodeWrapToBlock(block)

    let wrapButton = block.querySelector('.tomosona-code-wrap-btn') as HTMLButtonElement | null
    if (!wrapButton) {
      wrapButton = document.createElement('button')
      wrapButton.type = 'button'
      wrapButton.className = 'tomosona-code-wrap-btn'
      wrapButton.innerHTML = `
        <span class="icon-wrap-on" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" focusable="false" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h10.5" />
          </svg>
        </span>
        <span class="icon-wrap-off" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" focusable="false" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            <path stroke-linecap="round" stroke-linejoin="round" d="m16.5 16.5 3 3m0-3-3 3" />
          </svg>
        </span>
      `
      wrapButton.addEventListener('click', () => {
        setCodeWrapEnabled(!codeWrapEnabled.value)
        refreshCodeWrapUi()
      })
      block.appendChild(wrapButton)
    }
    setCodeWrapButtonState(wrapButton)

    if (block.querySelector('.tomosona-code-copy-btn')) return
    const copyButton = document.createElement('button')
    copyButton.type = 'button'
    copyButton.className = 'tomosona-code-copy-btn'
    copyButton.setAttribute('aria-label', 'Copy code')
    copyButton.innerHTML = `
      <span class="icon-copy" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" focusable="false" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125H4.5a1.125 1.125 0 0 1-1.125-1.125V8.25c0-.621.504-1.125 1.125-1.125h3.375"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.375c0-.621.504-1.125 1.125-1.125h9.125c.621 0 1.125.504 1.125 1.125v12.25c0 .621-.504 1.125-1.125 1.125h-9.125a1.125 1.125 0 0 1-1.125-1.125V3.375Z"/>
        </svg>
      </span>
      <span class="icon-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" focusable="false" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
        </svg>
      </span>
      <span class="copy-toast" aria-hidden="true">Copied!</span>
    `
    copyButton.addEventListener('click', () => {
      void copyCodeFromBlock(block, copyButton)
    })
    block.appendChild(copyButton)
  }

  /**
   * Decorates code blocks in the provided scope (or full holder when omitted).
   */
  function ensureCodeBlockUi(scope?: ParentNode | null) {
    if (!options.holder.value) return

    const root = scope ?? options.holder.value
    const blocks = new Set<HTMLElement>()

    if (root instanceof HTMLElement && root.matches('.ce-code')) {
      blocks.add(root)
    }
    if ('querySelectorAll' in root) {
      const found = Array.from(root.querySelectorAll('.ce-code')) as HTMLElement[]
      found.forEach((block) => blocks.add(block))
    }

    blocks.forEach((block) => {
      decorateCodeBlock(block)
    })
  }

  function scheduleCodeUiRefresh() {
    if (codeUiFrame !== null) return
    codeUiFrame = window.requestAnimationFrame(() => {
      codeUiFrame = null
      if (!options.holder.value) return

      if (codeUiNeedsGlobalRefresh) {
        ensureCodeBlockUi(options.holder.value)
      } else {
        pendingCodeUiBlocks.forEach((block) => ensureCodeBlockUi(block))
      }

      pendingCodeUiBlocks.clear()
      codeUiNeedsGlobalRefresh = false
    })
  }

  /**
   * Starts observing editor DOM mutations and refreshes affected code blocks.
   */
  function startObservers() {
    if (!options.holder.value || codeUiObserver) return
    codeUiObserver = new MutationObserver((records) => {
      if (!options.holder.value) return
      const blocks = collectAffectedCodeBlocks(records, options.holder.value)
      if (!blocks.length) return
      blocks.forEach((block) => pendingCodeUiBlocks.add(block))
      scheduleCodeUiRefresh()
    })
    codeUiObserver.observe(options.holder.value, { childList: true, subtree: true })
    codeUiNeedsGlobalRefresh = true
    scheduleCodeUiRefresh()
  }

  /**
   * Stops mutation/animation observers and clears pending UI refresh state.
   */
  function stopObservers() {
    if (codeUiObserver) {
      codeUiObserver.disconnect()
      codeUiObserver = null
    }
    if (codeUiFrame !== null) {
      window.cancelAnimationFrame(codeUiFrame)
      codeUiFrame = null
    }
    pendingCodeUiBlocks.clear()
    codeUiNeedsGlobalRefresh = false
  }

  return {
    codeWrapEnabled,
    initFromStorage,
    ensureCodeBlockUi,
    refreshCodeWrapUi,
    startObservers,
    stopObservers
  }
}
