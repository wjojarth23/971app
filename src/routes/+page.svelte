<script>
  import { onMount } from 'svelte';
  import { supabase, getAuthHeader } from '$lib/supabase.js';
  import { initAuth, userStore, signOut, authReady as authReadyStore } from '$lib/stores/auth.js';
  import { LogIn, UserPlus, Mail, Lock, User, Shield, Briefcase, CheckCircle, AlertCircle, LogOut, Users, Layers, Receipt, Clock } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { FRC_TEAMS, hasPermission } from '$lib/permissions.js';
  
  let user = null;

  function can(perm) {
    return hasPermission(user, perm);
  }
  let loading = true;
  // New state for user-specific lists
  let subsystems = [];
  let subsystemsLoading = false;
  let builds = [];
  let buildsLoading = false;
  let purchases = [];
  let purchasesLoading = false;

  // At-a-glance dashboard stats
  $: pendingPurchases = purchases.filter(p => (p.status || 'pending') === 'pending').length;
  let listsLoaded = false;
  let authMode = 'login'; // 'login' or 'register'  
  let formData = {
    email: '',
    password: '',
    name: '',
    frc_team: '' // 971, 9584, or Mentor
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
    const unsubReady = authReadyStore.subscribe((value) => {
      loading = !value;
    });
    const uninit = initAuth();
    return () => { unsub?.(); unsubReady?.(); uninit?.(); };
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
              name: formData.name,
              frc_team: formData.frc_team || null
            }
          }
        });
        if (error) throw error;

        // Update user_profiles with frc_team selection
        const newUserId = data?.user?.id || data?.user?.user?.id || null;
        if (newUserId && formData.frc_team) {
          try {
            await supabase
              .from('user_profiles')
              .update({ frc_team: formData.frc_team })
              .eq('id', newUserId);
          } catch (e) {
            console.warn('Failed to update frc_team in profile:', e);
          }
        }

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
      // Do not keep plaintext password in component state after submit.
      formData = { ...formData, password: '' };
      authLoading = false;
    }
  }

  function resetForm() {
    formData = {
      email: '',
      password: '',
      name: '',
      frc_team: ''
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
      <!-- At-a-glance stats -->
      <div class="stat-grid">
        <a href="/cad" class="stat-card">
          <div class="stat-icon"><Layers size={20} /></div>
          <div class="stat-body">
            <span class="stat-value">{subsystemsLoading ? '—' : subsystems.length}</span>
            <span class="stat-label">Your Subsystems</span>
          </div>
        </a>
        <a href="/cad/build" class="stat-card">
          <div class="stat-icon"><Briefcase size={20} /></div>
          <div class="stat-body">
            <span class="stat-value">{buildsLoading ? '—' : builds.length}</span>
            <span class="stat-label">Your Builds</span>
          </div>
        </a>
        <a href="/cad/purchasing" class="stat-card">
          <div class="stat-icon"><Receipt size={20} /></div>
          <div class="stat-body">
            <span class="stat-value">{purchasesLoading ? '—' : purchases.length}</span>
            <span class="stat-label">Purchase Requests</span>
          </div>
        </a>
        <a href="/cad/purchasing" class="stat-card" class:stat-card-alert={pendingPurchases > 0}>
          <div class="stat-icon"><Clock size={20} /></div>
          <div class="stat-body">
            <span class="stat-value">{purchasesLoading ? '—' : pendingPurchases}</span>
            <span class="stat-label">Pending Approval</span>
          </div>
        </a>
      </div>

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
  <div class="auth-container" style="min-height:60vh">
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
            <div class="form-group">
              <label class="form-label" for="frc_team">
                <Users size={18} />
                Team Affiliation
              </label>
              <select
                id="frc_team"
                class="form-input"
                bind:value={formData.frc_team}
                required
              >
                <option value="" disabled>Select your team...</option>
                <option value={FRC_TEAMS.TEAM_971}>Team 971</option>
                <option value={FRC_TEAMS.TEAM_9584}>Team 9584</option>
                <option value={FRC_TEAMS.MENTOR}>Mentor</option>
              </select>
              <small class="form-help">Select which FRC team you are affiliated with</small>
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
              autocomplete="username"
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
              autocomplete={authMode === 'login' ? 'current-password' : 'new-password'}
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
  .auth-container {
    max-width: 500px;
    margin: var(--space-8) auto;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0 var(--space-4);
  }

  .auth-card {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-7);
    box-shadow: var(--shadow-sm);
    width: 100%;
  }

  .auth-header {
    text-align: center;
    margin-bottom: var(--space-7);
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-3);
    color: var(--accent);
    margin-bottom: var(--space-2);
  }

  .brand h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--secondary);
  }

  .subtitle {
    color: var(--neutral-500);
    margin: 0;
    font-size: var(--font-xs);
  }

  .form-tabs {
    display: flex;
    margin-bottom: var(--space-6);
    border-bottom: 1px solid var(--border);
  }

  .tab-btn {
    flex: 1;
    padding: var(--space-3) var(--space-4);
    border: none;
    background: none;
    color: var(--neutral-500);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-2);
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
    margin-bottom: var(--space-6);
  }

  .form-label {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    margin-bottom: var(--space-2);
    font-weight: 600;
    color: var(--secondary);
  }

  .form-help {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--font-xs);
    color: var(--neutral-500);
  }

  .alert {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-4);
    font-size: var(--font-xs);
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

  .auth-submit {
    width: 100%;
    padding: var(--space-3);
    font-size: var(--font-base);
    font-weight: 600;
    margin-bottom: var(--space-4);
  }

  .auth-footer {
    text-align: center;
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .auth-footer p {
    margin: 0;
    color: var(--neutral-500);
    font-size: var(--font-xs);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    font-size: inherit;
    padding: 0;
    margin-left: var(--space-1);
  }

  .link-btn:hover {
    color: var(--brand-gold-base);
  }

  .dashboard-container {
    max-width: 1200px;
    margin: var(--space-7) auto;
    padding: 0 var(--space-4);
  }

  .user-welcome {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-7);
    margin-bottom: var(--space-7);
  }

  .user-welcome h2 {
    margin: 0 0 var(--space-6) 0;
    color: var(--secondary);
    font-size: var(--font-xl);
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--gap-4);
    margin-bottom: var(--space-7);
  }

  .stat-card {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5);
    text-decoration: none;
    color: inherit;
    box-shadow: var(--shadow-sm);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
  }

  .stat-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: var(--accent);
  }

  .stat-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    background: var(--brand-gold-soft);
    color: var(--brand-gold-strong);
  }

  .stat-body {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .stat-value {
    font-size: var(--font-2xl);
    font-weight: 700;
    line-height: 1.1;
    color: var(--secondary);
  }

  .stat-label {
    font-size: var(--font-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .stat-card-alert .stat-icon {
    background: var(--red-soft, #fee2e2);
    color: var(--red-strong, #991b1b);
  }

  .stat-card-alert .stat-value {
    color: var(--red-strong, #991b1b);
  }

  .pending-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--gap-4);
    background: var(--brand-gold-soft);
    border: 1px solid var(--orange-soft);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    margin-bottom: var(--space-7);
    color: var(--brand-gold-strong);
  }

  .pending-notice h3 {
    margin: 0 0 var(--space-2) 0;
    color: var(--brand-gold-strong);
    font-size: var(--font-md);
  }

  .pending-notice p {
    margin: 0;
    line-height: 1.5;
  }

  .dashboard-actions {
    margin-top: var(--space-7);
  }

  .dashboard-actions h3 {
    margin: 0 0 var(--space-4) 0;
    color: var(--secondary);
    font-size: var(--font-xl);
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--gap-6);
  }

  .action-card {
    display: block;
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
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
    margin: var(--space-2) 0;
    color: var(--secondary);
    font-size: var(--font-md);
  }

  .action-card p {
    margin: 0;
    color: var(--neutral-500);
    font-size: var(--font-xs);
    line-height: 1.4;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--gap-4);
    margin-top: var(--space-2);
  }

  .subsystem-card,
  .build-card {
    display: block;
    text-decoration: none;
    color: inherit;
  }

  .subsystem-card:hover,
  .build-card:hover {
    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  }

  .subsystem-card h5,
  .build-card h5 { margin: 0 0 var(--space-1) 0; color: var(--secondary); }
  .subsystem-card p,
  .build-card p { margin: 0; color: var(--neutral-500); font-size: var(--font-xs); }

  /* Mobile Responsive Styles */
  @media (max-width: 768px) {
    .auth-container { 
      margin: var(--space-4) auto; 
      padding: 0 var(--space-3);
    }
    .auth-card { padding: var(--space-6); }
    .brand h1 { font-size: var(--font-xl); }
    .dashboard-container { margin: var(--space-4) 0; padding: 0 var(--space-3); }
    .user-welcome { padding: var(--space-6); }
    .user-welcome h2 { font-size: var(--font-md); margin-bottom: var(--space-3); }
    .action-grid { grid-template-columns: 1fr; gap: var(--gap-4); }
    .action-card { padding: var(--space-4); }
    .pending-notice {
      flex-direction: column;
      gap: var(--gap-3);
      padding: var(--space-4);
    }
    .pending-notice h3 {
      font-size: var(--font-base);
    }
    .card-grid {
      grid-template-columns: 1fr;
    }
    .table-container {
      overflow-x: auto;
      margin: 0 -var(--space-3);
      padding: 0 var(--space-3);
    }
  }

  @media (max-width: 480px) {
    .auth-container { margin: var(--space-2) auto; }
    .auth-card { 
      padding: var(--space-4); 
      border-radius: var(--radius-sm);
    }
    .brand h1 { font-size: var(--font-md); }
    .form-tabs {
      flex-direction: column;
      border-bottom: none;
      gap: var(--space-2);
    }
    .tab-btn {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      border-bottom-width: 1px;
    }
    .tab-btn.active {
      border-color: var(--accent);
      background: var(--brand-gold-soft);
    }
    .user-welcome { 
      padding: var(--space-4); 
      margin-bottom: var(--space-4);
    }
    .dashboard-actions h3 {
      font-size: var(--font-md);
    }
    .user-lists h4 {
      font-size: var(--font-base);
    }
  }
</style>
