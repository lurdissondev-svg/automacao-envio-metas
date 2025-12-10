import { chromium, Browser, Page } from 'playwright';
import { logger } from './logger.js';
import type { ViewportConfig, BrowserConfig, ClipConfig } from './types.js';

let browser: Browser | null = null;

// ========== PAGE POOL ==========
// Pool de páginas para reutilização entre capturas

interface PooledPage {
  page: Page;
  baseUrl: string;
  lastUsed: number;
}

class PagePool {
  private pages: Map<string, PooledPage> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly PAGE_TIMEOUT = 5 * 60 * 1000; // 5 minutos
  private readonly MAX_PARALLEL = 5;

  constructor() {
    // Iniciar limpeza automática de páginas inativas
    this.startCleanup();
  }

  // Extrair URL base (planilha sem gid específico)
  private getBaseUrl(url: string): string {
    const match = url.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+/);
    return match ? match[0] : url;
  }

  // Obter ou criar página para URL
  async getPage(url: string, viewport: ViewportConfig): Promise<Page> {
    if (!browser) {
      throw new Error('Browser não inicializado');
    }

    const baseUrl = this.getBaseUrl(url);
    const pooled = this.pages.get(baseUrl);

    if (pooled) {
      pooled.lastUsed = Date.now();
      logger.debug('Reutilizando página do pool', { baseUrl });

      // Navegar para a URL específica (pode ter gid diferente)
      // Usando 'load' ao invés de 'networkidle' porque Google Sheets nunca fica "idle"
      if (pooled.page.url() !== url) {
        await pooled.page.goto(url, { waitUntil: 'load', timeout: 30000 });
      } else {
        // Mesmo URL, só recarregar para dados atualizados
        await pooled.page.reload({ waitUntil: 'load', timeout: 30000 });
      }

      return pooled.page;
    }

    // Criar nova página
    logger.debug('Criando nova página para pool', { baseUrl });
    const page = await browser.newPage();

    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    // Usando 'load' ao invés de 'networkidle' porque Google Sheets nunca fica "idle"
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });

    this.pages.set(baseUrl, {
      page,
      baseUrl,
      lastUsed: Date.now(),
    });

    return page;
  }

  // Limpar páginas inativas
  private async cleanupInactive(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [key, pooled] of this.pages) {
      if (now - pooled.lastUsed > this.PAGE_TIMEOUT) {
        toRemove.push(key);
      }
    }

    for (const key of toRemove) {
      const pooled = this.pages.get(key);
      if (pooled) {
        logger.debug('Removendo página inativa do pool', { baseUrl: key });
        await pooled.page.close().catch(() => {});
        this.pages.delete(key);
      }
    }
  }

  // Iniciar limpeza periódica
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactive().catch(err => {
        logger.error('Erro na limpeza de páginas', { error: err });
      });
    }, 60000); // Verificar a cada minuto
  }

  // Fechar todas as páginas
  async closeAll(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [, pooled] of this.pages) {
      await pooled.page.close().catch(() => {});
    }
    this.pages.clear();
    logger.debug('Pool de páginas limpo');
  }

  // Obter estatísticas do pool
  getStats(): { count: number; urls: string[] } {
    return {
      count: this.pages.size,
      urls: Array.from(this.pages.keys()),
    };
  }

  // Limite de capturas paralelas
  getMaxParallel(): number {
    return this.MAX_PARALLEL;
  }
}

// Instância global do pool
const pagePool = new PagePool();

// ========== BROWSER FUNCTIONS ==========

// Obter caminho do Chrome
function getChromePath(): string | undefined {
  // Prioridade: variável de ambiente > padrões do sistema
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  // Caminhos comuns no Linux
  const commonPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  // Verificar existência (em runtime)
  for (const path of commonPaths) {
    try {
      const fs = require('fs');
      if (fs.existsSync(path)) {
        return path;
      }
    } catch {
      continue;
    }
  }

  return undefined; // Usar Chromium bundled do Playwright
}

// Inicializar browser
export async function initBrowser(config: BrowserConfig): Promise<Browser> {
  if (browser) {
    return browser;
  }

  const chromePath = getChromePath();

  logger.info('Iniciando browser', {
    headless: config.headless,
    chromePath: chromePath || 'bundled',
  });

  browser = await chromium.launch({
    headless: config.headless,
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });

  logger.info('Browser iniciado com sucesso');
  return browser;
}

// Fechar browser
export async function closeBrowser(): Promise<void> {
  // Fechar pool de páginas primeiro
  await pagePool.closeAll();

  if (browser) {
    await browser.close();
    browser = null;
    logger.info('Browser fechado');
  }
}

// ========== SCREENSHOT FUNCTIONS ==========

