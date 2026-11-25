/**
 * Utilitarios.gs — funções puras (não acessam a planilha).
 *
 * Datas são sempre texto ISO 'yyyy-MM-dd'. As contas de calendário usam UTC
 * apenas para somar dias e achar o dia da semana, então não dependem de fuso.
 * Funções terminadas em "_" são privadas: o Apps Script não as expõe ao navegador.
 */

var FREQUENCIAS = [
  { id: 's1', nome: '1 vez por semana', porSemana: 1 },
  { id: 's2', nome: '2 vezes por semana', porSemana: 2 },
  { id: 's3', nome: '3 vezes por semana', porSemana: 3 },
  { id: 'q15', nome: 'A cada 15 dias', intervaloDias: 14 },
  { id: 'm1', nome: '1 vez por mês', intervaloDias: 28 }
];

function frequenciaPorId_(id) {
  for (var i = 0; i < FREQUENCIAS.length; i++) {
    if (FREQUENCIAS[i].id === id) return FREQUENCIAS[i];
  }
  return FREQUENCIAS[0];
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function ehIso_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = isoParaUtc_(s);
  return utcParaIso_(d) === s;
}

function isoParaUtc_(iso) {
  var p = iso.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}

function utcParaIso_(d) {
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

function somarDias_(iso, n) {
  var d = isoParaUtc_(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return utcParaIso_(d);
}

/** 0 = domingo ... 6 = sábado */
function diaDaSemana_(iso) {
  return isoParaUtc_(iso).getUTCDay();
}

/** A semana da escala vai de domingo a sábado. */
function inicioDaSemana_(iso) {
  return somarDias_(iso, -diaDaSemana_(iso));
}

function diasDaSemana_(inicioIso) {
  var lista = [];
  for (var i = 0; i < 7; i++) lista.push(somarDias_(inicioIso, i));
  return lista;
}

/** a - b, em dias */
function diferencaDias_(a, b) {
  return Math.round((isoParaUtc_(a).getTime() - isoParaUtc_(b).getTime()) / 86400000);
}

function normalizarTexto_(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function texto_(v, max) {
  var s = String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return max ? s.substring(0, max) : s;
}

function simNao_(v) {
  return (v === true || v === 'sim') ? 'sim' : 'nao';
}

function listaCsv_(s) {
  if (Array.isArray(s)) return s.slice();
  var t = String(s == null ? '' : s).trim();
  if (!t) return [];
  return t.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

function csvDeLista_(lista) {
  return (lista || []).join(',');
}

function unicos_(lista) {
  var visto = {};
  return lista.filter(function (x) {
    if (visto[x]) return false;
    visto[x] = true;
    return true;
  });
}

/** Número pequeno e estável a partir de um texto (desempate que varia de semana para semana). */
function hash_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Cria um gerador de ids sequenciais (ex.: U001, U002) a partir dos já existentes. */
function criarGeradorId_(prefixo, existentes, largura) {
  var maior = 0;
  existentes.forEach(function (o) {
    var m = String(o.id || '').match(/(\d+)$/);
    if (m && String(o.id).indexOf(prefixo) === 0) maior = Math.max(maior, parseInt(m[1], 10));
  });
  return function () {
    maior++;
    var n = String(maior);
    while (n.length < largura) n = '0' + n;
    return prefixo + n;
  };
}
