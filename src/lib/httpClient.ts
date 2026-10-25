/* v8 ignore start */
/* Thin wrappers around external services; exercised via mocks in tests. */
import { safeFetchWrap } from '@atproto-labs/fetch-node';
import wretch from 'wretch';
import FormDataAddon from 'wretch/addons/formData';

export const w = wretch()
  .polyfills({
    fetch: safeFetchWrap(),
  })
  .addon(FormDataAddon)
  .options({
    redirect: 'error',
  });
/* v8 ignore stop */
