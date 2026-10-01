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
  let themeChangeFrame = 0;

  const sunIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
  const moonIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  const apply = (theme, persist = false) => {
    if (theme !== 'light' && theme !== 'dark') return;
    const changed = root.dataset.theme !== theme;
    if (changed) {
      root.setAttribute('data-theme-changing', '');
      cancelAnimationFrame(themeChangeFrame);
    }
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
    if (changed) {
      themeChangeFrame = requestAnimationFrame(() => {
        themeChangeFrame = requestAnimationFrame(() => {
          root.removeAttribute('data-theme-changing');
          themeChangeFrame = 0;
        });
      });
    }
  };

  const wire = () => {
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.addEventListener('click', () => {
        apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
      });
    }

    for (const link of document.querySelectorAll('.mobile-menu-panel a')) {
      link.addEventListener('click', () => {
        link.closest('.mobile-menu')?.removeAttribute('open');
      });
    }

    const toggleStickyHeaderState = () => {
      const scrolled = window.scrollY > 8;
      for (const el of document.querySelectorAll('.nav, .topbar')) {
        el.classList.toggle('is-scrolled', scrolled);
      }
    };

    toggleStickyHeaderState();
    window.addEventListener('scroll', toggleStickyHeaderState, { passive: true });
    window.addEventListener('resize', toggleStickyHeaderState);
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
