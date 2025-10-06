// admin.service.ts
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, SubscriptionPlan } from '../users/entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async getAllUsers(page: number = 1, limit: number = 20) {
    const [users, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return {
      users,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['playlists', 'librarySongs'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async upgradeToPremium(userId: string, expiresAt?: Date) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.subscriptionPlan = SubscriptionPlan.PREMIUM;
    user.subscriptionExpiresAt = expiresAt || null;

    return this.userRepository.save(user);
  }

  async downgradeToFree(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.subscriptionPlan = SubscriptionPlan.FREE;
    user.subscriptionExpiresAt = null;

    return this.userRepository.save(user);
  }

  async deleteUser(userId: string) {
    const result = await this.userRepository.delete(userId);
    if (result.affected === 0) {
      throw new NotFoundException('User not found');
    }
    return { message: 'User deleted successfully' };
  }

  async getStats() {
    const totalUsers = await this.userRepository.count();
    const premiumUsers = await this.userRepository.count({
      where: { subscriptionPlan: SubscriptionPlan.PREMIUM },
    });
    const freeUsers = await this.userRepository.count({
      where: { subscriptionPlan: SubscriptionPlan.FREE },
    });
    const confirmedUsers = await this.userRepository.count({
      where: { isEmailConfirmed: true },
    });

    return {
      totalUsers,
      premiumUsers,
      freeUsers,
      confirmedUsers,
      unconfirmedUsers: totalUsers - confirmedUsers,
    };
  }

  async searchUsers(query: string) {
    return this.userRepository
    .createQueryBuilder('user')
    .where('user.email LIKE :query', { query: `%${query}%` })
    .getMany();
  }
}