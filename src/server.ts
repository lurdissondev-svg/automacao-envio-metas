import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import YAML from 'yaml';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { Scheduler } from './scheduler.js';
import { initBrowser, closeBrowser, captureScreenshotWithRetry } from './screenshot.js';
import { UazapiClient, createInstance, deleteInstanceByAdmin } from './uazapi.js';
import { createMessageWithSheetData } from './templates.js';
import { fetchSheetData } from './sheets.js';
import type { ScheduleConfig, AppConfig, SheetTabConfig, CellMapping } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3333;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Variáveis globais
let scheduler: Scheduler | null = null;
let currentConfig: AppConfig | null = null;
let uazapiClient: UazapiClient | null = null;
const configPath = process.env.CONFIG_PATH || './config/config.yaml';

// Interface para schedule com ID
interface ScheduleWithId extends ScheduleConfig {
  id: string;
  enabled: boolean;
}

// Carregar configuração
function reloadConfig(): AppConfig {
  currentConfig = loadConfig(configPath);
  return currentConfig;
}

// Obter ou criar UAZAPI Client
function getUazapiClient(): UazapiClient {
  const config = reloadConfig();
  if (!config.uazapi) {
    throw new Error('Configuração UAZAPI não encontrada');
  }
  if (!uazapiClient) {
    uazapiClient = new UazapiClient(config.uazapi);
  }
  return uazapiClient;
}

// Salvar configuração
function saveConfig(config: AppConfig): void {
  const yamlContent = YAML.stringify({
    uazapi: config.uazapi,
    settings: config.settings,
    browser: config.browser,
    schedules: config.schedules,
  });

  const absolutePath = path.resolve(configPath);
  fs.writeFileSync(absolutePath, yamlContent, 'utf-8');
  logger.info('Configuração salva', { path: absolutePath });
}

// Converter cron para formato legível
function parseCronToReadable(cron: string): { minutes: string; hours: string; days: number[] } {
  const parts = cron.split(' ');
  const dayMap: Record<string, number[]> = {
    '*': [0, 1, 2, 3, 4, 5, 6],
    '1-5': [1, 2, 3, 4, 5],
    '0,6': [0, 6],
  };

  let days = dayMap[parts[4]] || [0, 1, 2, 3, 4, 5, 6];

  // Parse range like 1-5
  if (parts[4].includes('-') && !dayMap[parts[4]]) {
    const [start, end] = parts[4].split('-').map(Number);
    days = [];
    for (let i = start; i <= end; i++) {
      days.push(i);
    }
  }

  // Parse list like 1,3,5
  if (parts[4].includes(',') && !dayMap[parts[4]]) {
    days = parts[4].split(',').map(Number);
  }

  return {
    minutes: parts[0],
    hours: parts[1],
    days,
  };
}

// Converter formato legível para cron
function formatToCron(hours: string, minutes: string, days: number[]): string {
  const dayPart = days.length === 7 ? '*' : days.sort((a, b) => a - b).join(',');
  return `${minutes} ${hours} * * ${dayPart}`;
}

// ========== API ROUTES ==========

// GET /api/schedules - Listar todos os schedules
app.get('/api/schedules', (req, res) => {
  try {
    const config = reloadConfig();
    const schedules: ScheduleWithId[] = config.schedules.map((s, index) => ({
      ...s,
      id: `schedule-${index}`,
      enabled: true,
    }));
    res.json({ success: true, data: schedules });
  } catch (error) {
    logger.error('Erro ao listar schedules', { error });
    res.status(500).json({ success: false, error: 'Erro ao carregar schedules' });
  }
});

