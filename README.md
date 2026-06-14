# RDO-Automatico-Porto-Imbituba-
Monitorar cargas do Porto de Imbituba por e-mail 


## Instalação
1. Crie uma planilha com abas `cargas` e `email`
2. Crie uma pasta no Drive para os PDFs
3. Cole o `Code.gs` no Apps Script da planilha
4. Edite o objeto `CONFIG` no topo do código com seus IDs
5. Ative Drive API: Serviços > Drive API > Ativar
6. Rode `executarRDOAutomatico()` pra testar

## Configuração
```javascript
const CONFIG = {
  ID_PLANILHA: "seu_id_aqui",
  URL_PDF: "url_do_rdo.pdf",
  PASTA_PDF_ID: "id_da_pasta",
  NOME_PORTO: "Nome do Porto"
};