// Capturar screenshot de uma URL do Google Sheets (versão otimizada com pool)
export async function captureScreenshot(
  url: string,
  viewport: ViewportConfig,
  selector?: string,
  waitAfterLoad: number = 2000,
  clip?: ClipConfig
): Promise<Buffer> {
  if (!browser) {
    throw new Error('Browser não inicializado. Chame initBrowser() primeiro.');
  }

  logger.info('Capturando screenshot', { url, viewport, selector, clip });

  // Usar pool para reutilizar páginas
  const page = await pagePool.getPage(url, viewport);

  try {
    // Aguardar tempo adicional para renderização completa
    await page.waitForTimeout(waitAfterLoad);

    let screenshot: Buffer;

    if (selector) {
      // Capturar apenas o elemento selecionado
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Elemento não encontrado: ${selector}`);
      }
      screenshot = await element.screenshot({
        type: 'png',
      });
      logger.info('Screenshot do elemento capturado', { selector });
    } else if (clip) {
      // Capturar região específica (recorte)
      screenshot = await page.screenshot({
        type: 'png',
        clip: {
          x: clip.x,
          y: clip.y,
          width: clip.width,
          height: clip.height,
        },
      });
      logger.info('Screenshot com recorte capturado', { clip });
    } else {
      // Capturar página completa visível
      screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
      });
      logger.info('Screenshot da página capturado');
    }

    return screenshot;
  } catch (error) {
    logger.error('Erro ao capturar screenshot', {
      error: error instanceof Error ? error.message : error,
      url,
    });
    throw error;
  }
  // Não fechamos a página - ela fica no pool para reutilização
}

// Capturar screenshot sem pool (cria página nova e fecha)
export async function captureScreenshotFresh(
  url: string,
  viewport: ViewportConfig,
  selector?: string,
  waitAfterLoad: number = 2000
): Promise<Buffer> {
  if (!browser) {
    throw new Error('Browser não inicializado. Chame initBrowser() primeiro.');
  }

  logger.info('Capturando screenshot (fresh)', { url, viewport, selector });

  const page: Page = await browser.newPage();

  try {
    // Configurar viewport
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    // Navegar para a página
    // Usando 'load' ao invés de 'networkidle' porque Google Sheets nunca fica "idle"
    await page.goto(url, {
      waitUntil: 'load',
      timeout: 30000,
    });

    // Aguardar tempo adicional para renderização completa
    await page.waitForTimeout(waitAfterLoad);

    let screenshot: Buffer;

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Elemento não encontrado: ${selector}`);
      }
      screenshot = await element.screenshot({ type: 'png' });
      logger.info('Screenshot do elemento capturado', { selector });
    } else {
      screenshot = await page.screenshot({ type: 'png', fullPage: false });
      logger.info('Screenshot da página capturado');
    }

    return screenshot;
  } catch (error) {
    logger.error('Erro ao capturar screenshot', {
      error: error instanceof Error ? error.message : error,
      url,
    });
    throw error;
  } finally {
    await page.close();
  }
}

// Capturar screenshot com retry
export async function captureScreenshotWithRetry(
  url: string,
  viewport: ViewportConfig,
  selector?: string,
  waitAfterLoad: number = 2000,
  maxRetries: number = 3,
  clip?: ClipConfig
): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Tentativa ${attempt}/${maxRetries} de captura`);
      return await captureScreenshot(url, viewport, selector, waitAfterLoad, clip);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`Tentativa ${attempt} falhou`, { error: lastError.message });

      if (attempt < maxRetries) {
        // Aguardar antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  throw lastError || new Error('Falha ao capturar screenshot após todas as tentativas');
}

// ========== PARALLEL CAPTURE ==========

interface ParallelCaptureTask {
  url: string;
  id: string; // Identificador (ex: groupId)
}

interface ParallelCaptureResult {
  id: string;
  screenshot?: Buffer;
  error?: string;
}

// Capturar múltiplos screenshots em paralelo
export async function captureScreenshotsParallel(
  tasks: ParallelCaptureTask[],
  viewport: ViewportConfig,
  selector?: string,
  waitAfterLoad: number = 2000,
  clip?: ClipConfig
): Promise<ParallelCaptureResult[]> {
  if (!browser) {
    throw new Error('Browser não inicializado. Chame initBrowser() primeiro.');
  }

  const maxParallel = pagePool.getMaxParallel();
  const results: ParallelCaptureResult[] = [];

  logger.info(`Iniciando captura paralela de ${tasks.length} screenshots (max ${maxParallel} simultâneos)`);

  // Processar em lotes para respeitar limite de paralelo
  for (let i = 0; i < tasks.length; i += maxParallel) {
    const batch = tasks.slice(i, i + maxParallel);

    const batchPromises = batch.map(async (task) => {
      try {
        const screenshot = await captureScreenshot(task.url, viewport, selector, waitAfterLoad, clip);
        return { id: task.id, screenshot };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Erro ao capturar screenshot para ${task.id}`, { error: errorMsg });
        return { id: task.id, error: errorMsg };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    logger.debug(`Lote ${Math.floor(i / maxParallel) + 1} concluído`, {
      processed: Math.min(i + maxParallel, tasks.length),
      total: tasks.length
    });
  }

  const successful = results.filter(r => r.screenshot).length;
  const failed = results.filter(r => r.error).length;

  logger.info('Captura paralela concluída', { total: tasks.length, successful, failed });

  return results;
}

// ========== POOL STATS ==========

// Obter estatísticas do pool de páginas
export function getPagePoolStats(): { count: number; urls: string[] } {
  return pagePool.getStats();
}
