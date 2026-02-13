import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import ChatView from '../views/ChatView.vue';
import LoginView from '../views/LoginView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'chat',
      component: ChatView,
      meta: { requiresAuth: true }
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView
    }
  ]
});

// 全局路由守卫
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore();

  // 如果有 token 但还没有验证过（或者刷新页面），尝试验证一次
  if (authStore.isLoggedIn && to.meta.requiresAuth) {
    const isValid = await authStore.checkAuth();
    if (!isValid) {
      return next('/login');
    }
  }

  if (to.meta.requiresAuth && !authStore.isLoggedIn) {
    next('/login');
  } else if (to.path === '/login' && authStore.isLoggedIn) {
    next('/');
  } else {
    next();
  }
});

export default router;
