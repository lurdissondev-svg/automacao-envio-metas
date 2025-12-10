import cron from 'node-cron';
import { logger } from './logger.js';
import type { ScheduleConfig, AppConfig, SheetTabConfig } from './types.js';
import { initBrowser, closeBrowser, captureScreenshotWithRetry, captureScreenshotsParallel } from './screenshot.js';
import { UazapiClient } from './uazapi.js';
import { createMessageWithSheetData } from './templates.js';
import { buildSheetUrlWithTab } from './sheets.js';

interface ScheduledTask {
  name: string;
  task: cron.ScheduledTask;
  config: ScheduleConfig;
}

// Gerenciador de agendamentos
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

  // Executar um schedule individual
  private async executeSchedule(schedule: ScheduleConfig): Promise<void> {
    const startTime = Date.now();
    logger.info(`Iniciando execução do schedule: ${schedule.name}`);

    try {
      // Verificar conexão com WhatsApp
      const connected = await this.uazapiClient.isConnected();
      if (!connected) {
        throw new Error('WhatsApp não conectado');
      }

      // Inicializar browser se necessário
      await initBrowser(this.appConfig.browser);

      let successful = 0;
      let failed = 0;

      // Verificar se há configuração de abas por grupo
      const hasTabConfigs = schedule.sheetTabs && schedule.sheetTabs.length > 0;

      if (hasTabConfigs) {
        // Modo: screenshot específico por grupo/aba (com captura paralela)
        logger.info(`Processando ${schedule.groups.length} grupos com abas específicas (modo paralelo)`);

        // Preparar tarefas para captura paralela
        const captureTasks: { url: string; id: string; tabConfig?: SheetTabConfig }[] = [];

        for (const groupId of schedule.groups) {
          const tabConfig = schedule.sheetTabs?.find(t => t.groupId === groupId);
          const tabIdentifier = tabConfig?.tabGid || tabConfig?.tabName;
          const sheetUrlForGroup = buildSheetUrlWithTab(schedule.sheetUrl, tabIdentifier);

          captureTasks.push({
            url: sheetUrlForGroup,
            id: groupId,
            tabConfig,
          });
        }

        // Capturar screenshots em paralelo
        logger.info(`Capturando ${captureTasks.length} screenshots em paralelo...`);
        const screenshotResults = await captureScreenshotsParallel(
          captureTasks,
          schedule.viewport || this.appConfig.browser.defaultViewport,
          schedule.selector,
          schedule.waitAfterLoad || this.appConfig.settings.waitAfterLoad,
          schedule.clip
        );

        // Enviar imagens para cada grupo
        for (const result of screenshotResults) {
          const groupId = result.id;
          const task = captureTasks.find(t => t.id === groupId);

          if (result.error) {
            failed++;
            logger.error(`Erro ao capturar screenshot para grupo ${groupId}`, {
              error: result.error,
            });
            continue;
          }

          try {
            const sheetUrlForGroup = task?.url || schedule.sheetUrl;

            // Criar mensagem com dados da planilha
            const message = await createMessageWithSheetData(
              schedule.messageTemplate,
              schedule.name,
              this.appConfig.settings.timezone,
              sheetUrlForGroup,
              schedule.cellMappings
            );

            // Enviar para este grupo
            const sendResult = await this.uazapiClient.sendImage(groupId, result.screenshot!, message);

            if (sendResult && !(sendResult instanceof Error)) {
              successful++;
              logger.debug(`Enviado com sucesso para grupo ${groupId}`);
            } else {
              failed++;
              logger.warn(`Falha ao enviar para grupo ${groupId}`, { error: sendResult });
            }

            // Delay entre envios
            const index = screenshotResults.indexOf(result);
            if (index < screenshotResults.length - 1) {
              await new Promise(resolve =>
                setTimeout(resolve, this.appConfig.settings.delayBetweenGroups)
              );
            }

          } catch (groupError) {
            failed++;
            logger.error(`Erro ao processar grupo ${groupId}`, {
              error: groupError instanceof Error ? groupError.message : groupError,
            });
          }
        }

      } else {
        // Modo tradicional: um screenshot para todos os grupos
        logger.info('Modo tradicional: screenshot único para todos os grupos');

        // Capturar screenshot
        const screenshot = await captureScreenshotWithRetry(
          schedule.sheetUrl,
          schedule.viewport || this.appConfig.browser.defaultViewport,
          schedule.selector,
          schedule.waitAfterLoad || this.appConfig.settings.waitAfterLoad,
          3, // maxRetries
          schedule.clip // clip config
        );

        // Criar mensagem com dados da planilha
        const message = await createMessageWithSheetData(
          schedule.messageTemplate,
          schedule.name,
          this.appConfig.settings.timezone,
          schedule.sheetUrl,
          schedule.cellMappings
        );

        // Enviar para grupos
        const results = await this.uazapiClient.sendImageToGroups(
          schedule.groups,
          screenshot,
          message,
          this.appConfig.settings.delayBetweenGroups
        );

        // Contar resultados
        successful = [...results.values()].filter(r => !(r instanceof Error)).length;
        failed = schedule.groups.length - successful;
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

  // Agendar um schedule
  private scheduleTask(schedule: ScheduleConfig): ScheduledTask {
    logger.info(`Agendando task: ${schedule.name}`, {
      cron: schedule.cron,
      groups: schedule.groups.length,
      sheetUrl: schedule.sheetUrl,
    });

    const task = cron.schedule(
      schedule.cron,
      async () => {
        await this.executeSchedule(schedule);
      },
      {
        scheduled: false, // Não iniciar automaticamente
        timezone: this.appConfig.settings.timezone,
      }
    );

    return {
      name: schedule.name,
      task,
      config: schedule,
    };
  }

  // Iniciar todos os schedules
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler já está em execução');
      return;
    }

    logger.info('Iniciando Scheduler', {
      timezone: this.appConfig.settings.timezone,
      schedules: this.appConfig.schedules.length,
    });

    // Verificar conexão inicial
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

    // Criar e iniciar tasks
    for (const schedule of this.appConfig.schedules) {
      const scheduledTask = this.scheduleTask(schedule);
      scheduledTask.task.start();
      this.tasks.push(scheduledTask);
    }

    this.isRunning = true;
    logger.info('Scheduler iniciado com sucesso', {
      tasksAtivas: this.tasks.length,
    });

    // Listar próximas execuções
    this.logNextExecutions();
  }

  // Parar todos os schedules
  async stop(): Promise<void> {
    logger.info('Parando Scheduler');

    for (const { name, task } of this.tasks) {
      task.stop();
      logger.debug(`Task ${name} parada`);
    }

    this.tasks = [];
    this.isRunning = false;

    // Fechar browser
    await closeBrowser();

    logger.info('Scheduler parado');
  }

  // Executar um schedule manualmente
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

      // Delay entre schedules
      if (schedules.indexOf(schedule) < schedules.length - 1) {
        await new Promise(resolve =>
          setTimeout(resolve, this.appConfig.settings.delayBetweenMessages)
        );
      }
    }
  }

  // Listar próximas execuções
  private logNextExecutions(): void {
    logger.info('=== Schedules Configurados ===');
    for (const { name, config } of this.tasks) {
      logger.info(`  - ${name}: ${config.cron} (${config.groups.length} grupos)`);
    }
    logger.info('==============================');
  }

  // Retornar status
  getStatus(): { isRunning: boolean; tasks: string[] } {
    return {
      isRunning: this.isRunning,
      tasks: this.tasks.map(t => t.name),
    };
  }
}
