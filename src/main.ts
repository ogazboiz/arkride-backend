import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createValidationExceptionFactory } from './common/pipes/validation-exception.factory';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { validateEnvironment } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { corsOptions } from './config/cors.config';

async function bootstrap() {
  // Before anything is constructed. A missing JWT_SECRET used to degrade into
  // a publicly known default; now it stops the process here.
  validateEnvironment();

  const app = await NestFactory.create(AppModule);

  // Global Request Logger Middleware for debugging connectivity
  app.use((req, res, next) => {
    const { method, url } = req;
    const timestamp = new Date().toISOString();
    console.log(`[\x1b[32m${timestamp}\x1b[0m] \x1b[33m${method}\x1b[0m ${url}`);
    next();
  });

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown properties rather than silently dropping them.
      // Stripping hid real client/DTO drift: a client sending `vehiclePlateNumber`
      // when the DTO says `plateNumber` got a 200 and no vehicle change.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: createValidationExceptionFactory(),
    }),
  );

  // ONE error contract and ONE success contract for the whole API.
  // Before these, callers saw four incompatible error shapes and eleven
  // different success shapes across the same eleven controllers.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());

  // Was `app.enableCors()` — every origin, every method, in production.
  app.enableCors(corsOptions());

  /**
   * Realtime transport.
   *
   * Note this is Socket.IO's own adapter — the CORS policy for websocket
   * handshakes is configured on @WebSocketGateway(), NOT by app.enableCors()
   * above, which only covers Express routes.
   *
   * When the app outgrows a single instance, this is the one line that changes:
   * a custom adapter backed by @socket.io/redis-adapter fans broadcasts out
   * across every running node (the shared Redis client already exists).
   */
  app.useWebSocketAdapter(new IoAdapter(app));

  const config = new DocumentBuilder()
    .setTitle('Ark Rides API')
    .setDescription(
      'Ride-hailing backend for Ark Rides: rider and driver identity (Privy + email), ' +
        'ride lifecycle, fare ledger, driver wallet, emergency SOS and off-app booking channels.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT access token',
      },
      'bearer',
    )
    .addTag('Ark Rides')
    .build();

  // Swagger used to be mounted unconditionally, unauthenticated, in every
  // environment — a full map of the API surface handed to anyone who asked.
  // Opt-in outside local development.
  const swaggerEnabled =
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === undefined ||
    process.env.ENABLE_SWAGGER === 'true';

  if (swaggerEnabled) {
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, documentFactory);
  }

  await app.listen(process.env.PORT ?? 4010, '0.0.0.0');
}
bootstrap();
