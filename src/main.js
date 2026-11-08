import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Mount after the first navigation (and its auth check) resolves, so the shell
// never flashes for a signed-out user.
router.isReady().then(() => app.mount('#app'))
