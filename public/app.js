// Parlats — lightweight vanilla JS utilities
// Replaces _hyperscript with simple, debuggable code

// CSRF: inject token into all HTMX requests
document.addEventListener('htmx:configRequest', function(event) {
  var token = document.querySelector('meta[name="csrf-token"]');
  if (token) {
    event.detail.headers['x-csrf-token'] = token.content;
  }
});

/** Namespace tab switching — update visual classes, preserve search/filter */
function switchTab(tab) {
  const activeClasses = ['border-primary', 'text-primary'];
  const inactiveClasses = ['border-transparent', 'text-text-secondary', 'hover:text-text-primary', 'hover:border-border-strong'];

  tab.closest('nav').querySelectorAll('a').forEach(t => {
    const isActive = t === tab;
    t.setAttribute('aria-current', isActive ? 'true' : 'false');
    if (isActive) {
      inactiveClasses.forEach(c => t.classList.remove(c));
      activeClasses.forEach(c => t.classList.add(c));
    } else {
      activeClasses.forEach(c => t.classList.remove(c));
      inactiveClasses.forEach(c => t.classList.add(c));
    }
  });
  const ns = document.getElementById('active-namespace');
  if (ns) ns.value = tab.dataset.namespace || '';
  // Search and filter are intentionally preserved across tab switches
}

/** Update import diff checkbox count */
function updateImportCount() {
  const form = document.getElementById('import-apply-form');
  if (!form) return;
  const count = form.querySelectorAll('input[type="checkbox"].diff-check:checked').length;
  const el = document.getElementById('apply-count');
  if (el) el.textContent = count + ' changes selected';
}

/** Toggle all import checkboxes */
function toggleImportAll() {
  const form = document.getElementById('import-apply-form');
  if (!form) return;
  const boxes = form.querySelectorAll('input[type="checkbox"].diff-check');
  const allChecked = Array.from(boxes).every(cb => cb.checked);
  boxes.forEach(cb => cb.checked = !allChecked);
  updateImportCount();
}

/** Auto-dismiss an element after delay */
function autoDismiss(el, ms) {
  setTimeout(() => {
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 500);
  }, ms || 5000);
}

/** Focus textarea and move cursor to end */
function focusEnd(el) {
  el.focus();
  el.selectionStart = el.value.length;
}

/** Toggle mobile sidebar drawer */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar || !backdrop) return;

  const isOpen = !sidebar.classList.contains('-translate-x-full');
  sidebar.classList.toggle('-translate-x-full', isOpen);
  backdrop.classList.toggle('hidden', isOpen);
  document.body.classList.toggle('overflow-hidden', !isOpen);
  toggle?.setAttribute('aria-expanded', String(!isOpen));

  // Return focus to hamburger button when closing
  if (isOpen && toggle) toggle.focus();
}

// Close sidebar on nav link click (mobile)
document.addEventListener('click', (e) => {
  const link = e.target.closest('#sidebar a[href]');
  if (link && window.innerWidth < 1024) {
    toggleSidebar();
  }
});

// Close sidebar on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
      toggleSidebar();
    }
  }
});

