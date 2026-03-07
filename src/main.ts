import { createApp } from 'vue'
import App from './app/App.vue'
import './assets/tailwind.css'
import './assets/theme-adapters/editorjs.css'

createApp(App).mount('#app')

declare global {
  interface Window {
    __TOMOSONA_HIDE_SPLASH__?: () => void
    __TOMOSONA_SPLASH_TIMER__?: number
  }
}

window.clearInterval(window.__TOMOSONA_SPLASH_TIMER__)
window.requestAnimationFrame(() => {
  window.__TOMOSONA_HIDE_SPLASH__?.()
})
