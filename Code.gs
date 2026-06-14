/**
 * RDO Automático - Monitor de Cargas Portuárias v1.2.1
 * Desenvolvido por Zegmundo Koziel - 2026
 *
 * O que faz: Baixa o RDO do porto todo dia, extrai os navios com cargas monitoradas
 * e dispara email formatado pra lista de clientes. Funciona 100% automático.
 *
 * INSTALAÇÃO RÁPIDA:
 * 1. Preencha os 4 campos do CONFIG abaixo
 * 2. Ative Drive API: Serviços Avançados > Drive API > Versão v3 > Ativar
 * 3. Execute executarRDOAutomatico() 1x pra autorizar
 * 4. Crie um gatilho diário: Acionadores > Adicionar acionador > executarRDOAutomatico
 *
 * REPOSITÓRIO: https://github.com/zegmundo-koziel/RDO-Automatico-Porto-Imbituba-
 * LICENÇA: MIT
 */

const VERSION = "1.2.1";

/**
 * CONFIGURAÇÃO - EDITE APENAS ESTA PARTE
 * Recomendo usar PropertiesService pra não commitar IDs sensíveis no git
 * Ex: PropertiesService.getScriptProperties().setProperty('ID_PLANILHA', 'xxx')
 */
const CONFIG = {
  // ID da planilha Google Sheets. Pega na URL: docs.google.com/spreadsheets/d/ID_AQUI/edit
  ID_PLANILHA: "COLE AQUI O ID DA PLANILHA",

  // Link direto do PDF do RDO no site do porto
  URL_PDF: "https://www.portodeimbituba.com.br/downloads/rdo.pdf",

  // ID da pasta do Google Drive onde salvar PDFs temporários. Pega na URL da pasta
  PASTA_PDF_ID: "COLE AQUI O ID DA PASTA",

  // Nome do porto que aparece no email. Ex: "Imbituba", "Santos", "Paranaguá"
  NOME_PORTO: "Imbituba",

  // Fuso horário. Deixe automático ou troque se necessário
  TIMEZONE: Session.getScriptTimeZone() || "America/Sao_Paulo"
};

/**
 * FUNÇÃO PRINCIPAL - EXECUTAR DIARIAMENTE VIA GATILHO
 * Baixa PDF, extrai texto, processa cargas, envia email e limpa arquivos temp
 */
function executarRDOAutomatico() {
  let arquivoPdf = null;
  let tempFileId = null;
  let docFileId = null;

  try {
    Logger.log(`RDO Automático v${VERSION} iniciado - Porto ${CONFIG.NOME_PORTO}`);
    validarConfig();

    // Evita bloqueio do Google por excesso de requisições
    Utilities.sleep(1000);

    const pdfResponse = UrlFetchApp.fetch(CONFIG.URL_PDF, { muteHttpExceptions: true });
    if (pdfResponse.getResponseCode()!== 200) {
      throw new Error(`Falha ao baixar PDF. Código HTTP: ${pdfResponse.getResponseCode()}. Verifique se URL_PDF está correta.`);
    }
    const pdfBlob = pdfResponse.getBlob().setName(`RDO_${CONFIG.NOME_PORTO}.pdf`);

    const pasta = DriveApp.getFolderById(CONFIG.PASTA_PDF_ID);
    const dataHoje = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
    arquivoPdf = pasta.createFile(pdfBlob);
    arquivoPdf.setName(`RDO_${CONFIG.NOME_PORTO}_${dataHoje.replace(/\//g, '-')}.pdf`);

    const resultado = extrairTextoDoPDF(pdfBlob);
    tempFileId = resultado.tempId;
    docFileId = resultado.docId;
    const textoPdf = resultado.texto;

    Logger.log(`PDF processado. ${textoPdf.length} caracteres extraídos.`);

    if (textoPdf.length < 100) {
      throw new Error("PDF parece vazio ou corrompido. Texto extraído muito curto. Verifique o arquivo no site do porto.");
    }

    const dados = processarRDO(textoPdf, CONFIG.ID_PLANILHA);
    enviarEmailRDO(dados, pdfBlob, CONFIG.ID_PLANILHA, dataHoje);
    Logger.log("Execução concluída com sucesso.");

  } catch (erro) {
    console.error("Erro no automático: " + erro.message);
    Logger.log("ERRO: " + erro.message + "\n" + erro.stack);
    notificarErro(erro);
    throw erro;
  } finally {
    if (arquivoPdf) try { arquivoPdf.setTrashed(true); } catch(e) { Logger.log("Falha ao deletar PDF: " + e); }
    if (tempFileId) try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch(e) { Logger.log("Falha ao deletar temp: " + e); }
    if (docFileId) try { DriveApp.getFileById(docFileId).setTrashed(true); } catch(e) { Logger.log("Falha ao deletar doc: " + e); }
  }
}

