/**
 * Codigo.gs — Sistema de Escala de Atendimento (cuidadoras sociais x famílias).
 *
 * Roda dentro da planilha: menu "Escala de Atendimento" > "Abrir sistema".
 * Grava SOMENTE nas abas criadas por este sistema: Usuarios, Cuidadoras, Cores,
 * Bloqueios, Atendimentos e Parametros. Nunca toca em outras abas, nem em colunas
 * à direita das colunas do contrato (onde ficam fórmulas suas).
 * Nada é apagado: usuários/cuidadoras/ausências são "inativados" e atendimentos
 * retirados ficam com status "cancelado" (histórico preservado).
 *
 * As funções expostas ao navegador são só as listadas em "API DA INTERFACE".
 */

var CONFIG = {
  titulo: 'Escala de Atendimento',
  periodos: [
    { id: 'manha', nome: 'Manhã', inicio: 8, fim: 12 },
    { id: 'tarde', nome: 'Tarde', inicio: 13, fim: 18 }
  ],
  semanasHistorico: 8,
  maxCores: 6,
  maxDiasBloqueio: 366,
  parametrosPadrao: {
    maxUsuarios: 30,
    tamanhoDupla: 2,
    cuidadorasPorTurno: 8,
    familiasPorDia: 8,
    diasAtendimento: [1, 2, 3, 4, 5],
    dispositivos: ['Cadeira de rodas', 'Andador', 'Bengala', 'Muleta', 'Cama hospitalar']
  },
  coresPadrao: [
    { nome: 'Verde', hex: '#2e7d32', significado: 'Leve: autônomo, precisa só de acompanhamento.' },
    { nome: 'Amarelo', hex: '#b26a00', significado: 'Moderado: precisa de ajuda em algumas tarefas.' },
    { nome: 'Vermelho', hex: '#c62828', significado: 'Alto: depende de ajuda na maior parte das tarefas.' }
  ],
  // [chave, título do cabeçalho, tipo opcional]. A primeira coluna é a chave primária.
  abas: {
    usuarios: {
      nome: 'Usuarios',
      colunas: [
        ['id', 'ID'], ['nome', 'Nome'], ['endereco', 'Endereço'], ['corId', 'Cor (gravidade)'],
        ['precisaBanho', 'Precisa de banho'], ['precisaAlimentacao', 'Precisa de ajuda para comer'],
        ['precisaLevantar', 'Precisa de ajuda para levantar'], ['dispositivo', 'Dispositivo de acessibilidade'],
        ['observacoes', 'Observações'], ['frequencia', 'Frequência'], ['periodoPreferido', 'Período preferido'],
        ['ativo', 'Ativo']
      ]
    },
    cuidadoras: {
      nome: 'Cuidadoras',
      colunas: [
        ['id', 'ID'], ['nome', 'Nome'], ['restricaoPeso', 'Não pode pegar peso'],
        ['restricaoBanho', 'Não faz banho'], ['coresPermitidas', 'Cores que atende'],
        ['observacoes', 'Observações'], ['ativo', 'Ativo']
      ]
    },
    cores: {
      nome: 'Cores',
      colunas: [['id', 'ID'], ['nome', 'Nome'], ['hex', 'Cor (hex)'], ['significado', 'Significado']]
    },
    bloqueios: {
      nome: 'Bloqueios',
      colunas: [
        ['id', 'ID'], ['cuidadoraId', 'Cuidadora'], ['dataInicio', 'Data inicial', 'data'],
        ['dataFim', 'Data final', 'data'], ['periodo', 'Período'], ['motivo', 'Motivo'], ['ativo', 'Ativo']
      ]
    },
    atendimentos: {
      nome: 'Atendimentos',
      colunas: [
        ['id', 'ID'], ['data', 'Data', 'data'], ['periodo', 'Período'], ['usuarioId', 'Usuário'],
        ['cuidadorasIds', 'Cuidadoras'], ['status', 'Status'], ['origem', 'Origem']
      ]
    },
    parametros: {
      nome: 'Parametros',
      colunas: [['chave', 'Chave'], ['valor', 'Valor']]
    }
  }
};

/* ===================================================================== */
/* MENU E JANELA                                                          */
/* ===================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu(CONFIG.titulo)
    .addItem('Abrir sistema', 'abrirSistema')
    .addSeparator()
    .addItem('Preparar planilha (criar abas)', 'prepararPlanilha')
    .addItem('Carregar dados de exemplo', 'seedExemplo')
    .addToUi();
}

function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

function abrirSistema() {
  try {
    // Falha cedo, com mensagem clara, se as abas ainda não existem.
    CONFIG_ABAS_CHAVES_.forEach(function (k) { abrirAba_(k); });
  } catch (e) {
    SpreadsheetApp.getUi().alert(e.message);
    return;
  }
  var html = HtmlService.createTemplateFromFile('Index').evaluate().setWidth(1400).setHeight(850);
  SpreadsheetApp.getUi().showModelessDialog(html, CONFIG.titulo);
}

var CONFIG_ABAS_CHAVES_ = ['usuarios', 'cuidadoras', 'cores', 'bloqueios', 'atendimentos', 'parametros'];

/** Cria as abas que faltam (com cabeçalho) e os valores iniciais. Não altera abas que já têm dados. */
function prepararPlanilha() {
  var ui = SpreadsheetApp.getUi();
  comLock_(function () {
    var ss = SpreadsheetApp.getActive();
    var criadas = [];
    CONFIG_ABAS_CHAVES_.forEach(function (k) {
      var def = CONFIG.abas[k];
      var sh = ss.getSheetByName(def.nome);
      if (!sh) { sh = ss.insertSheet(def.nome); criadas.push(def.nome); }
      if (sh.getLastRow() === 0) {
        var cab = def.colunas.map(function (c) { return c[1]; });
        sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#e8f0ec');
        sh.setFrozenRows(1);
      }
    });
    if (lerTabela_('cores').length === 0) {
      var gerarCor = criarGeradorId_('K', [], 1);
      anexarLinhas_('cores', CONFIG.coresPadrao.map(function (c) {
        return { id: gerarCor(), nome: c.nome, hex: c.hex, significado: c.significado };
      }));
    }
    if (lerTabela_('parametros').length === 0) {
      gravarParametros_(CONFIG.parametrosPadrao);
    }
    ui.alert(criadas.length
      ? 'Abas criadas: ' + criadas.join(', ') + '.\nAgora use Escala de Atendimento > Abrir sistema.'
      : 'Todas as abas já existem. Nada foi alterado nos dados.');
  });
}

