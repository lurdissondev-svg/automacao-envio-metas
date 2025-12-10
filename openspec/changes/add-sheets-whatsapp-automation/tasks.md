# Tasks: Automação de Envio de Screenshots do Google Sheets para WhatsApp

## 1. Setup do Projeto
- [ ] 1.1 Inicializar projeto Node.js com TypeScript
- [ ] 1.2 Configurar ESLint e Prettier
- [ ] 1.3 Criar estrutura de diretórios (src/, config/, docker/)
- [ ] 1.4 Configurar tsconfig.json
- [ ] 1.5 Adicionar dependências principais (playwright, node-cron, axios, yaml)

## 2. Módulo de Configuração
- [ ] 2.1 Criar schema de validação para config.yaml
- [ ] 2.2 Implementar carregamento e parsing do arquivo de configuração
- [ ] 2.3 Criar arquivo config.example.yaml com exemplos documentados
- [ ] 2.4 Implementar validação de expressões cron
- [ ] 2.5 Adicionar suporte a variáveis de ambiente (.env)

## 3. Módulo de Captura de Screenshots
- [ ] 3.1 Implementar cliente Playwright com configurações otimizadas
- [ ] 3.2 Criar função de navegação para Google Sheets
- [ ] 3.3 Configurar auto-wait para carregamento completo da planilha
- [ ] 3.4 Adicionar suporte a viewport configurável
- [ ] 3.5 Implementar captura de região específica (seletor CSS ou locator)
- [ ] 3.6 Adicionar tratamento de erros e timeout

## 4. Módulo de Integração com Evolution API v2
- [ ] 4.1 Criar cliente HTTP para Evolution API
- [ ] 4.2 Implementar verificação de conexão da instância
- [ ] 4.3 Implementar envio de mídia (imagem) com caption
- [ ] 4.4 Adicionar tratamento de erros da API
- [ ] 4.5 Implementar rate limiting entre envios
- [ ] 4.6 Criar tipagens TypeScript para a API

## 5. Módulo de Templates de Mensagem
- [ ] 5.1 Implementar parser de templates com placeholders
- [ ] 5.2 Criar funções para cada variável disponível (date, time, week, etc.)
- [ ] 5.3 Adicionar suporte a formatação de data/hora em português

## 6. Módulo de Agendamento
- [ ] 6.1 Implementar scheduler com node-cron
- [ ] 6.2 Criar lógica de execução de jobs
- [ ] 6.3 Implementar suporte a timezone
- [ ] 6.4 Adicionar logs de próximas execuções
- [ ] 6.5 Implementar graceful shutdown

## 7. Módulo de Logging
- [ ] 7.1 Configurar logger (winston ou pino)
- [ ] 7.2 Implementar rotação de logs
- [ ] 7.3 Adicionar níveis de log configuráveis
- [ ] 7.4 Criar formato estruturado para logs

## 8. Script Principal e Entry Point
- [ ] 8.1 Criar index.ts com inicialização do sistema
- [ ] 8.2 Implementar validação de pré-requisitos no startup
- [ ] 8.3 Integrar todos os módulos
- [ ] 8.4 Adicionar health check endpoint (opcional)

## 9. Docker e Deploy
- [ ] 9.1 Criar Dockerfile leve (Node.js sem browser embutido)
- [ ] 9.2 Criar serviço para integrar ao docker-compose existente da VPS
- [ ] 9.3 Configurar montagem do Chrome do host no container
- [ ] 9.4 Configurar volumes para persistência de configuração e logs
- [ ] 9.5 Criar .env.example com variáveis necessárias (incluindo CHROME_PATH)
- [ ] 9.6 Documentar processo de deploy e integração no README

## 10. Documentação
- [ ] 10.1 Criar README.md com instruções de instalação
- [ ] 10.2 Documentar formato do arquivo de configuração
- [ ] 10.3 Adicionar exemplos de expressões cron comuns
- [ ] 10.4 Criar guia de troubleshooting

## 11. Testes e Validação
- [ ] 11.1 Testar captura de screenshot localmente
- [ ] 11.2 Testar envio via Evolution API
- [ ] 11.3 Validar funcionamento do scheduler
- [ ] 11.4 Testar deploy completo em VPS

## Dependências entre tarefas

```
1.x (Setup) → 2.x (Config) → 6.x (Scheduling)
              ↓
            3.x (Screenshot) → 8.x (Main)
              ↓
            4.x (Evolution) → 8.x (Main)
              ↓
            5.x (Templates) → 4.x (Evolution)

7.x (Logging) pode ser paralelizado com 3.x, 4.x, 5.x

9.x (Docker) depende de 8.x (Main)
10.x (Docs) pode ser feito em paralelo
11.x (Testes) depende de tudo anterior
```

## Notas de Implementação

### Dockerfile Leve (sem browser)
Container leve que usa Chrome do host:
```dockerfile
FROM node:20-slim

# Apenas dependências mínimas para Playwright conectar ao Chrome externo
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
```

### Integração ao docker-compose existente
Adicionar este serviço ao `docker-compose.yml` da VPS:
```yaml
services:
  # ... outros serviços existentes ...

  sheets-whatsapp:
    build: ./automacao-envio-metas
    container_name: sheets-whatsapp-automation
    restart: unless-stopped
    environment:
      - CHROME_PATH=/usr/bin/google-chrome
      - EVOLUTION_API_URL=http://evolution-api:8080
      - TZ=America/Sao_Paulo
    volumes:
      # Chrome do host
      - /usr/bin/google-chrome:/usr/bin/google-chrome:ro
      - /usr/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu:ro
      # Configuração e logs
      - ./automacao-envio-metas/config:/app/config
      - ./automacao-envio-metas/logs:/app/logs
    networks:
      - default  # mesma rede dos outros serviços
    depends_on:
      - evolution-api  # se Evolution API estiver no mesmo compose
```

### Exemplo de Screenshot com Chrome do Host
```typescript
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ]
});

const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 }
});

await page.goto(sheetUrl);
await page.waitForLoadState('networkidle');

const screenshot = await page.screenshot({ type: 'png' });
await browser.close();
```

### Variáveis de Ambiente (.env)
```env
# Chrome
CHROME_PATH=/usr/bin/google-chrome

# Evolution API (usar nome do serviço no docker-compose)
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=sua-api-key
EVOLUTION_INSTANCE=sua-instancia

# Timezone
TZ=America/Sao_Paulo
```

### Evolution API v2
Endpoint principal para envio de mídia:
```
POST /message/sendMedia/{instance}
Headers:
  - apikey: {api_key}
Body:
  - number: "grupo@g.us"
  - mediatype: "image"
  - caption: "mensagem"
  - media: "base64"
```
