<script>  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore } from '$lib/stores/user.js';  import { LogIn, UserPlus, Mail, Lock, User, Shield, Briefcase, CheckCircle, AlertCircle, LogOut } from 'lucide-svelte';  import { goto } from '$app/navigation';
  
  let user = null;
  let loading = true;
  let authMode = 'login'; // 'login' or 'register'  
  let formData = {
    email: '',
    password: '',
    name: ''
  };
  let authLoading = false;
  let authError = '';
  let authSuccess = '';
  onMount(async () => {
    // Check if user is already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await loadUserProfile(session.user);
    }
    loading = false;

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await loadUserProfile(session.user);
      } else if (event === 'SIGNED_OUT') {
        user = null;
        userStore.set(null);
      }
    });

    return () => subscription?.unsubscribe();
  });
  async function loadUserProfile(authUser) {
    try {
      // Use auth user data directly - no database lookup needed
      user = {
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.user_metadata?.name || authUser.email.split('@')[0],
        role: authUser.user_metadata?.role || 'member',
        permissions: authUser.user_metadata?.permissions || 'basic'
      };
        userStore.set(user);
      console.log('User set from auth data:', user);
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  }

  async function handleAuth() {
    authLoading = true;
    authError = '';
    authSuccess = '';
    
    try {
      if (authMode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password
        });
        
        if (error) throw error;
          // User will be redirected by the auth state change listener
      } else {        // Register new user
        const { data, error } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            data: {
              name: formData.name
            }
          }
        });
          if (error) throw error;
        
        if (data.user && !data.session) {
          authSuccess = 'Registration successful! Please check your email to confirm your account.';
        }
      }
    } catch (error) {
      authError = error.message;
    } finally {
      authLoading = false;
    }
  }  function resetForm() {
    formData = {
      email: '',
      password: '',
      name: ''
    };
    authError = '';
    authSuccess = '';
  }
  function switchMode() {
    authMode = authMode === 'login' ? 'register' : 'login';
    resetForm();
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error logging out:', error);
    }
  }
</script>

<svelte:head>
  <title>971 Hub - Login</title>
</svelte:head>

