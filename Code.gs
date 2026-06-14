/**
 * RDO Automático - Monitor de Cargas Portuárias
 * CONFIGURAÇÃO: Preencha os 3 valores abaixo antes de usar
 */
const CONFIG = {
  ID_PLANILHA: "COLE_AQUI_ID_DA_PLANILHA",
  URL_PDF: "https://www.portodeimbituba.com.br/downloads/rdo.pdf",
  PASTA_PDF_ID: "COLE_AQUI_ID_DA_PASTA_RDO_PDF",
  NOME_PORTO: "Imbituba" // Troque pelo nome do porto
};

function executarRDOAutomatico() {
  let arquivoPdf = null;
  let tempFileId = null;
  let docFileId = null;

  try {
    validarConfig();

    const pdfResponse = UrlFetchApp.fetch(CONFIG.URL_PDF, { muteHttpExceptions: true });
    if (pdfResponse.getResponseCode()!== 200) {
      throw new Error(`Falha ao baixar PDF. Código: ${pdfResponse.getResponseCode()}`);
    }
    const pdfBlob = pdfResponse.getBlob().setName(`RDO_${CONFIG.NOME_PORTO}.pdf`);

    const pasta = DriveApp.getFolderById(CONFIG.PASTA_PDF_ID);
    const dataHoje = Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy');
    arquivoPdf = pasta.createFile(pdfBlob);
    arquivoPdf.setName(`RDO_${CONFIG.NOME_PORTO}_${dataHoje.replace(/\//g, '-')}.pdf`);

    const resultado = extrairTextoDoPDF(pdfBlob);
    tempFileId = resultado.tempId;
    docFileId = resultado.docId;
    const textoPdf = resultado.texto;

    Logger.log(`PDF processado. ${textoPdf.length} caracteres extraídos.`);

    if (textoPdf.length < 100) {
      throw new Error("PDF parece vazio ou corrompido. Texto extraído muito curto.");
    }

    const dados = processarRDO(textoPdf, CONFIG.ID_PLANILHA);
    enviarEmailRDO(dados, pdfBlob, CONFIG.ID_PLANILHA, dataHoje);

  } catch (erro) {
    console.error("Erro no automático: " + erro.message);
    Logger.log("ERRO: " + erro.message + "\n" + erro.stack);
    notificarErro(erro);
  } finally {
    // Limpa tudo mesmo se der erro
    if (arquivoPdf) try { arquivoPdf.setTrashed(true); } catch(e) {}
    if (tempFileId) try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch(e) {}
    if (docFileId) try { DriveApp.getFileById(docFileId).setTrashed(true); } catch(e) {}
  }
}

function validarConfig() {
  if (CONFIG.ID_PLANILHA.includes("COLE_AQUI") || CONFIG.PASTA_PDF_ID.includes("COLE_AQUI")) {
    throw new Error("CONFIG não preenchida. Edite o objeto CONFIG no topo do código com os IDs reais.");
  }
}

