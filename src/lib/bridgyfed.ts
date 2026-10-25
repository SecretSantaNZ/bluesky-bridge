import * as cheerio from 'cheerio';
import { w } from './httpClient.js';

export const fetchBridgedMastodonPage = async (
  blueskyHandle: string
): Promise<string | null> => {
  return w
    .get(`https://fed.brid.gy/bsky/${blueskyHandle}`)
    .notFound(() => null)
    .text();
};

export const fetchBridgedBlueskyPage = async (
  mastodonHandle: string
): Promise<string | null> => {
  return w
    .get(`https://fed.brid.gy/ap/@${mastodonHandle}`)
    .notFound(() => null)
    .text();
};

export const parseBridgedMastodonHandle = (html: string): string => {
  const doc = cheerio.load(html);
  const mastodonHandle = doc('a[rel="me"]').eq(1).text().trim();
  return mastodonHandle.replace(/^@/, '');
};

export const parseBridgedBlueskyHandle = (html: string): string => {
  const doc = cheerio.load(html);
  const blueskyHandle = doc('a[rel="me"]').eq(1).text().trim();
  return blueskyHandle;
};
