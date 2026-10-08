import { request } from './http'
import type { AuthResponse, LoginRequest, RegisterRequest } from '@/types/auth'

const LOGIN_URL = import.meta.env.VITE_AUTH_LOGIN_URL
const REGISTER_URL = import.meta.env.VITE_AUTH_REGISTER_URL

export const authApi = {
  login: (data: LoginRequest) => request<AuthResponse>(LOGIN_URL, { method: 'POST', body: data }),
  register: (data: RegisterRequest) => request<AuthResponse>(REGISTER_URL, { method: 'POST', body: data }),
}