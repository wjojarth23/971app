<script>  import { onMount } from 'svelte';
  import { supabase, getAuthHeader } from '$lib/supabase.js';
  import { initAuth, userStore, signOut } from '$lib/stores/auth.js';  import { LogIn, UserPlus, Mail, Lock, User, Shield, Briefcase, CheckCircle, AlertCircle, LogOut } from 'lucide-svelte';  import { goto } from '$app/navigation';
  
  let user = null;

  function can(perm) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return Array.isArray(user.permissions) && user.permissions.includes(perm);
  }
  let loading = true;
  // New state for user-specific lists
  let subsystems = [];
  let subsystemsLoading = false;
  let builds = [];
  let buildsLoading = false;
  let purchases = [];
  let purchasesLoading = false;
  let listsLoaded = false;
  let authMode = 'login'; // 'login' or 'register'  
  let formData = {
    email: '',
    password: '',
    name: ''
  };
  let authLoading = false;
  let authError = '';
  let authSuccess = '';

  // Scouting assignment alert state
  let myScoutAssignments = [];
  let nextScoutAssignment = null; // { scouting_type, match_key, team_key }
  let showScoutAlert = true;

  async function loadScoutAssignments(){
    if(!user?.id) return;
    try {
      const authHeaders = await getAuthHeader();
      // Fetch both types
      const res1 = await fetch(`/api/scout-assignments?scouting_type=data&mine=1&user_id=${encodeURIComponent(user.id)}`, {
        headers: authHeaders
      });
      const js1 = await res1.json();
      const res2 = await fetch(`/api/scout-assignments?scouting_type=note&mine=1&user_id=${encodeURIComponent(user.id)}`, {
        headers: authHeaders
      });
      const js2 = await res2.json();
      const rows = [].concat(js1?.data||[], js2?.data||[]);
      // Filter incomplete
      const incomplete = rows.filter(r => !r.completed_at);
      myScoutAssignments = incomplete;
      nextScoutAssignment = incomplete.sort((a,b)=> a.match_key.localeCompare(b.match_key))[0] || null;
    }catch(e){ /* ignore */ }
  }

  onMount(() => {
    const unsub = userStore.subscribe((v) => { user = v; });
    const uninit = initAuth();
    // UI shouldn't block on auth; keep simple
    loading = false;
    return () => { unsub?.(); uninit?.(); };
  });

  async function loadUserLists() {
    try {
      subsystemsLoading = true;
      buildsLoading = true;
      purchasesLoading = true;

      // Load subsystems where the user is a member
      try {
        const { data: subs, error: subErr } = await supabase
          .from('subsystem_members')
          .select('subsystems(*)')
          .eq('user_id', user.id);
        if (!subErr && Array.isArray(subs)) {
          subsystems = subs.map(r => r.subsystems).filter(Boolean);
        } else {
          subsystems = [];
        }
      } catch (e) {
        console.error('Failed loading subsystems:', e);
        subsystems = [];
      } finally {
        subsystemsLoading = false;
      }

      // Load builds tied to those subsystems (limit to recent 20)
      try {
        const subsystemIds = subsystems.map(s => s.id).filter(Boolean);
        if (subsystemIds.length > 0) {
          const { data: bdata, error: bErr } = await supabase
            .from('builds')
            .select(`*, subsystems(name)`)
            .in('subsystem_id', subsystemIds)
            .order('created_at', { ascending: false })
            .limit(20);
          if (!bErr) builds = bdata || [];
          else builds = [];
        } else {
          builds = [];
        }
      } catch (e) {
        console.error('Failed loading builds:', e);
        builds = [];
      } finally {
        buildsLoading = false;
      }

      // Load purchases associated with this user.
      // Prefer the `purchaser` UUID column (new), fall back to legacy `requester` text matches.
      try {
        const results = [];
        // Primary: rows explicitly linked to the user's UUID
        if (user.id) {
          const r = await supabase.from('purchasing').select('*').eq('purchaser', user.id);
          if (r && Array.isArray(r.data)) results.push(...r.data);
        }

        // Legacy compatibility: include rows where requester matches full name, email, or contains the email
        if (user.full_name) {
          const r = await supabase.from('purchasing').select('*').eq('requester', user.full_name);
          if (r && Array.isArray(r.data)) results.push(...r.data);
        }
        if (user.email) {
          const r1 = await supabase.from('purchasing').select('*').eq('requester', user.email);
          if (r1 && Array.isArray(r1.data)) results.push(...r1.data);
          const r2 = await supabase.from('purchasing').select('*').ilike('requester', `%${user.email}%`);
          if (r2 && Array.isArray(r2.data)) results.push(...r2.data);
        }

        // Some older rows may have stored the UUID string in requester; include those too
        if (user.id) {
          const r3 = await supabase.from('purchasing').select('*').eq('requester', user.id);
          if (r3 && Array.isArray(r3.data)) results.push(...r3.data);
        }

        // Merge unique by id and sort by created_at desc
        const merged = {};
        for (const r of results) {
          if (r && r.id) merged[r.id] = r;
        }
        purchases = Object.values(merged).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      } catch (e) {
        console.error('Failed loading purchases:', e);
        purchases = [];
      } finally {
        purchasesLoading = false;
      }
    } catch (err) {
      console.error('Error in loadUserLists:', err);
    }
  }

  // Reactive one-time loader: when user becomes available, load lists once
  $: if (user && !listsLoaded) {
    listsLoaded = true;
    loadUserLists();
    loadScoutAssignments();
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
        // auth state change will update stores
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
        // Notify approvers once when the user registers. This is triggered once per page session.
        try {
          if (!window.__notifiedUserRegistration) window.__notifiedUserRegistration = new Set();
          const newUserId = data?.user?.id || data?.user?.user?.id || null;
          const newUserName = formData.name || formData.email || newUserId;
          if (newUserId && !window.__notifiedUserRegistration.has(newUserId)) {
            window.__notifiedUserRegistration.add(newUserId);
            const BOT_BASE_URL = import.meta.env?.VITE_BOT_BASE_URL || '/api/971bot';
            fetch(`${BOT_BASE_URL}/notify/user_registration`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: newUserId, name: newUserName })
            }).then((r) => {
              if (!r.ok) console.warn('User registration notify failed', r.status);
            }).catch((e) => console.warn('User registration notify error', e));
          }

        } catch (e) {
          console.warn('Failed to notify user registration to bot:', e);
        }

        if (data.user && !data.session) {
          authSuccess = 'Registration successful! Please check your email to confirm your account.';
        }
        // If session exists, auth listener will populate stores
      }
    } catch (error) {
      authError = error.message;
    } finally {
      authLoading = false;
    }
  }

  function resetForm() {
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
    await signOut();
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
      <!-- Simplified header: we no longer show individual info boxes here -->
      <p class="muted">Quick access to your CAD subsystems, builds, and purchases.</p>
    </div>

    {#if showScoutAlert && myScoutAssignments.length>0}
      <div class="pending-notice" style="background:#fffbe6; border:1px solid #f5d87b;">
        <AlertCircle size={20} />
        <div>
          <h3>Scouting Assignments</h3>
          <p>You have {myScoutAssignments.length} upcoming scouting assignment{myScoutAssignments.length===1?'':'s'}.</p>
          {#if nextScoutAssignment}
            <div style="margin-top:0.25rem; display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center">
              <button class="btn btn-primary" on:click={() => goto(`/${nextScoutAssignment.scouting_type==='note'?'notescout':'datascout'}`)}>Go to Next ({nextScoutAssignment.scouting_type} – {nextScoutAssignment.match_key.split('_').pop()} – {nextScoutAssignment.team_key.replace('frc','')})</button>
              <button class="btn btn-outline" on:click={() => showScoutAlert=false}>Dismiss</button>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if !can('CAN_SEE_ROUTES')}
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
          <a href="/cad" class="action-card">
            <User size={24} />
            <h4>CAD Design</h4>
            <p>Work with CAD files and designs</p>
          </a>
          <a href="/cad/build" class="action-card">
            <Briefcase size={24} />
            <h4>Builds</h4>
            <p>View builds you are involved with</p>
          </a>
        </div>

        <!-- User-specific lists: subsystems, builds, and purchases -->
        <div class="user-lists">
          <h4>Your Subsystems</h4>
          {#if subsystemsLoading}
            <div class="loading-spinner small"></div>
          {:else if subsystems.length === 0}
            <p class="muted">You are not a member of any subsystems yet.</p>
          {:else}
            <div class="card-grid">
              {#each subsystems as s}
                <a class="subsystem-card" href={`/cad/${s.id}`}>
                  <h5>{s.name}</h5>
                  <p class="muted">{s.description || 'No description'}</p>
                </a>
              {/each}
            </div>
          {/if}

          <h4 style="margin-top:1rem">Your Builds</h4>
          {#if buildsLoading}
            <div class="loading-spinner small"></div>
          {:else if builds.length === 0}
            <p class="muted">No builds found for your subsystems.</p>
          {:else}
            <div class="card-grid">
              {#each builds as b}
                <a class="build-card" href={`/cad/build/${b.id}`}>
                  <h5>{b.release_name || b.name || `Build ${b.id}`}</h5>
                  <p class="muted">{b.subsystems?.name || 'Project'}</p>
                </a>
              {/each}
            </div>
          {/if}

          <h4 style="margin-top:1rem">Your Purchase Requests</h4>
          {#if purchasesLoading}
            <div class="loading-spinner small"></div>
          {:else if purchases.length === 0}
            <p class="muted">You haven't requested any purchases yet.</p>
          {:else}
            <div class="table-container">
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Quantity</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Project</th>
                  </tr>
                </thead>
                <tbody>
                  {#each purchases as p}
                    <tr>
                      <td>{p.name}</td>
                      <td>{p.quantity || 1}</td>
                      <td>{p.price !== null && p.price !== undefined ? `$${p.price.toFixed(2)}` : '—'}</td>
                      <td>{p.status || 'pending'}</td>
                      <td>{p.project_id || '-'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
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

  /* streamlined dashboard styles - user-specific cards below */

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

  /* Card grid for subsystems and builds */
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-top: 0.5rem;
  }

  .subsystem-card,
  .build-card {
    display: block;
    padding: 1rem;
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    box-shadow: var(--shadow-sm);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }

  .subsystem-card:hover,
  .build-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
    border-color: var(--accent);
  }

  .subsystem-card h5,
  .build-card h5 { margin: 0 0 0.25rem 0; color: var(--secondary); }
  .subsystem-card p,
  .build-card p { margin: 0; color: #666; font-size: 0.9rem; }

  @media (max-width: 768px) {
    .dashboard-container {
      margin: 1rem;
      padding: 0;
    }


    .user-welcome {
      padding: 1.5rem;
    }

  /* responsive adjustments kept for action grid and user-welcome */

    .action-grid {
      grid-template-columns: 1fr;
      gap: 1rem;
    }    .action-card {
      padding: 1rem;
    }
  }
</style>
