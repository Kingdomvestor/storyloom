(() => {
  const key = 'storyloom-theme';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: light)');
  let saved = null;

  try {
    const stored = localStorage.getItem(key);
    if (stored === 'light' || stored === 'dark') saved = stored;
  } catch {}

  const initial = saved || (media.matches ? 'light' : 'dark');
  root.setAttribute('data-theme', initial);
  root.style.colorScheme = initial;

  const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
  const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  const apply = (theme, persist = false) => {
    if (theme !== 'light' && theme !== 'dark') return;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      const isDark = theme === 'dark';
      button.innerHTML = isDark ? sunIcon : moonIcon;
      button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-pressed', String(!isDark));
    }
    if (persist) {
      saved = theme;
      try {
        localStorage.setItem(key, theme);
      } catch {}
    }
  };

  const wire = () => {
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.addEventListener('click', () => {
        apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
      });
    }
    apply(root.dataset.theme);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else {
    wire();
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== key) return;
    saved = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
    apply(saved || (media.matches ? 'light' : 'dark'));
  });
  media.addEventListener('change', (event) => {
    if (!saved) apply(event.matches ? 'light' : 'dark');
  });
})();
