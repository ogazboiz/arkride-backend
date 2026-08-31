import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import sgMail from '@sendgrid/mail';

/**
 * EmailProcessor
 * 
 * Purpose: This is the "Chef" (Consumer). It listens for jobs in the 'email' queue
 * and performs the actual work of sending emails via SendGrid.
 * 
 * Why this is separate:
 * Sending an email is a "heavy" task that takes time. By doing it here,
 * the main application stays fast and responsive.
 */
@Processor('email')
export class EmailProcessor extends WorkerHost {
  constructor() {
    super();
    // Initialize SendGrid with the API key
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');
  }

  /**
   * The main process method called by BullMQ when a job is ready
   */
  async process(job: Job<any, any, string>): Promise<any> {
    const { to, otp, name } = job.data;

    switch (job.name) {
      case 'sendOtp':
        return await this.handleSendOtp(to, otp, name);
      case 'sendWelcome':
        return await this.handleSendWelcome(to, name);
      case 'sendForgotPassword':
        return await this.handleSendForgotPassword(to, otp, name);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  private async handleSendOtp(to: string, otp: string, name: string) {
    const msg = {
      to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || '',
        name: process.env.APP_NAME || 'KEKE Rides',
      },
      subject: 'Verify Your Account - OTP Code',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #BF5102; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
            .otp-box { background: white; border: 2px dashed #BF5102; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 5px; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🚖 ${process.env.APP_NAME || 'KEKE Rides'}</h1>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Thank you for registering with ${process.env.APP_NAME || 'KEKE Rides'}! Please use the OTP below to verify your account:</p>
              <div class="otp-box">${otp}</div>
              <p><strong>⏰ This OTP will expire in 10 minutes.</strong></p>
              <p>If you didn't request this, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || 'KEKE Rides'}. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Background Job: OTP email sent to ${to}`);
  }

  private async handleSendWelcome(to: string, name: string) {
    const msg = {
      to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || '',
        name: process.env.APP_NAME || 'KEKE Rides',
      },
      subject: `Welcome to ${process.env.APP_NAME || 'KEKE Rides'}! 🎉`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="background: linear-gradient(135deg, #BF5102, #FFDBCB); color: white; padding: 30px; text-align: center;">
              <h1 style="margin: 0;">🎉 Welcome to ${process.env.APP_NAME || 'KEKE Rides'}!</h1>
            </div>
            <div style="padding: 30px;">
              <h2 style="color: #4CAF50;">Hello ${name},</h2>
              <p style="font-size: 16px; color: #555;">Your account has been successfully verified! ✅</p>
              <p style="font-size: 16px; color: #555;">You can now log in and start using our services.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${process.env.KEKE_WEBSITE_URL || 'http://localhost:3000'}/login" style="display: inline-block; background: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 25px; font-weight: bold;">Go to Login</a>
              </div>
              <p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions, feel free to contact us.</p>
            </div>
            <div style="background: #f9f9f9; padding: 20px; text-align: center; color: #999; font-size: 12px;">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || 'KEKE Rides'}. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Background Job: Welcome email sent to ${to}`);
  }

  private async handleSendForgotPassword(to: string, otp: string, name: string) {
    const msg = {
      to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || '',
        name: process.env.APP_NAME || 'KEKE Rides',
      },
      subject: 'Reset Your Password - OTP Code',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #FF5722; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 5px 5px; }
            .otp-box { background: white; border: 2px dashed #FF5722; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 5px; }
            .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Password Reset</h1>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>You requested to reset your password. Please use the OTP below to proceed:</p>
              <div class="otp-box">${otp}</div>
              <p><strong>⏰ This OTP will expire in 10 minutes.</strong></p>
              <p>If you didn't request this, please ignore this email and your password will remain unchanged.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || 'KEKE Rides'}. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await sgMail.send(msg);
    console.log(`✅ Background Job: Forgot password email sent to ${to}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`❌ Job ${job.id} failed: ${error.message}`);
  }
}