function extrairTextoDoPDF(pdfBlob) {
  // ATENÇÃO: Ativar Drive API em Serviços Avançados > Drive API
  const tempFile = DriveApp.createFile(pdfBlob);
  const tempFileId = tempFile.getId();

  try {
    const resource = {
      title: tempFile.getName(),
      mimeType: MimeType.GOOGLE_DOCS
    };

    const docFile = Drive.Files.copy(resource, tempFileId, {convert: true});
    const docFileId = docFile.id;
    const texto = DocumentApp.openById(docFileId).getBody().getText();

    return { texto, tempId: tempFileId, docId: docFileId };
  } catch (e) {
    try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch(e2) {}
    throw new Error("Falha ao converter PDF. Ative Drive API em Serviços Avançados: " + e.message);
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function processarRDO(textoPdf, idPlanilha) {
  const planilha = SpreadsheetApp.openById(idPlanilha);
  const abaCargas = planilha.getSheetByName("cargas");
  if (!abaCargas) throw new Error("Aba 'cargas' não encontrada. Crie uma aba chamada exatamente 'cargas'.");

  const ultimaLinha = abaCargas.getLastRow();
  let listaCargas = [];
  if (ultimaLinha >= 2) {
    listaCargas = abaCargas.getRange("A2:A" + ultimaLinha).getValues()
     .map(r => r.toString().trim())
     .filter(v => v!== "");
  }

  if (listaCargas.length === 0) {
    Logger.log("AVISO: Nenhuma carga cadastrada na aba 'cargas'");
    return { status: "sem_carga", cargas: [], tabela: [] };
  }

  let cargasOrdenadas = [...listaCargas].sort((a,b) => b.length - a.length);
  let cargasEncontradas = new Set();
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

    const regexNavio = /([A-Z][A-Z\s\.\-]+?)\s+(\d+)\s+([\d,\.]+)\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(\d{4})\s+(.+?)\s+([\d\.,]+)/g;
    const matches = [...textoSecao.matchAll(regexNavio)];

    for (let match of matches) {
      let nomeNavio = match[1].replace(/\s+\d+$/, '').trim();
      let data = match[4];
      let berco = secao.nome === "NAVIO ATRACADO"? match[5] : "N/A";
      let miolo = match[6].trim();
      let tonelagem = match[7];

      let cargaInfo = detectarCarga(miolo, cargasOrdenadas);
      if (!cargaInfo) continue;

      cargasEncontradas.add(cargaInfo.carga);

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

  Logger.log(`CARGAS: ${[...cargasEncontradas].join(", ")} | NAVIOS: ${tabelaNavios.length}`);

  return {
    status: cargasEncontradas.size > 0? "sucesso" : "sem_carga",
    cargas: [...cargasEncontradas],
    tabela: tabelaNavios
  };
}

function detectarCarga(textoMiolo, cargasOrdenadas) {
  const muros = ['IMBITUB','IMBIT','TCG','GRANÉIS','GRANEIS','ILP','BRASI','CRISTAL','TEG','TECON'];
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
      let idxInicio = depoisMuro.lastIndexOf(' ', idxCarga);
      idxInicio = idxInicio === -1? 0 : idxInicio + 1;

      let idxFim = depoisMuro.indexOf(' ', idxCarga + carga.length);
      idxFim = idxFim === -1? depoisMuro.length : idxFim;

      return {
        carga: carga,
        origem: depoisMuro.substring(0, idxInicio).trim(),
        cargaCompleta: depoisMuro.substring(idxInicio, idxFim)
      };
    }
  }
  return null;
}

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
     .filter(e => e!== "" && e.includes("@"));
  }

  if (listaEmails.length === 0) {
    Logger.log("Nenhum e-mail válido cadastrado. Abortando envio.");
    return;
  }

  const temCarga = dados && dados.status === "sucesso" && dados.cargas.length > 0;
  const listaCargasAchadas = temCarga? dados.cargas.join(', ') : '';

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
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;font-weight:bold;text-transform:uppercase;">${r.navio}</td>`;
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;">${r.chegada}</td>`;
      if (ehAtracado) html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;">${r.berco}</td>`;
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;">${origemCarga}</td>`;
      html += `<td style="padding:4px 6px;border:1px solid #c0c0c0;font-weight:bold;">${r.previsto}</td></tr>`;
    }
    html += '</table>';
    return html;
  }

  corpoHtml += gerarBlocoTabela("NAVIO ESPERADOS", esperados, false);
  corpoHtml += gerarBlocoTabela("NAVIO ATRACADOS", atracados, true);

  if (tabela.length === 0 && temCarga) {
    corpoHtml += '<p style="margin:8px 0 0 0;font-size:12px;">Cargas detectadas mas não foi possível extrair detalhes dos navios.</p>';
  }
  corpoHtml += '<p style="margin:8px 0 0 0;font-size:12px;">O PDF original segue anexado.</p>';

  // MODO TESTE: descomenta pra enviar de verdade
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

function notificarErro(erro) {
  try {
    MailApp.sendEmail({
      to: Session.getActiveUser().getEmail(),
      subject: `ERRO RDO Automático - ${CONFIG.NOME_PORTO}`,
      body: `Falha ao executar:\n\n${erro.message}\n\n${erro.stack}`
    });
  } catch(e) {
    Logger.log("Falha ao enviar email de erro: " + e.message);
  }
}

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
