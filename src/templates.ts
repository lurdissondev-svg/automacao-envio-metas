import { logger } from './logger.js';
import type { TemplateVariables } from './types.js';

// Criar variáveis de template baseadas na data/hora atual
export function createTemplateVariables(
  scheduleName: string,
  timezone: string = 'America/Sao_Paulo'
): TemplateVariables {
  const now = new Date();

  const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

  const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
  });

  // Calcular número da semana
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);

  return {
    date: dateFormatter.format(now),
    time: timeFormatter.format(now),
    datetime: `${dateFormatter.format(now)} ${timeFormatter.format(now)}`,
    week: `Semana ${weekNumber}`,
    weekday: weekdayFormatter.format(now),
    scheduleName,
  };
}

// Processar template substituindo variáveis
export function processTemplate(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  // Substituir variáveis no formato {variável}
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value);
  }

  // Log de variáveis não substituídas
  const remaining = result.match(/\{(\w+)\}/g);
  if (remaining) {
    logger.warn('Variáveis não substituídas no template', { variables: remaining });
  }

  return result;
}

// Criar mensagem final a partir do template e schedule
export function createMessage(
  messageTemplate: string,
  scheduleName: string,
  timezone: string = 'America/Sao_Paulo'
): string {
  const variables = createTemplateVariables(scheduleName, timezone);
  const message = processTemplate(messageTemplate, variables);

  logger.debug('Mensagem criada', {
    scheduleName,
    messageLength: message.length,
    variables
  });

  return message;
}
