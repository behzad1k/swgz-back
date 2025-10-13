import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { CronJobConfig } from '../../types';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(private schedulerRegistry: SchedulerRegistry) {}

  // Example: Run every day at midnight
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'dailyCleanup',
    timeZone: 'America/New_York',
  })
  async handleDailyCleanup() {
    this.logger.log('Running daily cleanup task');
    try {
      // Your cleanup logic here
      await this.performCleanup();
      this.logger.log('Daily cleanup completed successfully');
    } catch (error) {
      this.logger.error('Daily cleanup failed', error.stack);
    }
  }

  // Example: Run every 5 minutes
  @Cron('*/5 * * * *', {
    name: 'healthCheck',
  })
  async handleHealthCheck() {
    this.logger.debug('Running health check');
    try {
      // Your health check logic here
      await this.checkSystemHealth();
    } catch (error) {
      this.logger.error('Health check failed', error.stack);
    }
  }

  // Example: Run every Monday at 9 AM
  @Cron('0 9 * * 1', {
    name: 'weeklyReport',
    timeZone: 'UTC',
  })
  async handleWeeklyReport() {
    this.logger.log('Generating weekly report');
    try {
      await this.generateWeeklyReport();
      this.logger.log('Weekly report generated successfully');
    } catch (error) {
      this.logger.error('Weekly report generation failed', error.stack);
    }
  }

  // Dynamic cron job management
  addCronJob(name: string, cronExpression: string, callback: () => void) {
    try {
      const job = new CronJob(cronExpression, callback);
      this.schedulerRegistry.addCronJob(name, job);
      job.start();
      this.logger.log(`Cron job "${name}" added and started`);
    } catch (error) {
      this.logger.error(`Failed to add cron job "${name}"`, error.stack);
      throw error;
    }
  }

  removeCronJob(name: string) {
    try {
      this.schedulerRegistry.deleteCronJob(name);
      this.logger.log(`Cron job "${name}" deleted`);
    } catch (error) {
      this.logger.error(`Failed to delete cron job "${name}"`, error.stack);
      throw error;
    }
  }

  getCronJobs(): Map<string, CronJob> {
    return this.schedulerRegistry.getCronJobs();
  }

  stopCronJob(name: string) {
    try {
      const job = this.schedulerRegistry.getCronJob(name);
      job.stop();
      this.logger.log(`Cron job "${name}" stopped`);
    } catch (error) {
      this.logger.error(`Failed to stop cron job "${name}"`, error.stack);
      throw error;
    }
  }

  startCronJob(name: string) {
    try {
      const job = this.schedulerRegistry.getCronJob(name);
      job.start();
      this.logger.log(`Cron job "${name}" started`);
    } catch (error) {
      this.logger.error(`Failed to start cron job "${name}"`, error.stack);
      throw error;
    }
  }

  // Helper methods (implement your actual logic)
  private async performCleanup() {
    // Implement cleanup logic
    // e.g., delete old logs, temporary files, expired sessions
  }

  private async checkSystemHealth() {
    // Implement health check logic
    // e.g., check database connection, external API availability
  }

  private async generateWeeklyReport() {
    // Implement report generation logic
    // e.g., compile statistics, send emails
  }
  async onModuleInit() {
    // Initialize dynamic cron jobs on module initialization
    this.initializeDynamicJobs();
  }

  private initializeDynamicJobs() {
    // Load cron job configurations from environment or database
    const jobConfigs: CronJobConfig[] = this.getJobConfigs();

    jobConfigs.forEach((config) => {
      if (config.enabled) {
        this.createDynamicJob(config);
      }
    });
  }

  private createDynamicJob(config: CronJobConfig) {
    this.addCronJob(config.name, config.expression, () => {
      this.logger.log(`Executing dynamic job: ${config.name}`);
      this.executeDynamicJob(config.name);
    });
  }

  private async executeDynamicJob(jobName: string) {
    try {
      // Route to appropriate job handler based on name
      switch (jobName) {
        case 'dataBackup':
          await this.performDataBackup();
          break;
        case 'cacheInvalidation':
          await this.invalidateCache();
          break;
        case 'emailNotifications':
          await this.sendEmailNotifications();
          break;
        default:
          this.logger.warn(`Unknown job: ${jobName}`);
      }
    } catch (error) {
      this.logger.error(`Job "${jobName}" failed`, error.stack);
    }
  }

  private getJobConfigs(): CronJobConfig[] {
    // In production, load from environment variables or database
    return [
      {
        name: 'dataBackup',
        expression: '0 2 * * *', // Daily at 2 AM
        enabled: process.env.ENABLE_DATA_BACKUP === 'true',
        description: 'Daily database backup',
      },
      {
        name: 'cacheInvalidation',
        expression: '*/30 * * * *', // Every 30 minutes
        enabled: process.env.ENABLE_CACHE_INVALIDATION === 'true',
        description: 'Invalidate stale cache entries',
      },
      {
        name: 'emailNotifications',
        expression: '0 8 * * 1-5', // Weekdays at 8 AM
        enabled: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
        description: 'Send daily email notifications',
      },
    ];
  }

  // Job implementations
  private async performDataBackup() {
    this.logger.log('Starting data backup...');
    // Implement backup logic
  }

  private async invalidateCache() {
    this.logger.debug('Invalidating cache...');
    // Implement cache invalidation logic
  }

  private async sendEmailNotifications() {
    this.logger.log('Sending email notifications...');
    // Implement email notification logic
  }

  // Management methods
  async enableJob(jobName: string) {
    try {
      this.startCronJob(jobName);
      return { success: true, message: `Job "${jobName}" enabled` };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async disableJob(jobName: string) {
    try {
      this.stopCronJob(jobName);
      return { success: true, message: `Job "${jobName}" disabled` };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async listJobs() {
    const jobs = this.getCronJobs();
    const jobList: any[] = [];

    jobs.forEach((job, name) => {
      jobList.push({
        name,
        // running: job.running,
        lastDate: job.lastDate(),
        nextDate: job.nextDate(),
      });
    });

    return jobList;
  }
}
