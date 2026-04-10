import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import YAML from 'yaml';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { Scheduler } from './scheduler.js';
import { UazapiClient, createInstance, deleteInstanceByAdmin } from './uazapi.js';
import { authMiddleware, verifyLogin } from './auth.js';
import type { ScheduleConfig, AppConfig } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3333;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Auth middleware — protege todas as rotas /api/* exceto /api/auth/login
app.use(authMiddleware);

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username e password obrigatórios' });
    }

    const token = await verifyLogin(username, password);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }

    res.json({ success: true, data: { token } });
  } catch (error) {
    logger.error('Erro no login', { error });
    res.status(500).json({ success: false, error: 'Erro interno' });
  }
});

const stickersDir = path.resolve('./config/stickers');
if (!fs.existsSync(stickersDir)) {
  fs.mkdirSync(stickersDir, { recursive: true });
}

// Variáveis globais
let scheduler: Scheduler | null = null;
let currentConfig: AppConfig | null = null;
let uazapiClient: UazapiClient | null = null;
const configPath = process.env.CONFIG_PATH || './config/config.yaml';

interface ScheduleWithId extends ScheduleConfig {
  id: string;
  enabled: boolean;
}

function reloadConfig(): AppConfig {
  currentConfig = loadConfig(configPath);
  return currentConfig;
}

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

function saveConfig(config: AppConfig): void {
  const yamlContent = YAML.stringify({
    uazapi: config.uazapi,
    settings: config.settings,
    schedules: config.schedules,
  });

  const absolutePath = path.resolve(configPath);
  fs.writeFileSync(absolutePath, yamlContent, 'utf-8');
  logger.info('Configuração salva', { path: absolutePath });
}

function parseCronToReadable(cronStr: string): { minutes: string; hours: string; days: number[] } {
  const parts = cronStr.split(' ');
  const dayMap: Record<string, number[]> = {
    '*': [0, 1, 2, 3, 4, 5, 6],
    '1-5': [1, 2, 3, 4, 5],
    '0,6': [0, 6],
  };

  let days = dayMap[parts[4]] || [0, 1, 2, 3, 4, 5, 6];

  if (parts[4].includes('-') && !dayMap[parts[4]]) {
    const [start, end] = parts[4].split('-').map(Number);
    days = [];
    for (let i = start; i <= end; i++) {
      days.push(i);
    }
  }

  if (parts[4].includes(',') && !dayMap[parts[4]]) {
    days = parts[4].split(',').map(Number);
  }

  return {
    minutes: parts[0],
    hours: parts[1],
    days,
  };
}

function formatToCron(hours: string, minutes: string, days: number[]): string {
  const dayPart = days.length === 7 ? '*' : days.sort((a, b) => a - b).join(',');
  return `${minutes} ${hours} * * ${dayPart}`;
}

// ========== API ROUTES ==========

// GET /api/schedules
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

// GET /api/schedules/:id
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

// POST /api/schedules
app.post('/api/schedules', (req, res) => {
  try {
    const config = reloadConfig();
    const { name, message, groups, hours, minutes, days, stickerPath } = req.body;

    if (!name || !message || !groups || groups.length === 0) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando (name, message, groups)' });
    }

    const cron = formatToCron(hours || '9', minutes || '0', days || [1, 2, 3, 4, 5]);

    const newSchedule: ScheduleConfig = {
      name,
      message,
      groups: Array.isArray(groups) ? groups : [groups],
      cron,
      stickerPath: stickerPath || undefined,
    };

    config.schedules.push(newSchedule);
    saveConfig(config);

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

// PUT /api/schedules/:id
app.put('/api/schedules/:id', (req, res) => {
  try {
    const config = reloadConfig();
    const index = parseInt(req.params.id.replace('schedule-', ''));

    if (index < 0 || index >= config.schedules.length) {
      return res.status(404).json({ success: false, error: 'Schedule não encontrado' });
    }

    const { name, message, groups, hours, minutes, days, stickerPath } = req.body;

    const cron = formatToCron(hours || '9', minutes || '0', days || [1, 2, 3, 4, 5]);

    config.schedules[index] = {
      name: name || config.schedules[index].name,
      message: message || config.schedules[index].message,
      groups: groups || config.schedules[index].groups,
      cron,
      stickerPath: stickerPath !== undefined ? (stickerPath || undefined) : config.schedules[index].stickerPath,
    };

    saveConfig(config);

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

// DELETE /api/schedules/:id
app.delete('/api/schedules/:id', (req, res) => {
  try {
    const config = reloadConfig();
    const index = parseInt(req.params.id.replace('schedule-', ''));

    if (index < 0 || index >= config.schedules.length) {
      return res.status(404).json({ success: false, error: 'Schedule não encontrado' });
    }

    config.schedules.splice(index, 1);
    saveConfig(config);

    if (scheduler) {
      restartScheduler();
    }

    res.json({ success: true, message: 'Schedule removido' });
  } catch (error) {
    logger.error('Erro ao remover schedule', { error });
    res.status(500).json({ success: false, error: 'Erro ao remover schedule' });
  }
});

// POST /api/schedules/:id/run
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

    scheduler.runNow(schedule.name).catch(err => {
      logger.error('Erro na execução manual', { error: err });
    });

    res.json({ success: true, message: 'Execução iniciada' });
  } catch (error) {
    logger.error('Erro ao executar schedule', { error });
    res.status(500).json({ success: false, error: 'Erro ao executar schedule' });
  }
});

// GET /api/settings
app.get('/api/settings', (req, res) => {
  try {
    const config = reloadConfig();
    res.json({
      success: true,
      data: {
        uazapi: config.uazapi ? {
          baseUrl: config.uazapi.baseUrl,
        } : null,
        settings: config.settings,
      },
    });
  } catch (error) {
    logger.error('Erro ao obter settings', { error });
    res.status(500).json({ success: false, error: 'Erro ao obter configurações' });
  }
});

// PUT /api/settings
app.put('/api/settings', (req, res) => {
  try {
    const config = reloadConfig();
    const { uazapi, settings } = req.body;

    if (uazapi) {
      config.uazapi = { ...config.uazapi, ...uazapi };
    }
    if (settings) {
      config.settings = { ...config.settings, ...settings };
    }

    saveConfig(config);
    res.json({ success: true, message: 'Configurações atualizadas' });
  } catch (error) {
    logger.error('Erro ao atualizar settings', { error });
    res.status(500).json({ success: false, error: 'Erro ao atualizar configurações' });
  }
});

// ========== WHATSAPP API ROUTES ==========

// GET /api/whatsapp/status
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

// GET /api/whatsapp/qrcode
app.get('/api/whatsapp/qrcode', async (req, res) => {
  try {
    const client = getUazapiClient();

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

// POST /api/whatsapp/logout
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

// POST /api/whatsapp/restart
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

// GET /api/instance/info
app.get('/api/instance/info', async (req, res) => {
  try {
    const config = reloadConfig();
    const client = getUazapiClient();
    const status = await client.checkConnection();

    res.json({
      success: true,
      data: {
        instanceId: config.uazapi?.instanceId,
        baseUrl: config.uazapi?.baseUrl,
        status: status.instance?.status || 'unknown',
        connected: status.status?.connected || false,
        hasAdminToken: !!config.uazapi?.adminToken,
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

// POST /api/instance/create
app.post('/api/instance/create', async (req, res) => {
  try {
    const { instanceName } = req.body;
    const config = reloadConfig();

    if (!instanceName) {
      return res.status(400).json({ success: false, error: 'instanceName é obrigatório' });
    }

    const baseUrl = config.uazapi?.baseUrl;
    const adminToken = config.uazapi?.adminToken || '';

    if (!baseUrl || !adminToken) {
      return res.status(400).json({
        success: false,
        error: 'baseUrl e adminToken devem estar configurados no config.yaml',
      });
    }

    const result = await createInstance(baseUrl, adminToken, instanceName);

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const updatedConfig = configContent
      .replace(/token:\s*.*/, `token: ${result.token}`)
      .replace(/instanceId:\s*.*/, `instanceId: ${result.instance.id}`);
    fs.writeFileSync(configPath, updatedConfig);

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

