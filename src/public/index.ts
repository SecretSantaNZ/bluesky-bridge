import { startRequest, endRequest } from './disableFields.js';
import { buildPager, removeMatch, replaceMatch } from './utils.js';
import { formatDate, formatDateIso, formatDatetime } from '../lib/dates.js';

import Alpine from 'alpinejs';
import morph from '@alpinejs/morph';
import ajax from '@imacrayon/alpine-ajax';
import persist from '@alpinejs/persist';

import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

setOptions({
  // @ts-expect-error global isn't defined
  key: window.CLIENT_GOOGLE_API_KEY,
  v: 'weekly',
});

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
  'search-handles',
  (el, { expression }, { effect, evaluateLater, cleanup, Alpine }) => {
    let isEnabled = false;
    const inputElement = el as Alpine.ElementWithXAttributes<HTMLInputElement>;
    const elementId = el.getAttribute('id');
    const datalistId = elementId
      ? `${elementId}_autocomplete_handles`
      : crypto.randomUUID();
    const datalist = document.createElement('datalist');
    datalist.setAttribute('id', datalistId);

    inputElement.parentNode?.appendChild(datalist);
    inputElement.autocomplete = 'off';

    const getEnabled = evaluateLater(expression);
    effect(() => {
      getEnabled((enabled) => {
        isEnabled = Boolean(enabled);
        if (enabled) {
          inputElement.setAttribute('list', datalistId);
        } else {
          inputElement.removeAttribute('list');
        }
      });
    });
    inputElement.setAttribute('list', datalistId);

    const listener = Alpine.debounce(async () => {
      if (!isEnabled) return;
      const term = inputElement.value || '';
      const cleanTerm = term.replace(/^@/, '').trim().toLowerCase();
      const result = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(cleanTerm)}`
      );
      if (!result.ok) {
        console.error(
          `Error fetching matching handles: ${result.status}: ${await result.text()}`
        );
      }
      const { actors = [] } = await result.json();
      const prefix = term.startsWith('@') ? '@' : '';
      const handles = actors.map((item) => prefix + item.handle);
      datalist.innerHTML = '';
      for (const handle of handles) {
        const option = document.createElement('option');
        option.innerText = handle;
        datalist.appendChild(option);
      }
    });
    el.addEventListener('keydown', listener);
    cleanup(() => {
      el.removeEventListener('keydown', listener);
      inputElement.parentNode?.removeChild(datalist);
    });
  }
);

Alpine.directive('address-autocomplete', (el, { value }, { Alpine }) => {
  const dataAttribute = value || 'address';
  let elementId = el.getAttribute('id');
  if (!elementId) {
    elementId = crypto.randomUUID();
    el.setAttribute('id', elementId);
  }

  importLibrary('places').then((places) => {
    const addressAutocomplete = new places.Autocomplete(
      el as HTMLInputElement,
      {
        componentRestrictions: {
          country: 'nz',
        },
      }
    );
    function listener() {
      const place = addressAutocomplete.getPlace();
      Alpine.$data(el)[dataAttribute] = place.formatted_address;
    }
    addressAutocomplete.addListener('place_changed', listener);
  });
});

Alpine.directive('reassign-map', (el, { expression }, { evaluate }) => {
  let elementId = el.getAttribute('id');
  if (!elementId) {
    elementId = crypto.randomUUID();
    el.setAttribute('id', elementId);
  }

  importLibrary('maps').then(async ({ Map }) => {
    const { AdvancedMarkerElement, PinElement } = await importLibrary('marker');

    const map = new Map(
      document.getElementById(elementId as string) as HTMLElement,
      {
        mapId: elementId,
      }
    );

    const { giftee, santas } = evaluate(expression) as {
      giftee: { handle: string; address_location: string };
      santas: Array<{ handle: string; address_location: string }>;
    };
    for (const santa of santas) {
      if (!santa.address_location) continue;
      const santaMarker = new AdvancedMarkerElement({
        map,
        position: JSON.parse(santa.address_location),
        title: santa.handle,
      });
      santaMarker.addEventListener('click', () => {
        window.dispatchEvent(
          new CustomEvent('ss:santa:selected', {
            detail: { santa_handle: santa.handle },
          })
        );
      });
    }

    if (giftee.address_location) {
      const gifteeLocation = JSON.parse(giftee.address_location);
      const gifteePin = new PinElement({
        background: '#0000FF',
        glyphColor: '#6666FF',
      });
      new AdvancedMarkerElement({
        map,
        content: gifteePin.element,
        position: gifteeLocation,
        title: giftee.handle,
      });

      map.setCenter(gifteeLocation);
      map.setZoom(10);
    }
  });
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