/** Só roda se chamada pelo menu. Recusa se já houver usuários ou cuidadoras cadastrados. */
function seedExemplo() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('Dados de exemplo',
    'Isto cadastra 9 cuidadoras e 25 famílias fictícias para você testar. Só funciona com as abas vazias. Continuar?',
    ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  comLock_(function () {
    CONFIG_ABAS_CHAVES_.forEach(function (k) { abrirAba_(k); });
    if (lerTabela_('usuarios').length || lerTabela_('cuidadoras').length) {
      throw new Error('Já existem usuários ou cuidadoras cadastrados. Os dados de exemplo só entram com as abas vazias.');
    }
    var cores = lerCores_();
    var verde = cores[0].id, amarelo = cores[Math.min(1, cores.length - 1)].id, vermelho = cores[cores.length - 1].id;
    var gerarC = criarGeradorId_('C', [], 3);
    var nomesC = ['Ana', 'Bruna', 'Carla', 'Daniela', 'Elisa', 'Fátima', 'Gabriela', 'Helena', 'Iara'];
    anexarLinhas_('cuidadoras', nomesC.map(function (n) {
      return {
        id: gerarC(), nome: n,
        restricaoPeso: n === 'Carla' ? 'sim' : 'nao',
        restricaoBanho: n === 'Helena' ? 'sim' : 'nao',
        coresPermitidas: n === 'Elisa' ? verde + ',' + amarelo : '',
        observacoes: '', ativo: 'sim'
      };
    }));
    var familias = ['Alves', 'Barros', 'Cardoso', 'Dias', 'Esteves', 'Farias', 'Gomes', 'Honório', 'Ibrahim', 'Jesus',
      'Klein', 'Lima', 'Moura', 'Nunes', 'Oliveira', 'Pereira', 'Queiroz', 'Ramos', 'Silva', 'Teixeira',
      'Uchoa', 'Vieira', 'Werneck', 'Xavier', 'Zanetti'];
    var freqs = ['s2', 's1', 's3', 's1', 's2', 'q15', 's1', 's2', 'm1', 's1', 's2', 's1', 's3', 's1', 's2', 'q15', 's1', 's2', 's1', 's1', 's2', 's1', 's3', 's1', 's2'];
    var gerarU = criarGeradorId_('U', [], 3);
    var dispositivos = CONFIG.parametrosPadrao.dispositivos;
    anexarLinhas_('usuarios', familias.map(function (f, i) {
      var cor = i % 5 === 0 ? vermelho : (i % 2 === 0 ? amarelo : verde);
      var grave = cor === vermelho;
      return {
        id: gerarU(), nome: 'Família ' + f, endereco: '',
        corId: cor,
        precisaBanho: (grave || i % 3 === 0) ? 'sim' : 'nao',
        precisaAlimentacao: grave ? 'sim' : 'nao',
        precisaLevantar: (grave || i % 4 === 0) ? 'sim' : 'nao',
        dispositivo: (grave || i % 4 === 0) ? dispositivos[i % dispositivos.length] : '',
        observacoes: '', frequencia: freqs[i],
        periodoPreferido: i % 6 === 5 ? 'tarde' : 'manha',
        ativo: 'sim'
      };
    }));
    ui.alert('Dados de exemplo carregados. Abra o sistema e clique em "Atualizar escala".');
  });
}

/* ===================================================================== */
/* ACESSO ÀS ABAS (leitura e gravação)                                    */
/* ===================================================================== */

function fuso_() {
  return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'America/Sao_Paulo';
}

function hojeIso_() {
  return Utilities.formatDate(new Date(), fuso_(), 'yyyy-MM-dd');
}

function comLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    throw new Error('O sistema está ocupado com outra gravação. Tente novamente em alguns segundos.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function abrirAba_(chave) {
  var def = CONFIG.abas[chave];
  var alvo = normalizarTexto_(def.nome);
  var abas = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < abas.length; i++) {
    if (normalizarTexto_(abas[i].getName()) === alvo) return abas[i];
  }
  throw new Error('Não encontrei a aba "' + def.nome + '". Use o menu Escala de Atendimento > Preparar planilha.');
}

