import { describe, expect, it } from 'vitest';
import {
  resolveMastodonHandle,
  type FetchWebfinger,
  type WebfingerResult,
} from './index.js';

const webfinger = (
  overrides: Partial<{
    subject: string;
    links: WebfingerResult['links'];
  }>
): WebfingerResult => ({
  subject: 'acct:user@instance.social',
  links: [],
  ...overrides,
});

const selfLink = (href: string) => ({
  rel: 'self',
  type: 'application/activity+json',
  href,
});

const fakeFetch =
  (results: Record<string, WebfingerResult>): FetchWebfinger =>
  async (url) => {
    const result = results[url];
    if (result == null) {
      throw new Error(`unexpected request: ${url}`);
    }
    return result;
  };

const urlFor = (host: string) =>
  `https://${host}/.well-known/webfinger?resource=acct%3Auser%40instance.social`;

describe('resolveMastodonHandle', () => {
  it('resolves a handle whose self link stays on the same host', async () => {
    const result = await resolveMastodonHandle(
      'user@instance.social',
      'instance.social',
      undefined,
      fakeFetch({
        [urlFor('instance.social')]: webfinger({
          subject: 'acct:user@instance.social',
          links: [selfLink('https://instance.social/users/user')],
        }),
      })
    );
    expect(result).toEqual({
      host: 'instance.social',
      handle: 'user@instance.social',
    });
  });

  it('ignores subject case differences', async () => {
    const result = await resolveMastodonHandle(
      'user@instance.social',
      'instance.social',
      undefined,
      fakeFetch({
        [urlFor('instance.social')]: webfinger({
          subject: 'acct:USER@INSTANCE.SOCIAL',
          links: [selfLink('https://instance.social/users/user')],
        }),
      })
    );
    expect(result.handle).toBe('USER@INSTANCE.SOCIAL');
  });

  it('throws when webfinger returns a different subject', async () => {
    await expect(
      resolveMastodonHandle(
        'user@instance.social',
        'instance.social',
        undefined,
        fakeFetch({
          [urlFor('instance.social')]: webfinger({
            subject: 'acct:other@instance.social',
            links: [selfLink('https://instance.social/users/user')],
          }),
        })
      )
    ).rejects.toThrow('Invalid subject, expected acct:user@instance.social');
  });

  it('throws when there is no usable self link', async () => {
    await expect(
      resolveMastodonHandle(
        'user@instance.social',
        'instance.social',
        undefined,
        fakeFetch({
          [urlFor('instance.social')]: webfinger({
            links: [{ rel: 'alternate', href: 'https://instance.social' }],
          }),
        })
      )
    ).rejects.toThrow('No self link for acct:user@instance.social');
  });

  it('follows a self link to a different host', async () => {
    const result = await resolveMastodonHandle(
      'user@instance.social',
      'instance.social',
      undefined,
      fakeFetch({
        [urlFor('instance.social')]: webfinger({
          links: [selfLink('https://ap-proxy.example/users/user')],
        }),
        [urlFor('ap-proxy.example')]: webfinger({
          links: [selfLink('https://ap-proxy.example/users/user')],
        }),
      })
    );
    expect(result).toEqual({
      host: 'ap-proxy.example',
      handle: 'user@instance.social',
    });
  });

  it('throws after running out of resolutions', async () => {
    const chained = fakeFetch({
      [urlFor('instance.social')]: webfinger({
        links: [selfLink('https://one.example/users/user')],
      }),
      [urlFor('one.example')]: webfinger({
        links: [selfLink('https://two.example/users/user')],
      }),
    });
    await expect(
      resolveMastodonHandle(
        'user@instance.social',
        'instance.social',
        undefined,
        chained
      )
    ).rejects.toThrow('Too many resolves for acct:user@instance.social');
  });
});
