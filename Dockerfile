# ===========================================
# Dockerfile - Container Leve (sem browser embutido)
# ===========================================
# Este container usa o Chrome instalado no host da VPS
# montado via volume no docker-compose

FROM node:20-slim

# Dependências mínimas para Playwright conectar ao Chrome externo
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Bibliotecas necessárias para o Chrome
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
    libpango-1.0-0 \
    libcairo2 \
    # Utilitários
    ca-certificates \
    fonts-liberation \
    # Limpeza
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências primeiro (cache de layers)
COPY package*.json ./

# Instalar dependências (sem devDependencies)
RUN npm ci --omit=dev

# Copiar código fonte
COPY . .

# Build do TypeScript
RUN npm run build

# Criar diretório de logs
RUN mkdir -p /app/logs && chmod 755 /app/logs

# Usuário não-root (opcional, pode causar problemas com Chrome)
# USER node

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('OK')" || exit 1

# Comando padrão
CMD ["node", "dist/index.js"]
