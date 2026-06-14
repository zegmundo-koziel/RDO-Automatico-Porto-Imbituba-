# RDO Automático - Monitor de Cargas Portuárias

Script em Google Apps Script que automatiza o download do Relatório Diário de Operações (RDO) de portos em formato PDF, extrai informações sobre navios, identifica cargas monitoradas específicas e dispara relatórios formatados por e-mail.

## 🚀 Funcionalidades

* **Download automático:** Baixa o PDF do RDO via URL diariamente.
* **OCR integrado:** Extrai o texto do PDF convertendo-o temporariamente com Google Docs.
* **Detecção inteligente:** Identifica cargas cadastradas previamente na planilha.
* **Relatório HTML:** Separa navios esperados e atracados em tabelas limpas.
* **Disparo em massa:** Envia e-mails automáticos via BCC para proteger a privacidade.
* **Anexo original:** Inclui o PDF original do RDO diretamente na mensagem.
* **Autolimpeza:** Remove os arquivos temporários gerados no Google Drive de forma automática.
* **Tratamento de erros:** Envia alertas por e-mail caso ocorra alguma falha na execução.

---

## 📋 Requisitos

1. Conta Google com acesso ao Google Planilhas e Apps Script.
2. Planilha Google com duas abas nomeadas exatamente como: `cargas` e `email`.
3. Pasta dedicada no Google Drive para processamento temporário dos PDFs.
4. **Drive API** ativada no projeto do Apps Script.

---

## ⏱️ Instalação em 5 Minutos

### 1. Preparar a Planilha
1. Crie uma nova planilha no Google Planilhas.
2. Renomeie a primeira aba para `cargas`.
3. Na **coluna A** da aba `cargas`, liste as cargas que deseja monitorar (uma por linha):
   * *Exemplo: SOJA, MILHO, FERTILIZANTE, SODA CAUSTICA.*
4. Crie uma segunda aba chamada `email`.
5. Na **coluna B** da aba `email`, insira os endereços de e-mail dos destinatários (um por linha). A coluna A é opcional e pode ser usada para identificação.
6. Copie o ID da planilha presente na URL: 
   `https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit`

### 2. Criar Pasta no Drive
1. Crie uma pasta no seu Google Drive chamada `RDO_PDF`.
2. Abra a pasta e copie o ID dela diretamente da URL: 
   `https://drive.google.com/drive/folders/SEU_ID_AQUI`

### 3. Instalar o Script
1. Na sua planilha, acesse o menu **Extensões > Apps Script**.
2. Apague todo o código existente no editor e cole o conteúdo do arquivo `Code.gs`.
3. No topo do código, localize o objeto `CONFIG` e atualize com as suas informações:

```javascript
const CONFIG = {
  ID_PLANILHA: "COLE_AQUI_ID_DA_PLANILHA",
  URL_PDF: "https://www.portodeimbituba.com.br/downloads/rdo.pdf",
  PASTA_PDF_ID: "COLE_AQUI_ID_DA_PASTA",
  NOME_PORTO: "Imbituba"
};
```

### 4. Ativar a Drive API
1. No menu lateral esquerdo do Apps Script, clique no botão **+** ao lado de **Serviços**.
2. Procure por **Drive API**, selecione-a e clique em **Adicionar**.
   * *Nota: Sem este passo, a conversão de PDF para texto falhará.*

### 5. Primeiro Teste
1. No topo do editor do Apps Script, selecione a função `executarRDOAutomatico` no menu suspenso.
2. Clique no botão **Executar**.
3. Autorize as permissões da sua conta quando solicitado (**Revisar permissões > Avançado > Acessar... > Permitir**).
4. Verifique a aba **Execuções** na barra lateral para garantir que o script rodou com sucesso. O primeiro e-mail será enviado apenas para você como teste.

### 6. Agendar Execução Automática
1. No menu lateral esquerdo do Apps Script, clique no ícone de relógio (**Acionadores**).
2. Clique em **Adicionar acionador** no canto inferior direito.
3. Configure com as seguintes definições:
   * **Função**: `executarRDOAutomatico`
   * **Origem do evento**: Baseada em tempo
   * **Tipo**: Gatilho por dias
   * **Horário**: Escolha a faixa de horário em que o porto costuma atualizar o arquivo (Ex: das 9h às 10h).
4. Clique em **Salvar**.

---

## 🛠️ Personalização

### Trocar de Porto
* Altere a propriedade `URL_PDF` no objeto `CONFIG` para o link do novo porto.
* Ajuste a propriedade `NOME_PORTO` para atualizar os títulos dos e-mails.
* *Nota: Caso a estrutura textual do novo PDF mude drasticamente, pode ser necessário ajustar as expressões regulares (Regex) dentro da função `processarRDO`.*

### Adicionar Novos Terminais ou Termos de Busca
Se o porto monitorado utiliza siglas ou nomes específicos para os berços e muros, edite a array de mapeamento na função `detectarCarga`:
```javascript
const muros = ['IMBITUB', 'TCG', 'TEG', 'TECON', 'SEU_TERMINAL'];
```

---

## 🔍 Solução de Problemas (Troubleshooting)

| Erro | Causa Provável | Solução |
| :--- | :--- | :--- |
| **Drive API não ativada** | Falha na conversão do PDF para texto. | Repita o **Passo 4** e adicione o serviço Drive API. |
| **Aba 'cargas' não encontrada** | Nome da aba na planilha está incorreto. | Renomeie a aba da planilha exatamente para `cargas`. |
| **PDF parece vazio / Erro de leitura** | A URL do PDF mudou ou o arquivo está corrompido. | Copie a URL configurada e teste o acesso direto pelo navegador. |
| **Nenhum e-mail válido** | A lista de contatos está vazia ou desalinhada. | Certifique-se de preencher os e-mails na **coluna B** da aba `email`. |

---

## 📄 Licença e Suporte

* **Licença:** MIT License — Livre para modificação e uso comercial.
* **Desenvolvedor:** Zegmundo Koziel, 2026.
* **Versão Atual:** v1.2.1
  




