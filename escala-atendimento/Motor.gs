/**
 * Motor.gs — regras de distribuição da escala (funções puras, sem planilha).
 *
 * Regras que o motor aplica:
 *  1. Restrições da cuidadora (peso, banho, cores) NUNCA são violadas na geração automática.
 *  2. Durante a semana, a mesma cuidadora não repete o mesmo usuário
 *     (se for impossível cumprir, repete só como último recurso e avisa).
 *  3. Entre semanas, prefere quem atendeu aquele usuário há mais tempo (rodízio).
 *  4. Respeita ausências/reuniões (Bloqueios), cuidadoras por turno e famílias por dia.
 *  5. Prioriza usuários de cor mais grave; espalha as visitas do mesmo usuário em dias diferentes.
 *  6. Equilibra a carga entre cuidadoras (visitas com banho/levantar pesam mais).
 *
 * Entrada (ent): { semanaInicio, hoje, config, usuarios[], cuidadoras[] (ativas),
 *                  cores[] (da mais leve para a mais grave), bloqueios[] (ativos),
 *                  atendimentosSemana[], historico[] }
 */

var PERIODOS_IDS = ['manha', 'tarde'];

/** Devolve { ok, motivo } dizendo se a cuidadora pode atender o usuário. */
function eligivel_(cuidadora, usuario) {
  if (usuario.precisaLevantar === 'sim' && cuidadora.restricaoPeso === 'sim') {
    return { ok: false, motivo: cuidadora.nome + ' não pode pegar peso e ' + usuario.nome + ' precisa de ajuda para levantar.' };
  }
  if (usuario.precisaBanho === 'sim' && cuidadora.restricaoBanho === 'sim') {
    return { ok: false, motivo: cuidadora.nome + ' não faz banho e ' + usuario.nome + ' precisa de ajuda no banho.' };
  }
  var permitidas = listaCsv_(cuidadora.coresPermitidas);
  if (permitidas.length && permitidas.indexOf(usuario.corId) < 0) {
    return { ok: false, motivo: cuidadora.nome + ' não atende a cor de gravidade de ' + usuario.nome + '.' };
  }
  return { ok: true, motivo: '' };
}

function cuidadoraBloqueada_(bloqueios, cuidadoraId, data, periodo) {
  for (var i = 0; i < bloqueios.length; i++) {
    var b = bloqueios[i];
    if (b.cuidadoraId !== cuidadoraId && b.cuidadoraId !== 'todas') continue;
    if (data < b.dataInicio || data > b.dataFim) continue;
    if (b.periodo === 'ambos' || b.periodo === periodo) return b;
  }
  return null;
}

function equipeBloqueada_(bloqueios, data, periodo) {
  return cuidadoraBloqueada_(bloqueios, 'todas', data, periodo);
}

function pesoVisita_(usuario) {
  return 1 + (usuario.precisaBanho === 'sim' ? 1 : 0) + (usuario.precisaLevantar === 'sim' ? 1 : 0);
}

function ocupacao_(est, data, periodo) {
  var k = data + '|' + periodo;
  if (!est.oc[k]) est.oc[k] = { cuidadoras: {}, usadas: 0, visitas: 0 };
  return est.oc[k];
}

function criarEstado_(ent) {
  var est = {
    cfg: ent.config, semanaInicio: ent.semanaInicio, hoje: ent.hoje,
    usuarios: {}, cuidadoras: ent.cuidadoras, bloqueios: ent.bloqueios, cores: ent.cores,
    oc: {}, diaVis: {}, carga: {}, usoUsuario: {}, diasUsuario: {}, feitas: {},
    hist: {}, ultima: {}
  };
  ent.usuarios.forEach(function (u) { est.usuarios[u.id] = u; });
  ent.cuidadoras.forEach(function (c) { est.carga[c.id] = 0; });
  ent.historico.forEach(function (a) {
    if (!est.ultima[a.usuarioId] || a.data > est.ultima[a.usuarioId]) est.ultima[a.usuarioId] = a.data;
    est.hist[a.usuarioId] = est.hist[a.usuarioId] || {};
    listaCsv_(a.cuidadorasIds).forEach(function (cid) {
      est.hist[a.usuarioId][cid] = (est.hist[a.usuarioId][cid] || 0) + 1;
    });
  });
  ent.atendimentosSemana.forEach(function (a) { estadoRegistrar_(est, a); });
  return est;
}

