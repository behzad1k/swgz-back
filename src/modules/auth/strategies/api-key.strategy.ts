// src/modules/auth/strategies/api-key.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { AuthService } from '../auth.service';
import { Request } from 'express';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  constructor(private authService: AuthService) {
    super();
  }

  async validate(req: Request) {
    // Try to get API key from multiple sources (in order of priority)
    let apiKey: string | undefined;

    // 1. Check query parameter (for backward compatibility)
    apiKey = req.query['api-key'] as string;

    // 2. Check cookies
    if (!apiKey && req.cookies) {
      apiKey = req.cookies['api-key'] || req.cookies['apiKey'];
    }

    // 3. Check headers
    if (!apiKey && req.headers) {
      apiKey = req.headers['x-api-key'] as string;
    }

    if (!apiKey) {
      throw new UnauthorizedException('API key is required');
    }

    const user = await this.authService.validateApiKey(apiKey);
    if (!user) {
      throw new UnauthorizedException('Invalid API key');
    }

    return user;
  }
}