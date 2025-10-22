import { Controller, Post, Get, Body, Query, UseGuards, Req, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/decorators';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { SignUpDto, LoginDto, ConfirmEmailDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('signup')
  async signUp(@Body() signUpDto: SignUpDto) {
    return this.authService.signUp(signUpDto.email, signUpDto.password, signUpDto.username);
  }

  @Post('confirm-email')
  async confirmEmail(@Body() confirmEmailDto: ConfirmEmailDto) {
    return this.authService.confirmEmail(confirmEmailDto.token);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: any) {
    const user = await this.authService.login(loginDto.email, loginDto.password);

    res.cookie('api-key', user.apiKey, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return user;
  }

  @Get('user')
  @UseGuards(AuthGuard('jwt'))
  async getUser(@CurrentUser() user: User) {
    return this.authService.getUser(user);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(@Req() req) {
    return this.authService.googleLogin(req.user);
  }
}