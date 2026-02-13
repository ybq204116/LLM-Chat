import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import request from '../utils/request';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('auth_token'));
  const refreshToken = ref(localStorage.getItem('refresh_token'));
  const user = ref(JSON.parse(localStorage.getItem('user_info') || 'null'));

  const isLoggedIn = computed(() => !!token.value);

  async function checkAuth() {
    if (!token.value) return false;
    try {
      const userData: any = await request.get('/auth/me');
      user.value = userData;
      localStorage.setItem('user_info', JSON.stringify(userData));
      return true;
    } catch (error) {
      logout();
      return false;
    }
  }

  function setAuth(newToken: string, newRefreshToken: string, userInfo: any) {
    token.value = newToken;
    refreshToken.value = newRefreshToken;
    user.value = userInfo;
    localStorage.setItem('auth_token', newToken);
    localStorage.setItem('refresh_token', newRefreshToken);
    localStorage.setItem('user_info', JSON.stringify(userInfo));
  }

  function updateAccessToken(newToken: string) {
    token.value = newToken;
    localStorage.setItem('auth_token', newToken);
  }

  function logout() {
    token.value = null;
    refreshToken.value = null;
    user.value = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_info');
  }

  return {
    token,
    refreshToken,
    user,
    isLoggedIn,
    checkAuth,
    setAuth,
    updateAccessToken,
    logout
  };
});