function estadoRegistrar_(est, a) {
  var u = est.usuarios[a.usuarioId];
  var peso = u ? pesoVisita_(u) : 1;
  var ids = listaCsv_(a.cuidadorasIds);
  var oc = ocupacao_(est, a.data, a.periodo);
  ids.forEach(function (cid) {
    oc.cuidadoras[cid] = true;
    est.carga[cid] = (est.carga[cid] || 0) + peso;
    est.usoUsuario[a.usuarioId] = est.usoUsuario[a.usuarioId] || {};
    est.usoUsuario[a.usuarioId][cid] = (est.usoUsuario[a.usuarioId][cid] || 0) + 1;
  });
  oc.usadas += ids.length;
  oc.visitas++;
  est.diaVis[a.data] = (est.diaVis[a.data] || 0) + 1;
  est.diasUsuario[a.usuarioId] = est.diasUsuario[a.usuarioId] || [];
  est.diasUsuario[a.usuarioId].push(a.data);
  est.feitas[a.usuarioId] = (est.feitas[a.usuarioId] || 0) + 1;
}

function estadoRemover_(est, a) {
  var u = est.usuarios[a.usuarioId];
  var peso = u ? pesoVisita_(u) : 1;
  var ids = listaCsv_(a.cuidadorasIds);
  var oc = ocupacao_(est, a.data, a.periodo);
  ids.forEach(function (cid) {
    delete oc.cuidadoras[cid];
    est.carga[cid] = Math.max(0, (est.carga[cid] || 0) - peso);
    if (est.usoUsuario[a.usuarioId] && est.usoUsuario[a.usuarioId][cid]) est.usoUsuario[a.usuarioId][cid]--;
  });
  oc.usadas = Math.max(0, oc.usadas - ids.length);
  oc.visitas = Math.max(0, oc.visitas - 1);
  est.diaVis[a.data] = Math.max(0, (est.diaVis[a.data] || 0) - 1);
  var dias = est.diasUsuario[a.usuarioId] || [];
  var pos = dias.indexOf(a.data);
  if (pos >= 0) dias.splice(pos, 1);
  est.feitas[a.usuarioId] = Math.max(0, (est.feitas[a.usuarioId] || 0) - 1);
}

/** Quantas visitas o usuário precisa nesta semana, quantas já tem e quantas faltam. */
function necessidadeUsuario_(est, u) {
  var fr = frequenciaPorId_(u.frequencia);
  var feitas = est.feitas[u.id] || 0;
  var precisa;
  if (fr.porSemana) {
    precisa = fr.porSemana;
  } else {
    var ult = est.ultima[u.id];
    var fimSemana = somarDias_(est.semanaInicio, 6);
    precisa = (!ult || diferencaDias_(fimSemana, ult) >= fr.intervaloDias) ? 1 : 0;
  }
  return { precisa: precisa, feitas: feitas, faltam: Math.max(0, precisa - feitas) };
}

/**
 * Cuidadoras que podem atender o usuário neste horário, da melhor para a pior.
 * relaxar = true permite repetir cuidadora que já atendeu o usuário na semana.
 */
function candidatas_(est, u, data, periodo, relaxar, excluir) {
  var oc = ocupacao_(est, data, periodo);
  var uso = est.usoUsuario[u.id] || {};
  var hist = est.hist[u.id] || {};
  var lista = est.cuidadoras.filter(function (c) {
    if (excluir && excluir.indexOf(c.id) >= 0) return false;
    if (oc.cuidadoras[c.id]) return false;
    if (cuidadoraBloqueada_(est.bloqueios, c.id, data, periodo)) return false;
    if (!eligivel_(c, u).ok) return false;
    if (!relaxar && uso[c.id]) return false;
    return true;
  });
  var pontos = {};
  lista.forEach(function (c) {
    pontos[c.id] = (est.carga[c.id] || 0) * 4 + (hist[c.id] || 0) * 16 + (hash_(c.id + u.id + est.semanaInicio) % 7);
  });
  lista.sort(function (a, b) { return pontos[a.id] - pontos[b.id]; });
  return lista;
}

