import { logger } from './logger.js';
import type { TemplateVariables, CellMapping } from './types.js';
import { fetchSheetData } from './sheets.js';

// Criar variáveis de template baseadas na data/hora atual
export function createTemplateVariables(
  scheduleName: string,
  timezone: string = 'America/Sao_Paulo',
  sheetData?: Record<string, string>
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

  // Variáveis base
  const variables: TemplateVariables = {
    date: dateFormatter.format(now),
    time: timeFormatter.format(now),
    datetime: `${dateFormatter.format(now)} ${timeFormatter.format(now)}`,
    week: `Semana ${weekNumber}`,
    weekday: weekdayFormatter.format(now),
    scheduleName,
  };

  // Adicionar variáveis da planilha
  if (sheetData) {
    for (const [key, value] of Object.entries(sheetData)) {
      variables[key] = value;
    }
  }

  return variables;
}

// Buscar dados da planilha e criar variáveis
export async function createTemplateVariablesWithSheetData(
  scheduleName: string,
  timezone: string = 'America/Sao_Paulo',
  sheetUrl?: string,
  cellMappings?: CellMapping[]
): Promise<TemplateVariables> {
  let sheetData: Record<string, string> = {};

  if (sheetUrl && cellMappings && cellMappings.length > 0) {
    try {
      sheetData = await fetchSheetData(sheetUrl, cellMappings);
      logger.info('Dados da planilha obtidos', {
        variables: Object.keys(sheetData),
        values: sheetData
      });
    } catch (error) {
      logger.error('Erro ao buscar dados da planilha', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  return createTemplateVariables(scheduleName, timezone, sheetData);
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

// Criar mensagem final a partir do template e schedule (síncrono, sem dados da planilha)
export function createMessage(
  messageTemplate: string,
  scheduleName: string,
  timezone: string = 'America/Sao_Paulo',
  sheetData?: Record<string, string>
): string {
  const variables = createTemplateVariables(scheduleName, timezone, sheetData);
  const message = processTemplate(messageTemplate, variables);

  logger.debug('Mensagem criada', {
    scheduleName,
    messageLength: message.length,
    variables
  });

  return message;
}

// Criar mensagem com dados da planilha (assíncrono)
export async function createMessageWithSheetData(
  messageTemplate: string,
  scheduleName: string,
  timezone: string = 'America/Sao_Paulo',
  sheetUrl?: string,
  cellMappings?: CellMapping[]
): Promise<string> {
  const variables = await createTemplateVariablesWithSheetData(
    scheduleName,
    timezone,
    sheetUrl,
    cellMappings
  );
  const message = processTemplate(messageTemplate, variables);

  logger.debug('Mensagem criada com dados da planilha', {
    scheduleName,
    messageLength: message.length,
    variables
  });

  return message;
}
