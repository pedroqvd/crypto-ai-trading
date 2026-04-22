// ================================================
// UI HELPERS — Toast notifications, loading states
// ================================================

(function() {
  'use strict';

  // ========================================
  // TOAST NOTIFICATIONS
  // ========================================
  const toastContainer = (() => {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      max-width: 400px;
    `;
    document.body.appendChild(container);
    return container;
  })();

  window.showToast = function(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      background: ${
        type === 'success' ? '#10b981' :
        type === 'error' ? '#ef4444' :
        type === 'warning' ? '#f59e0b' : '#3b82f6'
      };
      color: white;
      padding: 12px 16px;
      margin-bottom: 10px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: slideIn 0.3s ease-out;
      font-size: 14px;
      line-height: 1.4;
    `;

    toast.innerHTML = `<span style="margin-right: 8px;">${icons[type]}</span>${message}`;

    toastContainer.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    return toast;
  };

  // ========================================
  // LOADING SPINNER
  // ========================================
  window.showLoading = function(element) {
    if (!element) return;
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.style.cssText = `
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
    `;
    element.innerHTML = '';
    element.appendChild(spinner);
    element.appendChild(document.createTextNode('Loading...'));
  };

  window.hideLoading = function(element, text = '') {
    if (!element) return;
    element.innerHTML = text || '';
    element.style.opacity = '1';
  };

  // ========================================
  // RETRY LOGIC
  // ========================================
  window.retryAsync = async function(fn, maxAttempts = 3, delayMs = 1000) {
    let lastError;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  };

  // ========================================
  // BUTTON STATE MANAGEMENT
  // ========================================
  window.setBtnLoading = function(button, loading = true) {
    if (!button) return;
    const originalText = button.dataset.originalText || button.textContent;

    if (loading) {
      button.dataset.originalText = originalText;
      button.disabled = true;
      button.style.opacity = '0.7';
      button.style.pointerEvents = 'none';

      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      spinner.style.cssText = `
        display: inline-block;
        width: 12px;
        height: 12px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-right: 6px;
      `;
      button.innerHTML = '';
      button.appendChild(spinner);
      button.appendChild(document.createTextNode('Loading...'));
    } else {
      button.disabled = false;
      button.style.opacity = '1';
      button.style.pointerEvents = 'auto';
      button.textContent = originalText;
    }
  };

  // ========================================
  // CSS ANIMATIONS
  // ========================================
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .toast {
      word-break: break-word;
      white-space: pre-wrap;
    }

    .loading-spinner {
      vertical-align: middle;
    }

    .btn-spinner {
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);

  // ========================================
  // FORM VALIDATION FEEDBACK
  // ========================================
  window.showValidationError = function(input, message) {
    input.classList.add('input-error');
    input.setAttribute('data-error', message);
    const error = document.createElement('div');
    error.className = 'error-message';
    error.textContent = message;
    error.style.cssText = `
      color: #ef4444;
      font-size: 12px;
      margin-top: 4px;
      font-weight: 500;
    `;
    input.parentNode.appendChild(error);
  };

  window.clearValidationError = function(input) {
    input.classList.remove('input-error');
    const error = input.parentNode.querySelector('.error-message');
    if (error) error.remove();
  };

  // ========================================
  // DEBOUNCE HELPER
  // ========================================
  window.debounce = function(fn, delay = 300) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  };

  // ========================================
  // PROGRESS INDICATOR
  // ========================================
  window.showProgress = function(element, percentage) {
    let progress = element.querySelector('.progress-bar');
    if (!progress) {
      progress = document.createElement('div');
      progress.className = 'progress-bar';
      progress.style.cssText = `
        width: 100%;
        height: 4px;
        background: rgba(0,0,0,0.1);
        border-radius: 2px;
        overflow: hidden;
        margin-top: 8px;
      `;
      const bar = document.createElement('div');
      bar.style.cssText = `
        height: 100%;
        background: linear-gradient(90deg, #667eea, #764ba2);
        width: 0%;
        transition: width 0.3s ease;
      `;
      progress.appendChild(bar);
      element.appendChild(progress);
    }

    const bar = progress.querySelector('div');
    bar.style.width = Math.min(100, Math.max(0, percentage)) + '%';
  };

})();
