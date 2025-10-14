import { startRequest, endRequest } from './disableFields.js';
import { buildPager, removeMatch, replaceMatch } from './utils.js';
import { formatDate, formatDateIso, formatDatetime } from '../lib/dates.js';

import Alpine from 'alpinejs';
import morph from '@alpinejs/morph';
import ajax from '@imacrayon/alpine-ajax';
import persist from '@alpinejs/persist';

declare global {
  interface Window {
    Alpine: typeof Alpine;
  }
}
window.Alpine = Alpine;
Alpine.plugin(morph);
Alpine.plugin(ajax);
Alpine.plugin(persist);
Alpine.magic('pager', () => buildPager);
Alpine.magic('replaceMatch', () => replaceMatch);
Alpine.magic('removeMatch', () => removeMatch);
Alpine.magic('currentDateIso', () => formatDateIso(new Date()));
Alpine.magic('startRequest', () => (startRequestFrom) => {
  startRequest(document.querySelector(startRequestFrom));
});
Alpine.directive(
  'datetime',
  (el, { expression }, { evaluateLater, effect }) => {
    const getIsoDatetime = evaluateLater(expression);
    effect(() => {
      getIsoDatetime((isoDatetime) => {
        const formattedDateTime = isoDatetime
          ? formatDatetime(isoDatetime as string | Date)
          : '';
        el.innerText = formattedDateTime;
      });
    });
  }
);
Alpine.directive('date', (el, { expression }, { evaluateLater, effect }) => {
  const getIsoDate = evaluateLater(expression);
  effect(() => {
    getIsoDate((isoDate) => {
      const formattedDate = isoDate ? formatDate(isoDate as string | Date) : '';
      el.innerText = formattedDate;
    });
  });
});

Alpine.start();

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
