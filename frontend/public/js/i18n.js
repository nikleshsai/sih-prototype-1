/**
 * I18N — Internationalization Engine
 * Supports: English (en), Tamil (ta), Hindi (hi)
 * Usage:
 *   I18N.t('nav.dashboard') → "Dashboard"
 *   I18N.t('farmer.expectedHarvest') → "எதிர்பார்க்கப்படும் அறுவடை" (Tamil)
 *   I18N.t('price') → "₹"
 *
 * Auto-applies translations to any element with data-i18n attribute,
 * and automatically translates UI text by matching english keys.
 */
const I18N = (() => {
  let _locale = localStorage.getItem('lang') || 'en';
  let _translations = {};
  let _loaded = {};
  let _enReverseMap = {}; // English String -> Key
  const SUPPORTED = ['en', 'ta', 'hi'];
  const LANG_NAMES = { en: 'English', ta: 'தமிழ்', hi: 'हिन्दी' };

  function buildReverseMap(obj, prefix = '') {
    for (let k in obj) {
      if (typeof obj[k] === 'object') {
        buildReverseMap(obj[k], prefix + k + '.');
      } else {
        _enReverseMap[obj[k].trim()] = prefix + k;
      }
    }
  }

  async function load(locale) {
    if (!SUPPORTED.includes(locale)) locale = 'en';
    // Always ensure English is loaded for reverse mapping
    if (!_loaded.en) {
      try {
        const res = await fetch('/i18n/en.json');
        _loaded.en = await res.json();
        buildReverseMap(_loaded.en);
      } catch (e) {
        console.warn('Failed to load English base for auto-translation');
        _loaded.en = {};
      }
    }
    if (!_loaded[locale]) {
      try {
        const res = await fetch(`/i18n/${locale}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _loaded[locale] = await res.json();
      } catch (err) {
        console.warn(`[I18N] Failed to load ${locale}.json, falling back to en`, err.message);
        _loaded[locale] = _loaded.en;
      }
    }
    _locale = locale;
    _translations = _loaded[locale];
    localStorage.setItem('lang', locale);
    document.documentElement.setAttribute('lang', locale);
    applyAll();
    _emitChange(locale);
  }

  function t(key, fallback) {
    const parts = key.split('.');
    let val = _translations;
    for (const part of parts) {
      if (val && typeof val === 'object') val = val[part];
      else {
        val = undefined;
        break;
      }
    }
    if (val && typeof val === 'string') return val;
    return fallback || key;
  }

  function translateTextNode(node) {
    if (!node._originalText) {
      node._originalText = node.nodeValue;
    }
    let original = node._originalText;
    let trimmed = original.trim();
    if (!trimmed) return;
    // Check if the exact english text has a mapping key
    let key = _enReverseMap[trimmed];
    if (key) {
      let translated = t(key);
      if (translated !== key) {
        node.nodeValue = original.replace(trimmed, translated);
        return;
      }
    }
    // If not found, revert to original (useful when switching back to en)
    node.nodeValue = original;
  }

  function walkDOMAndTranslate(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      translateTextNode(node);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Skip scripts and styles
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
      // Handle known attributes that might have english text
      if (node.placeholder) {
        if (!node._originalPlaceholder) node._originalPlaceholder = node.placeholder;
        let key = _enReverseMap[node._originalPlaceholder.trim()];
        if (key) node.placeholder = t(key);
        else node.placeholder = node._originalPlaceholder;
      }
      for (let child of node.childNodes) {
        walkDOMAndTranslate(child);
      }
    }
  }

  function applyAll() {
    // 1. Walk DOM to auto-translate any raw text
    walkDOMAndTranslate(document.body);
    // 2. data-i18n attributes (explicit translations)
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const val = t(el.dataset.i18n);
      if (val !== el.dataset.i18n) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.dataset.i18nTitle);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    // Update lang switcher buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
      const lang = btn.dataset.lang;
      btn.classList.toggle('active', lang === _locale);
      btn.setAttribute('aria-pressed', lang === _locale);
    });
  }

  function locale() { return _locale; }

  function supportedLanguages() {
    return SUPPORTED.map(code => ({ code, name: LANG_NAMES[code] }));
  }

  const _listeners = [];

  function _emitChange(locale) {
    _listeners.forEach(fn => fn(locale));
  }

  function onLanguageChange(fn) {
    _listeners.push(fn);
  }

  function renderSwitcher() {
    return SUPPORTED.map(code => `
      <button class="lang-btn${_locale === code ? ' active' : ''}" data-lang="${code}"
        aria-label="Switch to ${LANG_NAMES[code]}" aria-pressed="${_locale === code}"
        onclick="I18N.load('${code}')" title="${LANG_NAMES[code]}"
      >${LANG_NAMES[code] || code.toUpperCase()}</button>
    `).join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    load(_locale);
  });

  // Expose a method to re-scan dynamically added content
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            walkDOMAndTranslate(node);
          }
        });
      }
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
  });

  return { load, t, applyAll, locale, supportedLanguages, renderSwitcher, onLanguageChange };
})();