/** Posição (0-based) de cada coluna, achada pelo cabeçalho ignorando caixa e acentos. */
function mapaColunas_(sh, def) {
  var larg = Math.max(sh.getLastColumn(), 1);
  var cab = sh.getRange(1, 1, 1, larg).getValues()[0].map(normalizarTexto_);
  var mapa = {};
  def.colunas.forEach(function (c) {
    var i = cab.indexOf(normalizarTexto_(c[1]));
    if (i < 0) throw new Error('Não achei a coluna "' + c[1] + '" na aba "' + def.nome + '". Não renomeie os cabeçalhos.');
    mapa[c[0]] = i;
  });
  return mapa;
}

function valorDaPlanilha_(tipo, v) {
  if (v instanceof Date) return Utilities.formatDate(v, fuso_(), 'yyyy-MM-dd');
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function valorParaPlanilha_(tipo, v) {
  if (tipo === 'data') return v ? Utilities.parseDate(v, fuso_(), 'yyyy-MM-dd') : '';
  return v === null || v === undefined ? '' : String(v);
}

function lerTabela_(chave) {
  var def = CONFIG.abas[chave];
  var sh = abrirAba_(chave);
  var mapa = mapaColunas_(sh, def);
  var ult = sh.getLastRow();
  if (ult < 2) return [];
  var larg = Math.max.apply(null, def.colunas.map(function (c) { return mapa[c[0]]; })) + 1;
  var vals = sh.getRange(2, 1, ult - 1, larg).getValues();
  var pk = def.colunas[0][0];
  var saida = [];
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][mapa[pk]] === '' || vals[i][mapa[pk]] === null) continue;
    var o = { _linha: i + 2 };
    def.colunas.forEach(function (c) { o[c[0]] = valorDaPlanilha_(c[2], vals[i][mapa[c[0]]]); });
    saida.push(o);
  }
  return saida;
}

/** Acrescenta linhas no fim da tabela com UMA gravação. Devolve a primeira linha usada. */
function anexarLinhas_(chave, objetos) {
  if (!objetos.length) return 0;
  var def = CONFIG.abas[chave];
  var sh = abrirAba_(chave);
  var mapa = mapaColunas_(sh, def);
  var maxIdx = Math.max.apply(null, def.colunas.map(function (c) { return mapa[c[0]]; }));
  var pkIdx = mapa[def.colunas[0][0]];
  var inicio = 2;
  var ult = sh.getLastRow();
  if (ult >= 2) {
    var col = sh.getRange(2, pkIdx + 1, ult - 1, 1).getValues();
    for (var i = col.length - 1; i >= 0; i--) {
      if (col[i][0] !== '' && col[i][0] !== null) { inicio = i + 3; break; }
    }
  }
  var linhas = [];
  var formatos = [];
  objetos.forEach(function (o) {
    var linha = [], fmt = [];
    for (var j = 0; j <= maxIdx; j++) { linha.push(''); fmt.push('@'); }
    def.colunas.forEach(function (c) {
      linha[mapa[c[0]]] = valorParaPlanilha_(c[2], o[c[0]]);
      fmt[mapa[c[0]]] = c[2] === 'data' ? 'dd/MM/yyyy' : '@';
    });
    linhas.push(linha);
    formatos.push(fmt);
  });
  var destino = sh.getRange(inicio, 1, objetos.length, maxIdx + 1);
  if (!destino.isBlank()) {
    throw new Error('As linhas abaixo da tabela "' + def.nome + '" não estão vazias. Limpe-as e tente de novo.');
  }
  destino.setNumberFormats(formatos);
  destino.setValues(linhas);
  SpreadsheetApp.flush();
  objetos.forEach(function (o, i) { o._linha = inicio + i; });
  return inicio;
}

/** alteracoes = [{ linha, valores: { chave: valor } }]. Reescreve só as colunas do contrato, numa única gravação. */
function salvarAlteracoes_(chave, alteracoes) {
  if (!alteracoes.length) return;
  var def = CONFIG.abas[chave];
  var sh = abrirAba_(chave);
  var mapa = mapaColunas_(sh, def);
  var tipos = {};
  def.colunas.forEach(function (c) { tipos[c[0]] = c[2]; });
  var ult = sh.getLastRow();
  if (ult < 2) return;
  var larg = Math.max.apply(null, def.colunas.map(function (c) { return mapa[c[0]]; })) + 1;
  var rng = sh.getRange(2, 1, ult - 1, larg);
  var vals = rng.getValues();
  alteracoes.forEach(function (a) {
    var linha = vals[a.linha - 2];
    if (!linha) throw new Error('Linha ' + a.linha + ' não existe na aba "' + def.nome + '".');
    Object.keys(a.valores).forEach(function (k) {
      if (mapa[k] === undefined) return;
      linha[mapa[k]] = valorParaPlanilha_(tipos[k], a.valores[k]);
    });
  });
  rng.setValues(vals);
  SpreadsheetApp.flush();
}

function semLinha_(o) {
  var c = {};
  Object.keys(o).forEach(function (k) { if (k !== '_linha') c[k] = o[k]; });
  return c;
}

/* ===================================================================== */
/* PARÂMETROS E CORES                                                     */
/* ===================================================================== */

