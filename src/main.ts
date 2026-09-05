import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { validateEnvironment } from './config/env.validation';
import { configureApp } from './app-setup';
import { isDevelopment } from './config/environment';
import { applyEnvelopeToDocument } from './common/swagger/document-envelope';

async function bootstrap() {
  // Before anything is constructed. A missing JWT_SECRET used to degrade into
  // a publicly known default; now it stops the process here.
  validateEnvironment();

  const app = await NestFactory.create(AppModule);

  // Request log. Goes through the Nest logger rather than console.log, so it
  // honours log levels and is formatted like every other line the app emits —
  // and it logs the PATH, not the full URL, which would put query strings
  // (including a `?token=`) into the log.
  const requests = new Logger('HTTP');
  app.use((req: Request, _res: Response, next: NextFunction) => {
    requests.log(`${req.method} ${req.path}`);
    next();
  });

  // Pipes, filters, interceptors and CORS. Shared with the integration tests
  // so they exercise the same request path production does — see app-setup.ts.
  configureApp(app);

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
  // Fails CLOSED: an unset NODE_ENV is NOT development. See config/environment.
  const swaggerEnabled =
    isDevelopment() || process.env.ENABLE_SWAGGER === 'true';

  if (swaggerEnabled) {
    const documentFactory = () =>
      // Every handler declares its INNER payload, but a global interceptor
      // wraps all of them in the standard envelope — so the document is
      // corrected once, centrally, rather than by a decorator on 67 handlers
      // that one person will forget. See document-envelope.ts.
      applyEnvelopeToDocument(SwaggerModule.createDocument(app, config));

    SwaggerModule.setup('api', app, documentFactory, {
      jsonDocumentUrl: 'api-json',
      swaggerOptions: {
        // Keep the bearer token across a page reload; re-pasting it for every
        // call is the main reason people stop using the docs page.
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  await app.listen(process.env.PORT ?? 4010, '0.0.0.0');
}
bootstrap();
