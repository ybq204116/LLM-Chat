import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const request = axios.create({
    baseURL: 'http://localhost:3000/api', // 指向你的 Express 后端
    timeout: 10000,
});

// 是否正在刷新 Token
let isRefreshing = false;
// 存储等待 Token 刷新完成后需要重发的请求
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach(prom => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token);
        }
    });
    failedQueue = [];
};

// 请求拦截器：自动注入 Token
request.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// 响应拦截器：统一处理错误
request.interceptors.response.use(
    (response) => response.data,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                }).then(token => {
                    originalRequest.headers['Authorization'] = 'Bearer ' + token;
                    return request(originalRequest);
                }).catch(err => {
                    return Promise.reject(err);
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            const authStore = useAuthStore();
            const refreshToken = authStore.refreshToken;

            if (refreshToken) {
                try {
                    const res = await axios.post('http://localhost:3000/api/auth/refresh-token', {
                        refreshToken
                    });
                    
                    if (res.data.token) {
                        // 如果后端返回了新的 refreshToken，也要更新
                        if (res.data.refreshToken) {
                             authStore.setAuth(res.data.token, res.data.refreshToken, res.data.user || authStore.user);
                        } else {
                             authStore.updateAccessToken(res.data.token);
                        }
                        
                        processQueue(null, res.data.token);
                        
                        // 重发原始请求
                        originalRequest.headers['Authorization'] = 'Bearer ' + res.data.token;
                        return request(originalRequest);
                    }
                } catch (refreshError) {
                    processQueue(refreshError, null);
                    authStore.logout();
                    window.location.href = '/login';
                    return Promise.reject(refreshError);
                } finally {
                    isRefreshing = false;
                }
            } else {
                authStore.logout();
                window.location.href = '/login';
            }
        }
        
        return Promise.reject(error.response?.data || error.message);
    }
);

export default request;
