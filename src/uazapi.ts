import { logger } from './logger.js';
import type {
  UazapiConfig,
  UazapiConnectionStatus,
  UazapiConnectResponse,
  UazapiSendMediaResponse,
  UazapiGroup,
} from './types.js';

// ========== GROUP CACHE ==========
// Cache de grupos com sincronização automática

interface GroupCacheData {
  groups: UazapiGroup[];
  lastSync: number;
}

class GroupCache {
  private cache: GroupCacheData | null = null;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos
  private readonly CACHE_MAX_AGE = 10 * 60 * 1000; // 10 minutos - força refresh
  private readonly SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutos

  // Verificar se cache é válido
  isValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.lastSync < this.CACHE_TTL;
  }

  // Verificar se cache expirou completamente
  isExpired(): boolean {
    if (!this.cache) return true;
    return Date.now() - this.cache.lastSync > this.CACHE_MAX_AGE;
  }

  // Obter grupos do cache
  get(): UazapiGroup[] | null {
    if (!this.cache) return null;
    return this.cache.groups;
  }

  // Atualizar cache
  set(groups: UazapiGroup[]): void {
    this.cache = {
      groups,
      lastSync: Date.now(),
    };
    logger.debug('Cache de grupos atualizado', { count: groups.length });
  }

  // Obter timestamp da última sincronização
  getLastSync(): number | null {
    return this.cache?.lastSync || null;
  }

  // Limpar cache
  clear(): void {
    this.cache = null;
    logger.debug('Cache de grupos limpo');
  }

  // Iniciar sincronização periódica
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

  // Parar sincronização periódica
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.debug('Sincronização periódica de grupos parada');
    }
  }

  // Obter estatísticas do cache
  getStats(): { count: number; lastSync: number | null; isValid: boolean; isExpired: boolean } {
    return {
      count: this.cache?.groups.length || 0,
      lastSync: this.cache?.lastSync || null,
      isValid: this.isValid(),
      isExpired: this.isExpired(),
    };
  }
}

// Instância global do cache de grupos
const groupCache = new GroupCache();

// ========== UAZAPI CLIENT ==========

// Cliente para UAZAPI (sem prefixo de versão na URL)
export class UazapiClient {
  private baseUrl: string;
  private token: string;
  private instanceId: string;
  private adminToken?: string;

  constructor(config: UazapiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remover barra final
    this.token = config.token;
    this.instanceId = config.instanceId;
    this.adminToken = config.adminToken;

    logger.info('UAZAPI Client inicializado', {
      baseUrl: this.baseUrl,
      instanceId: this.instanceId,
    });
  }

