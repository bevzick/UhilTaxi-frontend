export interface LoginRequest {
  phone: string | null
  password: string | null
}

export interface RegisterRequest {
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
  password: string | null
  birth_date: string | null
}

export interface ChangePasswordRequest {
  current_password: string | null
  new_password: string | null
}

export interface UserResponse {
  id?: number | string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  email?: string | null
  birth_date?: string | null
  [key: string]: unknown
}

export interface AuthResponse {
  access_token: string | null
  expires_in: number
  user: UserResponse | null
}