function indiceCor_(cores, corId) {
  for (var i = 0; i < cores.length; i++) if (cores[i].id === corId) return i;
  return 0;
}

/** Gera as visitas que faltam na semana (não mexe no que já existe). */
function motorGerarSemana_(ent) {
  var est = criarEstado_(ent);
  var cfg = ent.config;
  var tam = cfg.tamanhoDupla;
  var avisos = [];
  var novos = [];

  var slots = [];
  var idx = 0;
  diasDaSemana_(ent.semanaInicio).forEach(function (data) {
    if (data < ent.hoje) return;
    if (cfg.diasAtendimento.indexOf(diaDaSemana_(data)) < 0) return;
    PERIODOS_IDS.forEach(function (p) {
      if (equipeBloqueada_(est.bloqueios, data, p)) return;
      slots.push({ data: data, periodo: p, indice: idx++ });
    });
  });

  var ativos = ent.usuarios.filter(function (u) { return u.ativo === 'sim'; });
  var fila = ativos.map(function (u) { return { u: u, nec: necessidadeUsuario_(est, u) }; })
    .filter(function (x) { return x.nec.faltam > 0; });
  fila.sort(function (a, b) {
    return (indiceCor_(est.cores, b.u.corId) - indiceCor_(est.cores, a.u.corId)) ||
      (b.nec.faltam - a.nec.faltam) || a.u.nome.localeCompare(b.u.nome);
  });

  function melhorSlot(u, relaxar) {
    var melhor = null;
    slots.forEach(function (s) {
      if ((est.diasUsuario[u.id] || []).indexOf(s.data) >= 0) return;
      if ((est.diaVis[s.data] || 0) >= cfg.familiasPorDia) return;
      var oc = ocupacao_(est, s.data, s.periodo);
      if (oc.usadas + tam > cfg.cuidadorasPorTurno) return;
      var cand = candidatas_(est, u, s.data, s.periodo, relaxar);
      if (cand.length < tam) return;
      var pontos = 0;
      if (u.periodoPreferido !== 'qualquer' && s.periodo !== u.periodoPreferido) pontos += 40;
      (est.diasUsuario[u.id] || []).forEach(function (d) {
        var dist = Math.abs(diferencaDias_(s.data, d));
        if (dist < 3) pontos += (3 - dist) * 15;
      });
      pontos += (est.diaVis[s.data] || 0) * 4 + oc.visitas * 2 + s.indice * 0.5;
      if (!melhor || pontos < melhor.pontos) melhor = { slot: s, ids: cand.slice(0, tam).map(function (c) { return c.id; }), pontos: pontos };
    });
    return melhor;
  }

  fila.forEach(function (item) {
    var u = item.u;
    for (var k = 0; k < item.nec.faltam; k++) {
      var r = melhorSlot(u, false);
      var repetiu = false;
      if (!r) {
        r = melhorSlot(u, true);
        repetiu = !!r;
      }
      if (!r) {
        var elegiveis = est.cuidadoras.filter(function (c) { return eligivel_(c, u).ok; }).length;
        avisos.push(elegiveis < tam
          ? u.nome + ': não há cuidadoras suficientes com as restrições compatíveis (' + elegiveis + ' elegível(is)).'
          : u.nome + ': sem vaga para ' + (item.nec.faltam - k) + ' visita(s) (capacidade, ausências ou limite por dia).');
        break;
      }
      var a = { data: r.slot.data, periodo: r.slot.periodo, usuarioId: u.id, cuidadorasIds: csvDeLista_(r.ids) };
      estadoRegistrar_(est, a);
      novos.push({ data: a.data, periodo: a.periodo, usuarioId: u.id, cuidadorasIds: r.ids });
      if (repetiu) avisos.push(u.nome + ': uma cuidadora repetiu na semana (' + a.data + ') por falta de alternativa.');
    }
  });

  return { novos: novos, avisos: avisos };
}