function lerParametros_() {
  var p = JSON.parse(JSON.stringify(CONFIG.parametrosPadrao));
  lerTabela_('parametros').forEach(function (r) {
    if (!(r.chave in p)) return;
    var padrao = CONFIG.parametrosPadrao[r.chave];
    if (typeof padrao === 'number') {
      var n = parseInt(r.valor, 10);
      if (!isNaN(n)) p[r.chave] = n;
    } else if (r.chave === 'diasAtendimento') {
      p[r.chave] = listaCsv_(r.valor).map(function (x) { return parseInt(x, 10); })
        .filter(function (x) { return x >= 0 && x <= 6; });
    } else {
      p[r.chave] = String(r.valor).split('|').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
    }
  });
  return p;
}

function gravarParametros_(p) {
  var existentes = lerTabela_('parametros');
  var alteracoes = [], novos = [];
  Object.keys(p).forEach(function (k) {
    var v = p[k];
    var txt = Array.isArray(v) ? (k === 'dispositivos' ? v.join('|') : v.join(',')) : String(v);
    var achou = null;
    existentes.forEach(function (r) { if (r.chave === k) achou = r; });
    if (achou) alteracoes.push({ linha: achou._linha, valores: { valor: txt } });
    else novos.push({ chave: k, valor: txt });
  });
  salvarAlteracoes_('parametros', alteracoes);
  anexarLinhas_('parametros', novos);
}

function lerCores_() {
  return lerTabela_('cores').map(semLinha_);
}

/* ===================================================================== */
/* CONTEXTO (lê tudo uma vez) E MONTAGEM DA ENTRADA DO MOTOR              */
/* ===================================================================== */

function lerContexto_() {
  var todos = lerTabela_('atendimentos');
  return {
    p: lerParametros_(),
    cores: lerCores_(),
    usuarios: lerTabela_('usuarios'),
    cuidadoras: lerTabela_('cuidadoras'),
    bloqueios: lerTabela_('bloqueios').filter(function (b) { return b.ativo === 'sim'; }),
    atendimentosTodos: todos,
    atendimentos: todos.filter(function (a) { return a.status === 'planejado'; }),
    hoje: hojeIso_()
  };
}

function montarEntrada_(ctx, semanaInicio) {
  var fim = somarDias_(semanaInicio, 6);
  var limiteHist = somarDias_(semanaInicio, -7 * CONFIG.semanasHistorico);
  return {
    semanaInicio: semanaInicio,
    hoje: ctx.hoje,
    config: ctx.p,
    usuarios: ctx.usuarios,
    cuidadoras: ctx.cuidadoras.filter(function (c) { return c.ativo === 'sim'; }),
    cores: ctx.cores,
    bloqueios: ctx.bloqueios,
    atendimentosSemana: ctx.atendimentos.filter(function (a) { return a.data >= semanaInicio && a.data <= fim; }),
    historico: ctx.atendimentos.filter(function (a) { return a.data < semanaInicio && a.data >= limiteHist; })
  };
}

function nomesDasCuidadoras_(ctx, ids) {
  return ids.map(function (id) {
    var c = ctx.cuidadoras.filter(function (x) { return x.id === id; })[0];
    return c ? c.nome : id;
  });
}

function cancelarAtendimentos_(ctx, lista) {
  if (!lista.length) return;
  salvarAlteracoes_('atendimentos', lista.map(function (a) {
    return { linha: a._linha, valores: { status: 'cancelado' } };
  }));
  var ids = {};
  lista.forEach(function (a) { ids[a.id] = true; a.status = 'cancelado'; });
  ctx.atendimentos = ctx.atendimentos.filter(function (a) { return !ids[a.id]; });
}

/** Gera as visitas que faltam. modo: 'completar' (mantém o que existe) ou 'refazer' (recalcula o automático). */
function gerarSemanaInterno_(ctx, semanaIso, modo) {
  var ini = inicioDaSemana_(semanaIso);
  var fim = somarDias_(ini, 6);
  if (fim < ctx.hoje) throw new Error('Esta semana já terminou. Escolha a semana atual ou uma futura.');
  if (modo === 'refazer') {
    cancelarAtendimentos_(ctx, ctx.atendimentos.filter(function (a) {
      return a.data >= ini && a.data <= fim && a.data >= ctx.hoje && a.origem !== 'manual';
    }));
  }
  var res = motorGerarSemana_(montarEntrada_(ctx, ini));
  var proximoId = criarGeradorId_('A', ctx.atendimentosTodos, 5);
  var linhas = res.novos.map(function (n) {
    return {
      id: proximoId(), data: n.data, periodo: n.periodo, usuarioId: n.usuarioId,
      cuidadorasIds: csvDeLista_(n.cuidadorasIds), status: 'planejado', origem: 'auto'
    };
  });
  anexarLinhas_('atendimentos', linhas);
  linhas.forEach(function (l) { ctx.atendimentos.push(l); ctx.atendimentosTodos.push(l); });
  return { criados: linhas.length, avisos: res.avisos };
}

