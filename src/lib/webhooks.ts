/* v8 ignore start */
/* Thin wrappers around external services; exercised via mocks in tests. */
import fetch from 'node-fetch';

export const postWebhook = async (
  hookUrl: string,
  body: unknown
): Promise<void> => {
  const result = await fetch(hookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  await result.text();
};
/* v8 ignore stop */
