FROM node:20-slim

# Instalar dependencias do Playwright/Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependencias
RUN npm ci

# Instalar Playwright browsers
RUN npx playwright install chromium

# Copiar codigo fonte
COPY . .

# Compilar TypeScript
RUN npm run build

# Criar diretorios necessarios
RUN mkdir -p logs config

# Expor porta
EXPOSE 3333

# Comando de inicio (usa o server compilado)
CMD ["npm", "run", "start:server"]
