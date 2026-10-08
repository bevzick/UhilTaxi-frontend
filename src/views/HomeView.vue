<template>
  <main class="home">
    <header class="header">
      <div class="logo">
        <span class="logo__icon">U</span>
        <span class="logo__name">Uhil<span>Taxi</span></span>
      </div>
    </header>

    <section class="hero">
      <h1 class="hero__title">
        Потрібно добратись до певного місця
        <span class="accent">призначення?</span>
      </h1>

      <p class="hero__subtitle">
        <strong>UhilTaxi</strong> — надаємо послуги таксі різних класів для різних ситуацій.
        Реєструйся і замовляй своє таксі.
      </p>

      <div class="hero__actions">
        <button class="btn btn--primary">Зареєструватись</button>
        <button class="btn btn--secondary">Увійти</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  padding: 0 clamp(20px, 6vw, 96px);
}

.header {
  padding: 28px 0;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.logo__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: #2f7d57;
  color: #fbf7ee;
  font-size: 22px;
  font-weight: 700;
}

.logo__name {
  font-size: 24px;
  font-weight: 700;
  color: #2b2b26;
}

.logo__name span {
  color: #2f7d57;
}

.hero {
  max-width: 720px;
  padding-top: clamp(60px, 12vh, 140px);
}

.hero__title {
  margin: 0 0 24px;
  font-size: clamp(36px, 5vw, 60px);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: #2b2b26;
}

.accent {
  color: #2f7d57;
}

.hero__subtitle {
  margin: 0 0 40px;
  max-width: 560px;
  font-size: clamp(16px, 1.4vw, 19px);
  line-height: 1.7;
  color: #6b675c;
}

.hero__subtitle strong {
  color: #2b2b26;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.btn {
  padding: 16px 32px;
  border-radius: 14px;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn--primary {
  border: 2px solid #2f7d57;
  background: #2f7d57;
  color: #fbf7ee;
  box-shadow: 0 8px 24px rgba(47, 125, 87, 0.25);
}

.btn--primary:hover {
  background: #266a49;
  border-color: #266a49;
  transform: translateY(-2px);
}

.btn--secondary {
  border: 2px solid #2f7d57;
  background: transparent;
  color: #2f7d57;
}

.btn--secondary:hover {
  background: rgba(47, 125, 87, 0.08);
  transform: translateY(-2px);
}
</style>