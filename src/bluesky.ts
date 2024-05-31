import { BskyAgent } from '@atproto/api';

export const unauthenticatedAgent = new BskyAgent({
  service: 'https://public.api.bsky.app',
});

const agent = new BskyAgent({
  service: 'https://bsky.social',
});

export const getSantaBskyAgent = async () => {
  if (!agent.hasSession) {
    console.log('logging in');
    await agent.login({
      identifier: process.env.SANTA_BLUESKY_HANDLE ?? 'unknown',
      password: process.env.SANTA_BLUESKY_PASSWORD ?? 'unknown',
    });
  }
  return agent;
};

export const getRobotBskyAgent = async () => {
  if (!agent.hasSession) {
    console.log('logging in');
    await agent.login({
      identifier: process.env.ROBOT_BLUESKY_HANDLE ?? 'unknown',
      password: process.env.ROBOT_BLUESKY_PASSWORD ?? 'unknown',
    });
  }
  return agent;
};
