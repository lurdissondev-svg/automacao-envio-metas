import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import type { AppConfig, ScheduleConfig, SettingsConfig, BrowserConfig, EvolutionConfig } from './types.js';

// Valores padrão
const defaultSettings: SettingsConfig = {
  timezone: 'America/Sao_Paulo',
  delayBetweenMessages: 3000,
  delayBetweenGroups: 5000,
  pageTimeout: 30000,
  waitAfterLoad: 2000,
};

const defaultBrowser: BrowserConfig = {
  headless: true,
  defaultViewport: {
    width: 1920,
    height: 1080,
  },
};

// Substituir variáveis de ambiente em strings
function replaceEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, envVar) => {
    return process.env[envVar] || '';
  });
}

// Processar objeto recursivamente para substituir env vars
function processEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return replaceEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(processEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = processEnvVars(value);
    }
    return result;
  }
  return obj;
}

// Validar expressão cron
function isValidCron(expression: string): boolean {
  const parts = expression.split(' ');
  if (parts.length !== 5) return false;

  // Validação básica de cada campo
  const ranges = [
    { min: 0, max: 59 },   // minuto
    { min: 0, max: 23 },   // hora
    { min: 1, max: 31 },   // dia do mês
    { min: 1, max: 12 },   // mês
    { min: 0, max: 6 },    // dia da semana
  ];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '*') continue;

    // Verificar ranges (ex: 1-5)
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (isNaN(start) || isNaN(end)) continue; // Pode ter texto como MON-FRI
    }

    // Verificar steps (ex: */5)
    if (part.includes('/')) {
      const [, step] = part.split('/');
      if (isNaN(Number(step))) return false;
    }

    // Verificar lista (ex: 1,2,3)
    if (part.includes(',')) {
      continue; // Aceitar listas
    }
  }

  return true;
}

// Validar configuração de schedule
function validateSchedule(schedule: ScheduleConfig, index: number): boolean {
  const errors: string[] = [];

  if (!schedule.name) {
    errors.push(`Schedule ${index}: 'name' é obrigatório`);
  }

  if (!schedule.sheetUrl) {
    errors.push(`Schedule ${index}: 'sheetUrl' é obrigatório`);
  } else if (!schedule.sheetUrl.includes('docs.google.com/spreadsheets')) {
    errors.push(`Schedule ${index}: 'sheetUrl' deve ser uma URL do Google Sheets`);
  }

  if (!schedule.groups || schedule.groups.length === 0) {
    errors.push(`Schedule ${index}: 'groups' deve ter pelo menos um grupo`);
  }

  if (!schedule.cron) {
    errors.push(`Schedule ${index}: 'cron' é obrigatório`);
  } else if (!isValidCron(schedule.cron)) {
    errors.push(`Schedule ${index}: 'cron' inválido: ${schedule.cron}`);
  }

  if (!schedule.messageTemplate) {
    errors.push(`Schedule ${index}: 'messageTemplate' é obrigatório`);
  }

  if (errors.length > 0) {
    errors.forEach(e => logger.error(e));
    return false;
  }

  return true;
}

// Carregar configuração
export function loadConfig(configPath?: string): AppConfig {
  const configFile = configPath || process.env.CONFIG_PATH || './config/config.yaml';
  const absolutePath = path.resolve(configFile);

  logger.info(`Carregando configuração de: ${absolutePath}`);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo de configuração não encontrado: ${absolutePath}`);
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf-8');
  const rawConfig = YAML.parse(fileContent);

  // Processar variáveis de ambiente
  const config = processEnvVars(rawConfig) as Partial<AppConfig>;

  // Validar evolution config
  const evolution: EvolutionConfig = {
    baseUrl: config.evolution?.baseUrl || process.env.EVOLUTION_API_URL || '',
    apiKey: config.evolution?.apiKey || process.env.EVOLUTION_API_KEY || '',
    instanceName: config.evolution?.instanceName || process.env.EVOLUTION_INSTANCE || '',
  };

  if (!evolution.baseUrl || !evolution.apiKey || !evolution.instanceName) {
    throw new Error('Configuração da Evolution API incompleta. Verifique baseUrl, apiKey e instanceName.');
  }

  // Mesclar settings com padrões
  const settings: SettingsConfig = {
    ...defaultSettings,
    ...config.settings,
  };

  // Mesclar browser config com padrões
  const browser: BrowserConfig = {
    ...defaultBrowser,
    ...config.browser,
    defaultViewport: {
      ...defaultBrowser.defaultViewport,
      ...config.browser?.defaultViewport,
    },
  };

  // Validar schedules
  const schedules = config.schedules || [];
  if (schedules.length === 0) {
    throw new Error('Nenhum schedule configurado');
  }

  const validSchedules: ScheduleConfig[] = [];
  schedules.forEach((schedule, index) => {
    if (validateSchedule(schedule, index)) {
      validSchedules.push({
        ...schedule,
        viewport: schedule.viewport || browser.defaultViewport,
        waitAfterLoad: schedule.waitAfterLoad || settings.waitAfterLoad,
      });
    }
  });

  if (validSchedules.length === 0) {
    throw new Error('Nenhum schedule válido encontrado');
  }

  logger.info(`Configuração carregada: ${validSchedules.length} schedules válidos`);

  return {
    evolution,
    settings,
    browser,
    schedules: validSchedules,
  };
}
