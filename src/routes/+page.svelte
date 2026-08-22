<script>
  const NEW_URL = 'https://spartanshub.spartanrobotics.org';
</script>

<svelte:head>
  <title>Spartans Hub has moved</title>
</svelte:head>

<div class="page">
  <div class="glow" aria-hidden="true"></div>

  <div class="auth-container">
    <div class="auth-card">
      <div class="auth-header">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <h1>Spartans Hub</h1>
        </div>
        <p class="subtitle">Spartan Robotics</p>
      </div>

      <div class="divider"></div>

      <p class="moved-message">This site has moved</p>
      <p class="moved-detail">
        Continue to <span class="url">spartanshub.spartanrobotics.org</span>
      </p>

      <a class="continue-btn" href={NEW_URL}>
        Continue to Spartans Hub
        <svg class="arrow" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3.5 8h9M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </a>
    </div>
  </div>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #0e0c07;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .page {
    position: relative;
    min-height: 100vh;
    overflow: hidden;
  }

  .glow {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 900px;
    height: 900px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, rgba(233, 184, 48, 0.14) 0%, rgba(233, 184, 48, 0.05) 35%, rgba(233, 184, 48, 0) 65%);
    pointer-events: none;
  }

  .auth-container {
    position: relative;
    max-width: 460px;
    min-height: 100vh;
    margin: 0 auto;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0 1.25rem;
  }

  .auth-card {
    background: #1c1913;
    border: 1px solid #373226;
    border-radius: 10px;
    padding: 2.25rem 2rem;
    width: 100%;
    box-sizing: border-box;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(233, 184, 48, 0.04);
    animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .auth-card {
      animation: none;
    }
  }

  .auth-header {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .brand-mark {
    display: inline-block;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    background-image: url('/spartan-helmet-dark.png');
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
    filter: drop-shadow(0 0 14px rgba(233, 184, 48, 0.35));
  }

  .brand h1 {
    margin: 0;
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 1.85rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #f4f0e6;
  }

  .subtitle {
    color: #7f7863;
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .divider {
    height: 1px;
    background: linear-gradient(to right, transparent, #373226, transparent);
    margin-bottom: 1.75rem;
  }

  .moved-message {
    text-align: center;
    color: #e9b830;
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0 0 0.6rem 0;
  }

  .moved-detail {
    text-align: center;
    color: #a49c8a;
    font-size: 0.88rem;
    margin: 0 0 2rem 0;
    line-height: 1.6;
  }

  .moved-detail .url {
    color: #ece7db;
    font-weight: 500;
  }

  .continue-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.9rem 1.5rem;
    background: linear-gradient(180deg, #f0cd6a 0%, #e9b830 100%);
    color: #1c1913;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 700;
    font-size: 0.95rem;
    box-shadow: 0 8px 20px rgba(233, 184, 48, 0.18);
    transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
  }

  .continue-btn:hover {
    filter: brightness(1.05);
    box-shadow: 0 10px 26px rgba(233, 184, 48, 0.28);
    transform: translateY(-1px);
  }

  .continue-btn:active {
    transform: translateY(0);
    filter: brightness(0.97);
  }

  .continue-btn .arrow {
    transition: transform 0.15s ease;
  }

  .continue-btn:hover .arrow {
    transform: translateX(2px);
  }
</style>