/** Export wizard — update namespace/language steps based on selected format */
function updateExportSteps() {
  var formatEl = document.querySelector('input[name="format"]:checked');
  if (!formatEl) return;
  var format = formatEl.value;
  var isMulti = (format === 'csv' || format === 'xlsx');
  var config = window.__exportConfig || {};

  // Update format card styling
  document.querySelectorAll('.export-format-card').forEach(function(card) {
    var radio = card.querySelector('input[type="radio"]');
    if (radio && radio.checked) {
      card.classList.remove('border-border', 'bg-surface-card');
      card.classList.add('border-primary', 'bg-primary/10');
    } else {
      card.classList.remove('border-primary', 'bg-primary/10');
      card.classList.add('border-border', 'bg-surface-card');
    }
  });

  // Update namespace heading
  var nsHeading = document.getElementById('namespace-heading');
  if (nsHeading) {
    nsHeading.textContent = isMulti ? '2. Namespace(s)' : '2. Namespace';
  }

  // Update language heading
  var langHeading = document.getElementById('language-heading');
  if (langHeading) {
    langHeading.textContent = isMulti ? '3. Language(s)' : '3. Language';
  }

  // Switch namespace inputs between radio and checkbox
  var nsInputs = document.querySelectorAll('.namespace-input');
  nsInputs.forEach(function(input) {
    var newType = isMulti ? 'checkbox' : 'radio';
    if (input.type !== newType) {
      input.type = newType;
      // When switching to radio, ensure only default is selected
      if (newType === 'radio') {
        input.checked = (input.dataset.default === 'true');
      }
    }
  });

  // Switch language inputs between radio and checkbox
  var langInputs = document.querySelectorAll('.language-input');
  langInputs.forEach(function(input) {
    var isDefault = (input.dataset.default === 'true');
    var newType = isMulti ? 'checkbox' : 'radio';
    if (input.type !== newType) {
      input.type = newType;
      // When switching to radio, ensure only default is selected
      if (newType === 'radio') {
        input.checked = isDefault;
        input.disabled = false;
      }
    }
    // For multi-format, default language is always checked and disabled
    if (isMulti) {
      if (isDefault) {
        input.checked = true;
        input.disabled = true;
      } else {
        input.disabled = false;
      }
    } else {
      input.disabled = false;
    }
  });

  // Enable/disable hidden default language input
  // When multi-format, the visible default-lang checkbox is disabled (won't submit),
  // so we enable a hidden input to carry that value instead.
  var defaultLangHidden = document.getElementById('default-lang-hidden');
  if (defaultLangHidden) {
    defaultLangHidden.disabled = !isMulti;
  }

  // Show/hide only-missing filter
  var onlyMissingFilter = document.getElementById('only-missing-filter');
  if (onlyMissingFilter) {
    if (isMulti) {
      onlyMissingFilter.classList.remove('hidden');
    } else {
      onlyMissingFilter.classList.add('hidden');
      // Uncheck when hidden
      var cb = onlyMissingFilter.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
    }
  }
}

// Modal focus trap + initial focus
document.addEventListener('click', (e) => {
  var btn = e.target.closest('[data-open-dialog]');
  if (btn) {
    var dialog = document.getElementById(btn.dataset.openDialog);
    if (dialog) {
      dialog.showModal();
      // Focus first interactive element inside
      var focusable = dialog.querySelector('button:not([aria-label="Close"]), input, select, textarea, a[href]');
      if (focusable) focusable.focus();
    }
  }
});

// Auto-focus first interactive element when any dialog opens
new MutationObserver(function(mutations) {
  mutations.forEach(function(m) {
    if (m.attributeName === 'open') {
      var dialog = m.target;
      if (dialog.tagName === 'DIALOG' && dialog.hasAttribute('open')) {
        var focusable = dialog.querySelector('input:not([type="hidden"]), select, textarea, button:not([aria-label="Close"])');
        if (focusable) setTimeout(function() { focusable.focus(); }, 50);
      }
    }
  });
}).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open'] });

// Focus trap: keep Tab/Shift+Tab inside open dialogs
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  var dialog = document.querySelector('dialog[open]');
  if (!dialog) return;

  var focusable = dialog.querySelectorAll('button, input:not([type="hidden"]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;

  var first = focusable[0];
  var last = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === '?') {
    e.preventDefault();
    document.getElementById('shortcuts-modal')?.showModal();
  }
});

// Confirm dialogs via data-confirm attribute (prevents XSS from inline JS)
document.addEventListener('submit', function(event) {
  var form = event.target.closest('form[data-confirm]');
  if (form) {
    var message = form.getAttribute('data-confirm');
    if (!confirm(message)) {
      event.preventDefault();
    }
  }
});