// GET /api/schedules/:id - Obter schedule específico
app.get('/api/schedules/:id', (req, res) => {
  try {
    const config = reloadConfig();
    const index = parseInt(req.params.id.replace('schedule-', ''));
    const schedule = config.schedules[index];

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule não encontrado' });
    }

    const parsed = parseCronToReadable(schedule.cron);

    res.json({
      success: true,
      data: {
        ...schedule,
        id: req.params.id,
        enabled: true,
        cronParsed: parsed,
      },
    });
  } catch (error) {
    logger.error('Erro ao obter schedule', { error });
    res.status(500).json({ success: false, error: 'Erro ao obter schedule' });
  }
});

// POST /api/schedules - Criar novo schedule
app.post('/api/schedules', (req, res) => {
  try {
    const config = reloadConfig();
    const { name, sheetUrl, groups, hours, minutes, days, messageTemplate, sheetTabs, cellMappings, clip, selector } = req.body;

    // Validação básica
    if (!name || !sheetUrl || !groups || groups.length === 0) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando' });
    }

    const cron = formatToCron(hours || '9', minutes || '0', days || [1, 2, 3, 4, 5]);

    const newSchedule: ScheduleConfig = {
      name,
      sheetUrl,
      groups: Array.isArray(groups) ? groups : [groups],
      cron,
      messageTemplate: messageTemplate || `📊 *{scheduleName}* - {date}\n\nAtualização das {time}`,
      viewport: config.browser.defaultViewport,
      waitAfterLoad: config.settings.waitAfterLoad,
      sheetTabs: sheetTabs || [],
      cellMappings: cellMappings || [],
      clip: clip || undefined,
      selector: selector || undefined,
    };

    config.schedules.push(newSchedule);
    saveConfig(config);

    // Reiniciar scheduler se estiver rodando
    if (scheduler) {
      restartScheduler();
    }

    res.json({
      success: true,
      data: {
        ...newSchedule,
        id: `schedule-${config.schedules.length - 1}`,
        enabled: true,
      },
    });
  } catch (error) {
    logger.error('Erro ao criar schedule', { error });
    res.status(500).json({ success: false, error: 'Erro ao criar schedule' });
  }
});

// PUT /api/schedules/:id - Atualizar schedule
app.put('/api/schedules/:id', (req, res) => {
  try {
    const config = reloadConfig();
    const index = parseInt(req.params.id.replace('schedule-', ''));

    if (index < 0 || index >= config.schedules.length) {
      return res.status(404).json({ success: false, error: 'Schedule não encontrado' });
    }

    const { name, sheetUrl, groups, hours, minutes, days, messageTemplate, sheetTabs, cellMappings, clip, selector } = req.body;

    const cron = formatToCron(hours || '9', minutes || '0', days || [1, 2, 3, 4, 5]);

    config.schedules[index] = {
      ...config.schedules[index],
      name: name || config.schedules[index].name,
      sheetUrl: sheetUrl || config.schedules[index].sheetUrl,
      groups: groups || config.schedules[index].groups,
      cron,
      messageTemplate: messageTemplate || config.schedules[index].messageTemplate,
      sheetTabs: sheetTabs !== undefined ? sheetTabs : config.schedules[index].sheetTabs,
      cellMappings: cellMappings !== undefined ? cellMappings : config.schedules[index].cellMappings,
      clip: clip !== undefined ? clip : config.schedules[index].clip,
      selector: selector !== undefined ? selector : config.schedules[index].selector,
    };

    saveConfig(config);

    // Reiniciar scheduler se estiver rodando
    if (scheduler) {
      restartScheduler();
    }

    res.json({
      success: true,
      data: {
        ...config.schedules[index],
        id: req.params.id,
        enabled: true,
      },
    });
  } catch (error) {
    logger.error('Erro ao atualizar schedule', { error });
    res.status(500).json({ success: false, error: 'Erro ao atualizar schedule' });
  }
});

