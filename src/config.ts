import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { logger } from './logger.js';
import type { AppConfig, ScheduleConfig, SettingsConfig, UazapiConfig } from './types.js';

const defaultSettings: SettingsConfig = {
  timezone: 'America/Sao_Paulo',
  delayBetweenMessages: 3000,
  delayBetweenGroups: 5000,
};

function replaceEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, envVar) => {
    return process.env[envVar] || '';
  });
}

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

function isValidCron(expression: string): boolean {
  const parts = expression.split(' ');
  if (parts.length !== 5) return false;

  for (const part of parts) {
    if (part === '*') continue;
    if (part.includes('/')) {
      const [, step] = part.split('/');
      if (isNaN(Number(step))) return false;
    }
  }

  return true;
}

function validateSchedule(schedule: ScheduleConfig, index: number): boolean {
  const errors: string[] = [];

  if (!schedule.name) {
    errors.push(`Schedule ${index}: 'name' e obrigatorio`);
  }

  if (!schedule.message) {
    errors.push(`Schedule ${index}: 'message' e obrigatorio`);
  }

  if (!schedule.groups || schedule.groups.length === 0) {
    errors.push(`Schedule ${index}: 'groups' deve ter pelo menos um grupo`);
  }

  if (!schedule.cron) {
    errors.push(`Schedule ${index}: 'cron' e obrigatorio`);
  } else if (!isValidCron(schedule.cron)) {
    errors.push(`Schedule ${index}: 'cron' invalido: ${schedule.cron}`);
  }

  if (errors.length > 0) {
    errors.forEach(e => logger.error(e));
    return false;
  }

  return true;
}

export function loadConfig(configPath?: string): AppConfig {
  const configFile = configPath || process.env.CONFIG_PATH || './config/config.yaml';
  const absolutePath = path.resolve(configFile);

  logger.info(`Carregando configuração de: ${absolutePath}`);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo de configuração não encontrado: ${absolutePath}`);
  }

  const fileContent = fs.readFileSync(absolutePath, 'utf-8');
  const rawConfig = YAML.parse(fileContent);

  const config = processEnvVars(rawConfig) as Partial<AppConfig>;

  const uazapi: UazapiConfig = {
    baseUrl: config.uazapi?.baseUrl || process.env.UAZAPI_URL || '',
    token: config.uazapi?.token || process.env.UAZAPI_TOKEN || '',
    instanceId: config.uazapi?.instanceId || process.env.UAZAPI_INSTANCE_ID || '',
    adminToken: config.uazapi?.adminToken || process.env.UAZAPI_ADMIN_TOKEN,
  };

  if (!uazapi.baseUrl) {
    throw new Error('Configuração da UAZAPI incompleta. Verifique baseUrl.');
  }

  const settings: SettingsConfig = {
    ...defaultSettings,
    ...config.settings,
  };

  const schedules = config.schedules || [];
  const validSchedules: ScheduleConfig[] = [];

  schedules.forEach((schedule, index) => {
    if (validateSchedule(schedule, index)) {
      validSchedules.push(schedule);
    }
  });

  logger.info(`Configuração carregada: ${validSchedules.length} schedules válidos`);

  return {
    uazapi,
    settings,
    schedules: validSchedules,
  };
}