/** Troca a cuidadora em atendimentos futuros. Sem substituta, o atendimento fica "incompleto" (aparece em alerta). */
function reatribuirCuidadora_(ctx, cuidadoraId, dataIni, dataFim, periodo) {
  var ini = dataIni < ctx.hoje ? ctx.hoje : dataIni;
  var afetados = ctx.atendimentos.filter(function (a) {
    return a.data >= ini && a.data <= dataFim && (periodo === 'ambos' || a.periodo === periodo) &&
      listaCsv_(a.cuidadorasIds).indexOf(cuidadoraId) >= 0;
  });
  var estados = {}, alteracoes = [], trocadas = 0, semCobertura = 0;
  afetados.forEach(function (a) {
    var semana = inicioDaSemana_(a.data);
    if (!estados[semana]) estados[semana] = criarEstado_(montarEntrada_(ctx, semana));
    var est = estados[semana];
    var u = est.usuarios[a.usuarioId];
    var restantes = listaCsv_(a.cuidadorasIds).filter(function (x) { return x !== cuidadoraId; });
    estadoRemover_(est, a);
    var cand = u ? candidatas_(est, u, a.data, a.periodo, false, [cuidadoraId]) : [];
    if (u && !cand.length) cand = candidatas_(est, u, a.data, a.periodo, true, [cuidadoraId]);
    if (cand.length) { restantes.push(cand[0].id); trocadas++; } else { semCobertura++; }
    a.cuidadorasIds = csvDeLista_(restantes);
    estadoRegistrar_(est, a);
    alteracoes.push({ linha: a._linha, valores: { cuidadorasIds: a.cuidadorasIds } });
  });
  salvarAlteracoes_('atendimentos', alteracoes);
  return { trocadas: trocadas, semCobertura: semCobertura };
}

function alertasDoAtendimento_(ctx, a) {
  var alertas = [];
  var ids = listaCsv_(a.cuidadorasIds);
  var u = ctx.usuarios.filter(function (x) { return x.id === a.usuarioId; })[0];
  if (ids.length < ctx.p.tamanhoDupla) alertas.push('Faltam cuidadoras neste atendimento.');
  ids.forEach(function (id) {
    var c = ctx.cuidadoras.filter(function (x) { return x.id === id; })[0];
    if (!c) { alertas.push('Cuidadora ' + id + ' não encontrada.'); return; }
    if (c.ativo !== 'sim') alertas.push(c.nome + ' está inativa.');
    var b = cuidadoraBloqueada_(ctx.bloqueios, id, a.data, a.periodo);
    if (b) alertas.push(c.nome + ' está indisponível (' + (b.motivo || 'ausência') + ').');
    if (u) { var e = eligivel_(c, u); if (!e.ok) alertas.push(e.motivo); }
  });
  return alertas;
}

/* ===================================================================== */
/* API DA INTERFACE (única parte exposta ao navegador)                    */
/* ===================================================================== */

function carregarInicial() {
  var ctx = lerContexto_();
  return {
    titulo: CONFIG.titulo,
    hoje: ctx.hoje,
    parametros: ctx.p,
    cores: ctx.cores,
    usuarios: ctx.usuarios.map(semLinha_),
    cuidadoras: ctx.cuidadoras.map(semLinha_),
    bloqueios: ctx.bloqueios.filter(function (b) { return b.dataFim >= ctx.hoje; }).map(semLinha_),
    frequencias: FREQUENCIAS,
    periodos: CONFIG.periodos
  };
}

function carregarEscala(semanaIso) {
  var ctx = lerContexto_();
  var ini = inicioDaSemana_(ehIso_(semanaIso) ? semanaIso : ctx.hoje);
  var fim = somarDias_(ini, 6);
  var ats = ctx.atendimentos.filter(function (a) { return a.data >= ini && a.data <= fim; })
    .sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : a.id < b.id ? -1 : 1; })
    .map(function (a) {
      var o = semLinha_(a);
      o.cuidadorasIds = listaCsv_(a.cuidadorasIds);
      o.alertas = alertasDoAtendimento_(ctx, a);
      return o;
    });
  var pendencias = [];
  if (fim >= ctx.hoje) {
    var est = criarEstado_(montarEntrada_(ctx, ini));
    ctx.usuarios.filter(function (u) { return u.ativo === 'sim'; }).forEach(function (u) {
      var n = necessidadeUsuario_(est, u);
      if (n.faltam > 0) pendencias.push({ usuarioId: u.id, faltam: n.faltam });
    });
  }
  return {
    semanaInicio: ini,
    dias: diasDaSemana_(ini).map(function (d) {
      return { data: d, dow: diaDaSemana_(d), atende: ctx.p.diasAtendimento.indexOf(diaDaSemana_(d)) >= 0 };
    }),
    atendimentos: ats,
    bloqueios: ctx.bloqueios.filter(function (b) { return b.dataFim >= ini && b.dataInicio <= fim; }).map(semLinha_),
    pendencias: pendencias
  };
}

/** modo: 'completar' ou 'refazer'. */
function gerarEscala(semanaIso, modo) {
  return comLock_(function () {
    if (!ehIso_(semanaIso)) throw new Error('Semana inválida.');
    var ctx = lerContexto_();
    var r = gerarSemanaInterno_(ctx, semanaIso, modo === 'refazer' ? 'refazer' : 'completar');
    return {
      mensagem: r.criados + ' atendimento(s) criado(s).' + (r.avisos.length ? ' Veja os avisos.' : ''),
      avisos: r.avisos
    };
  });
}

/**
 * Cria ou altera um atendimento (mover dia/período/cuidadoras). Regras "suaves" pedem confirmação:
 * devolve { ok:false, confirmar:true, avisos } e a tela reenvia com forcar = true.
 */
