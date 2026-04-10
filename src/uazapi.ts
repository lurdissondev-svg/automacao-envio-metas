import { logger } from './logger.js';
import type {
  UazapiConfig,
  UazapiConnectionStatus,
  UazapiConnectResponse,
  UazapiSendTextResponse,
  UazapiSendMediaResponse,
  UazapiGroup,
} from './types.js';

// ========== GROUP CACHE ==========

interface GroupCacheData {
  groups: UazapiGroup[];
  lastSync: number;
}

class GroupCache {
  private cache: GroupCacheData | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000;
  private readonly CACHE_MAX_AGE = 10 * 60 * 1000;
  private readonly SYNC_INTERVAL = 5 * 60 * 1000;

  isValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.lastSync < this.CACHE_TTL;
  }

  isExpired(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.lastSync > this.CACHE_MAX_AGE;
  }

  get(): UazapiGroup[] | null {
    if (!this.cache) return null;
    return this.cache.groups;
  }

  set(groups: UazapiGroup[]): void {
    this.cache = {
      groups,
      lastSync: Date.now(),
    };
    logger.debug('Cache de grupos atualizado', { count: groups.length });
  }

  getLastSync(): number | null {
    return this.cache?.lastSync || null;
  }

  clear(): void {
    this.cache = null;
    logger.debug('Cache de grupos limpo');
  }

  startPeriodicSync(fetchFn: () => Promise<UazapiGroup[]>): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      try {
        logger.info('Sincronização periódica de grupos iniciada');
        const groups = await fetchFn();
        this.set(groups);
        logger.info('Sincronização periódica de grupos concluída', { count: groups.length });
      } catch (error) {
        logger.error('Erro na sincronização periódica de grupos', {
          error: error instanceof Error ? error.message : error,
        });
      }
    }, this.SYNC_INTERVAL);

    logger.info('Sincronização periódica de grupos configurada', {
      interval: `${this.SYNC_INTERVAL / 1000}s`,
    });
  }

  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  getStats(): { count: number; lastSync: number | null; isValid: boolean; isExpired: boolean } {
    return {
      count: this.cache?.groups.length || 0,
      lastSync: this.cache?.lastSync || null,
      isValid: this.isValid(),
      isExpired: this.isExpired(),
    };
  }
}

const groupCache = new GroupCache();

// ========== UAZAPI CLIENT ==========

export class UazapiClient {
  private baseUrl: string;
  private token: string;
  private instanceId: string;
  private adminToken?: string;

