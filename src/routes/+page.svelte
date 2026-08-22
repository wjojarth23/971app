<script>
  const NEW_URL = 'https://spartanshub.spartanrobotics.org';

  if (typeof window !== 'undefined') {
    setTimeout(() => window.location.replace(NEW_URL), 3000);
  }
</script>

<svelte:head>
  <title>We've moved - Spartan Robotics</title>
  <meta http-equiv="refresh" content="3;url={NEW_URL}" />
</svelte:head>

<div class="moved-container">
  <div class="moved-card">
    <h1>This site has moved</h1>
    <p>
      Spartan Robotics' team hub is now at
      <a href={NEW_URL}>spartanshub.spartanrobotics.org</a>.
    </p>
    <p class="redirect-note">Redirecting you there automatically...</p>
    <a class="moved-button" href={NEW_URL}>Go to Spartans Hub</a>
  </div>
</div>

<style>
  .moved-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0a;
    color: #f5f5f5;
  }

  .moved-card {
    max-width: 32rem;
    text-align: center;
  }

  h1 {
    font-size: 1.75rem;
    margin: 0 0 1rem 0;
  }

  p {
    line-height: 1.6;
    margin: 0 0 1rem 0;
    color: #c9c9c9;
  }

  a {
    color: #4da3ff;
  }

  .redirect-note {
    font-size: 0.85rem;
    color: #888;
  }

  .moved-button {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.75rem 1.5rem;
    background: #4da3ff;
    color: #0a0a0a;
    border-radius: 0.5rem;
    text-decoration: none;
    font-weight: 600;
  }
</style>