function salvarAtendimento(d, forcar) {
  return comLock_(function () {
    var ctx = lerContexto_();
    var erros = [];
    var usuario = ctx.usuarios.filter(function (u) { return u.id === d.usuarioId; })[0];
    if (!usuario) erros.push('Escolha o usuário.');
    if (!ehIso_(d.data)) erros.push('Informe uma data válida.');
    if (PERIODOS_IDS.indexOf(d.periodo) < 0) erros.push('Escolha o período.');
    var ids = unicos_(listaCsv_(d.cuidadorasIds));
    if (!ids.length) erros.push('Escolha pelo menos uma cuidadora.');
    if (ids.length > ctx.p.tamanhoDupla) erros.push('O máximo é ' + ctx.p.tamanhoDupla + ' cuidadora(s) por atendimento.');
    ids.forEach(function (id) {
      var c = ctx.cuidadoras.filter(function (x) { return x.id === id; })[0];
      if (!c || c.ativo !== 'sim') erros.push('Cuidadora inválida ou inativa.');
    });
    var existente = null;
    if (d.id) {
      existente = ctx.atendimentos.filter(function (a) { return a.id === d.id; })[0];
      if (!existente) erros.push('Atendimento não encontrado (talvez já tenha sido retirado).');
    }
    if (erros.length) throw new Error(unicos_(erros).join('\n'));

    var semana = inicioDaSemana_(d.data);
    var fimSemana = somarDias_(semana, 6);
    var outros = ctx.atendimentos.filter(function (a) { return !existente || a.id !== existente.id; });
    var mesmoHorario = outros.filter(function (a) { return a.data === d.data && a.periodo === d.periodo; });
    ids.forEach(function (id) {
      mesmoHorario.forEach(function (a) {
        if (listaCsv_(a.cuidadorasIds).indexOf(id) >= 0) {
          throw new Error(nomesDasCuidadoras_(ctx, [id])[0] + ' já está em outro atendimento neste horário.');
        }
      });
    });

    var avisos = [];
    var nomes = {};
    ids.forEach(function (id) {
      var c = ctx.cuidadoras.filter(function (x) { return x.id === id; })[0];
      nomes[id] = c.nome;
      var e = eligivel_(c, usuario);
      if (!e.ok) avisos.push(e.motivo);
      var b = cuidadoraBloqueada_(ctx.bloqueios, id, d.data, d.periodo);
      if (b) avisos.push(c.nome + ' está indisponível neste horário (' + (b.motivo || 'ausência') + ').');
      var repetiu = outros.some(function (a) {
        return a.usuarioId === usuario.id && a.data >= semana && a.data <= fimSemana && listaCsv_(a.cuidadorasIds).indexOf(id) >= 0;
      });
      if (repetiu) avisos.push(c.nome + ' já atendeu ' + usuario.nome + ' nesta semana.');
    });
    if (equipeBloqueada_(ctx.bloqueios, d.data, d.periodo)) avisos.push('A equipe toda está indisponível neste período.');
    if (outros.some(function (a) { return a.usuarioId === usuario.id && a.data === d.data; })) {
      avisos.push(usuario.nome + ' já tem outro atendimento neste dia.');
    }
    var usadasNoTurno = mesmoHorario.reduce(function (s, a) { return s + listaCsv_(a.cuidadorasIds).length; }, 0) + ids.length;
    if (usadasNoTurno > ctx.p.cuidadorasPorTurno) avisos.push('Passa do limite de ' + ctx.p.cuidadorasPorTurno + ' cuidadoras por turno.');
    var familiasNoDia = outros.filter(function (a) { return a.data === d.data; }).length + 1;
    if (familiasNoDia > ctx.p.familiasPorDia) avisos.push('Passa do limite de ' + ctx.p.familiasPorDia + ' famílias por dia.');

    if (avisos.length && !forcar) return { ok: false, confirmar: true, avisos: unicos_(avisos) };

    if (existente) {
      salvarAlteracoes_('atendimentos', [{
        linha: existente._linha,
        valores: { data: d.data, periodo: d.periodo, cuidadorasIds: csvDeLista_(ids), origem: 'manual' }
      }]);
    } else {
      var proximoId = criarGeradorId_('A', ctx.atendimentosTodos, 5);
      anexarLinhas_('atendimentos', [{
        id: proximoId(), data: d.data, periodo: d.periodo, usuarioId: usuario.id,
        cuidadorasIds: csvDeLista_(ids), status: 'planejado', origem: 'manual'
      }]);
    }
    return { ok: true, mensagem: 'Atendimento salvo.' };
  });
}

function retirarAtendimento(id) {
  return comLock_(function () {
    var ctx = lerContexto_();
    var a = ctx.atendimentos.filter(function (x) { return x.id === id; })[0];
    if (!a) throw new Error('Atendimento não encontrado (talvez já tenha sido retirado).');
    cancelarAtendimentos_(ctx, [a]);
    return { ok: true, mensagem: 'Atendimento retirado da escala.' };
  });
}

