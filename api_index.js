const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Parsing da URL do banco ──────────────────────────────────────
// mysql2 às vezes rejeita a URI diretamente no Railway.
// Fazemos o parse manual para garantir que funcione.
function parseMysqlUrl(url) {
  try {
    const u = new URL(url.replace(/^mysql2?:\/\//, 'http://'));
    return {
      host:     u.hostname,
      port:     parseInt(u.port) || 3306,
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  } catch (e) {
    throw new Error('URL do banco invalida: ' + url + ' — ' + e.message);
  }
}

const rawUrl = process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL || '';
console.log('MYSQL_PUBLIC_URL definida:', !!rawUrl);
console.log('Primeiros 30 chars:', rawUrl.slice(0, 30) + '...');

if (!rawUrl) {
  console.error('ERRO FATAL: variavel MYSQL_PUBLIC_URL nao encontrada.');
  console.error('Defina-a em Variables no painel do Railway.');
  process.exit(1);
}

let dbConfig;
try {
  dbConfig = parseMysqlUrl(rawUrl);
  console.log('Banco:', dbConfig.host + ':' + dbConfig.port + '/' + dbConfig.database);
  console.log('Usuario:', dbConfig.user);
} catch (e) {
  console.error('Erro ao parsear URL:', e.message);
  process.exit(1);
}

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit:    10,
  connectTimeout:     15000,
  ssl: { rejectUnauthorized: false }
});

// ── Cria tabela se nao existir ───────────────────────────────────
async function inicializar() {
  console.log('Conectando ao banco...');
  const conn = await pool.getConnection();
  console.log('Conexao OK. Criando tabela se necessario...');
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ferias (
      id               VARCHAR(50)   PRIMARY KEY,
      matricula        VARCHAR(255)  DEFAULT '',
      nome             TEXT,
      cargo            VARCHAR(255)  DEFAULT '',
      lotacao          VARCHAR(255)  DEFAULT '',
      setor            VARCHAR(255)  DEFAULT '',
      periodo          VARCHAR(255)  DEFAULT '',
      tipo             VARCHAR(255)  DEFAULT '',
      dias             INT           DEFAULT NULL,
      inicio           DATE          DEFAULT NULL,
      fim              DATE          DEFAULT NULL,
      obs              TEXT,
      status           VARCHAR(50)   DEFAULT 'Pendente',
      motivo_negacao   TEXT,
      data_envio       DATE          DEFAULT NULL,
      mes              VARCHAR(50)   DEFAULT '',
      ano              VARCHAR(10)   DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  conn.release();
  console.log('Tabela pronta.');
}

// ── Rota de saude ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'Ferias IPC API', versao: '1.1' });
});

// ── GET /ferias ──────────────────────────────────────────────────
app.get('/ferias', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM ferias ORDER BY data_envio DESC'
    );
    const dados = rows.map(r => ({
      ...r,
      inicio:     r.inicio     ? fmtDate(r.inicio)     : '',
      fim:        r.fim        ? fmtDate(r.fim)         : '',
      data_envio: r.data_envio ? fmtDate(r.data_envio)  : '',
      dias:       r.dias !== null ? String(r.dias) : ''
    }));
    res.json(dados);
  } catch (err) {
    console.error('GET /ferias erro:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── POST /ferias ─────────────────────────────────────────────────
app.post('/ferias', async (req, res) => {
  try {
    const r = req.body;
    if (!r || !r.id) {
      return res.status(400).json({ erro: 'Campo id e obrigatorio' });
    }
    await pool.execute(
      `INSERT INTO ferias
         (id, matricula, nome, cargo, lotacao, setor, periodo, tipo,
          dias, inicio, fim, obs, status, motivo_negacao, data_envio, mes, ano)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         matricula      = VALUES(matricula),
         nome           = VALUES(nome),
         cargo          = VALUES(cargo),
         lotacao        = VALUES(lotacao),
         setor          = VALUES(setor),
         periodo        = VALUES(periodo),
         tipo           = VALUES(tipo),
         dias           = VALUES(dias),
         inicio         = VALUES(inicio),
         fim            = VALUES(fim),
         obs            = VALUES(obs),
         status         = VALUES(status),
         motivo_negacao = VALUES(motivo_negacao),
         data_envio     = VALUES(data_envio),
         mes            = VALUES(mes),
         ano            = VALUES(ano)`,
      [
        r.id,
        r.matricula      || '',
        r.nome           || '',
        r.cargo          || '',
        r.lotacao        || '',
        r.setor          || '',
        r.periodo        || '',
        r.tipo           || '',
        parseInt(r.dias) || null,
        r.inicio         || null,
        r.fim            || null,
        r.obs            || '',
        r.status         || 'Pendente',
        r.motivo_negacao || '',
        r.data_envio     || null,
        r.mes            || '',
        r.ano            || ''
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /ferias erro:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── PATCH /ferias/:id ────────────────────────────────────────────
app.patch('/ferias/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, motivo_negacao } = req.body;
    if (!status) return res.status(400).json({ erro: 'status e obrigatorio' });
    const [result] = await pool.execute(
      'UPDATE ferias SET status=?, motivo_negacao=? WHERE id=?',
      [status, motivo_negacao || '', id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Registro nao encontrado' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /ferias erro:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Helper de data ───────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().slice(0, 10);
  } catch { return ''; }
}

// ── Iniciar servidor ─────────────────────────────────────────────
inicializar()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Servidor rodando na porta ' + PORT);
    });
  })
  .catch(err => {
    console.error('Erro ao conectar ao banco:', err.message);
    console.error('Stack:', err.stack);
    process.exit(1);
  });