  constructor(config: UazapiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.instanceId = config.instanceId;
    this.adminToken = config.adminToken;

    logger.info('UAZAPI Client inicializado', {
      baseUrl: this.baseUrl,
      instanceId: this.instanceId,
    });
  }

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<T> {
    let url = `${this.baseUrl}${endpoint}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams(queryParams);
      url += `?${params.toString()}`;
    }

    logger.debug('UAZAPI request', { method, url });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'token': this.token,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();

    let jsonData: T;
    try {
      jsonData = JSON.parse(responseText) as T;
    } catch {
      if (!response.ok) {
        logger.error('UAZAPI error', {
          status: response.status,
          statusText: response.statusText,
          body: responseText,
        });
        throw new Error(`UAZAPI error: ${response.status} - ${responseText}`);
      }
      throw new Error(`Invalid JSON response: ${responseText}`);
    }

    if (!response.ok && response.status !== 409) {
      logger.error('UAZAPI error', {
        status: response.status,
        statusText: response.statusText,
        body: responseText,
      });
      throw new Error(`UAZAPI error: ${response.status} - ${responseText}`);
    }

    return jsonData;
  }

  async checkConnection(): Promise<UazapiConnectionStatus> {
    const result = await this.request<UazapiConnectionStatus>(
      '/instance/status',
      'GET',
      undefined,
      { instance: this.instanceId }
    );

    logger.info('Status da conexão UAZAPI', {
      status: result.instance?.status,
      connected: result.status?.connected,
      loggedIn: result.status?.loggedIn,
    });

    return result;
  }

  async isConnected(): Promise<boolean> {
    try {
      const status = await this.checkConnection();
      return status.status?.connected === true || status.instance?.status === 'connected';
    } catch (error) {
      logger.error('Erro ao verificar conexão UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  async getQRCode(): Promise<{ base64: string; pairingCode?: string }> {
    try {
      const result = await this.request<UazapiConnectResponse>(
        '/instance/connect',
        'POST',
        { instance: this.instanceId, paircode: true }
      );

      const qrcode = result.qrcode || result.instance?.qrcode || '';
      const paircode = result.paircode || result.instance?.paircode || '';

      logger.info('QR Code obtido', {
        hasQrCode: !!qrcode,
        hasPairCode: !!paircode,
      });

      return {
        base64: qrcode,
        pairingCode: paircode,
      };
    } catch (error) {
      logger.error('Erro ao obter QR Code UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async connect(): Promise<UazapiConnectResponse> {
    const qr = await this.getQRCode();
    return {
      qrcode: qr.base64,
      paircode: qr.pairingCode,
    };
  }

  private formatGroupJid(groupId: string): string {
    if (groupId.includes('@g.us')) {
      return groupId;
    }
    const cleaned = groupId.replace(/[^\d]/g, '');
    return `${cleaned}@g.us`;
  }

  // Enviar texto
  async sendText(
    groupId: string,
    message: string
  ): Promise<UazapiSendTextResponse> {
    const jid = this.formatGroupJid(groupId);

    const body = {
      number: jid,
      text: message,
    };

    logger.info('Enviando texto via UAZAPI', {
      groupId: jid,
      messageLength: message.length,
    });

    const response = await this.request<UazapiSendTextResponse>(
      '/send/text',
      'POST',
      body
    );

    logger.info('Texto enviado com sucesso via UAZAPI', {
      messageId: response.messageId || response.id,
      status: response.status,
    });

    return response;
  }

  // Enviar sticker (webp)
  async sendSticker(
    groupId: string,
    stickerBuffer: Buffer
  ): Promise<UazapiSendMediaResponse> {
    const jid = this.formatGroupJid(groupId);
    const base64Sticker = `data:image/webp;base64,${stickerBuffer.toString('base64')}`;

    const body = {
      number: jid,
      type: 'sticker',
      file: base64Sticker,
    };

    logger.info('Enviando sticker via UAZAPI', {
      groupId: jid,
      stickerSize: stickerBuffer.length,
    });

    const response = await this.request<UazapiSendMediaResponse>(
      '/send/media',
      'POST',
      body
    );

    logger.info('Sticker enviado com sucesso via UAZAPI', {
      messageId: response.messageId || response.id,
    });

    return response;
  }

  // Enviar texto para múltiplos grupos com delay
  async sendTextToGroups(
    groups: string[],
    message: string,
    delayBetweenGroups: number = 5000
  ): Promise<Map<string, UazapiSendTextResponse | Error>> {
    const results = new Map<string, UazapiSendTextResponse | Error>();

    for (let i = 0; i < groups.length; i++) {
      const groupId = groups[i];

      try {
        logger.info(`Enviando para grupo ${i + 1}/${groups.length}`, { groupId });
        const response = await this.sendText(groupId, message);
        results.set(groupId, response);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`Erro ao enviar para grupo ${groupId}`, {
          error: err.message,
        });
        results.set(groupId, err);
      }

      if (i < groups.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenGroups));
      }
    }

    const successful = [...results.values()].filter(r => !(r instanceof Error)).length;
    const failed = groups.length - successful;

    logger.info('Envio para grupos concluído', {
      total: groups.length,
      successful,
      failed,
    });

    return results;
  }

  // ========== GROUP METHODS WITH CACHE ==========

  private async fetchGroupsFromApi(force: boolean = false): Promise<UazapiGroup[]> {
    const queryParams: Record<string, string> = { instance: this.instanceId };
    if (force) {
      queryParams.force = 'true';
    }

    const result = await this.request<{ groups?: UazapiGroup[] }>(
      '/group/list',
      'GET',
      undefined,
      queryParams
    );

    const groups = result.groups || [];
    logger.info('Grupos obtidos via UAZAPI', { count: groups.length, force });
    return groups;
  }

  async fetchAllGroups(): Promise<UazapiGroup[]> {
    try {
      if (groupCache.isValid()) {
        const cached = groupCache.get();
        if (cached) {
          logger.debug('Retornando grupos do cache', { count: cached.length });
          return cached;
        }
      }

      const groups = await this.fetchGroupsFromApi();
      groupCache.set(groups);
      return groups;
    } catch (error) {
      logger.error('Erro ao listar grupos UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });

      const cached = groupCache.get();
      if (cached) {
        logger.warn('Usando cache expirado devido a erro na API');
        return cached;
      }

      throw error;
    }
  }

  async refreshGroups(): Promise<{ groups: UazapiGroup[]; lastSync: number }> {
    logger.info('Forçando refresh da lista de grupos (force=true)');
    const groups = await this.fetchGroupsFromApi(true);
    groupCache.set(groups);

    return {
      groups,
      lastSync: groupCache.getLastSync() || Date.now(),
    };
  }

  async getGroupsWithCacheInfo(): Promise<{
    groups: UazapiGroup[];
    lastSync: number | null;
    fromCache: boolean;
  }> {
    const fromCache = groupCache.isValid();
    const groups = await this.fetchAllGroups();

    return {
      groups,
      lastSync: groupCache.getLastSync(),
      fromCache,
    };
  }

  startGroupSync(): void {
    groupCache.startPeriodicSync(() => this.fetchGroupsFromApi());
  }

  stopGroupSync(): void {
    groupCache.stopPeriodicSync();
  }

  getGroupCacheStats(): { count: number; lastSync: number | null; isValid: boolean; isExpired: boolean } {
    return groupCache.getStats();
  }

  // ========== OTHER METHODS ==========

  async logout(): Promise<void> {
    try {
      await this.request(
        '/instance/disconnect',
        'POST',
        { instance: this.instanceId }
      );
      logger.info('Logout UAZAPI realizado');
      groupCache.clear();
    } catch (error) {
      logger.error('Erro ao fazer logout UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async restart(): Promise<void> {
    try {
      await this.request(
        '/instance/restart',
        'POST',
        { instance: this.instanceId }
      );
      logger.info('Instância UAZAPI reiniciada');
      groupCache.clear();
    } catch (error) {
      logger.error('Erro ao reiniciar instância UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  async deleteInstance(): Promise<void> {
    try {
      await this.request(
        '/instance/delete',
        'DELETE',
        { instance: this.instanceId }
      );
      logger.info('Instância UAZAPI deletada', { instanceId: this.instanceId });
      groupCache.clear();
    } catch (error) {
      logger.error('Erro ao deletar instância UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }
}

// ========== STATIC METHODS FOR ADMIN OPERATIONS ==========

export interface CreateInstanceResponse {
  instance: {
    id: string;
    token: string;
    name: string;
    status: string;
  };
  token: string;
  response: string;
}

export async function createInstance(
  baseUrl: string,
  adminToken: string,
  instanceName: string
): Promise<CreateInstanceResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/instance/create`;

  logger.info('Criando nova instância UAZAPI', { instanceName });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'admintoken': adminToken,
    },
    body: JSON.stringify({ Name: instanceName }),
  });

  const data = await response.json() as { message?: string; instance?: { id: string; name: string } };

  if (!response.ok && response.status !== 409) {
    throw new Error(data.message || `Erro ao criar instância: ${response.status}`);
  }

  logger.info('Instância criada com sucesso', {
    instanceId: data.instance?.id,
    instanceName: data.instance?.name,
  });

  return data as CreateInstanceResponse;
}

export async function deleteInstanceByAdmin(
  baseUrl: string,
  adminToken: string,
  instanceId: string
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/instance/delete`;

  logger.info('Deletando instância UAZAPI via admin', { instanceId });

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'admintoken': adminToken,
    },
    body: JSON.stringify({ instance: instanceId }),
  });

  if (!response.ok) {
    const data = await response.json() as { message?: string };
    throw new Error(data.message || `Erro ao deletar instância: ${response.status}`);
  }

  logger.info('Instância deletada com sucesso', { instanceId });
}
