<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ThemeColorScheme } from '../../../shared/lib/themeRegistry'
import { closeTerminalSession, listenTerminalClosed, listenTerminalOutput, resizeTerminalSession, startTerminalSession, writeTerminalSession, type TerminalOutput } from '../../../shared/api/terminalApi'
import { resolveTerminalBuiltinCommand } from '../../lib/terminalCommands'

/** Owns docked terminal tabs. Hiding the panel preserves their shells and buffers. */
const props = defineProps<{ visible: boolean; workspacePath: string; currentFilePath: string; colorScheme: ThemeColorScheme }>()
const emit = defineEmits<{ close: [] }>()

type TerminalTab = { id: string; label: string; sessionId: string | null; error: string }
type TerminalRuntime = { terminal: Terminal; fitAddon: FitAddon; resizeObserver: ResizeObserver }

const tabs = ref<TerminalTab[]>([])
const activeTabId = ref<string | null>(null)
const terminalHeight = ref(210)
const hosts = new Map<string, HTMLElement>()
const runtimes = new Map<string, TerminalRuntime>()
const typedInputByTab = new Map<string, string>()
const endedSessionIds = new Set<string>()
let tabSequence = 1
let unlisten: (() => void) | null = null
let listenerPromise: Promise<void> | null = null
let resizeStartY = 0
let resizeStartHeight = 0

function terminalTheme() {
  return props.colorScheme === 'light'
    ? { background: '#fbf9fc', foreground: '#302b35', cursor: '#b23b86', selectionBackground: '#b23b8640', black: '#302b35', brightBlack: '#807887', green: '#24734f', brightGreen: '#16815a', magenta: '#b23b86', brightMagenta: '#8f2869' }
    : { background: '#282c34', foreground: '#abb2bf', cursor: '#61afef', selectionBackground: '#3e4451', black: '#282c34', brightBlack: '#5c6370', green: '#98c379', brightGreen: '#b6d98e', magenta: '#c678dd', brightMagenta: '#d19aef' }
}

function setTerminalHost(tabId: string, element: unknown) {
  if (element instanceof HTMLElement) hosts.set(tabId, element)
  else hosts.delete(tabId)
}

function updateTab(tabId: string, patch: Partial<TerminalTab>) {
  const tab = tabs.value.find((item) => item.id === tabId)
  if (tab) Object.assign(tab, patch)
}

async function ensureOutputListener() {
  if (unlisten) return
  if (!listenerPromise) {
    listenerPromise = Promise.all([
      listenTerminalOutput((output: TerminalOutput) => {
        const tab = tabs.value.find((item) => item.sessionId === output.session_id)
        if (tab) runtimes.get(tab.id)?.terminal.write(output.data)
      }),
      listenTerminalClosed((closed) => {
        endedSessionIds.add(closed.session_id)
        const tab = tabs.value.find((item) => item.sessionId === closed.session_id)
        if (tab) {
          endedSessionIds.delete(closed.session_id)
          void closeTerminalTab(tab.id)
        }
      })
    ]).then(([stopOutput, stopClosed]) => { unlisten = () => { stopOutput(); stopClosed() } })
  }
  await listenerPromise
}

async function syncSize(tabId: string) {
  const tab = tabs.value.find((item) => item.id === tabId)
  const runtime = runtimes.get(tabId)
  if (!tab?.sessionId || !runtime || tabId !== activeTabId.value || !props.visible) return
  runtime.fitAddon.fit()
  await resizeTerminalSession(tab.sessionId, runtime.terminal.cols, runtime.terminal.rows).catch(() => undefined)
}

function focusActiveTab() {
  const tabId = activeTabId.value
  if (!tabId) return
  void nextTick(async () => {
    await syncSize(tabId)
    runtimes.get(tabId)?.terminal.focus()
  })
}

