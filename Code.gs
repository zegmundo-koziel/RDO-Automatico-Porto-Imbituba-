/**
 * RDO Automático - Monitor de Cargas Portuárias v1.1
 * CONFIGURAÇÃO: Preencha os 3 valores abaixo antes de usar
 */
const VERSION = "1.1.0";
const CONFIG = {
  ID_PLANILHA: "COLE_AQUI_ID_DA_PLANILHA",
  URL_PDF: "https://www.portodeimbituba.com.br/downloads/rdo.pdf",
  PASTA_PDF_ID: "COLE_AQUI_ID_DA_PASTA_RDO_PDF",
  NOME_PORTO: "Imbituba",
  TIMEZONE: Session.getScriptTimeZone() || "America/Sao_Paulo" // Auto-detect
};

function executarRDOAutomatico() {
  // ... resto igual, mas troca GMT-3 por:
  const dataHoje = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
  
  // Add antes do fetch:
  Utilities.sleep(1000); // Evita rate limit
  const pdfResponse = UrlFetchApp.fetch(CONFIG.URL_PDF, { muteHttpExceptions: true });
  
  // ...
}