/**
 * Valida se o usuário preencheu a CONFIG. Trava execução se esqueceu.
 */
function validarConfig() {
  if (CONFIG.ID_PLANILHA.includes("COLE_AQUI") || CONFIG.PASTA_PDF_ID.includes("COLE_AQUI")) {
    throw new Error("CONFIG não preenchida. Edite o objeto CONFIG no topo do código com os IDs reais da planilha e pasta.");
  }
  if (!CONFIG.URL_PDF.startsWith("http")) {
    throw new Error("URL_PDF inválida. Deve começar com http:// ou https://");
  }
}

/**
 * Converte PDF em texto usando OCR do Google Docs.
 * IMPORTANTE: Drive API v3 precisa estar ativada em Serviços Avançados.
 */
function extrairTextoDoPDF(pdfBlob) {
  const tempFile = DriveApp.createFile(pdfBlob);
  const tempFileId = tempFile.getId();

  try {
    const resource = {
      name: tempFile.getName(),
      mimeType: 'application/vnd.google-apps.document'
    };

    const docFile = Drive.Files.create(resource, pdfBlob);
    const docFileId = docFile.id;
    const texto = DocumentApp.openById(docFileId).getBody().getText();

    return { texto, tempId: tempFileId, docId: docFileId };
  } catch (e) {
    try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch(e2) {}
    throw new Error("Falha ao converter PDF. ATIVE a Drive API v3 em Recursos > Serviços Avançados do Google > Drive API. Erro: " + e.message);
  }
}

/**
 * Escapa caracteres especiais pra usar em regex.
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lê aba 'cargas' da planilha e busca cada carga no texto do PDF.
 * Usa regex separado pra Esperado e Atracado conforme layout do RDO Imbituba.
 * Retorna lista de cargas encontradas + tabela de navios formatada.
 */
