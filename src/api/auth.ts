import { request } from './http'
import { MOCK_API, mockApi } from './mock.ts'
import type { AuthResponse, LoginRequest, RegisterRequest } from '@/types/auth'

const LOGIN_URL = import.meta.env.VITE_AUTH_LOGIN_URL
const REGISTER_URL = import.meta.env.VITE_AUTH_REGISTER_URL

export const authApi = {
  login: (data: LoginRequest) =>
    MOCK_API ? mockApi.login(data) : request<AuthResponse>(LOGIN_URL, { method: 'POST', body: data }),
  register: (data: RegisterRequest) =>
    MOCK_API ? mockApi.register(data) : request<AuthResponse>(REGISTER_URL, { method: 'POST', body: data }),
}