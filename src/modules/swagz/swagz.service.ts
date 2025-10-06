import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, SubscriptionPlan } from '../users/entities/user.entity';

export enum SwagzAction {
  STREAM = 'stream',           // +1 swagz
  LIKE = 'like',               // +2 swagz
  COMMENT = 'comment',         // +3 swagz
  REPOST = 'repost',           // +5 swagz
  DAILY_LOGIN = 'daily_login', // +10 swagz
}

const SWAGZ_REWARDS = {
  [SwagzAction.STREAM]: 1,
  [SwagzAction.LIKE]: 2,
  [SwagzAction.COMMENT]: 3,
  [SwagzAction.REPOST]: 5,
  [SwagzAction.DAILY_LOGIN]: 10,
};

const PREMIUM_COST = 1000; // 1000 swagz to upgrade to premium

@Injectable()
export class SwagzService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async awardSwagz(userId: string, action: SwagzAction): Promise<number> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return 0;

    const reward = SWAGZ_REWARDS[action] || 0;
    user.swagz += reward;
    await this.userRepository.save(user);

    return reward;
  }

  async getSwagzBalance(userId: string): Promise<number> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return user?.swagz || 0;
  }

  async upgradeToPremiumWithSwagz(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) return false;
    if (user.swagz < PREMIUM_COST) return false;
    if (user.subscriptionPlan === SubscriptionPlan.PREMIUM) return false;

    user.swagz -= PREMIUM_COST;
    user.subscriptionPlan = SubscriptionPlan.PREMIUM;
    user.subscriptionExpiresAt = null; // Permanent when bought with swagz

    await this.userRepository.save(user);
    return true;
  }

  getPremiumCost(): number {
    return PREMIUM_COST;
  }
}