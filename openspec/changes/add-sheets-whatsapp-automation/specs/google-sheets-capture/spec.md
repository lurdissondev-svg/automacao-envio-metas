# Google Sheets Capture

## ADDED Requirements

### Requirement: Screenshot Capture
O sistema SHALL capturar screenshots de planilhas Google Sheets via URL fornecida na configuração.

#### Scenario: Captura de screenshot com sucesso
- **WHEN** uma URL válida de Google Sheets é fornecida
- **AND** a planilha está acessível (pública ou autenticada)
- **THEN** o sistema captura um screenshot da planilha em formato PNG
- **AND** o screenshot inclui toda a área visível ou a região configurada

#### Scenario: Falha no carregamento da planilha
- **WHEN** a URL do Google Sheets não está acessível
- **OR** o tempo de carregamento excede o timeout configurado
- **THEN** o sistema registra o erro nos logs
- **AND** não envia mensagem para os grupos

### Requirement: Viewport Configuration
O sistema SHALL permitir configuração do viewport para captura de screenshots.

#### Scenario: Configuração de dimensões do viewport
- **WHEN** dimensões de viewport são especificadas na configuração
- **THEN** o Playwright usa essas dimensões para renderizar a página
- **AND** o screenshot reflete as dimensões configuradas

#### Scenario: Viewport padrão
- **WHEN** nenhuma dimensão de viewport é especificada
- **THEN** o sistema usa dimensões padrão de 1920x1080

### Requirement: Region Selection
O sistema SHALL permitir seleção de região específica da planilha para captura.

#### Scenario: Captura de região específica
- **WHEN** um seletor CSS ou coordenadas de região são configurados
- **THEN** o screenshot captura apenas a área especificada

#### Scenario: Captura de página completa
- **WHEN** nenhuma região é especificada
- **THEN** o screenshot captura a área visível completa da planilha

### Requirement: Wait for Load
O sistema SHALL aguardar o carregamento completo da planilha antes de capturar.

#### Scenario: Aguardar elementos carregados
- **WHEN** a navegação para o Google Sheets é iniciada
- **THEN** o sistema aguarda até que todos os elementos da planilha estejam renderizados
- **AND** aguarda um delay adicional configurável para garantir carregamento de dados

#### Scenario: Timeout de carregamento
- **WHEN** o carregamento excede o timeout máximo (padrão: 30 segundos)
- **THEN** o sistema registra erro de timeout
- **AND** a captura é abortada