{#if loading}
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else if user}
  <!-- User Dashboard -->
  <div class="dashboard-container">
    <div class="user-welcome">
      <h2>Welcome back, {user.full_name || user.email}!</h2>
      <div class="user-info">
        <div class="info-card">
          <User size={20} />
          <div>
            <strong>Name:</strong> {user.full_name || 'Not set'}
          </div>
        </div>
        <div class="info-card">
          <Mail size={20} />
          <div>
            <strong>Email:</strong> {user.email}
          </div>
        </div>        <div class="info-card">
          <Shield size={20} />
          <div>
            <strong>Role:</strong> 
            {#if user.role === 'pending'}
              <span class="pending-status">Pending Assignment</span>
            {:else}
              {user.role || 'Not assigned'}
            {/if}
          </div>
        </div>
        <div class="info-card">
          <Shield size={20} />
          <div>
            <strong>Permissions:</strong> 
            {#if user.permissions === 'none' || user.role === 'pending'}
              <span class="pending-status">Awaiting Admin Approval</span>
            {:else}
              {user.permissions || 'Not assigned'}
            {/if}
          </div>
        </div>
      </div>    </div>

    {#if user.role === 'pending' || user.permissions === 'none'}
      <div class="pending-notice">
        <AlertCircle size={20} />
        <div>
          <h3>Account Pending Approval</h3>
          <p>Your account has been created successfully. An administrator needs to assign your role and permissions before you can access the manufacturing features. You'll receive an email notification once your account is approved.</p>
        </div>
      </div>
    {:else}
      <div class="dashboard-actions">
        <h3>Quick Actions</h3>
        <div class="action-grid">
          <a href="/manufacture" class="action-card">
            <Briefcase size={24} />
            <h4>Manufacturing</h4>
            <p>Access manufacturing workflows and tasks</p>
          </a>
          <a href="/cad" class="action-card">
            <User size={24} />
            <h4>CAD Design</h4>
            <p>Work with CAD files and designs</p>
          </a>
        </div>
      </div>
    {/if}
  </div>
{:else}
  <!-- Authentication Forms -->
  <div class="auth-container">
    <div class="auth-card">      <div class="auth-header">
        <div class="brand">
          <Briefcase size={32} />
          <h1>971 Hub</h1>
        </div>
        <p class="subtitle">Centralized Platform for Workflow Management</p>
      </div>

      <div class="auth-form">
        <div class="form-tabs">
          <button 
            class="tab-btn {authMode === 'login' ? 'active' : ''}"
            on:click={() => { authMode = 'login'; resetForm(); }}
          >
            <LogIn size={16} />
            Sign In
          </button>
          <button 
            class="tab-btn {authMode === 'register' ? 'active' : ''}"
            on:click={() => { authMode = 'register'; resetForm(); }}
          >
            <UserPlus size={16} />
            Register
          </button>
        </div>

        <form on:submit|preventDefault={handleAuth}>
          {#if authMode === 'register'}
            <div class="form-group">
              <label class="form-label" for="name">
                <User size={18} />
                Full Name
              </label>
              <input
                id="name"
                type="text"
                class="form-input"
                bind:value={formData.name}
                placeholder="Enter your full name"
                required              />
            </div>
          {/if}

          <div class="form-group">
            <label class="form-label" for="email">
              <Mail size={18} />
              Email Address
            </label>
            <input
              id="email"
              type="email"
              class="form-input"
              bind:value={formData.email}
              placeholder="Enter your email"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="password">
              <Lock size={18} />
              Password
            </label>
            <input
              id="password"
              type="password"
              class="form-input"
              bind:value={formData.password}
              placeholder="Enter your password"
              required
              minlength="6"
            />
            {#if authMode === 'register'}
              <small class="form-help">Password must be at least 6 characters long</small>
            {/if}
          </div>

          {#if authError}
            <div class="alert alert-error">
              <AlertCircle size={18} />
              {authError}
            </div>
          {/if}

          {#if authSuccess}
            <div class="alert alert-success">
              <CheckCircle size={18} />
              {authSuccess}
            </div>
          {/if}

          <button 
            type="submit" 
            class="btn btn-primary auth-submit"
            disabled={authLoading}
          >
            {#if authLoading}
              <div class="loading-spinner small"></div>
            {:else if authMode === 'login'}
              <LogIn size={18} />
            {:else}
              <UserPlus size={18} />
            {/if}
            {authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div class="auth-footer">
          <p>
            {authMode === 'login' ? "Don't have an account?" : 'Already have an account?'}
            <button class="link-btn" on:click={switchMode}>
              {authMode === 'login' ? 'Register here' : 'Sign in here'}
            </button>
          </p>        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 50vh;
    gap: 1rem;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid var(--border);
    border-top: 4px solid var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .loading-spinner.small {
    width: 20px;
    height: 20px;
    border-width: 2px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .auth-container {
    max-width: 500px;
    margin: 4rem auto;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
  }

  .auth-card {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 2rem;
    box-shadow: var(--shadow-sm);
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
    color: var(--accent);
    margin-bottom: 0.5rem;
  }

  .brand h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--secondary);
  }

  .subtitle {
    color: #666;
    margin: 0;
    font-size: 0.95rem;
  }

  .form-tabs {
    display: flex;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .tab-btn {
    flex: 1;
    padding: 0.75rem 1rem;
    border: none;
    background: none;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-btn:hover {
    color: var(--secondary);
  }

  .form-group {
    margin-bottom: 1.25rem;
  }

  .form-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-weight: 600;
    color: var(--secondary);
  }

  .form-help {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.85rem;
    color: #666;
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    margin-bottom: 1rem;
    font-size: 0.9rem;
  }

  .alert-error {
    background: rgba(220, 53, 69, 0.1);
    color: var(--danger);
    border: 1px solid rgba(220, 53, 69, 0.2);
  }

  .alert-success {
    background: rgba(40, 167, 69, 0.1);
    color: var(--success);
    border: 1px solid rgba(40, 167, 69, 0.2);
  }

  .btn-primary {
    background: var(--accent);
    color: var(--secondary);
  }

  .btn-primary:hover:not(:disabled) {
    background: #d4a829;
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .auth-submit {
    width: 100%;
    padding: 0.875rem;
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 1rem;
  }

  .auth-footer {
    text-align: center;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .auth-footer p {
    margin: 0;
    color: #666;
    font-size: 0.9rem;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    font-size: inherit;
    padding: 0;
    margin-left: 0.25rem;
  }

  .link-btn:hover {    color: #d4a829;
  }

  @media (max-width: 768px) {
    .auth-container {
      margin: 2rem 1rem;
    }    .auth-card {
      padding: 1.5rem;
    }

    .brand h1 {
      font-size: 1.5rem;
    }
  }

  /* Dashboard Styles */
  .dashboard-container {
    max-width: 1200px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .user-welcome {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 2rem;
    margin-bottom: 2rem;
  }

  .user-welcome h2 {
    margin: 0 0 1.5rem 0;
    color: var(--secondary);
    font-size: 1.5rem;
  }

  .user-info {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
  }

  .info-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .info-card div {
    font-size: 0.9rem;
  }

  .pending-status {
    color: #f59e0b;
    font-weight: 500;
    font-style: italic;
  }

  .pending-notice {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    background: #fef3c7;
    border: 1px solid #f59e0b;
    border-radius: var(--radius-md);
    padding: 1.5rem;
    margin-bottom: 2rem;
    color: #92400e;
  }

  .pending-notice h3 {
    margin: 0 0 0.5rem 0;
    color: #92400e;
    font-size: 1.1rem;
  }

  .pending-notice p {
    margin: 0;
    line-height: 1.5;
  }

  .dashboard-actions {
    margin-top: 2rem;
  }

  .dashboard-actions h3 {
    margin: 0 0 1rem 0;
    color: var(--secondary);
    font-size: 1.25rem;
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .action-card {
    display: block;
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1.5rem;
    text-decoration: none;
    color: inherit;
    transition: all 0.2s ease;
    box-shadow: var(--shadow-sm);
  }

  .action-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border-color: var(--accent);
  }

  .action-card h4 {
    margin: 0.5rem 0;
    color: var(--secondary);
    font-size: 1.1rem;
  }

  .action-card p {
    margin: 0;
    color: #666;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  @media (max-width: 768px) {
    .dashboard-container {
      margin: 1rem;
      padding: 0;
    }

    .dashboard-header {
      flex-direction: column;
      gap: 1rem;
      align-items: stretch;
    }

    .user-welcome {
      padding: 1.5rem;
    }

    .user-info {
      grid-template-columns: 1fr;
    }

    .action-grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }    .action-card {
      padding: 1rem;
    }
  }
</style>
