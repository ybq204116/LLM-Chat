<template>
  <div class="login-container">
    <el-card class="login-card">
      <template #header>
        <div class="card-header">
          <h2>{{ isLogin ? '登录' : '注册' }} LLM Chat</h2>
        </div>
      </template>
      
      <el-form :model="form" @submit.prevent="handleSubmit">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>

        <el-form-item v-if="!isLogin" label="手机号">
          <el-input v-model="form.phoneNumber" placeholder="请输入手机号" />
        </el-form-item>
        
        <el-form-item label="密码">
          <el-input 
            v-model="form.password" 
            type="password" 
            placeholder="请输入密码" 
            show-password 
          />
        </el-form-item>

        <el-form-item v-if="!isLogin" label="确认密码">
          <el-input 
            v-model="form.confirmPassword" 
            type="password" 
            placeholder="请再次输入密码" 
            show-password 
          />
        </el-form-item>

        <div class="actions">
          <el-button type="primary" native-type="submit" :loading="loading" block>
            {{ isLogin ? '立即登录' : '立即注册' }}
          </el-button>
          
          <el-link type="info" @click="isLogin = !isLogin" class="switch-link">
            {{ isLogin ? '没有账号？去注册' : '已有账号？去登录' }}
          </el-link>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import request from '../utils/request';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const authStore = useAuthStore();

const isLogin = ref(true);
const loading = ref(false);

const form = reactive({
  username: '',
  password: '',
  phoneNumber: '',
  confirmPassword: ''
});

const handleSubmit = async () => {
  if (!form.username || !form.password || (!isLogin.value && !form.phoneNumber)) {
    return ElMessage.warning('请填写完整信息');
  }

  if (!isLogin.value) {
    if (form.username.length < 3) {
      return ElMessage.warning('用户名至少需要3个字符');
    }
    if (form.password.length < 6) {
      return ElMessage.warning('密码至少需要6个字符');
    }
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(form.phoneNumber)) {
      return ElMessage.warning('请输入有效的手机号');
    }
    if (form.password !== form.confirmPassword) {
      return ElMessage.warning('两次输入的密码不一致');
    }
  }

  loading.value = true;
  try {
    const endpoint = isLogin.value ? '/auth/login' : '/auth/register';
    const res: any = await request.post(endpoint, form);

    if (isLogin.value) {
      authStore.setAuth(res.token, res.refreshToken, res.user);
      ElMessage.success('登录成功');
      router.push('/');
    } else {
      ElMessage.success('注册成功，请登录');
      isLogin.value = true;
    }
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped lang="scss">
.login-container {
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--el-bg-color-page);
}

.login-card {
  width: 400px;
  
  .card-header {
    text-align: center;
    h2 {
      margin: 0;
      color: var(--el-text-color-primary);
    }
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 24px;

    .el-button {
      width: 100%;
    }

    .switch-link {
      align-self: center;
    }
  }
}
</style>