function salvarUsuario(d) {
  return comLock_(function () {
    var ctx = lerContexto_();
    var erros = [];
    var nome = texto_(d.nome, 80);
    if (!nome) erros.push('Informe o nome do usuário.');
    if (!ctx.cores.some(function (c) { return c.id === d.corId; })) erros.push('Escolha a cor de gravidade.');
    if (!FREQUENCIAS.some(function (f) { return f.id === d.frequencia; })) erros.push('Escolha a frequência de atendimento.');
    if (['manha', 'tarde', 'qualquer'].indexOf(d.periodoPreferido) < 0) erros.push('Escolha o período preferido.');
    var dispositivo = texto_(d.dispositivo, 60);
    if (dispositivo && ctx.p.dispositivos.indexOf(dispositivo) < 0) erros.push('Dispositivo fora da lista (cadastre em Configurações).');
    if (texto_(d.observacoes).length > 300) erros.push('Observações: no máximo 300 caracteres.');
    var existente = d.id ? ctx.usuarios.filter(function (u) { return u.id === d.id; })[0] : null;
    if (d.id && !existente) erros.push('Usuário não encontrado.');
    var ativo = simNao_(d.ativo);
    var ativos = ctx.usuarios.filter(function (u) { return u.ativo === 'sim' && (!existente || u.id !== existente.id); }).length;
    if (ativo === 'sim' && ativos >= ctx.p.maxUsuarios) {
      erros.push('Limite de ' + ctx.p.maxUsuarios + ' usuários ativos atingido. Inative um usuário ou aumente o limite em Configurações.');
    }
    if (erros.length) throw new Error(erros.join('\n'));

    var valores = {
      nome: nome, endereco: texto_(d.endereco, 120), corId: d.corId,
      precisaBanho: simNao_(d.precisaBanho), precisaAlimentacao: simNao_(d.precisaAlimentacao),
      precisaLevantar: simNao_(d.precisaLevantar), dispositivo: dispositivo,
      observacoes: texto_(d.observacoes, 300), frequencia: d.frequencia,
      periodoPreferido: d.periodoPreferido, ativo: ativo
    };
    var id;
    if (existente) {
      id = existente.id;
      salvarAlteracoes_('usuarios', [{ linha: existente._linha, valores: valores }]);
      if (existente.ativo === 'sim' && ativo === 'nao') {
        cancelarAtendimentos_(ctx, ctx.atendimentos.filter(function (a) { return a.usuarioId === id && a.data >= ctx.hoje; }));
      }
    } else {
      valores.id = criarGeradorId_('U', ctx.usuarios, 3)();
      id = valores.id;
      anexarLinhas_('usuarios', [valores]);
    }
    return { id: id, mensagem: 'Usuário salvo. Se as necessidades mudaram, use "Refazer semana" para reavaliar as cuidadoras.' };
  });
}

function salvarCuidadora(d) {
  return comLock_(function () {
    var ctx = lerContexto_();
    var erros = [];
    var nome = texto_(d.nome, 60);
    if (!nome) erros.push('Informe o nome da cuidadora.');
    var cores = unicos_(listaCsv_(d.coresPermitidas));
    cores.forEach(function (c) {
      if (!ctx.cores.some(function (x) { return x.id === c; })) erros.push('Cor inválida em "cores que atende".');
    });
    if (texto_(d.observacoes).length > 300) erros.push('Observações: no máximo 300 caracteres.');
    var existente = d.id ? ctx.cuidadoras.filter(function (c) { return c.id === d.id; })[0] : null;
    if (d.id && !existente) erros.push('Cuidadora não encontrada.');
    if (erros.length) throw new Error(unicos_(erros).join('\n'));
    var todasAsCores = ctx.cores.length === cores.length;
    var valores = {
      nome: nome, restricaoPeso: simNao_(d.restricaoPeso), restricaoBanho: simNao_(d.restricaoBanho),
      coresPermitidas: todasAsCores ? '' : csvDeLista_(cores),
      observacoes: texto_(d.observacoes, 300), ativo: simNao_(d.ativo)
    };
    var msg = 'Cuidadora salva.';
    if (existente) {
      salvarAlteracoes_('cuidadoras', [{ linha: existente._linha, valores: valores }]);
      if (existente.ativo === 'sim' && valores.ativo === 'nao') {
        var ctx2 = lerContexto_();
        var r = reatribuirCuidadora_(ctx2, existente.id, ctx2.hoje, somarDias_(ctx2.hoje, 365), 'ambos');
        msg += ' ' + r.trocadas + ' atendimento(s) reatribuído(s); ' + r.semCobertura + ' sem cobertura.';
      }
    } else {
      valores.id = criarGeradorId_('C', ctx.cuidadoras, 3)();
      anexarLinhas_('cuidadoras', [valores]);
    }
    return { mensagem: msg + ' As restrições valem para as próximas gerações; use "Refazer semana" para reavaliar a escala atual.' };
  });
}

