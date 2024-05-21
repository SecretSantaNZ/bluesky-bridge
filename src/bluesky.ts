import { BskyAgent } from '@atproto/api';

export const agent = new BskyAgent({ service: 'https://bsky.social' });
export const getBskyAgent = async () => {
  if (!agent.hasSession) {
    console.log('logging in');
    await agent.login({
      identifier: process.env.BLUESKY_HANDLE ?? 'unknown',
      password: process.env.BLUESKY_PASSWORD ?? 'unknown',
    });
  }
  return agent;
};
