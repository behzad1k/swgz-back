// swagz.controller.ts
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SwagzService } from './swagz.service';
import { CurrentUser } from '../../common/decorators/decorators';
import { User } from '../users/entities/user.entity';

@Controller('swagz')
@UseGuards(AuthGuard(['jwt', 'api-key']))
export class SwagzController {
  constructor(private swagzService: SwagzService) {}

  @Get('balance')
  async getBalance(@CurrentUser() user: User) {
    const balance = await this.swagzService.getSwagzBalance(user.id);
    const premiumCost = this.swagzService.getPremiumCost();
    return {
      swagz: balance,
      premiumCost,
      canUpgrade: balance >= premiumCost,
    };
  }

  @Post('upgrade-premium')
  async upgradeToPremium(@CurrentUser() user: User) {
    const success = await this.swagzService.upgradeToPremiumWithSwagz(user.id);
    if (!success) {
      return {
        success: false,
        message: 'Insufficient swagz or already premium',
      };
    }
    return {
      success: true,
      message: 'Successfully upgraded to premium!',
    };
  }

  @Get('premium-cost')
  async getPremiumCost() {
    return {
      cost: this.swagzService.getPremiumCost(),
    };
  }
}