function processarRDO(textoPdf, idPlanilha) {
  const planilha = SpreadsheetApp.openById(idPlanilha);
  const abaCargas = planilha.getSheetByName("cargas");
  if (!abaCargas) throw new Error("Aba 'cargas' não encontrada na planilha.");

  const ultimaLinha = abaCargas.getLastRow();
  let listaCargas = [];
  if (ultimaLinha >= 2) {
    listaCargas = abaCargas.getRange("A2:A" + ultimaLinha).getValues()
.map(r => r.toString().trim()).filter(v => v!== "");
  }
  if (listaCargas.length === 0) {
    Logger.log("AVISO: Nenhuma carga cadastrada na planilha");
    return { status: "sem_carga", cargas: [], tabela: [] };
  }

  let cargasOrdenadas = [...listaCargas].sort((a,b) => b.length - a.length);
  let cargasEncontradas = [];
  let tabelaNavios = [];

  const secoes = [
    { nome: "NAVIO ESPERADO", regex: /NAVIOS?\s+ESPERADOS?([\s\S]*?)(?=NAVIOS?\s+ATRACADOS?|NAVIOS?\s+SA[IÍ]DOS?|Emitido\s+em|$)/i },
    { nome: "NAVIO ATRACADO", regex: /NAVIOS?\s+ATRACADOS?([\s\S]*?)(?=NAVIOS?\s+SA[IÍ]DOS?|Emitido\s+em|$)/i }
  ];

  for (let secao of secoes) {
    const matchSecao = textoPdf.match(secao.regex);
    if (!matchSecao) continue;

    let textoSecao = matchSecao[1];
    textoSecao = textoSecao.replace(/NAVIO\s+VG\s+LOA[\s\S]*?PREVISTO/i, '').trim();

    let regexNavio;
    if (secao.nome === "NAVIO ESPERADO") {
      regexNavio = /([A-Z][A-Z\s\.\-]+?)\s+(\d+)\s+([\d,]+)\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(\d{4})\s+(.+?)\s+([\d\.,]+)(?=\s+[A-Z][A-Z\s\.\-]+?\s+\d+|$)/g;
    } else {
      regexNavio = /([A-Z][A-Z\s\.\-]+?)\s+(\d+)\s+([\d,]+)\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(\d{4})\s+(.+?)\s+\d{2}\/\d{2}\s+\d{2}:\d{2}\s+([\d\.,]+)\s+[\d\.,]+(?=\s+[A-Z][A-Z\s\.\-]+?\s+\d+|$)/g;
    }

    var matches = [...textoSecao.matchAll(regexNavio)];

    for (let match of matches) {
      let nomeNavio = match[1].replace(/\s+\d+$/, '').trim();
      let data = match[4];
      let berco = secao.nome === "NAVIO ATRACADO"? match[5] : "N/A";
      let miolo = match[6].trim();
      let tonelagem = secao.nome === "NAVIO ESPERADO"? match[7] : match[7];

      const cargaInfo = detectarCarga(miolo, cargasOrdenadas);
      if (!cargaInfo) continue;

      if (!cargasEncontradas.includes(cargaInfo.carga)) cargasEncontradas.push(cargaInfo.carga);

      tabelaNavios.push({
        status: secao.nome,
        navio: nomeNavio,
        chegada: data,
        berco: berco,
        origem_porto: cargaInfo.origem,
        carga_completa: cargaInfo.cargaCompleta,
        previsto: tonelagem,
        carga_detectada: cargaInfo.carga
      });
    }
  }

  Logger.log("CARGAS ENCONTRADAS: " + cargasEncontradas.join(", "));
  Logger.log("TOTAL NAVIOS: " + tabelaNavios.length);

  return {
    status: cargasEncontradas.length > 0? "sucesso" : "sem_carga",
    cargas: cargasEncontradas,
    tabela: tabelaNavios
  };
}

/**
 * Detecta qual carga da lista está no texto do navio.
 * Pega a carga completa até a tonelagem, sem cortar.
 * Ex: Se na planilha tá "Coque", retorna "Coque Não Calcinado" inteiro do PDF
 */
function detectarCarga(textoMiolo, cargasOrdenadas) {
  const muros = ['IMBITUB','IMBIT','TCG','GRANÉIS','GRANEIS','ILP','BRASI','CRISTAL','TEG','TECON','GPC'];
  let partesMiolo = textoMiolo.split(/\s+/);
  let idxMuro = -1;

  for (let i = partesMiolo.length - 1; i >= 0; i--) {
    if (muros.some(m => partesMiolo[i].toUpperCase().includes(m))) {
      idxMuro = i;
      break;
    }
  }

  if (idxMuro === -1) return null;

  let depoisMuro = partesMiolo.slice(idxMuro + 1).join(" ");
  let depoisMuroNormalizado = depoisMuro.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  for (let carga of cargasOrdenadas) {
    let cargaNormalizada = carga.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    let idxCarga = depoisMuroNormalizado.indexOf(cargaNormalizada);

    if (idxCarga!== -1) {
      let idxInicioPalavra = depoisMuro.lastIndexOf(' ', idxCarga);
      idxInicioPalavra = idxInicioPalavra === -1? 0 : idxInicioPalavra + 1;

      let cargaCompletaOriginal = depoisMuro.substring(idxInicioPalavra).trim();
      cargaCompletaOriginal = cargaCompletaOriginal.replace(/\s+[\d\.,]+$/, '').trim();

      return {
        carga: carga,
        origem: depoisMuro.substring(0, idxInicioPalavra).trim(),
        cargaCompleta: cargaCompletaOriginal,
        cargaNormalizada: cargaCompletaOriginal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      };
    }
  }
  return null;
}

