export * from './utils.js';
export * from './disableFields.js';
export * from '../lib/dates.js';

(function () {
  const mql = window.matchMedia('(max-width: 1024px)');
  function screenTest(e: MediaQueryList | MediaQueryListEvent) {
    // @ts-expect-error this field is not declared
    window.ssIsMobileWidth = e.matches;
    window.dispatchEvent(
      new CustomEvent('ss-is-mobile-width-changed', { detail: e.matches })
    );
  }
  mql.addEventListener('change', screenTest);
  screenTest(mql);
})();
