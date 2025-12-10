## 1. Otimização de Screenshot

- [x] 1.1 Criar classe `PagePool` para gerenciar páginas do browser persistentes
- [x] 1.2 Implementar cache de páginas por URL base da planilha
- [x] 1.3 Modificar `captureScreenshot()` para reutilizar páginas existentes
- [x] 1.4 Adicionar método para captura paralela de múltiplas abas
- [x] 1.5 Implementar limpeza automática de páginas inativas (timeout)
- [x] 1.6 Atualizar `scheduler.ts` para usar capturas paralelas

## 2. Sincronização Automática de Grupos

- [x] 2.1 Criar classe `GroupCache` em `src/uazapi.ts`
- [x] 2.2 Implementar método `refreshGroups()` com controle de tempo
- [x] 2.3 Adicionar auto-sync ao iniciar o servidor
- [x] 2.4 Criar job periódico de atualização (a cada 5 minutos)
- [x] 2.5 Adicionar endpoint `GET /api/groups/refresh` para forçar atualização
- [x] 2.6 Atualizar `GET /api/whatsapp/groups` para usar cache

## 3. Testes e Validação

- [ ] 3.1 Testar captura de múltiplas abas em paralelo
- [ ] 3.2 Verificar economia de tempo com reutilização de páginas
- [ ] 3.3 Confirmar que sync automático funciona no startup
- [ ] 3.4 Testar endpoint de refresh manual
