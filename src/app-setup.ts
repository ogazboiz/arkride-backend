import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { createValidationExceptionFactory } from './common/pipes/validation-exception.factory';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { corsOptions } from './config/cors.config';

/**
 * Everything global that shapes a request or a response.
 *
 * WHY THIS IS NOT IN `main.ts`
 *
 * It was, and that made every integration test a lie. A test doing
 * `Test.createTestingModule({ imports: [AppModule] })` builds the app WITHOUT
 * `main.ts` — so it ran with no ValidationPipe, no exception filter and no
 * response envelope. `test/app.e2e-spec.ts` asserted a bare `'Hello ARK RIDE!'`
 * and passed, while production returns that string wrapped in the envelope.
 *
 * The failure mode is the bad kind: the test is green, and it is green because
 * it is testing something the server never does. Every e2e test written after
 * it would have been written against that same wrong contract.
 *
 * So the global setup lives here, `main.ts` calls it, and tests call it too.
 * There is one definition of what a request passes through.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown properties rather than silently dropping them.
      // Stripping hid real client/DTO drift: a client sending
      // `vehiclePlateNumber` when the DTO says `plateNumber` got a 200 and no
      // vehicle change.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: createValidationExceptionFactory(),
    }),
  );

  // ONE error contract and ONE success contract for the whole API. Before
  // these, callers saw four incompatible error shapes and eleven different
  // success shapes across the same eleven controllers.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  // Was `app.enableCors()` — every origin, every method, in production.
  app.enableCors(corsOptions());

  return app;
}
