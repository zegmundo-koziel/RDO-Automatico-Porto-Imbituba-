function executarRDOAutomatico() {
  let arquivoPdf = null;
  try {
    const ID_PLANILHA = "COLE AQUI O ID DA PLANILHA";
    const URL_PDF = "https://www.portodeimbituba.com.br/downloads/rdo.pdf";
    const PASTA_PDF_ID = "COLE AQUI O ID DA PASTA RDO_PDF_HISTORICO";

    const pdfResponse = UrlFetchApp.fetch(URL_PDF, { muteHttpExceptions: true });
    if (pdfResponse.getResponseCode()!== 200) {
      throw new Error("Não consegui baixar o PDF. Código: " + pdfResponse.getResponseCode());
    }
    const pdfBlob = pdfResponse.getBlob().setName('RDO_Imbituba.pdf');

    const pasta = DriveApp.getFolderById(PASTA_PDF_ID);
    const dataHoje = Utilities.formatDate(new Date(), 'GMT-3', 'dd/MM/yyyy');
    arquivoPdf = pasta.createFile(pdfBlob);
    arquivoPdf.setName('RDO_Imbituba_' + dataHoje.replace(/\//g, '-') + '.pdf');

    const textoPdf = extrairTextoDoPDF(pdfBlob);
    console.log("--- INICIO PDF ---");
    console.log(textoPdf);
    console.log("--- FIM PDF ---");

    const dados = processarRDO(textoPdf, ID_PLANILHA);
    enviarEmailRDO(dados, pdfBlob, ID_PLANILHA, dataHoje);

  } catch (erro) {
    console.error("Erro no automático: " + erro.message);
    Logger.log("ERRO: " + erro.message + "\n" + erro.stack);
    // DESCOMENTA SÓ DEPOIS QUE VALIDAR QUE TÁ TUDO OK PRA NÃO GASTAR COTA
    // MailApp.sendEmail({
    // to: Session.getActiveUser().getEmail(),
    // subject: "ERRO RDO Automático Imbituba",
    // body: "Falha ao rodar: " + erro.message + "\n\n" + erro.stack
    // });
  } finally {
    if (arquivoPdf) {
      try {
        arquivoPdf.setTrashed(true);
        Logger.log("PDF movido pra lixeira: " + arquivoPdf.getName());
      } catch (e) {
        Logger.log("Falha ao apagar PDF: " + e.message);
      }
    }
  }
}

function extrairTextoDoPDF(pdfBlob) {
  const tempFile = DriveApp.createFile(pdfBlob);
  const resource = {
    title: tempFile.getName(),
    mimeType: 'application/vnd.google-apps.document'
  };
  const docFile = Drive.Files.copy(resource, tempFile.getId(), {convert: true});
  const texto = DocumentApp.openById(docFile.id).getBody().getText();
  Drive.Files.remove(docFile.id);
  Drive.Files.remove(tempFile.getId());
  return texto;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
    { nome: "NAVIO ESPERADO", regex: /NAVIOS ESPERADOS([\s\S]*?)(?=NAVIOS ATRACADOS|NAVIOS SAÍDOS|Emitido em|$)/i },
    { nome: "NAVIO ATRACADO", regex: /NAVIOS ATRACADOS([\s\S]*?)(?=NAVIOS SAÍDOS|Emitido em|$)/i }
  ];

  for (let secao of secoes) {
    const matchSecao = textoPdf.match(secao.regex);
    if (!matchSecao) continue;

    let textoSecao = matchSecao[1];

    if (secao.nome === "NAVIO ESPERADO") {
      textoSecao = textoSecao.replace(/NAVIO\s+VG\s+LOA[\s\S]*?PREVISTO/i, '').trim();
      const regexNavio = /([A-Z][A-Z\s\.\-]+?)\s+(\d+)\s+([\d,]+)\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(\d{4})\s+(.+?)\s+([\d\.,]+)(?=\s+[A-Z][A-Z\s\.\-]+?\s+\d+|$)/g;
      var matches = [...textoSecao.matchAll(regexNavio)];

      for (let match of matches) {
        let nomeNavio = match[1].replace(/\s+\d+$/, '').trim();
        let chegada = match[4];
        let berco = match[5];
        let miolo = match[6].trim();
        let previsto = match[7];

        const muros = ['IMBITUB','IMBIT','TCG','GRANÉIS','GRANEIS','ILP','BRASI','CRISTAL'];
        let partesMiolo = miolo.split(/\s+/);
        let idxMuro = -1;

        for (let i = partesMiolo.length - 1; i >= 0; i--) {
          if (muros.some(m => partesMiolo[i].toUpperCase().includes(m))) {
            idxMuro = i;
            break;
          }
        }

        if (idxMuro === -1) continue;

        let depoisMuro = partesMiolo.slice(idxMuro + 1).join(" ");
        let origemPorto = "";
        let cargaCompleta = "";
        let cargaDetectada = null;

        let depoisMuroNormalizado = depoisMuro.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        for (let carga of cargasOrdenadas) {
          let cargaNormalizada = carga.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          let idxCarga = depoisMuroNormalizado.indexOf(cargaNormalizada);
          if (idxCarga!== -1) {
            cargaDetectada = carga;

            // NOVO: expande pra pegar a palavra inteira que contém a busca
            let idxInicioPalavra = depoisMuro.lastIndexOf(' ', idxCarga);
            idxInicioPalavra = idxInicioPalavra === -1? 0 : idxInicioPalavra + 1;

            let idxFimPalavra = depoisMuro.indexOf(' ', idxCarga);
            idxFimPalavra = idxFimPalavra === -1? depoisMuro.length : idxFimPalavra;

            let palavraInteira = depoisMuro.substring(idxInicioPalavra, idxFimPalavra);

            origemPorto = depoisMuro.substring(0, idxInicioPalavra).trim();
            cargaCompleta = palavraInteira + depoisMuro.substring(idxFimPalavra);

            if (!cargasEncontradas.includes(cargaDetectada)) cargasEncontradas.push(cargaDetectada);
            break;
          }
        }

        if (!cargaDetectada) continue;

        tabelaNavios.push({
          status: secao.nome,
          navio: nomeNavio,
          chegada: chegada,
          berco: "N/A",
          origem_porto: origemPorto,
          carga_completa: cargaCompleta.trim(),
          previsto: previsto,
          carga_detectada: cargaDetectada
        });
      }

    } else if (secao.nome === "NAVIO ATRACADO") {
      textoSecao = textoSecao.replace(/NAVIO\s+VG\s+LOA[\s\S]*?PREVISTO/i, '').trim();
      const regexAtracado = /([A-Z][A-Z\s\.\-]+?)\s+(\d+)\s+([\d,]+)\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}\s+(\d{4})\s+(.+?)\s+\d{2}\/\d{2}\s+\d{2}:\d{2}\s+([\d\.,]+)\s+[\d\.,]+(?=\s+[A-Z][A-Z\s\.\-]+?\s+\d+|$)/g;
      var matches = [...textoSecao.matchAll(regexAtracado)];

      for (let match of matches) {
        let nomeNavio = match[1].replace(/\s+\d+$/, '').trim();
        let atracacao = match[4];
        let berco = match[5];
        let miolo = match[6].trim();
        let realizado = match[7];

        const muros = ['IMBITUB','IMBIT','TCG','GRANÉIS','GRANEIS','ILP','BRASI','CRISTAL'];
        let partesMiolo = miolo.split(/\s+/);
        let idxMuro = -1;

        for (let i = partesMiolo.length - 1; i >= 0; i--) {
          if (muros.some(m => partesMiolo[i].toUpperCase().includes(m))) {
            idxMuro = i;
            break;
          }
        }

        if (idxMuro === -1) continue;

        let depoisMuro = partesMiolo.slice(idxMuro + 1).join(" ");
        let origemPorto = "";
        let cargaCompleta = "";
        let cargaDetectada = null;

        let depoisMuroNormalizado = depoisMuro.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        for (let carga of cargasOrdenadas) {
          let cargaNormalizada = carga.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          let idxCarga = depoisMuroNormalizado.indexOf(cargaNormalizada);
          if (idxCarga!== -1) {
            cargaDetectada = carga;

            // NOVO: expande pra pegar a palavra inteira que contém a busca
            let idxInicioPalavra = depoisMuro.lastIndexOf(' ', idxCarga);
            idxInicioPalavra = idxInicioPalavra === -1? 0 : idxInicioPalavra + 1;

            let idxFimPalavra = depoisMuro.indexOf(' ', idxCarga);
            idxFimPalavra = idxFimPalavra === -1? depoisMuro.length : idxFimPalavra;

            let palavraInteira = depoisMuro.substring(idxInicioPalavra, idxFimPalavra);

            origemPorto = depoisMuro.substring(0, idxInicioPalavra).trim();
            cargaCompleta = palavraInteira + depoisMuro.substring(idxFimPalavra);

            if (!cargasEncontradas.includes(cargaDetectada)) cargasEncontradas.push(cargaDetectada);
            break;
          }
        }

        if (!cargaDetectada) continue;

        tabelaNavios.push({
          status: secao.nome,
          navio: nomeNavio,
          chegada: atracacao,
          berco: berco,
          origem_porto: origemPorto,
          carga_completa: cargaCompleta.trim(),
          previsto: realizado,
          carga_detectada: cargaDetectada
        });
      }
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

  const temCarga = dados && dados.status === "sucesso" && dados.cargas.length > 0;
  const listaCargasAchadas = temCarga? dados.cargas.join(', ') : '';

  let assunto = 'RDO Imbituba ' + dataHojeBR;
  assunto += temCarga? ' - CARGA: ' + listaCargasAchadas : ' - SEM CARGA MONITORADA';

  let tabela = dados.tabela || [];
  let esperados = tabela.filter(r => r.status === "NAVIO ESPERADO");
  let atracados = tabela.filter(r => r.status === "NAVIO ATRACADO");

  let corpoHtml = '<h3 style="margin: 0 0 8px 0; font-size: 16px;">Relatório de Navios e Cargas - Porto de Imbituba (' + dataHojeBR + ')</h3>';

  if (!temCarga) {
    corpoHtml += '<p style="margin: 0 0 8px 0; font-size: 13px;"><b>Nenhuma carga monitorada encontrada no RDO de hoje.</b></p>';
  } else {
    corpoHtml += '<p style="margin: 0 0 8px 0; font-size: 13px;"><b>Cargas detectadas:</b> ' + listaCargasAchadas + '</p>';
  }

  function gerarBlocoTabela(tituloSecao, listaNavios, ehAtracado) {
    if (listaNavios.length === 0) return '';
    let html = '<table style="width: 100%; max-width: 900px; border-collapse: collapse; border: 1px solid #c0c0c0; font-family: Calibri, Arial, sans-serif; margin-bottom: 12px; font-size: 12px;">';
    let colSpanHeader = ehAtracado? "5" : "4";
    html += '<tr style="background-color: #808080; color: #ffffff; font-weight: bold; text-align: center; font-size: 14px; text-transform: uppercase;"><th colspan="' + colSpanHeader + '" style="border: 1px solid #c0c0c0; padding: 5px 8px;">' + tituloSecao + '</th></tr>';
    html += '<tr style="background-color: #000000; color: #ffffff; font-weight: bold; text-align: center; font-size: 12px; text-transform: uppercase;">';
    html += '<th style="border: 1px solid #c0c0c0; padding: 4px 6px; width: 22%;">NAVIO</th>';
    html += '<th style="border: 1px solid #c0c0c0; padding: 4px 6px; width: 12%;">' + (ehAtracado? 'ATRACAÇÃO' : 'CHEGADA') + '</th>';
    if (ehAtracado) html += '<th style="border: 1px solid #c0c0c0; padding: 4px 6px; width: 8%;">BERÇO</th>';
    html += '<th style="border: 1px solid #c0c0c0; padding: 4px 6px; width: 46%;">ORIGEM/CARGA</th>';
    html += '<th style="border: 1px solid #c0c0c0; padding: 4px 6px; width: 12%;">' + (ehAtracado? 'REALIZADO' : 'PREVISTO') + '</th></tr>';

    for (let r of listaNavios) {
      // CORRIGIDO: grifa a palavra inteira que está em carga_completa
      let origemCarga = r.origem_porto;
      if (r.carga_completa) {
        origemCarga += ' <b style="color:#0066cc;">' + r.carga_completa + '</b>';
      }

      html += '<tr style="background-color: #ffffff; text-align: center; color: #000000; font-size: 12px; line-height: 1.3;">';
      html += '<td style="padding: 4px 6px; border: 1px solid #c0c0c0; font-weight: bold; text-transform: uppercase;">' + r.navio + '</td>';
      html += '<td style="padding: 4px 6px; border: 1px solid #c0c0c0;">' + r.chegada + '</td>';
      if (ehAtracado) html += '<td style="padding: 4px 6px; border: 1px solid #c0c0c0;">' + r.berco + '</td>';
      html += '<td style="padding: 4px 6px; border: 1px solid #c0c0c0;">' + origemCarga + '</td>';
      html += '<td style="padding: 4px 6px; border: 1px solid #c0c0c0; font-weight: bold;">' + r.previsto + '</td></tr>';
    }
    html += '</table>';
    return html;
  }

  corpoHtml += gerarBlocoTabela("NAVIO ESPERADOS", esperados, false);
  corpoHtml += gerarBlocoTabela("NAVIO ATRACADOS", atracados, true);

  if (tabela.length === 0 && temCarga) {
     corpoHtml += '<p style="margin: 8px 0 0 0; font-size: 12px;">Cargas detectadas mas não foi possível extrair detalhes dos navios.</p>';
  }
  corpoHtml += '<p style="margin: 8px 0 0 0; font-size: 12px;">O PDF original lido segue anexado a este e-mail.</p>';

  // MODO TESTE ATIVO: só loga, não envia
  // Logger.log("MODO TESTE - E-mail não enviado");
  // Logger.log("Assunto: " + assunto);
  // Logger.log("Total destinatários BCC: " + listaEmails.length);
  // Logger.log("Destinatários: " + listaEmails.join(", "));

  // PRA ENVIAR DE VERDADE AMANHÃ, DESCOMENTA O BLOCO ABAIXO:
  MailApp.sendEmail({
  to: Session.getActiveUser().getEmail(),
  bcc: listaEmails.join(','),
  subject: assunto,
  htmlBody: corpoHtml,
  attachments: [pdfBlob],
  name: 'RDO Porto Imbituba'
  });
  Logger.log("E-mail enviado via BCC para " + listaEmails.length + " destinatários");
}

function limparPastaRDO() {
  try {
    const PASTA_PDF_ID = "1CNBjzkej2honYt-RXoJbLp8ZtKdBLWqs";
    const pasta = DriveApp.getFolderById(PASTA_PDF_ID);
    const arquivos = pasta.getFiles();
    let contador = 0;

    while (arquivos.hasNext()) {
      arquivos.next().setTrashed(true);
      contador++;
    }

    Logger.log("Pasta limpa. Total de arquivos movidos pra lixeira: " + contador);
  } catch (erro) {
    Logger.log("Erro ao limpar pasta: " + erro.message);
    throw erro;
  }
}