function routeTerminalInput(tabId: string, data: string) {
  const previous = typedInputByTab.get(tabId) ?? ''
  const commandInput = data.endsWith('\r') ? previous + data.slice(0, -1) : ''
  const builtin = commandInput
    ? resolveTerminalBuiltinCommand(commandInput, props.currentFilePath, props.workspacePath)
    : null
  const session = tabs.value.find((item) => item.id === tabId)?.sessionId
  if (!session) return

  if (builtin) {
    typedInputByTab.set(tabId, '')
    void writeTerminalSession(session, `\x15${builtin}\r`).catch(() => undefined)
    return
  }
  if (data.endsWith('\r')) typedInputByTab.set(tabId, '')
  else if (data === '\x7f') typedInputByTab.set(tabId, previous.slice(0, -1))
  else if (data === '\x15') typedInputByTab.set(tabId, '')
  else if (!/[\x00-\x1f\x7f]/.test(data)) typedInputByTab.set(tabId, previous + data)
  void writeTerminalSession(session, data).catch(() => undefined)
}

async function createTerminalTab() {
  if (!props.workspacePath) return
  const id = `terminal-tab-${tabSequence}`
  const label = `Terminal ${tabSequence}`
  tabSequence += 1
  tabs.value = [...tabs.value, { id, label, sessionId: null, error: '' }]
  activeTabId.value = id
  await nextTick()
  // The panel can have just transitioned from `display: none`; wait one frame
  // for Vue to attach the keyed xterm host before opening the terminal.
  let host = hosts.get(id)
  if (!host) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    host = hosts.get(id)
  }
  if (!host) {
    updateTab(id, { error: 'Impossible de préparer cet onglet.' })
    return
  }

  const terminal = new Terminal({ cursorBlink: true, cursorStyle: 'block', convertEol: true, fontFamily: '"SF Mono", "Cascadia Mono", "Courier New", monospace', fontSize: 13, lineHeight: 1.2, scrollback: 5000, theme: terminalTheme() })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(host)
  const resizeObserver = new ResizeObserver(() => void syncSize(id))
  resizeObserver.observe(host)
  runtimes.set(id, { terminal, fitAddon, resizeObserver })

  try {
    await ensureOutputListener()
    const sessionId = await startTerminalSession(props.currentFilePath || undefined)
    updateTab(id, { sessionId })
    if (endedSessionIds.delete(sessionId)) {
      await closeTerminalTab(id)
      return
    }
    terminal.writeln(`\x1b[2mWorkspace shell · ${props.workspacePath}\x1b[0m\r\n`)
    terminal.onData((data) => routeTerminalInput(id, data))
    focusActiveTab()
  } catch {
    updateTab(id, { error: 'Impossible de démarrer le shell.' })
  }
}

async function disposeTab(tabId: string) {
  const tab = tabs.value.find((item) => item.id === tabId)
  const runtime = runtimes.get(tabId)
  runtime?.resizeObserver.disconnect()
  runtime?.terminal.dispose()
  runtimes.delete(tabId)
  typedInputByTab.delete(tabId)
  if (tab?.sessionId) await closeTerminalSession(tab.sessionId).catch(() => undefined)
}

async function closeTerminalTab(tabId: string) {
  const index = tabs.value.findIndex((item) => item.id === tabId)
  if (index < 0) return
  await disposeTab(tabId)
  tabs.value = tabs.value.filter((item) => item.id !== tabId)
  if (!tabs.value.length) {
    activeTabId.value = null
    emit('close')
    return
  }
  if (activeTabId.value === tabId) activeTabId.value = tabs.value[Math.min(index, tabs.value.length - 1)].id
}

async function disposeAllTabs() {
  await Promise.all(tabs.value.map((tab) => disposeTab(tab.id)))
  tabs.value = []
  activeTabId.value = null
}

function clampHeight(value: number) { return Math.min(Math.max(value, 150), Math.round(window.innerHeight * 0.7)) }
function onResizeMove(event: PointerEvent) { terminalHeight.value = clampHeight(resizeStartHeight + resizeStartY - event.clientY) }
function stopResize() { window.removeEventListener('pointermove', onResizeMove); window.removeEventListener('pointerup', stopResize) }
function startResize(event: PointerEvent) {
  resizeStartY = event.clientY
  resizeStartHeight = terminalHeight.value
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize, { once: true })
}

watch(() => props.visible, (visible) => {
  if (visible && !tabs.value.length) void createTerminalTab()
  if (visible) focusActiveTab()
}, { immediate: true })
defineExpose({ focus: focusActiveTab })