// DELETE /api/instance/delete
app.delete('/api/instance/delete', async (req, res) => {
  try {
    const config = reloadConfig();
    const baseUrl = config.uazapi?.baseUrl;
    const adminToken = config.uazapi?.adminToken || '';
    const instanceId = config.uazapi?.instanceId;

    if (!baseUrl || !adminToken || !instanceId) {
      return res.status(400).json({
        success: false,
        error: 'Configuração incompleta para deletar instância',
      });
    }

    await deleteInstanceByAdmin(baseUrl, adminToken, instanceId);

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const updatedConfig = configContent
      .replace(/token:\s*.*/, 'token: ')
      .replace(/instanceId:\s*.*/, 'instanceId: ');
    fs.writeFileSync(configPath, updatedConfig);

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

// GET /api/whatsapp/groups
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const client = getUazapiClient();

    const isConnected = await client.isConnected();
    if (!isConnected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado.',
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

// GET /api/groups/refresh
app.get('/api/groups/refresh', async (req, res) => {
  try {
    const client = getUazapiClient();

    const isConnected = await client.isConnected();
    if (!isConnected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado.',
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

// GET /api/stickers - Listar stickers disponíveis
app.get('/api/stickers', (req, res) => {
  try {
    const files = fs.readdirSync(stickersDir).filter(f => f.endsWith('.webp'));
    const stickers = files.map(f => ({
      name: f,
      path: `./config/stickers/${f}`,
    }));
    res.json({ success: true, data: stickers });
  } catch (error) {
    res.json({ success: true, data: [] });
  }
});

// POST /api/stickers/upload - Upload de sticker webp
app.post('/api/stickers/upload', (req, res) => {
  try {
    const { name, data: base64Data } = req.body;
    if (!name || !base64Data) {
      return res.status(400).json({ success: false, error: 'name e data são obrigatórios' });
    }

    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '') + '.webp';
    const filePath = path.join(stickersDir, safeName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);

    logger.info('Sticker salvo', { name: safeName, size: buffer.length });

    res.json({
      success: true,
      data: {
        name: safeName,
        path: `./config/stickers/${safeName}`,
      },
    });
  } catch (error) {
    logger.error('Erro ao salvar sticker', { error });
    res.status(500).json({ success: false, error: 'Erro ao salvar sticker' });
  }
});

// POST /api/test/send - Enviar teste para um grupo
app.post('/api/test/send', async (req, res) => {
  try {
    const { groupId, message, stickerPath } = req.body;

    if (!groupId || !message) {
      return res.status(400).json({ success: false, error: 'groupId e message são obrigatórios' });
    }

    const client = getUazapiClient();

    const isConnected = await client.isConnected();
    if (!isConnected) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp não está conectado',
      });
    }

    logger.info('Enviando teste', { groupId, hasSticker: !!stickerPath });

    // Enviar sticker primeiro se configurado
    if (stickerPath) {
      const stickerFile = path.resolve(stickerPath);
      if (fs.existsSync(stickerFile)) {
        const stickerBuffer = fs.readFileSync(stickerFile);
        await client.sendSticker(groupId, stickerBuffer);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    const result = await client.sendText(groupId, message);

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

// GET /api/status
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    data: {
      scheduler: scheduler?.getStatus() || { isRunning: false, tasks: [] },
      uptime: process.uptime(),
    },
  });
});

// POST /api/scheduler/start
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

// POST /api/scheduler/stop
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

async function restartScheduler(): Promise<void> {
  if (scheduler) {
    await scheduler.stop();
    const config = reloadConfig();
    scheduler = new Scheduler(config);
    await scheduler.start();
  }
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`Recebido sinal ${signal}. Encerrando...`);
  if (scheduler) {
    await scheduler.stop();
  }
  if (uazapiClient) {
    uazapiClient.stopGroupSync();
  }
  process.exit(0);
}

async function initializeGroupSync(): Promise<void> {
  try {
    const client = getUazapiClient();
    const isConnected = await client.isConnected();

    if (isConnected) {
      logger.info('WhatsApp conectado. Iniciando sincronização automática de grupos...');
      await client.refreshGroups();
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

app.listen(PORT, () => {
  logger.info(`Servidor rodando em http://localhost:${PORT}`);
  logger.info('Interface web disponível');

  setTimeout(() => {
    initializeGroupSync().catch(err => {
      logger.error('Erro na inicialização do sync de grupos', { error: err });
    });
  }, 2000);
});
