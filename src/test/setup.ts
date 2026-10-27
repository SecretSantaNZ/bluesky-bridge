import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './mocks/server.js';

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