watch(activeTabId, () => focusActiveTab())
watch(() => props.colorScheme, () => { for (const runtime of runtimes.values()) runtime.terminal.options.theme = terminalTheme() })
watch(() => props.workspacePath, async () => {
  if (!tabs.value.length) return
  await disposeAllTabs()
  if (props.visible) await createTerminalTab()
})
onBeforeUnmount(() => { stopResize(); unlisten?.(); void disposeAllTabs() })
</script>

<template>
  <section v-show="visible" class="integrated-terminal" :style="{ height: `${terminalHeight}px` }" aria-label="Terminal intégré">
    <div class="terminal-resize-handle" aria-label="Redimensionner le terminal" @pointerdown.prevent="startResize"></div>
    <header class="terminal-titlebar" title="@current : dossier du fichier actif · @home : racine du workspace">
      <div class="terminal-tabs" role="tablist" aria-label="Sessions terminal">
        <button v-for="tab in tabs" :key="tab.id" type="button" class="terminal-tab" :class="{ active: tab.id === activeTabId }" role="tab" :aria-selected="tab.id === activeTabId" @click="activeTabId = tab.id">
          <span class="terminal-tab-dot" aria-hidden="true"></span>
          <span>{{ tab.label }}</span>
          <span class="terminal-tab-close" aria-label="Fermer l’onglet" @click.stop="void closeTerminalTab(tab.id)">×</span>
        </button>
      </div>
      <span class="terminal-hint">@current · @home</span>
      <button type="button" class="terminal-action" aria-label="Nouveau terminal" title="Nouveau terminal" @click="void createTerminalTab()">+</button>
      <button type="button" class="terminal-action" aria-label="Masquer le terminal" title="Masquer le terminal" @click="emit('close')">×</button>
    </header>
    <div class="terminal-views">
      <div v-for="tab in tabs" :key="tab.id" :ref="(element) => setTerminalHost(tab.id, element)" v-show="tab.id === activeTabId" class="terminal-screen" tabindex="-1"></div>
      <p v-for="tab in tabs.filter((item) => item.error && item.id === activeTabId)" :key="tab.id" class="terminal-status">{{ tab.error }}</p>
    </div>
  </section>
</template>

<style scoped>
.integrated-terminal { position: relative; flex: 0 0 auto; min-height: 150px; overflow: hidden; border-top: 1px solid var(--panel-border); background: var(--panel-bg); }
.terminal-resize-handle { position: absolute; z-index: 2; top: -5px; right: 0; left: 0; height: 9px; cursor: ns-resize; }
.terminal-titlebar { display: flex; align-items: stretch; height: 32px; border-bottom: 1px solid var(--panel-border); background: var(--surface-muted); color: var(--text-soft); font: 12px/1 var(--font-code); }
.terminal-tabs { display: flex; flex: 1 1 auto; min-width: 0; overflow-x: auto; }
.terminal-hint { align-self: center; margin-left: auto; padding: 0 9px; color: var(--text-dim); font-size: 11px; white-space: nowrap; }
.terminal-tab { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 7px; max-width: 190px; min-width: 112px; padding: 0 8px 0 10px; border: 0; border-right: 1px solid var(--panel-border); border-bottom: 2px solid transparent; background: transparent; color: var(--text-soft); font: inherit; cursor: pointer; }
.terminal-tab:hover { background: var(--surface-subtle); color: var(--text-main); }
.terminal-tab.active { border-bottom-color: var(--accent); background: var(--panel-bg); color: var(--text-main); }
.terminal-tab-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--accent); }
.terminal-tab-close { margin-left: auto; color: var(--text-dim); font-size: 15px; line-height: 1; }
.terminal-tab-close:hover { color: var(--text-main); }
.terminal-action { width: 32px; border: 0; border-left: 1px solid var(--panel-border); background: transparent; color: var(--text-soft); font: 18px/1 var(--font-code); cursor: pointer; }
.terminal-action:hover { background: var(--surface-subtle); color: var(--accent); }
.terminal-views { position: relative; height: calc(100% - 32px); background: var(--surface-bg); }
.terminal-screen { height: 100%; padding: 8px 12px; }
.terminal-status { position: absolute; right: 12px; bottom: 7px; margin: 0; color: var(--danger); font: 11px/1 var(--font-code); }
@media (max-width: 700px) { .terminal-hint { display: none; } }
</style>
