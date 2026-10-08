import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import { useAuth } from '@/composables/useAuth'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
    role?: 'client' | 'driver' | 'admin'
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('@/views/AuthView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/app',
      name: 'map',
      component: () => import('@/views/MapView.vue'),
      meta: { requiresAuth: true, role: 'client' },
    },
    {
      path: '/driver',
      name: 'driver',
      component: () => import('@/views/DriverView.vue'),
      meta: { requiresAuth: true, role: 'driver' },
    },
    {
      path: '/admin',
      component: () => import('@/views/AdminView.vue'),
      meta: { requiresAuth: true, role: 'admin' },
      children: [
        { path: '', name: 'admin', component: () => import('@/views/admin/AdminDashboard.vue') },
        { path: 'orders', name: 'admin-orders', component: () => import('@/views/admin/AdminOrders.vue') },
        { path: 'clients', name: 'admin-clients', component: () => import('@/views/admin/AdminClients.vue') },
        { path: 'drivers', name: 'admin-drivers', component: () => import('@/views/admin/AdminDrivers.vue') },
        { path: 'tariffs', name: 'admin-tariffs', component: () => import('@/views/admin/AdminTariffs.vue') },
        { path: 'promocodes', name: 'admin-promocodes', component: () => import('@/views/admin/AdminPromocodes.vue') },
        { path: 'trips', name: 'admin-trips', component: () => import('@/views/admin/AdminTrips.vue') },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach((to) => {
  const { isAuthenticated, role } = useAuth()
  const home = role.value === 'driver' ? 'driver' : role.value === 'admin' ? 'admin' : 'map'

  if (to.meta.requiresAuth && !isAuthenticated.value) {
    return { name: 'auth', query: { redirect: to.fullPath } }
  }

  if (to.meta.guestOnly && isAuthenticated.value) {
    return { name: home }
  }

  if (to.meta.role && to.meta.role !== role.value) {
    return { name: home }
  }
})

export default router