/**
 * Monta HTML do email e dispara pra lista da aba 'email' coluna B.
 * Usa nome real da carga achada no PDF, não da planilha.
 * Agrupa cargas similares pra evitar duplicata no cabeçalho.
 */
function enviarEmailRDO(dados, pdfBlob, idPlanilha, dataHojeBR) {
  const planilha = SpreadsheetApp.openById(idPlanilha);
  const abaEmails = planilha.getSheetByName("email");
  if (!abaEmails) throw new Error("Aba 'email' não encontrada na planilha.");

  const ultimaLinhaEmail = abaEmails.getLastRow();
  let listaEmails = [];
  if (ultimaLinhaEmail >= 2) {
    listaEmails = abaEmails.getRange("B2:B" + ultimaLinhaEmail).getValues()
.flat()
.map(e => e.toString().trim())
.filter(e => e!== "" && e.includes("@") && e.includes("."));
  }

  if (listaEmails.length === 0) {
    Logger.log("Nenhum e-mail válido cadastrado na aba 'email'. Abortando envio.");
    return;
  }

  const temCarga = dados && dados.status === "sucesso" && dados.tabela.length > 0;
  
  let cargasReais = [];
  if (temCarga) {
    let cargasMap = new Map();
    
    dados.tabela.forEach(nav => {
      if (nav.carga_completa) {
        let cargaLimpa = nav.carga_completa
        .replace(/\s+(GPC|TEG|TECON|ILP|BRASI|CRISTAL)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
        
        let chave = cargaLimpa.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        
        if (!cargasMap.has(chave) || cargaLimpa.length > cargasMap.get(chave).length) {
          cargasMap.set(chave, cargaLimpa);
        }
        
        for (let [k, v] of cargasMap.entries()) {
          if (chave.includes(k) && chave!== k) {
            cargasMap.delete(k);
            cargasMap.set(chave, cargaLimpa);
          } else if (k.includes(chave) && chave!== k) {
            return;
          }
        }
      }
    });
    
    cargasReais = [...cargasMap.values()];
  }

  const listaCargasAchadas = cargasReais.map(c => {
    return c.split(' ').map(palavra =>
      palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase()
    ).join(' ');
  }).join(', ');

  let assunto = `RDO ${CONFIG.NOME_PORTO} ${dataHojeBR}`;
  assunto += temCarga? ` - CARGA: ${listaCargasAchadas}` : ' - SEM CARGA MONITORADA';

  let tabela = dados.tabela || [];
  let esperados = tabela.filter(r => r.status === "NAVIO ESPERADO");
  let atracados = tabela.filter(r => r.status === "NAVIO ATRACADO");

  let corpoHtml = `<h3 style="margin:0 0 8px 0;font-size:16px;">Relatório de Navios - ${CONFIG.NOME_PORTO} (${dataHojeBR})</h3>`;

  if (!temCarga) {
    corpoHtml += '<p style="margin:0 0 8px 0;font-size:13px;"><b>Nenhuma carga monitorada encontrada no RDO de hoje.</b></p>';
  } else {
    corpoHtml += `<p style="margin:0 0 8px 0;font-size:13px;"><b>Cargas detectadas:</b> ${listaCargasAchadas}</p>`;
  }

  function gerarBlocoTabela(tituloSecao, listaNavios, ehAtracado) {
    if (listaNavios.length === 0) return '';
    let html = `<table style="width:100%;max-width:900px;border-collapse:collapse;border:1px solid #c0c0c0;font-family:Calibri,Arial,sans-serif;margin-bottom:12px;font-size:12px;">`;
    let colSpanHeader = ehAtracado? "5" : "4";
    html += `<tr style="background:#808080;color:#fff;font-weight:bold;text-align:center;font-size:14px;text-transform:uppercase;"><th colspan="${colSpanHeader}" style="border:1px solid #c0c0c0;padding:5px 8px;">${tituloSecao}</th></tr>`;
    html += `<tr style="background:#000;color:#fff;font-weight:bold;text-align:center;font-size:12px;text-transform:uppercase;">`;
    html += `<th style="border:1px solid #c0c0c0;padding:4px 6px;width:22%;">NAVIO</th>`;
    html += `<th style="border:1px solid #c0c0c0;padding:4px 6px;width:12%;">${ehAtracado? 'ATRACAÇÃO' : 'CHEGADA'}</th>`;
    if (ehAtracado) html += `<th style="border:1px solid #c0c0c0;padding:4px 6px;width:8%;">BERÇO</th>`;
    html += `<th style="border:1px solid #c0c0c0;padding:4px 6px;width:46%;">ORIGEM/CARGA</th>`;
    html += `<th style="border:1px solid #c0c0c0;padding:4px 6px;width:12%;">${ehAtracado? 'REALIZADO' : 'PREVISTO'}</th></tr>`;

    for (let r of listaNavios) {
      let origemCarga = r.origem_porto;
      if (r.carga_completa) {
        origemCarga += ` <b style="color:#0066cc;">${r.carga_completa}</b>`;
      }

      html += `<tr style="background:#fff;text-align:center;color:#000;font-size:12px;line-height:1.3;">`;
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;font-weight:bold;text-transform:uppercase;white-space:nowrap;">${r.navio}</td>`;
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;">${r.chegada}</td>`;
      if (ehAtracado) html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;">${r.berco}</td>`;
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;">${origemCarga}</td>`;
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;font-weight:bold;">${r.previsto}</td></tr>`;
    }
    html += '</table>';
    return html;
  }

  corpoHtml += gerarBlocoTabela("NAVIOS ESPERADOS", esperados, false);
  corpoHtml += gerarBlocoTabela("NAVIOS ATRACADOS", atracados, true);

  if (tabela.length === 0 && temCarga) {
    corpoHtml += '<p style="margin:8px 0 0 0;font-size:12px;">Cargas detectadas mas não foi possível extrair detalhes dos navios. Verifique o PDF.</p>';
  }
  corpoHtml += '<p style="margin:8px 0 0 0;font-size:12px;">O PDF original segue anexado.</p>';
  corpoHtml += `<p style="margin:8px 0 0 0;font-size:10px;color:#666;">RDO Automático v${VERSION} | ${CONFIG.NOME_PORTO}</p>`;

  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    bcc: listaEmails.join(','),
    subject: assunto,
    htmlBody: corpoHtml,
    attachments: [pdfBlob],
    name: `RDO ${CONFIG.NOME_PORTO}`
  });
  Logger.log(`E-mail enviado para ${listaEmails.length} destinatários`);
}

/**
 * Se der erro, manda email só pra você com o stack trace completo.
 */
function notificarErro(erro) {
  try {
    MailApp.sendEmail({
      to: Session.getActiveUser().getEmail(),
      subject: `ERRO RDO Automático - ${CONFIG.NOME_PORTO}`,
      body: `Falha ao executar RDO Automático v${VERSION}:\n\n${erro.message}\n\nStack:\n${erro.stack}\n\nVerifique os logs em Execuções.`
    });
  } catch(e) {
    Logger.log("Falha ao enviar email de erro: " + e.message);
  }
}

/**
 * FUNÇÃO AUXILIAR: Limpa pasta de PDFs manualmente se precisar.
 * Execute 1x por semana se a pasta lotar.
 */
function limparPastaRDO() {
  try {
    const pasta = DriveApp.getFolderById(CONFIG.PASTA_PDF_ID);
    const arquivos = pasta.getFiles();
    let contador = 0;
    while (arquivos.hasNext()) {
      arquivos.next().setTrashed(true);
      contador++;
    }
    Logger.log(`Pasta limpa. ${contador} arquivos movidos pra lixeira.`);
  } catch (erro) {
    Logger.log("Erro ao limpar pasta: " + erro.message);
    throw erro;
  }
}