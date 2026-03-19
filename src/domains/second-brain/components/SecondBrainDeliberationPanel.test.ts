import { createApp, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import SecondBrainDeliberationPanel from './SecondBrainDeliberationPanel.vue'

describe('SecondBrainDeliberationPanel', () => {
  it('renders assistant markdown with the shared preview renderer', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const app = createApp(defineComponent({
      setup() {
        return () => h(SecondBrainDeliberationPanel, {
          messages: [{
            id: 'a1',
            role: 'assistant',
            mode: 'freestyle',
            content_md: '1. First\n2. Second\n\n| Name | Value |\n| --- | --- |\n| **Bold** | Line 1<br>Line 2 |',
            citations_json: '[]',
            attachments_json: '[]',
            created_at_ms: 1
          }],
          mode: 'freestyle',
          messageInput: '',
          modes: [],
          sending: false,
          sendError: '',
          resolveMessageContent: (message: { content_md: string }) => message.content_md,
          citationsByMessageId: {}
        })
      }
    }))

    app.mount(root)

    const html = root.querySelector('.sb-msg-content')?.innerHTML ?? ''
    expect(html).toContain('<ol>')
    expect(html).toContain('<td>Line 1<br>Line 2</td>')
    expect(html).toContain('<strong>Bold</strong>')

    app.unmount()
  })
})
