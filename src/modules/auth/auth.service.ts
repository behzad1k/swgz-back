import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User, UserRole, SubscriptionPlan } from '../users/entities/user.entity';
import { EmailService } from './email.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async signUp(email: string, password: string, username: string) {
    const existingUser = await this.userRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const emailConfirmToken = uuidv4();
    const apiKey = uuidv4();

    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      username,
      emailConfirmToken,
      apiKey,
      subscriptionPlan: SubscriptionPlan.FREE,
    });

    await this.userRepository.save(user);
    await this.emailService.sendConfirmationEmail(email, emailConfirmToken);

    return { message: 'All good. Check your email' };
  }

  async confirmEmail(token: string) {
    const user = await this.userRepository.findOne({ where: { emailConfirmToken: token } });

    if (!user) {
      throw new BadRequestException('Invalid confirmation token');
    }

    user.isEmailConfirmed = true;
    user.emailConfirmToken = null;
    await this.userRepository.save(user);

    return { message: 'Email confirmed successfully' };
  }

  async login(email: string, password: string) {
    const user = await this.userRepository.findOne({ where: { email } });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailConfirmed) {
      throw new UnauthorizedException('Please confirm your email first');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      apiKey: user.apiKey,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        subscriptionPlan: user.subscriptionPlan,
      },
    };
  }

  async getUser(user: User){

    return this.userRepository.findOneOrFail({ where: { id: user.id } });
  }

  async googleLogin(profile: any) {
    let user = await this.userRepository.findOne({ where: { googleId: profile.id } });

    if (!user) {
      user = await this.userRepository.findOne({ where: { email: profile.emails[0].value } });

      if (!user) {
        const apiKey = uuidv4();
        user = this.userRepository.create({
          email: profile.emails[0].value,
          googleId: profile.id,
          isEmailConfirmed: true,
          apiKey,
          subscriptionPlan: SubscriptionPlan.FREE,
        });
      } else {
        user.googleId = profile.id;
        user.isEmailConfirmed = true;
      }

      await this.userRepository.save(user);
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      apiKey: user.apiKey,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        subscriptionPlan: user.subscriptionPlan,
      },
    };
  }

  async validateApiKey(apiKey: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { apiKey, isEmailConfirmed: true }
    });
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id: userId } });
  }
}