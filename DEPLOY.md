# Deploy - Automacao de Envio de Metas

Guia completo para fazer deploy do projeto na sua VPS usando Docker.

---

## Pre-requisitos na VPS

Sua VPS precisa ter instalado:
- **Docker** (versao 20+)
- **Docker Compose** (versao 2+)
- **Git** (opcional, para clonar)

### Instalar Docker na VPS (Ubuntu/Debian)

```bash
# Atualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Adicionar seu usuario ao grupo docker
sudo usermod -aG docker $USER

# Instalar Docker Compose
sudo apt install docker-compose-plugin -y

# Verificar instalacao
docker --version
docker compose version
```

---

## Opcao 1: Copiar via SCP (Recomendado)

### 1. No seu computador local, compacte o projeto:

```bash
cd /home/lucas/DEV
tar -czvf automacao-metas.tar.gz automacao-envio-metas \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='logs/*.log'
```

### 2. Envie para a VPS:

```bash
# Substitua pelo IP e usuario da sua VPS
scp automacao-metas.tar.gz usuario@IP_DA_VPS:/home/usuario/
```

### 3. Na VPS, extraia o projeto:

```bash
ssh usuario@IP_DA_VPS

# Extrair
cd /home/usuario
tar -xzvf automacao-metas.tar.gz

# Entrar na pasta
cd automacao-envio-metas
```

---

## Opcao 2: Copiar via Git

### 1. Suba o projeto para um repositorio Git (GitHub, GitLab, etc)

### 2. Na VPS, clone o repositorio:

```bash
ssh usuario@IP_DA_VPS
cd /home/usuario
git clone https://github.com/SEU_USUARIO/automacao-envio-metas.git
cd automacao-envio-metas
```

---

## Opcao 3: Copiar via rsync

```bash
# Do seu computador local
rsync -avz --progress \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'logs/*.log' \
    /home/lucas/DEV/automacao-envio-metas/ \
    usuario@IP_DA_VPS:/home/usuario/automacao-envio-metas/
```

---

## Configurar e Iniciar na VPS

### 1. Verificar/editar configuracao

```bash
cd /home/usuario/automacao-envio-metas

# Verificar se config existe
cat config/config.yaml

# Editar se necessario (ajustar tokens, grupos, etc)
nano config/config.yaml
```

### 2. Construir e iniciar com Docker Compose

```bash
# Construir a imagem (primeira vez ou apos mudancas no codigo)
docker compose build

# Iniciar em background
docker compose up -d

# Ver logs
docker compose logs -f

# Verificar se esta rodando
docker compose ps
```

### 3. Acessar a interface web

Acesse no navegador:
```
http://IP_DA_VPS:3333
```

---

## Comandos Uteis

### Gerenciamento do Container

```bash
# Ver status
docker compose ps

# Ver logs em tempo real
docker compose logs -f

# Ver logs das ultimas 100 linhas
docker compose logs --tail=100

# Parar
docker compose stop

# Iniciar
docker compose start

# Reiniciar
docker compose restart

# Parar e remover container
docker compose down

# Rebuild apos mudancas no codigo
docker compose build --no-cache
docker compose up -d
```

### Acessar o container

```bash
# Entrar no shell do container
docker compose exec automacao-metas sh

# Ver processos dentro do container
docker compose exec automacao-metas ps aux
```

### Atualizar o projeto

```bash
cd /home/usuario/automacao-envio-metas

# Parar container
docker compose down

# Atualizar arquivos (via git pull ou scp)
git pull  # se estiver usando git

# Rebuild e iniciar
docker compose build
docker compose up -d
```

---

## Configurar como Servico (Auto-start)

O Docker Compose com `restart: unless-stopped` ja garante que o container reinicie automaticamente apos reboot da VPS.

Para garantir que o Docker inicie no boot:

```bash
sudo systemctl enable docker
```

---

## Configurar Nginx como Proxy (Opcional)

Se quiser acessar via dominio com HTTPS:

### 1. Instalar Nginx

```bash
sudo apt install nginx -y
```

### 2. Criar configuracao

```bash
sudo nano /etc/nginx/sites-available/automacao-metas
```

Conteudo:
```nginx
server {
    listen 80;
    server_name metas.seudominio.com;

    location / {
        proxy_pass http://localhost:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Ativar e reiniciar

```bash
sudo ln -s /etc/nginx/sites-available/automacao-metas /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 4. Adicionar SSL com Certbot

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d metas.seudominio.com
```

---

## Firewall

Se sua VPS tiver firewall ativo, libere a porta 3333:

```bash
# UFW (Ubuntu)
sudo ufw allow 3333/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Ou se usar apenas Nginx
sudo ufw allow 'Nginx Full'
```

---

## Troubleshooting

### Container nao inicia
```bash
# Ver logs de erro
docker compose logs

# Verificar se porta esta em uso
sudo lsof -i :3333
```

### Chromium nao funciona
```bash
# Verificar se shm_size esta configurado no docker-compose.yml
# Deve ter: shm_size: '2gb'

# Verificar memoria disponivel
free -h
```

### Erro de permissao nos volumes
```bash
# Dar permissao nas pastas
sudo chown -R $USER:$USER config logs
chmod -R 755 config logs
```

### WhatsApp desconecta
- Acesse a interface web e reconecte escaneando o QR code
- O estado de sessao e mantido no config/

---

## Estrutura de Arquivos na VPS

```
/home/usuario/automacao-envio-metas/
├── config/
│   └── config.yaml      # Configuracoes (tokens, schedules)
├── logs/
│   └── app.log          # Logs da aplicacao
├── public/
│   └── index.html       # Interface web
├── src/                  # Codigo fonte
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Backup

### Fazer backup da configuracao

```bash
# Na VPS
cp config/config.yaml config/config.yaml.backup

# Ou baixar para seu computador
scp usuario@IP_DA_VPS:/home/usuario/automacao-envio-metas/config/config.yaml ./backup/
```

---

## Resumo Rapido

```bash
# 1. No seu PC - Compactar
cd /home/lucas/DEV
tar -czvf automacao-metas.tar.gz automacao-envio-metas --exclude='node_modules' --exclude='.git'

# 2. Enviar para VPS
scp automacao-metas.tar.gz usuario@IP_DA_VPS:~/

# 3. Na VPS - Extrair e iniciar
ssh usuario@IP_DA_VPS
tar -xzvf automacao-metas.tar.gz
cd automacao-envio-metas
docker compose build
docker compose up -d

# 4. Acessar
# http://IP_DA_VPS:3333
```
