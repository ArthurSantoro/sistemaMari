# Segurança da Pauta de Prazos

Este documento descreve como o sistema está protegido, o que depende de configuração no
Firebase/Google Cloud e como publicar ou reverter as mudanças. Ele **não** atesta que o sistema
é seguro ou adequado à LGPD: é um registro das medidas adotadas e das pendências.

## Arquitetura

| Parte | Onde roda | Observação |
|---|---|---|
| Página (`painel-prazos.html`, `app.js`, `sync.js`) | GitHub Pages (repositório **público**) | Só código; nenhum dado de cliente fica no repositório |
| Login | Firebase Authentication (e-mail e senha) | Senhas guardadas pelo Google (hash scrypt), nunca pelo site |
| Banco | Cloud Firestore, `southamerica-east1` | Criptografado em repouso pelo Google; acesso controlado pelas regras |
| Publicações | API pública do DJEN/CNJ (`comunicaapi.pje.jus.br`) | Consulta por número de OAB; só leitura |

Não há servidor próprio, upload de documentos, envio de e-mails/notificações ou integração com IA.

## Controles implementados

**Acesso (regras do Firestore, `firestore.rules`)**
- Só lê/grava quem está logado, com **e-mail confirmado** e cadastrado na coleção `membros` (pelo UID).
- A coleção `membros` não pode ser alterada pelo site (só pelo console): ninguém se autopromove.
- Todo o resto do banco é negado por padrão.
- Validação de campos no servidor: lista fechada de campos, tipos, tamanhos, datas, situação, link só `https://`.

**Integridade dos prazos**
- **Auditoria obrigatória**: toda criação/alteração de prazo ou configuração só é aceita se vier, no mesmo
  lote, com um registro em `auditoria` (quem, quando — hora do servidor —, o que mudou, antes/depois).
- Registros de auditoria não podem ser alterados nem apagados pelo site.
- **Controle de versão**: cada gravação precisa ser a versão atual + 1. Se duas pessoas alterarem o mesmo
  prazo ao mesmo tempo, a segunda é recusada e avisada (não há sobrescrita silenciosa).
- **Sem exclusão definitiva pelo site**: "Excluir" manda para a **Lixeira**, de onde dá para restaurar.
- Quem gravou é sempre a pessoa logada (o servidor confere o e-mail).

**Sessão e login**
- Mensagem de "esqueci a senha" igual exista ou não a conta (não revela quem é cadastrado).
- Link de nova senha do Firebase: uso único e validade curta.
- Saída automática após **7 dias sem uso** no aparelho (`INATIVIDADE_MAX_MS` em `sync.js`).
- Opção "computador compartilhado": a sessão termina ao fechar o navegador.
- "Sair" apaga do aparelho o cache do banco (IndexedDB) e as cópias locais.
- Com o banco ligado, os prazos não ficam copiados no `localStorage`.

**Aplicação**
- Todo conteúdo vindo do DJEN ou do banco é exibido como texto (escapado); links só `https://`.
- Content Security Policy: scripts só do próprio site e do SDK do Firebase (`gstatic`); conexões só
  com DJEN e Google; sem `eval`, sem scripts inline, sem plugins, sem `<base>`.
- `noindex`, `no-referrer`, links externos com `noopener noreferrer`.
- SDK do Firebase atualizado de 10.12.2 para 12.6.0 (versão fixa).
- IDs de lançamentos manuais com `crypto.randomUUID()`.

## Testes

- `node --test tests/calculo.test.mjs` — regras de contagem (cível, criminal, Súmula 310, recesso, réu preso)
  e detecção cível × criminal. **9 de 9 passando.**
