import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { User, SubscriptionPlan } from '../users/entities/user.entity';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpiredSubscriptions() {
    const now = new Date();

    const expiredUsers = await this.userRepository.find({
      where: {
        subscriptionPlan: SubscriptionPlan.PREMIUM,
        subscriptionExpiresAt: LessThan(now),
      },
    });

    for (const user of expiredUsers) {
      user.subscriptionPlan = SubscriptionPlan.FREE;
      user.subscriptionExpiresAt = null;
      await this.userRepository.save(user);
      console.log(`Downgraded user ${user.email} to free plan`);
    }

    return expiredUsers.length;
  }
}