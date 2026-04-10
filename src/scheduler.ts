import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import type { ScheduleConfig, AppConfig } from './types.js';
import { UazapiClient } from './uazapi.js';

interface ScheduledTask {
  name: string;
  task: cron.ScheduledTask;
  config: ScheduleConfig;
}

export class Scheduler {
  private tasks: ScheduledTask[] = [];
  private uazapiClient: UazapiClient;
  private appConfig: AppConfig;
  private isRunning: boolean = false;

  constructor(config: AppConfig) {
    this.appConfig = config;
    if (!config.uazapi) {
      throw new Error('Configuração UAZAPI não encontrada');
    }
    this.uazapiClient = new UazapiClient(config.uazapi);
  }

  private async executeSchedule(schedule: ScheduleConfig): Promise<void> {
    const startTime = Date.now();
    logger.info(`Iniciando execução do schedule: ${schedule.name}`);

    try {
      const connected = await this.uazapiClient.isConnected();
      if (!connected) {
        throw new Error('WhatsApp não conectado');
      }

      // Carregar sticker se configurado
      let stickerBuffer: Buffer | null = null;
      if (schedule.stickerPath) {
        const stickerFile = path.resolve(schedule.stickerPath);
        if (fs.existsSync(stickerFile)) {
          stickerBuffer = fs.readFileSync(stickerFile);
          logger.info('Sticker carregado', { path: stickerFile, size: stickerBuffer.length });
        } else {
          logger.warn('Sticker não encontrado', { path: stickerFile });
        }
      }

      let successful = 0;
      let failed = 0;
      const delay = this.appConfig.settings.delayBetweenGroups;

      for (let i = 0; i < schedule.groups.length; i++) {
        const groupId = schedule.groups[i];
        try {
          // Enviar sticker primeiro (se configurado)
          if (stickerBuffer) {
            await this.uazapiClient.sendSticker(groupId, stickerBuffer);
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
          // Enviar texto
          await this.uazapiClient.sendText(groupId, schedule.message);
          successful++;
        } catch (error) {
          failed++;
          logger.error(`Erro ao enviar para grupo ${groupId}`, {
            error: error instanceof Error ? error.message : error,
          });
        }
        // Delay entre grupos
        if (i < schedule.groups.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`Schedule ${schedule.name} concluído`, {
        duration: `${duration}ms`,
        groupsTotal: schedule.groups.length,
        groupsSuccess: successful,
        groupsFailed: failed,
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Erro no schedule ${schedule.name}`, {
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private scheduleTask(schedule: ScheduleConfig): ScheduledTask {
    logger.info(`Agendando task: ${schedule.name}`, {
      cron: schedule.cron,
      groups: schedule.groups.length,
    });

    const task = cron.schedule(
      schedule.cron,
      async () => {
        await this.executeSchedule(schedule);
      },
      {
        scheduled: false,
        timezone: this.appConfig.settings.timezone,
      }
    );

    return {
      name: schedule.name,
      task,
      config: schedule,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler já está em execução');
      return;
    }

    logger.info('Iniciando Scheduler', {
      timezone: this.appConfig.settings.timezone,
      schedules: this.appConfig.schedules.length,
    });

    try {
      const connected = await this.uazapiClient.isConnected();
      if (!connected) {
        logger.warn('WhatsApp não conectado. Os schedules serão iniciados, mas verificarão a conexão antes de cada execução.');
      } else {
        logger.info('WhatsApp conectado e pronto');
      }
    } catch (error) {
      logger.error('Erro ao verificar conexão inicial', {
        error: error instanceof Error ? error.message : error,
      });
    }

    for (const schedule of this.appConfig.schedules) {
      const scheduledTask = this.scheduleTask(schedule);
      scheduledTask.task.start();
      this.tasks.push(scheduledTask);
    }

    this.isRunning = true;
    logger.info('Scheduler iniciado com sucesso', {
      tasksAtivas: this.tasks.length,
    });

    this.logNextExecutions();
  }

  async stop(): Promise<void> {
    logger.info('Parando Scheduler');

    for (const { name, task } of this.tasks) {
      task.stop();
      logger.debug(`Task ${name} parada`);
    }

    this.tasks = [];
    this.isRunning = false;

    logger.info('Scheduler parado');
  }

  async runNow(scheduleName?: string): Promise<void> {
    const schedules = scheduleName
      ? this.appConfig.schedules.filter(s => s.name === scheduleName)
      : this.appConfig.schedules;

    if (schedules.length === 0) {
      logger.error('Nenhum schedule encontrado', { scheduleName });
      return;
    }

    logger.info('Executando schedules manualmente', {
      count: schedules.length,
    });

    for (const schedule of schedules) {
      await this.executeSchedule(schedule);

      if (schedules.indexOf(schedule) < schedules.length - 1) {
        await new Promise(resolve =>
          setTimeout(resolve, this.appConfig.settings.delayBetweenMessages)
        );
      }
    }
  }

  private logNextExecutions(): void {
    logger.info('=== Schedules Configurados ===');
    for (const { name, config } of this.tasks) {
      logger.info(`  - ${name}: ${config.cron} (${config.groups.length} grupos)`);
    }
    logger.info('==============================');
  }

  getStatus(): { isRunning: boolean; tasks: string[] } {
    return {
      isRunning: this.isRunning,
      tasks: this.tasks.map(t => t.name),
    };
  }
}
