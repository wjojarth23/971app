<script>
  const NEW_URL = 'https://spartanshub.spartanrobotics.org';
</script>

<svelte:head>
  <title>Spartans Hub has moved</title>
</svelte:head>

<div class="auth-container">
  <div class="auth-card">
    <div class="auth-header">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <h1>Spartans Hub</h1>
      </div>
      <p class="subtitle">Spartan Robotics</p>
    </div>

    <p class="moved-message">This site has moved</p>
    <p class="moved-detail">
      Continue to <span class="url">spartanshub.spartanrobotics.org</span>
    </p>

    <a class="continue-btn" href={NEW_URL}>Continue to Spartans Hub</a>
  </div>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: #131109;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .auth-container {
    max-width: 500px;
    min-height: 100vh;
    margin: 0 auto;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0 1rem;
  }

  .auth-card {
    background: #1c1913;
    border: 1px solid #373226;
    border-radius: 8px;
    padding: 2rem;
    width: 100%;
    box-sizing: border-box;
  }

  .auth-header {
    text-align: center;
    margin-bottom: 2rem;
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
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    background-image: url('/spartan-helmet-dark.png');
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  .brand h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    color: #ece7db;
  }

  .subtitle {
    color: #a49c8a;
    margin: 0;
    font-size: 0.75rem;
  }

  .moved-message {
    text-align: center;
    color: #e9b830;
    font-size: 1.15rem;
    font-weight: 600;
    margin: 0 0 0.75rem 0;
  }

  .moved-detail {
    text-align: center;
    color: #a49c8a;
    font-size: 0.85rem;
    margin: 0 0 2rem 0;
    line-height: 1.5;
  }

  .moved-detail .url {
    color: #ece7db;
  }

  .continue-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    box-sizing: border-box;
    padding: 0.85rem 1.5rem;
    background: #e9b830;
    color: #1c1913;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 700;
    font-size: 1rem;
  }

  .continue-btn:hover {
    background: #f0cd6a;
  }
</style>
