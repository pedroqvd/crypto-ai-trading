// ================================================
// LOGIN CLIENT — Authentication Frontend
// ================================================

(function() {
  'use strict';

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const toggleBtn = document.getElementById('toggle-password');
  const errorDiv = document.getElementById('error-message');
  const errorText = document.getElementById('error-text');
  const loginBtn = document.getElementById('login-btn');
  const btnText = document.getElementById('btn-text');
  const btnLoading = document.getElementById('btn-loading');

  // Toggle password visibility
  toggleBtn.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
    toggleBtn.textContent = type === 'password' ? '👁️' : '🙈';
  });

  // Handle Enter key
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      form.dispatchEvent(new Event('submit'));
    }
  });

  // ========================================
  // BOOTSTRAP — Load backend URL then wire up
  // ========================================
  async function init() {
    // When frontend is on Vercel and bot is on Fly.io,
    // backendUrl will be set and all API calls go directly to Fly.io.
    // When Fly.io serves the frontend directly, backendUrl is '' (same origin).
    let backendUrl = '';
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      backendUrl = (cfg.backendUrl || '').replace(/\/$/, '');
    } catch (_) {
      // Config fetch failed — assume same-origin
    }

    function apiCall(path, options) {
      const url = backendUrl ? backendUrl + path : path;
      return fetch(url, options);
    }

    // Check if already logged in
    const existingToken = localStorage.getItem('auth_token');
    if (existingToken) {
      apiCall('/api/auth/status', {
        headers: { 'Authorization': 'Bearer ' + existingToken },
      })
        .then(r => r.json())
        .then(data => {
          if (data.authenticated) window.location.href = '/';
        })
        .catch(() => {});
    }

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email || !password) {
        showError('Preencha todos os campos.');
        return;
      }

      setLoading(true);
      hideError();

      try {
        const response = await apiCall('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (response.ok && data.token) {
          localStorage.setItem('auth_token', data.token);
          window.location.href = '/';
        } else {
          const errorMessages = {
            'INVALID_CREDENTIALS': 'E-mail ou senha incorretos.',
            'RATE_LIMITED': 'Muitas tentativas. Tente novamente em 15 minutos.',
            'NOT_CONFIGURED': 'Sistema de autenticação não configurado. Execute o setup.',
          };

          showError(errorMessages[data.code] || data.error || 'Erro desconhecido. Tente novamente.');

          form.classList.add('shake');
          setTimeout(() => form.classList.remove('shake'), 400);
        }
      } catch (err) {
        showError('Erro de conexão. Verifique se o servidor está rodando.');
      } finally {
        setLoading(false);
      }
    });
  }

  // ========================================
  // HELPERS
  // ========================================
  function showError(message) {
    errorText.textContent = message;
    errorDiv.hidden = false;
  }

  function hideError() {
    errorDiv.hidden = true;
  }

  function setLoading(loading) {
    loginBtn.disabled = loading;
    btnText.textContent = loading ? 'Verificando...' : 'Entrar';
    btnLoading.hidden = !loading;
  }

  init().catch(console.error);

})();
