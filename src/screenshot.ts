import { chromium, Browser, Page } from 'playwright';
import { logger } from './logger.js';
import type { ViewportConfig, BrowserConfig } from './types.js';

let browser: Browser | null = null;

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
  if (browser) {
    await browser.close();
    browser = null;
    logger.info('Browser fechado');
  }
}

// Capturar screenshot de uma URL do Google Sheets
export async function captureScreenshot(
  url: string,
  viewport: ViewportConfig,
  selector?: string,
  waitAfterLoad: number = 2000
): Promise<Buffer> {
  if (!browser) {
    throw new Error('Browser não inicializado. Chame initBrowser() primeiro.');
  }

  logger.info('Capturando screenshot', { url, viewport, selector });

  const page: Page = await browser.newPage();

  try {
    // Configurar viewport
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    // Navegar para a página
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

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
  maxRetries: number = 3
): Promise<Buffer> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Tentativa ${attempt}/${maxRetries} de captura`);
      return await captureScreenshot(url, viewport, selector, waitAfterLoad);
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
