import { BadRequestException, Logger, ValidationError } from '@nestjs/common';

const SENSITIVE_VALIDATION_FIELDS = new Set([
  'password',
  'confirmPassword',
  'oldPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
]);

function safeValidationValue(property: string, value: unknown) {
  if (SENSITIVE_VALIDATION_FIELDS.has(property)) {
    return '[REDACTED]';
  }

  return value;
}

export function createValidationExceptionFactory() {
  const validationLogger = new Logger('ValidationPipe');

  return (errors: ValidationError[]) => {
    const validationErrors = errors.map((error) => ({
      property: error.property,
      value: safeValidationValue(error.property, error.value),
      constraints: error.constraints,
      children: error.children?.map((child) => ({
        property: child.property,
        value: safeValidationValue(child.property, child.value),
        constraints: child.constraints,
      })),
    }));

    validationLogger.warn({
      message: 'Request validation failed',
      errors: validationErrors,
    });

    return new BadRequestException(validationErrors);
  };
}
