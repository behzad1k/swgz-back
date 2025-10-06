import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendConfirmationEmail(email: string, token: string) {
    const confirmUrl = `${process.env.APP_URL}/api/auth/confirm-email?token=${token}`;

    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@slsk-music.com',
      to: email,
      subject: 'Confirm Your Email',
      html: `
        <h1>Welcome to SLSK Music!</h1>
        <p>Please confirm your email by clicking the link below:</p>
        <a href="${confirmUrl}">Confirm Email</a>
        <p>This link will expire in 24 hours.</p>
      `,
    });
  }
}