import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { createValidationExceptionFactory } from './common/pipes/validation-exception.factory';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
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
      transform: true,
      exceptionFactory: createValidationExceptionFactory(),
    }),
  );

  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle("KEKE")
    .setDescription("Keke Rides API description")
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT access token',
      },
      'bearer',
    )
    .addTag("KEKE")
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, documentFactory);

  await app.listen(process.env.PORT ?? 4010, '0.0.0.0');
}
bootstrap();
