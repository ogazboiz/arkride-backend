import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DecaneService } from './decane.service';

describe('DecaneService', () => {
  let service: DecaneService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'DECANE_APP_ID') return 'proj_test_123';
      if (key === 'DECANE_API_KEY') return 'dck_live_test_key';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecaneService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<DecaneService>(DecaneService);
    service.onModuleInit();
  });

  it('should be defined and initialized', () => {
    expect(service).toBeDefined();
  });

  it('should reject safeVerifyAccessToken with invalid token without throwing', async () => {
    const claims = await service.safeVerifyAccessToken('invalid.jwt.token');
    expect(claims).toBeNull();
  });
});