- `tests/regras/` — testes das regras do Firestore **no emulador local** (nunca em produção):
  sem login, não membro, e-mail não confirmado, autopromoção a membro, sobrescrita por versão antiga,
  gravação sem auditoria, assinatura em nome de outra pessoa, exclusão definitiva, alteração/remoção da
  auditoria, campos extras, link `javascript:`, caminhos fora do escopo; e o uso normal com o formato exato
  que o painel grava (importar do DJEN, lançamento manual, documento antigo sem versão, lixeira e
  restauração, configurações, leitura do histórico). **18 de 18 passando.**
  Requer Java 21+ (Temurin 21 instalado em `C:\Program Files\Eclipse Adoptium`). Para rodar:
  ```
  cd tests/regras
  npm install
  $env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"; $env:Path="$env:JAVA_HOME\bin;$env:Path"
  npm test
  ```
- **Não testado**: o painel completo (sync.js) gravando no Firebase real com as regras novas — depende de
  login real e das configurações do console. Fazer o roteiro da seção "Publicar".

## Configuração no console (obrigatória antes de publicar as regras novas)

1. **Cadastrar os membros** — Firestore → Dados → *Iniciar coleção* `membros`; ID do documento = **UID**
   da pessoa (Authentication → Usuários → coluna "UID do usuário"); um campo `email` (texto) para referência.
2. **E-mails confirmados** — no primeiro acesso após a mudança, o painel pede para confirmar o e-mail
   (envia o link). Sem isso, a regra nova bloqueia.
3. **Desativar cadastro público** — Authentication → Configurações → Ações do usuário → desmarcar
   *Ativar criação (inscrição)*. Contas só serão criadas pelo console.
4. **Proteção contra enumeração de e-mail** — Authentication → Configurações → confirmar que está ativada.
5. **Restringir a chave da API** — Google Cloud Console → APIs e serviços → Credenciais → chave
   "Browser key": restrição de **sites** `https://arthursantoro.github.io/*` e `http://localhost/*`;
   restrição de **APIs**: Identity Toolkit, Token Service, Cloud Firestore.
6. **Publicar as regras** — Firestore → Regras → colar `firestore.rules` → Publicar.

## Pendências e riscos remanescentes

| Item | Situação |
|---|---|
| Autenticação multifator (MFA) | Exige Identity Platform (plano Blaze). Não implementado. |
| Backup automático do banco | Backups agendados/PITR do Firestore exigem plano Blaze. Hoje: Lixeira + histórico + botão "Baixar cópia de segurança" (manual). |
| App Check (bloquear uso da chave fora do site) | Recomendado (reCAPTCHA); não configurado. |
| Cabeçalhos HTTP (HSTS, frame-ancestors/anti-clickjacking) | GitHub Pages não permite cabeçalhos próprios; HTTPS é forçado pelo GitHub. Para controle total, hospedar no Firebase Hosting. |
| Revogar sessões de todos os aparelhos | Trocar a senha revoga as sessões. Revogação pelo site exige servidor (Admin SDK). |
| Retenção/eliminação de dados | Nada é apagado automaticamente. Política de guarda precisa ser definida pela responsável. |
| Dados das publicações | Textos do DJEN podem conter dados pessoais de partes (são públicos no Diário, mas ficam guardados no banco do escritório). |
| Aparelho perdido | Proteja o celular com senha/biometria; troque a senha da conta se perder o aparelho. |

## Publicar

1. Fazer os passos 1 a 5 da configuração acima.
2. Mesclar a branch `seguranca` na `main` e enviar (`git push`). O código novo funciona também com as
   regras antigas, então pode ir antes.
3. Entrar no painel, confirmar o e-mail se pedido, e testar: buscar, marcar cumprido, excluir/restaurar,
   ver histórico.
4. Publicar as regras novas (passo 6). Recarregar o painel em todos os aparelhos.

## Reverter

- **Regras**: Firestore → Regras → aba *Histórico* do console mostra versões anteriores; dá para voltar.
  (Regra antiga: lista de e-mails em `request.auth.token.email in [...]`.)
- **Código**: `git revert` do merge na `main` e `git push`. Os dados novos (versão, auditoria, lixeira)
  continuam compatíveis com a versão anterior do painel, que apenas os ignora.
- **Dados**: nada é migrado nem apagado por esta mudança.
