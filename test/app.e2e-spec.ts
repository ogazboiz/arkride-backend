import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app-setup';

/**
 * NOTE FOR ANYONE ADDING AN INTEGRATION TEST HERE.
 *
 * `Test.createTestingModule({ imports: [AppModule] })` builds the app WITHOUT
 * `main.ts`, so it has no ValidationPipe, no exception filter and no response
 * envelope unless you say so. `configureApp(app)` is what makes the test
 * exercise the request path production actually uses.
 *
 * This test previously asserted a bare `'Hello ARK RIDE!'` and passed — while
 * the server returns that string wrapped in the envelope. A green test that is
 * green because it tests something the server never does is worse than no test,
 * and every e2e test written after it would have inherited the same wrong
 * contract.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(moduleFixture.createNestApplication());
    await app.init();
  });

  afterEach(async () => {
    // Without this the Redis client and the BullMQ workers keep the Jest
    // process alive and the run ends in an open-handle warning.
    await app.close();
  });

  it('wraps the liveness response in the standard envelope', async () => {
    // NOTE: the payload is the framework's default 'Hello World!'. There is no
    // real health endpoint yet — see "Known gaps" in the README. This asserts
    // the ENVELOPE, which is the contract that matters here.
    const response = await request(app.getHttpServer()).get('/').expect(200);

    expect(response.body).toEqual({
      success: true,
      statusCode: 200,
      message: 'Request successful',
      data: 'Hello World!',
      timestamp: expect.any(String),
    });
  });

  it('returns the standard failure envelope for an unknown route', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404);

    expect(response.body).toMatchObject({
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      path: '/api/v1/does-not-exist',
    });
    // The contract is that `message` is ALWAYS one string, never an array.
    expect(typeof response.body.message).toBe('string');
  });

  it('rejects an unknown property rather than silently dropping it', async () => {
    // forbidNonWhitelisted is part of configureApp; a test built without it
    // would get a 401 here instead and never notice the pipe was missing.
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/privy')
      .send({ accessToken: 'x', audience: 'rider', isAdmin: true })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'isAdmin' }),
      ]),
    );
  });
});
