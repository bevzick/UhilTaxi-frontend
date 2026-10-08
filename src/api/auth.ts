import { request } from './http'
import { MOCK_API, mockApi } from './mock.ts'
import type { AuthResponse, LoginRequest, RegisterRequest } from '@/types/auth'

const LOGIN_URL = '/api/v1/auth/login'
const REGISTER_URL = '/api/v1/auth/register'

export const authApi = {
  login: (data: LoginRequest) =>
    MOCK_API ? mockApi.login(data) : request<AuthResponse>(LOGIN_URL, { method: 'POST', body: data }),
  register: (data: RegisterRequest) =>
    MOCK_API ? mockApi.register(data) : request<AuthResponse>(REGISTER_URL, { method: 'POST', body: data }),
}