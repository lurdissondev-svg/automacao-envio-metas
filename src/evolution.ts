import { logger } from './logger.js';
import type {
  EvolutionConfig,
  EvolutionConnectionState,
  EvolutionSendMediaPayload,
  EvolutionSendMediaResponse,
} from './types.js';

// Cliente para Evolution API v2
export class EvolutionClient {
  private baseUrl: string;
  private apiKey: string;
  private instanceName: string;

  constructor(config: EvolutionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remover barra final
    this.apiKey = config.apiKey;
    this.instanceName = config.instanceName;

    logger.info('Evolution Client inicializado', {
      baseUrl: this.baseUrl,
      instanceName: this.instanceName,
    });
  }

  // Fazer requisição à API
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    logger.debug('Evolution API request', { method, url });

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Evolution API error', {
        status: response.status,
        statusText: response.statusText,
        body: errorText,
      });
      throw new Error(`Evolution API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  // Verificar estado da conexão
  async checkConnection(): Promise<EvolutionConnectionState> {
    const result = await this.request<{ instance: EvolutionConnectionState }>(
      `/instance/connectionState/${this.instanceName}`
    );

    logger.info('Estado da conexão', { state: result.instance.state });
    return result.instance;
  }

  // Verificar se está conectado
  async isConnected(): Promise<boolean> {
    try {
      const state = await this.checkConnection();
      return state.state === 'open';
    } catch (error) {
      logger.error('Erro ao verificar conexão', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
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

  // Enviar imagem para um grupo
  async sendImage(
    groupId: string,
    imageBuffer: Buffer,
    caption: string
  ): Promise<EvolutionSendMediaResponse> {
    const jid = this.formatGroupJid(groupId);
    const base64Image = imageBuffer.toString('base64');

    const payload: EvolutionSendMediaPayload = {
      number: jid,
      mediatype: 'image',
      mimetype: 'image/png',
      caption,
      media: base64Image,
    };

    logger.info('Enviando imagem', {
      groupId: jid,
      captionLength: caption.length,
      imageSize: imageBuffer.length,
    });

    const response = await this.request<EvolutionSendMediaResponse>(
      `/message/sendMedia/${this.instanceName}`,
      'POST',
      payload
    );

    logger.info('Imagem enviada com sucesso', {
      messageId: response.key?.id,
      remoteJid: response.key?.remoteJid,
    });

    return response;
  }

  // Enviar imagem para múltiplos grupos com delay
  async sendImageToGroups(
    groups: string[],
    imageBuffer: Buffer,
    caption: string,
    delayBetweenGroups: number = 5000
  ): Promise<Map<string, EvolutionSendMediaResponse | Error>> {
    const results = new Map<string, EvolutionSendMediaResponse | Error>();

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
}
