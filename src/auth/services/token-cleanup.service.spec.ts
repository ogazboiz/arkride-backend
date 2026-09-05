import { TokenCleanupService } from './token-cleanup.service';
import { TokenService } from './token.service';

describe('TokenCleanupService', () => {
  let tokens: { pruneExpired: jest.Mock };
  let service: TokenCleanupService;

  beforeEach(() => {
    tokens = { pruneExpired: jest.fn().mockResolvedValue(0) };
    service = new TokenCleanupService(tokens as unknown as TokenService);
  });

  it('prunes on sweep', async () => {
    tokens.pruneExpired.mockResolvedValue(12);
    await service.sweep();
    expect(tokens.pruneExpired).toHaveBeenCalled();
  });

  it('never throws when the prune fails', async () => {
    // This runs from a background timer. An unhandled rejection there takes
    // the process down over a housekeeping task.
    tokens.pruneExpired.mockRejectedValue(new Error('connection reset'));
    await expect(service.sweep()).resolves.toBeUndefined();
  });

  it('starts no timer under NODE_ENV=test', () => {
    // Jest sets NODE_ENV=test. A background timer here would fire against a
    // mock and leave an open handle warning at the end of the run.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    service.onModuleInit();
    expect((service as unknown as { timer: unknown }).timer).toBeNull();
    process.env.NODE_ENV = previous;
  });

  it('starts and then clears a timer outside test', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    service.onModuleInit();
    expect((service as unknown as { timer: unknown }).timer).not.toBeNull();
    service.onModuleDestroy();
    expect((service as unknown as { timer: unknown }).timer).toBeNull();
    process.env.NODE_ENV = previous;
  });

  it('is safe to destroy without ever having started', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
