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

  // Check if already logged in
  const existingToken = getCookie('auth_token');
  if (existingToken) {
    // Verify token is still valid
    fetch('/api/auth/status', {
      headers: { 'Authorization': 'Bearer ' + existingToken }
    })
    .then(r => r.json())
    .then(data => {
      if (data.authenticated) {
        window.location.href = '/';
      }
    })
    .catch(() => {});
  }

  // Toggle password visibility
  toggleBtn.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
    toggleBtn.textContent = type === 'password' ? '👁️' : '🙈';
  });

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError('Preencha todos os campos.');
      return;
    }

    // Show loading
    setLoading(true);
    hideError();

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        // Save token in secure cookie
        setCookie('auth_token', data.token, 1); // 1 day expiry

        // Redirect to dashboard
        window.location.href = '/';
      } else {
        // Show error
        const errorMessages = {
          'INVALID_CREDENTIALS': 'E-mail ou senha incorretos.',
          'RATE_LIMITED': 'Muitas tentativas. Tente novamente em 15 minutos.',
          'NOT_CONFIGURED': 'Sistema de autenticação não configurado. Execute o setup.',
        };
        
        showError(errorMessages[data.code] || data.error || 'Erro desconhecido. Tente novamente.');
        
        // Shake the form
        form.classList.add('shake');
        setTimeout(() => form.classList.remove('shake'), 400);
      }
    } catch (err) {
      showError('Erro de conexão. Verifique se o servidor está rodando.');
    } finally {
      setLoading(false);
    }
  });

  // Handle Enter key
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      form.dispatchEvent(new Event('submit'));
    }
  });

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

  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict; Secure`;
  }

  function getCookie(name) {
    const cookies = document.cookie.split(';').map(c => c.trim());
    const found = cookies.find(c => c.startsWith(name + '='));
    return found ? found.split('=')[1] : null;
  }

})();
