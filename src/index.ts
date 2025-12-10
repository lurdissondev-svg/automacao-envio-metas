import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { Scheduler } from './scheduler.js';
import { closeBrowser } from './screenshot.js';

// Variáveis globais
let scheduler: Scheduler | null = null;

// Tratamento de sinais para shutdown gracioso
async function shutdown(signal: string): Promise<void> {
  logger.info(`Recebido sinal ${signal}. Encerrando...`);

  try {
    if (scheduler) {
      await scheduler.stop();
    }
    await closeBrowser();
    logger.info('Aplicação encerrada com sucesso');
    process.exit(0);
  } catch (error) {
    logger.error('Erro durante shutdown', {
      error: error instanceof Error ? error.message : error,
    });
    process.exit(1);
  }
}

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  logger.error('Exceção não capturada', {
    error: error.message,
    stack: error.stack,
  });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise rejeitada não tratada', {
    reason: reason instanceof Error ? reason.message : reason,
  });
});

// Sinais de shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Função principal
async function main(): Promise<void> {
  logger.info('='.repeat(50));
  logger.info('Automação de Envio de Metas - Google Sheets para WhatsApp');
  logger.info('='.repeat(50));

  try {
    // Carregar configuração
    const configPath = process.env.CONFIG_PATH || './config/config.yaml';
    const config = loadConfig(configPath);

    // Verificar modo de execução
    const runOnce = process.argv.includes('--run-once');
    const scheduleName = process.argv.find((arg, i) =>
      process.argv[i - 1] === '--schedule'
    );

    // Criar scheduler
    scheduler = new Scheduler(config);

    if (runOnce) {
      // Modo de execução única (para testes ou execução manual)
      logger.info('Modo de execução única ativado');
      await scheduler.runNow(scheduleName);
      await closeBrowser();
      logger.info('Execução única concluída');
      process.exit(0);
    } else {
      // Modo de agendamento contínuo
      await scheduler.start();
      logger.info('Scheduler em execução. Pressione Ctrl+C para encerrar.');

      // Manter processo vivo
      process.stdin.resume();
    }
  } catch (error) {
    logger.error('Erro fatal na inicialização', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Iniciar aplicação
main();