// DELETE /api/schedules/:id - Remover schedule
app.delete('/api/schedules/:id', (req, res) => {
  try {
    const config = reloadConfig();
    const index = parseInt(req.params.id.replace('schedule-', ''));

    if (index < 0 || index >= config.schedules.length) {
      return res.status(404).json({ success: false, error: 'Schedule não encontrado' });
    }

    config.schedules.splice(index, 1);
    saveConfig(config);

    // Reiniciar scheduler se estiver rodando
    if (scheduler) {
      restartScheduler();
    }

    res.json({ success: true, message: 'Schedule removido' });
  } catch (error) {
    logger.error('Erro ao remover schedule', { error });
    res.status(500).json({ success: false, error: 'Erro ao remover schedule' });
  }
});

// POST /api/schedules/:id/run - Executar schedule manualmente
app.post('/api/schedules/:id/run', async (req, res) => {
  try {
    const config = reloadConfig();
    const index = parseInt(req.params.id.replace('schedule-', ''));
    const schedule = config.schedules[index];

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule não encontrado' });
    }

    if (!scheduler) {
      scheduler = new Scheduler(config);
    }

    // Executar em background
    scheduler.runNow(schedule.name).catch(err => {
      logger.error('Erro na execução manual', { error: err });
    });

    res.json({ success: true, message: 'Execução iniciada' });
  } catch (error) {
    logger.error('Erro ao executar schedule', { error });
    res.status(500).json({ success: false, error: 'Erro ao executar schedule' });
  }
});

// GET /api/settings - Obter configurações gerais
app.get('/api/settings', (req, res) => {
  try {
    const config = reloadConfig();
    res.json({
      success: true,
      data: {
        uazapi: config.uazapi ? {
          baseUrl: config.uazapi.baseUrl,
          // Não expor token por segurança
        } : null,
        settings: config.settings,
        browser: config.browser,
      },
    });
  } catch (error) {
    logger.error('Erro ao obter settings', { error });
    res.status(500).json({ success: false, error: 'Erro ao obter configurações' });
  }
});

// PUT /api/settings - Atualizar configurações
app.put('/api/settings', (req, res) => {
  try {
    const config = reloadConfig();
    const { uazapi, settings, browser } = req.body;

    if (uazapi) {
      config.uazapi = { ...config.uazapi, ...uazapi };
    }
    if (settings) {
      config.settings = { ...config.settings, ...settings };
    }
    if (browser) {
      config.browser = { ...config.browser, ...browser };
    }

    saveConfig(config);
    res.json({ success: true, message: 'Configurações atualizadas' });
  } catch (error) {
    logger.error('Erro ao atualizar settings', { error });
    res.status(500).json({ success: false, error: 'Erro ao atualizar configurações' });
  }
});

// ========== WHATSAPP API ROUTES ==========

// GET /api/whatsapp/status - Status da conexão WhatsApp
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    const client = getUazapiClient();
    const status = await client.checkConnection();

    const connected = status.status?.connected === true || status.instance?.status === 'connected';

    res.json({
      success: true,
      data: {
        connected,
        state: status.instance?.status || (connected ? 'connected' : 'disconnected'),
        instance: {
          status: status.instance?.status,
          loggedIn: status.status?.loggedIn,
        },
      },
    });
  } catch (error) {
    logger.error('Erro ao verificar status WhatsApp', { error });
    res.json({
      success: true,
      data: {
        connected: false,
        state: 'disconnected',
        error: error instanceof Error ? error.message : 'Erro de conexão',
      },
    });
  }
});

// GET /api/whatsapp/qrcode - Obter QR Code para conexão
app.get('/api/whatsapp/qrcode', async (req, res) => {
  try {
    const client = getUazapiClient();

    // Verificar se já está conectado
    const isConnected = await client.isConnected();
    if (isConnected) {
      return res.json({
        success: true,
        data: {
          connected: true,
          message: 'WhatsApp já está conectado',
        },
      });
    }

    // UAZAPI retorna QR Code já em base64 data URI
    const qrCode = await client.getQRCode();

    res.json({
      success: true,
      data: {
        connected: false,
        qrCode: qrCode.base64,
        pairingCode: qrCode.pairingCode,
      },
    });
  } catch (error) {
    logger.error('Erro ao obter QR Code', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao obter QR Code',
    });
  }
});

