import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * EmailService
 * 
 * Purpose: This is the "Waiter" (Producer). It doesn't send emails itself.
 * Instead, it takes the "order" and puts it into a Redis queue.
 * 
 * Benefits:
 * 1. Speed: Adding a job to Redis takes ~1ms. Sending an email takes ~2000ms.
 * 2. Reliability: If SendGrid is down, the job stays in the queue and can be retried.
 */
@Injectable()
export class EmailService {
  constructor(
    @InjectQueue('email') private readonly emailQueue: Queue,
  ) {}

  /**
   * Adds an OTP email job to the queue
   */
  async sendOtpEmail(to: string, otp: string, name: string): Promise<void> {
    await this.emailQueue.add('sendOtp', { to, otp, name }, {
      attempts: 3, // Retry 3 times if it fails
      backoff: {
        type: 'exponential',
        delay: 5000, // Wait 5s, then 10s, etc.
      },
    });
    console.log(`📡 Job queued: OTP email for ${to}`);
  }

  /**
   * Adds a Welcome email job to the queue
   */
  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    await this.emailQueue.add('sendWelcome', { to, name }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    console.log(`📡 Job queued: Welcome email for ${to}`);
  }
  
  /**
   * Adds a Forgot Password email job to the queue
   */
  async sendForgotPasswordEmail(to: string, otp: string, name: string): Promise<void> {
    await this.emailQueue.add('sendForgotPassword', { to, otp, name }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    console.log(`📡 Job queued: Forgot password email for ${to}`);
  }
}
