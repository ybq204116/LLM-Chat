import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import './assets/styles/main.scss'
import App from './App.vue'
import router from './router'

// 使用深色代码主题
import 'highlight.js/styles/github-dark.css'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
// @ts-ignore
import VueVirtualScroller from 'vue-virtual-scroller'

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

// 注册所有图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(pinia)
app.use(router)
app.use(ElementPlus)
app.use(VueVirtualScroller)
app.mount('#app')