// POST /api/whatsapp/logout - Desconectar WhatsApp
app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    const client = getUazapiClient();
    await client.logout();

    res.json({
      success: true,
      message: 'WhatsApp desconectado',
    });
  } catch (error) {
    logger.error('Erro ao desconectar WhatsApp', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao desconectar',
    });
  }
});

// POST /api/whatsapp/restart - Reiniciar instância
app.post('/api/whatsapp/restart', async (req, res) => {
  try {
    const client = getUazapiClient();
    await client.restart();

    res.json({
      success: true,
      message: 'Instância reiniciada',
    });
  } catch (error) {
    logger.error('Erro ao reiniciar instância', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao reiniciar',
    });
  }
});

// ========== INSTANCE MANAGEMENT ==========

// GET /api/instance/info - Informações da instância atual
app.get('/api/instance/info', async (req, res) => {
  try {
    const config = reloadConfig();
    const client = getUazapiClient();
    const status = await client.checkConnection();

    res.json({
      success: true,
      data: {
        instanceId: config.uazapi?.instanceId || process.env.UAZAPI_INSTANCE_ID,
        baseUrl: config.uazapi?.baseUrl || process.env.UAZAPI_URL,
        status: status.instance?.status || 'unknown',
        connected: status.status?.connected || false,
        hasAdminToken: !!(config.uazapi?.adminToken || process.env.UAZAPI_ADMIN_TOKEN),
      },
    });
  } catch (error) {
    logger.error('Erro ao obter info da instância', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao obter info',
    });
  }
});

// POST /api/instance/create - Criar nova instância
app.post('/api/instance/create', async (req, res) => {
  try {
    const { instanceName } = req.body;

    if (!instanceName) {
      return res.status(400).json({ success: false, error: 'instanceName é obrigatório' });
    }

    const baseUrl = process.env.UAZAPI_URL || '';
    const adminToken = process.env.UAZAPI_ADMIN_TOKEN || '';

    if (!baseUrl || !adminToken) {
      return res.status(400).json({
        success: false,
        error: 'UAZAPI_URL e UAZAPI_ADMIN_TOKEN devem estar configurados no .env',
      });
    }

    const result = await createInstance(baseUrl, adminToken, instanceName);

    // Atualizar .env com a nova instância
    const envPath = path.resolve('.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');

    // Atualizar ou adicionar UAZAPI_TOKEN e UAZAPI_INSTANCE_ID
    if (envContent.includes('UAZAPI_TOKEN=')) {
      envContent = envContent.replace(/UAZAPI_TOKEN=.*/, `UAZAPI_TOKEN=${result.token}`);
    } else {
      envContent += `\nUAZAPI_TOKEN=${result.token}`;
    }

    if (envContent.includes('UAZAPI_INSTANCE_ID=')) {
      envContent = envContent.replace(/UAZAPI_INSTANCE_ID=.*/, `UAZAPI_INSTANCE_ID=${result.instance.id}`);
    } else {
      envContent += `\nUAZAPI_INSTANCE_ID=${result.instance.id}`;
    }

    fs.writeFileSync(envPath, envContent);

    // Atualizar variáveis de ambiente em runtime
    process.env.UAZAPI_TOKEN = result.token;
    process.env.UAZAPI_INSTANCE_ID = result.instance.id;

    // Resetar cliente UAZAPI para usar nova instância
    uazapiClient = null;

    logger.info('Nova instância criada e configurada', {
      instanceId: result.instance.id,
      instanceName: result.instance.name,
    });

    res.json({
      success: true,
      data: {
        instanceId: result.instance.id,
        instanceName: result.instance.name,
        token: result.token,
        status: result.instance.status,
      },
      message: 'Instância criada com sucesso! Escaneie o QR Code para conectar.',
    });
  } catch (error) {
    logger.error('Erro ao criar instância', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao criar instância',
    });
  }
});