/** Ausência, atestado, falta ou reunião. Cuidadora específica: reatribui. 'todas': retira os atendimentos e reagenda. */
function registrarBloqueio(d) {
  return comLock_(function () {
    var ctx = lerContexto_();
    var erros = [];
    var quem = d.cuidadoraId === 'todas' ? 'todas' : d.cuidadoraId;
    if (quem !== 'todas' && !ctx.cuidadoras.some(function (c) { return c.id === quem; })) erros.push('Escolha a cuidadora (ou "Toda a equipe").');
    if (!ehIso_(d.dataInicio) || !ehIso_(d.dataFim)) erros.push('Informe as datas inicial e final.');
    else if (d.dataFim < d.dataInicio) erros.push('A data final não pode ser antes da inicial.');
    else if (diferencaDias_(d.dataFim, d.dataInicio) > CONFIG.maxDiasBloqueio) erros.push('O período é longo demais (máximo ' + CONFIG.maxDiasBloqueio + ' dias).');
    if (['manha', 'tarde', 'ambos'].indexOf(d.periodo) < 0) erros.push('Escolha o período.');
    var motivo = texto_(d.motivo, 80);
    if (!motivo) erros.push('Informe o motivo (ex.: reunião, atestado).');
    if (erros.length) throw new Error(erros.join('\n'));

    var bloqueio = {
      id: criarGeradorId_('B', ctx.bloqueios.concat(lerTabela_('bloqueios')), 3)(),
      cuidadoraId: quem, dataInicio: d.dataInicio, dataFim: d.dataFim, periodo: d.periodo, motivo: motivo, ativo: 'sim'
    };
    anexarLinhas_('bloqueios', [bloqueio]);
    ctx.bloqueios.push(bloqueio);

    var avisos = [];
    var msg;
    if (quem === 'todas') {
      var ini = d.dataInicio < ctx.hoje ? ctx.hoje : d.dataInicio;
      var afetados = ctx.atendimentos.filter(function (a) {
        return a.data >= ini && a.data <= d.dataFim && (d.periodo === 'ambos' || a.periodo === d.periodo);
      });
      var semanas = unicos_(afetados.map(function (a) { return inicioDaSemana_(a.data); }));
      cancelarAtendimentos_(ctx, afetados);
      var criados = 0;
      semanas.forEach(function (s) {
        var r = gerarSemanaInterno_(ctx, s, 'completar');
        criados += r.criados;
        avisos = avisos.concat(r.avisos);
      });
      msg = 'Bloqueio registrado. ' + afetados.length + ' atendimento(s) retirado(s) e ' + criados + ' reagendado(s) em outros horários.';
    } else {
      var rr = reatribuirCuidadora_(ctx, quem, d.dataInicio, d.dataFim, d.periodo);
      msg = 'Ausência registrada. ' + rr.trocadas + ' atendimento(s) passaram para outra cuidadora' +
        (rr.semCobertura ? '; ' + rr.semCobertura + ' ficaram sem cobertura (veja os alertas na escala).' : '.');
    }
    return { mensagem: msg, avisos: avisos };
  });
}

/** Desativa o bloqueio. Não reagenda sozinho: use "Atualizar escala". */
function removerBloqueio(id) {
  return comLock_(function () {
    var b = lerTabela_('bloqueios').filter(function (x) { return x.id === id; })[0];
    if (!b) throw new Error('Bloqueio não encontrado.');
    salvarAlteracoes_('bloqueios', [{ linha: b._linha, valores: { ativo: 'nao' } }]);
    return { mensagem: 'Bloqueio removido. Use "Atualizar escala" para voltar a usar esse horário.' };
  });
}

function salvarConfiguracao(d) {
  return comLock_(function () {
    var ctx = lerContexto_();
    var erros = [];
    function inteiro(valor, min, max, rotulo) {
      var n = parseInt(valor, 10);
      if (isNaN(n) || n < min || n > max) { erros.push(rotulo + ': informe um número de ' + min + ' a ' + max + '.'); return min; }
      return n;
    }
    var p = {
      maxUsuarios: inteiro(d.maxUsuarios, 1, 200, 'Máximo de usuários'),
      tamanhoDupla: inteiro(d.tamanhoDupla, 1, 4, 'Cuidadoras por atendimento'),
      cuidadorasPorTurno: inteiro(d.cuidadorasPorTurno, 1, 60, 'Cuidadoras por turno'),
      familiasPorDia: inteiro(d.familiasPorDia, 1, 60, 'Famílias por dia'),
      diasAtendimento: unicos_(listaCsv_(d.diasAtendimento).map(function (x) { return parseInt(x, 10); }))
        .filter(function (x) { return x >= 0 && x <= 6; }),
      dispositivos: unicos_((d.dispositivos || []).map(function (x) { return texto_(x, 60); }).filter(function (x) { return x; })).slice(0, 30)
    };
    if (p.cuidadorasPorTurno < p.tamanhoDupla) erros.push('Cuidadoras por turno não pode ser menor que cuidadoras por atendimento.');
    if (!p.diasAtendimento.length) erros.push('Marque pelo menos um dia de atendimento.');

    var cores = d.cores || [];
    if (!cores.length || cores.length > CONFIG.maxCores) erros.push('Defina de 1 a ' + CONFIG.maxCores + ' cores.');
    cores.forEach(function (c) {
      if (!texto_(c.nome, 20)) erros.push('Toda cor precisa de um nome.');
      if (!/^#[0-9a-fA-F]{6}$/.test(String(c.hex || ''))) erros.push('Cor inválida: ' + texto_(c.nome, 20) + '.');
      if (c.id && !ctx.cores.some(function (x) { return x.id === c.id; })) erros.push('Cor não encontrada.');
    });
    ctx.cores.forEach(function (x) {
      if (!cores.some(function (c) { return c.id === x.id; })) erros.push('Não é possível remover a cor "' + x.nome + '".');
    });
    if (erros.length) throw new Error(unicos_(erros).join('\n'));

    gravarParametros_(p);
    var alteracoes = [], novas = [];
    var proximoId = criarGeradorId_('K', ctx.cores, 1);
    var coresAtuais = lerTabela_('cores');
    cores.forEach(function (c) {
      var v = { nome: texto_(c.nome, 20), hex: String(c.hex).toLowerCase(), significado: texto_(c.significado, 200) };
      if (c.id) {
        var atual = coresAtuais.filter(function (x) { return x.id === c.id; })[0];
        alteracoes.push({ linha: atual._linha, valores: v });
      } else {
        v.id = proximoId();
        novas.push(v);
      }
    });
    salvarAlteracoes_('cores', alteracoes);
    anexarLinhas_('cores', novas);
    return { mensagem: 'Configurações salvas.' };
  });
}