  // Fazer requisição à API v1
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<T> {
    // Construir URL com query params
    let url = `${this.baseUrl}${endpoint}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams(queryParams);
      url += `?${params.toString()}`;
    }

    logger.debug('UAZAPI request', { method, url });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'token': this.token,  // UAZAPI usa header 'token' (não Bearer)
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseText = await response.text();

    // Tentar parsear como JSON mesmo em caso de erro (UAZAPI retorna dados úteis em erros)
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

    // Para alguns endpoints, erro 409 ainda retorna dados úteis (como QR Code)
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

  // Verificar status da conexão
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

  // Verificar se está conectado
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

  // Obter QR Code (usa POST /instance/connect)
  async getQRCode(): Promise<{ base64: string; pairingCode?: string }> {
    try {
      const result = await this.request<UazapiConnectResponse>(
        '/instance/connect',
        'POST',
        { instance: this.instanceId }
      );

      // QR Code pode estar em result.qrcode ou result.instance.qrcode
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

  // Conectar (alias para getQRCode para compatibilidade)
  async connect(): Promise<UazapiConnectResponse> {
    const qr = await this.getQRCode();
    return {
      qrcode: qr.base64,
      paircode: qr.pairingCode,
    };
  }

  // Formatar número do grupo para JID
  private formatGroupJid(groupId: string): string {
    // Se já é um JID completo, retornar
    if (groupId.includes('@g.us')) {
      return groupId;
    }

    // Remover caracteres especiais e adicionar sufixo
    const cleaned = groupId.replace(/[^\d]/g, '');
    return `${cleaned}@g.us`;
  }

  // Enviar imagem (usando endpoint /send/media conforme documentação UAZAPI v2)
  async sendImage(
    groupId: string,
    imageBuffer: Buffer,
    caption: string
  ): Promise<UazapiSendMediaResponse> {
    const jid = this.formatGroupJid(groupId);
    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    // Formato conforme documentação: https://docs.uazapi.com/endpoint/post/send~media
    const body = {
      number: jid,
      type: 'image',
      file: base64Image,
      text: caption,  // 'text' é usado como caption na API v2
    };

    logger.info('Enviando imagem via UAZAPI', {
      groupId: jid,
      captionLength: caption.length,
      imageSize: imageBuffer.length,
    });

    const response = await this.request<UazapiSendMediaResponse>(
      '/send/media',
      'POST',
      body
    );

    logger.info('Imagem enviada com sucesso via UAZAPI', {
      messageId: response.messageId || response.id,
      status: response.status,
    });

    return response;
  }

  // Enviar imagem para múltiplos grupos com delay
  async sendImageToGroups(
    groups: string[],
    imageBuffer: Buffer,
    caption: string,
    delayBetweenGroups: number = 5000
  ): Promise<Map<string, UazapiSendMediaResponse | Error>> {
    const results = new Map<string, UazapiSendMediaResponse | Error>();

    for (let i = 0; i < groups.length; i++) {
      const groupId = groups[i];

      try {
        logger.info(`Enviando para grupo ${i + 1}/${groups.length}`, { groupId });
        const response = await this.sendImage(groupId, imageBuffer, caption);
        results.set(groupId, response);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`Erro ao enviar para grupo ${groupId}`, {
          error: err.message,
        });
        results.set(groupId, err);
      }

      // Aguardar entre envios (exceto no último)
      if (i < groups.length - 1) {
        logger.debug(`Aguardando ${delayBetweenGroups}ms antes do próximo envio`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenGroups));
      }
    }

    // Log resumo
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

  // Buscar grupos da API (sem cache)
  private async fetchGroupsFromApi(force: boolean = false): Promise<UazapiGroup[]> {
    // Usando endpoint /group/list com parâmetro force para atualizar cache do WhatsApp
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

  // Listar todos os grupos do WhatsApp (com cache)
  async fetchAllGroups(): Promise<UazapiGroup[]> {
    try {
      // Se cache válido, retornar do cache
      if (groupCache.isValid()) {
        const cached = groupCache.get();
        if (cached) {
          logger.debug('Retornando grupos do cache', { count: cached.length });
          return cached;
        }
      }

      // Se cache expirou completamente ou não existe, buscar da API
      const groups = await this.fetchGroupsFromApi();
      groupCache.set(groups);
      return groups;
    } catch (error) {
      logger.error('Erro ao listar grupos UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });

      // Se houver erro mas temos cache (mesmo expirado), usar ele
      const cached = groupCache.get();
      if (cached) {
        logger.warn('Usando cache expirado devido a erro na API');
        return cached;
      }

      throw error;
    }
  }

  // Forçar refresh da lista de grupos (ignora cache local e força atualização no WhatsApp)
  async refreshGroups(): Promise<{ groups: UazapiGroup[]; lastSync: number }> {
    logger.info('Forçando refresh da lista de grupos (force=true)');

    // Usar force=true para buscar dados atualizados diretamente do WhatsApp
    const groups = await this.fetchGroupsFromApi(true);
    groupCache.set(groups);

    return {
      groups,
      lastSync: groupCache.getLastSync() || Date.now(),
    };
  }

  // Obter grupos com informações de cache
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

  // Iniciar sincronização automática de grupos
  startGroupSync(): void {
    groupCache.startPeriodicSync(() => this.fetchGroupsFromApi());
  }

  // Parar sincronização automática de grupos
  stopGroupSync(): void {
    groupCache.stopPeriodicSync();
  }

  // Obter estatísticas do cache de grupos
  getGroupCacheStats(): { count: number; lastSync: number | null; isValid: boolean; isExpired: boolean } {
    return groupCache.getStats();
  }

  // ========== OTHER METHODS ==========

  // Desconectar instância (logout)
  async logout(): Promise<void> {
    try {
      await this.request(
        '/instance/logout',
        'POST',
        { instance: this.instanceId }
      );
      logger.info('Logout UAZAPI realizado');

      // Limpar cache ao deslogar
      groupCache.clear();
    } catch (error) {
      logger.error('Erro ao fazer logout UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // Reiniciar instância
  async restart(): Promise<void> {
    try {
      await this.request(
        '/instance/restart',
        'POST',
        { instance: this.instanceId }
      );
      logger.info('Instância UAZAPI reiniciada');

      // Limpar cache ao reiniciar
      groupCache.clear();
    } catch (error) {
      logger.error('Erro ao reiniciar instância UAZAPI', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  // Deletar instância
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

export async function listInstances(
  baseUrl: string,
  adminToken: string
): Promise<Array<{ id: string; name: string; status: string; token: string }>> {
  // UAZAPI não tem endpoint oficial de listar todas as instâncias
  // Retornamos array vazio - a instância atual vem da configuração
  logger.info('Listando instâncias não suportado pela UAZAPI');
  return [];
}