// DELETE /api/instance/delete - Deletar instância atual
app.delete('/api/instance/delete', async (req, res) => {
  try {
    const baseUrl = process.env.UAZAPI_URL || '';
    const adminToken = process.env.UAZAPI_ADMIN_TOKEN || '';
    const instanceId = process.env.UAZAPI_INSTANCE_ID || '';

    if (!baseUrl || !adminToken || !instanceId) {
      return res.status(400).json({
        success: false,
        error: 'Configuração incompleta para deletar instância',
      });
    }

    await deleteInstanceByAdmin(baseUrl, adminToken, instanceId);

    // Limpar .env
    const envPath = path.resolve('.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');
    envContent = envContent.replace(/UAZAPI_TOKEN=.*/, 'UAZAPI_TOKEN=');
    envContent = envContent.replace(/UAZAPI_INSTANCE_ID=.*/, 'UAZAPI_INSTANCE_ID=');
    fs.writeFileSync(envPath, envContent);

    // Limpar variáveis em runtime
    process.env.UAZAPI_TOKEN = '';
    process.env.UAZAPI_INSTANCE_ID = '';
    uazapiClient = null;

    res.json({
      success: true,
      message: 'Instância deletada com sucesso',
    });
  } catch (error) {
    logger.error('Erro ao deletar instância', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao deletar instância',
    });
  }
});

// GET /api/whatsapp/groups - Listar grupos do WhatsApp (com cache)
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const client = getUazapiClient();

    // Verificar conexão primeiro
    const isConnected = await client.isConnected();
    if (!isConnected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado. Escaneie o QR Code primeiro.',
      });
    }

    const result = await client.getGroupsWithCacheInfo();
    const cacheStats = client.getGroupCacheStats();

    res.json({
      success: true,
      data: result.groups.map(g => ({
        id: g.JID,
        name: g.Name,
        size: g.ParticipantCount,
        creation: g.GroupCreated,
      })),
      cache: {
        lastSync: result.lastSync,
        fromCache: result.fromCache,
        count: cacheStats.count,
        isValid: cacheStats.isValid,
      },
    });
  } catch (error) {
    logger.error('Erro ao listar grupos', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao listar grupos',
    });
  }
});

// GET /api/groups/refresh - Forçar atualização da lista de grupos
app.get('/api/groups/refresh', async (req, res) => {
  try {
    const client = getUazapiClient();

    // Verificar conexão primeiro
    const isConnected = await client.isConnected();
    if (!isConnected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado. Escaneie o QR Code primeiro.',
      });
    }

    logger.info('Forçando refresh da lista de grupos via API');
    const result = await client.refreshGroups();

    res.json({
      success: true,
      data: result.groups.map(g => ({
        id: g.JID,
        name: g.Name,
        size: g.ParticipantCount,
        creation: g.GroupCreated,
      })),
      lastSync: result.lastSync,
      message: `${result.groups.length} grupos atualizados`,
    });
  } catch (error) {
    logger.error('Erro ao atualizar grupos', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao atualizar grupos',
    });
  }
});

// GET /api/groups/cache - Obter estatísticas do cache de grupos
app.get('/api/groups/cache', (req, res) => {
  try {
    const client = getUazapiClient();
    const stats = client.getGroupCacheStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Erro ao obter estatísticas do cache', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao obter estatísticas',
    });
  }
});

// ========== PREVIEW/TEST ROUTES ==========

