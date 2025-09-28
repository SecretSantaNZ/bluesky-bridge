import { startRequest, endRequest } from './disableFields.js';
export * from './disableFields.js';
export * from './utils.js';
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

  window.addEventListener('ajax:before', function (evt) {
    startRequest(evt.target as Element);
  });
  window.addEventListener('ajax:after', function (evt) {
    endRequest(evt.target as Element);
  });
  window.addEventListener('ajax:send', function (evt) {
    const event = evt as CustomEvent;
    const target = event.target as Element;
    const errorTarget = target.getAttribute('x-target.error');
    if (errorTarget) {
      event.detail.headers['x-ssnz-error-target'] = errorTarget;
    }
  });
})();