// POST /api/schedules/:id/preview - Preview sem enviar (para teste)
app.post('/api/schedules/:id/preview', async (req, res) => {
  try {
    const config = reloadConfig();
    const index = parseInt(req.params.id.replace('schedule-', ''));
    const schedule = config.schedules[index];

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule não encontrado' });
    }

    logger.info('Gerando preview do schedule', { name: schedule.name });

    // Inicializar browser
    await initBrowser(config.browser);

    // Capturar screenshot
    const screenshot = await captureScreenshotWithRetry(
      schedule.sheetUrl,
      schedule.viewport || config.browser.defaultViewport,
      schedule.selector,
      schedule.waitAfterLoad || config.settings.waitAfterLoad
    );

    // Buscar dados da planilha (se houver mapeamentos)
    let sheetData: Record<string, string> = {};
    if (schedule.cellMappings && schedule.cellMappings.length > 0) {
      sheetData = await fetchSheetData(schedule.sheetUrl, schedule.cellMappings);
    }

    // Criar mensagem
    const message = await createMessageWithSheetData(
      schedule.messageTemplate,
      schedule.name,
      config.settings.timezone,
      schedule.sheetUrl,
      schedule.cellMappings
    );

    // Converter screenshot para base64
    const screenshotBase64 = `data:image/png;base64,${screenshot.toString('base64')}`;

    res.json({
      success: true,
      data: {
        screenshot: screenshotBase64,
        message,
        sheetData,
        schedule: {
          name: schedule.name,
          sheetUrl: schedule.sheetUrl,
          groups: schedule.groups,
        },
      },
    });
  } catch (error) {
    logger.error('Erro ao gerar preview', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao gerar preview',
    });
  }
});

// POST /api/test/preview - Preview completo (screenshot + mensagem + dados)
app.post('/api/test/preview', async (req, res) => {
  try {
    const { sheetUrl, messageTemplate, cellMappings, scheduleName, viewport, selector, waitAfterLoad, clip } = req.body;

    if (!sheetUrl) {
      return res.status(400).json({ success: false, error: 'sheetUrl é obrigatório' });
    }

    const config = reloadConfig();

    logger.info('Gerando preview de teste', { sheetUrl, scheduleName, clip });

    // Inicializar browser
    await initBrowser(config.browser);

    // Capturar screenshot
    const screenshot = await captureScreenshotWithRetry(
      sheetUrl,
      viewport || config.browser.defaultViewport,
      selector,
      waitAfterLoad || config.settings.waitAfterLoad,
      3,
      clip
    );

    // Buscar dados da planilha (se houver mapeamentos)
    let variables: Record<string, string> = {};
    let sheetError: string | null = null;

    if (cellMappings && Array.isArray(cellMappings) && cellMappings.length > 0) {
      try {
        variables = await fetchSheetData(sheetUrl, cellMappings);
        if (Object.keys(variables).length === 0 && cellMappings.length > 0) {
          sheetError = 'Não foi possível extrair dados da planilha. Verifique se a planilha está pública (Compartilhar -> "Qualquer pessoa com o link pode ver").';
        }
      } catch (sheetErr) {
        sheetError = sheetErr instanceof Error ? sheetErr.message : 'Erro ao buscar dados da planilha';
        logger.warn('Erro ao buscar dados da planilha para preview', { error: sheetError });
      }
    }

    // Criar mensagem
    const message = await createMessageWithSheetData(
      messageTemplate || '{scheduleName} - {date}',
      scheduleName || 'Teste',
      config.settings.timezone,
      sheetUrl,
      cellMappings
    );

    // Converter screenshot para base64
    const screenshotBase64 = `data:image/png;base64,${screenshot.toString('base64')}`;

    res.json({
      success: true,
      data: {
        screenshot: screenshotBase64,
        message,
        variables,
        sheetError, // Aviso sobre erro na planilha (se houver)
      },
    });
  } catch (error) {
    logger.error('Erro ao gerar preview de teste', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao gerar preview',
    });
  }
});

// POST /api/test/screenshot - Testar captura de screenshot (sem schedule)
app.post('/api/test/screenshot', async (req, res) => {
  try {
    const { sheetUrl, viewport, selector, waitAfterLoad } = req.body;

    if (!sheetUrl) {
      return res.status(400).json({ success: false, error: 'sheetUrl é obrigatório' });
    }

    const config = reloadConfig();

    logger.info('Capturando screenshot de teste', { sheetUrl });

    // Inicializar browser
    await initBrowser(config.browser);

    // Capturar screenshot
    const screenshot = await captureScreenshotWithRetry(
      sheetUrl,
      viewport || config.browser.defaultViewport,
      selector,
      waitAfterLoad || config.settings.waitAfterLoad
    );

    // Converter para base64
    const screenshotBase64 = `data:image/png;base64,${screenshot.toString('base64')}`;

    res.json({
      success: true,
      data: {
        screenshot: screenshotBase64,
      },
    });
  } catch (error) {
    logger.error('Erro ao capturar screenshot de teste', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao capturar screenshot',
    });
  }
});

// POST /api/test/sheet-data - Testar extração de dados da planilha
app.post('/api/test/sheet-data', async (req, res) => {
  try {
    const { sheetUrl, cellMappings } = req.body;

    if (!sheetUrl) {
      return res.status(400).json({ success: false, error: 'sheetUrl é obrigatório' });
    }

    if (!cellMappings || !Array.isArray(cellMappings) || cellMappings.length === 0) {
      return res.status(400).json({ success: false, error: 'cellMappings é obrigatório' });
    }

    logger.info('Testando extração de dados', { sheetUrl, cellMappings });

    const sheetData = await fetchSheetData(sheetUrl, cellMappings);

    res.json({
      success: true,
      data: {
        sheetData,
        mappings: cellMappings,
      },
    });
  } catch (error) {
    logger.error('Erro ao extrair dados da planilha', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao extrair dados',
    });
  }
});

// POST /api/test/message - Testar geração de mensagem
app.post('/api/test/message', async (req, res) => {
  try {
    const { messageTemplate, scheduleName, sheetUrl, cellMappings } = req.body;

    if (!messageTemplate) {
      return res.status(400).json({ success: false, error: 'messageTemplate é obrigatório' });
    }

    const config = reloadConfig();

    logger.info('Testando geração de mensagem', { scheduleName });

    const message = await createMessageWithSheetData(
      messageTemplate,
      scheduleName || 'Teste',
      config.settings.timezone,
      sheetUrl,
      cellMappings
    );

    res.json({
      success: true,
      data: {
        message,
      },
    });
  } catch (error) {
    logger.error('Erro ao gerar mensagem de teste', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao gerar mensagem',
    });
  }
});

// POST /api/test/send - Enviar teste para um grupo específico
app.post('/api/test/send', async (req, res) => {
  try {
    const { sheetUrl, groupId, messageTemplate, cellMappings, scheduleName, screenshot: screenshotBase64, message: precomputedMessage } = req.body;

    if (!groupId) {
      return res.status(400).json({ success: false, error: 'groupId é obrigatório' });
    }

    const config = reloadConfig();
    const client = getUazapiClient();

    // Verificar conexão
    const isConnected = await client.isConnected();
    if (!isConnected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado',
      });
    }

    logger.info('Enviando teste', { groupId });

    let screenshot: Buffer;
    let message: string;

    // Se screenshot e mensagem já foram enviados, usar eles
    if (screenshotBase64 && precomputedMessage) {
      // Converter base64 data URI para Buffer
      const base64Data = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');
      screenshot = Buffer.from(base64Data, 'base64');
      message = precomputedMessage;
    } else {
      // Caso contrário, capturar screenshot e gerar mensagem
      if (!sheetUrl) {
        return res.status(400).json({ success: false, error: 'sheetUrl é obrigatório' });
      }
      if (!messageTemplate) {
        return res.status(400).json({ success: false, error: 'messageTemplate é obrigatório' });
      }

      // Inicializar browser
      await initBrowser(config.browser);

      // Capturar screenshot
      screenshot = await captureScreenshotWithRetry(
        sheetUrl,
        config.browser.defaultViewport,
        undefined,
        config.settings.waitAfterLoad
      );

      // Criar mensagem
      message = await createMessageWithSheetData(
        messageTemplate,
        scheduleName || 'Teste',
        config.settings.timezone,
        sheetUrl,
        cellMappings
      );
    }

    // Enviar
    const result = await client.sendImage(groupId, screenshot, message);

    res.json({
      success: true,
      data: {
        messageId: result.messageId || result.id,
        message,
        groupId,
      },
    });
  } catch (error) {
    logger.error('Erro ao enviar teste', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao enviar teste',
    });
  }
});

// GET /api/status - Status do scheduler
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    data: {
      scheduler: scheduler?.getStatus() || { isRunning: false, tasks: [] },
      uptime: process.uptime(),
    },
  });
});

// POST /api/scheduler/start - Iniciar scheduler
app.post('/api/scheduler/start', async (req, res) => {
  try {
    if (scheduler?.getStatus().isRunning) {
      return res.json({ success: true, message: 'Scheduler já está rodando' });
    }

    const config = reloadConfig();
    scheduler = new Scheduler(config);
    await scheduler.start();

    res.json({ success: true, message: 'Scheduler iniciado' });
  } catch (error) {
    logger.error('Erro ao iniciar scheduler', { error });
    res.status(500).json({ success: false, error: 'Erro ao iniciar scheduler' });
  }
});

// POST /api/scheduler/stop - Parar scheduler
app.post('/api/scheduler/stop', async (req, res) => {
  try {
    if (scheduler) {
      await scheduler.stop();
      scheduler = null;
    }
    res.json({ success: true, message: 'Scheduler parado' });
  } catch (error) {
    logger.error('Erro ao parar scheduler', { error });
    res.status(500).json({ success: false, error: 'Erro ao parar scheduler' });
  }
});

// Função para reiniciar scheduler
async function restartScheduler(): Promise<void> {
  if (scheduler) {
    await scheduler.stop();
    const config = reloadConfig();
    scheduler = new Scheduler(config);
    await scheduler.start();
  }
}

// Servir index.html para rotas não-API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Tratamento de sinais
async function shutdown(signal: string): Promise<void> {
  logger.info(`Recebido sinal ${signal}. Encerrando...`);
  if (scheduler) {
    await scheduler.stop();
  }
  // Parar sincronização de grupos
  if (uazapiClient) {
    uazapiClient.stopGroupSync();
  }
  await closeBrowser();
  process.exit(0);
}

// Iniciar sincronização automática de grupos (após servidor estar pronto)
async function initializeGroupSync(): Promise<void> {
  try {
    const client = getUazapiClient();
    const isConnected = await client.isConnected();

    if (isConnected) {
      logger.info('WhatsApp conectado. Iniciando sincronização automática de grupos...');
      // Fazer sync inicial
      await client.refreshGroups();
      // Iniciar sync periódico (a cada 5 minutos)
      client.startGroupSync();
      logger.info('Sincronização de grupos iniciada com sucesso');
    } else {
      logger.info('WhatsApp não conectado. Sincronização de grupos será iniciada após conexão.');
    }
  } catch (error) {
    logger.warn('Não foi possível iniciar sincronização de grupos no startup', {
      error: error instanceof Error ? error.message : error,
    });
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Iniciar servidor
app.listen(PORT, () => {
  logger.info(`Servidor rodando em http://localhost:${PORT}`);
  logger.info('Interface web disponível');

  // Iniciar sincronização automática de grupos após startup
  setTimeout(() => {
    initializeGroupSync().catch(err => {
      logger.error('Erro na inicialização do sync de grupos', { error: err });
    });
  }, 2000); // Aguardar 2 segundos para garantir que tudo está pronto
});
