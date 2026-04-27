const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT;
if (!PORT) { console.error('ERRO: variavel PORT nao definida pelo Railway'); process.exit(1); }

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve o HTML principal em qualquer rota que não seja /ferias ou /teste
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Parse da URL ─────────────────────────────────────────────────
function parseMysqlUrl(url) {
  const u = new URL(url.replace(/^mysql2?:\/\//, 'http://'));
  return {
    host:     u.hostname,
    port:     parseInt(u.port) || 3306,
    user:     decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

const rawUrl = process.env.MYSQL_PUBLIC_URL
  || process.env.DATABASE_URL
  || '';

if (!rawUrl) {
  console.error('ERRO: MYSQL_PUBLIC_URL nao definida.');
  process.exit(1);
}

const dbConfig = parseMysqlUrl(rawUrl);
console.log('Conectando a:', dbConfig.host + ':' + dbConfig.port + '/' + dbConfig.database);

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit:    10,
  connectTimeout:     20000,
  ssl: { rejectUnauthorized: false }
});

// ── Cria tabela ───────────────────────────────────────────────────
async function inicializar() {
  const conn = await pool.getConnection();
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ferias (
      id               VARCHAR(50)  PRIMARY KEY,
      matricula        VARCHAR(255) DEFAULT '',
      nome             TEXT,
      cargo            VARCHAR(255) DEFAULT '',
      lotacao          VARCHAR(255) DEFAULT '',
      setor            VARCHAR(255) DEFAULT '',
      periodo          VARCHAR(255) DEFAULT '',
      tipo             VARCHAR(255) DEFAULT '',
      dias             INT          DEFAULT NULL,
      inicio           DATE         DEFAULT NULL,
      fim              DATE         DEFAULT NULL,
      obs              TEXT,
      status           VARCHAR(50)  DEFAULT 'Pendente',
      motivo_negacao   TEXT,
      data_envio       DATE         DEFAULT NULL,
      mes              VARCHAR(50)  DEFAULT '',
      ano              VARCHAR(10)  DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  conn.release();
  console.log('Tabela pronta.');
}

// ── Helper data ───────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  try { return (d instanceof Date ? d : new Date(d)).toISOString().slice(0,10); }
  catch { return ''; }
}

// ── GET / — status + diagnóstico ─────────────────────────────────
app.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT COUNT(*) as total FROM ferias');
    res.json({
      status:  'ok',
      versao:  '1.2',
      banco:   dbConfig.host + '/' + dbConfig.database,
      registros_na_tabela: rows[0].total
    });
  } catch(err) {
    res.json({ status: 'ok', versao: '1.2', erro_banco: err.message });
  }
});

// ── GET /teste — insere registro de teste direto pelo navegador ───
app.get('/teste', async (req, res) => {
  try {
    const id = 'teste_' + Date.now();
    await pool.execute(
      `INSERT INTO ferias (id, nome, matricula, status, data_envio, mes, ano)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, 'Servidor Teste', '000000', 'Pendente', new Date().toISOString().slice(0,10), 'Abril', '2025']
    );
    const [rows] = await pool.execute('SELECT COUNT(*) as total FROM ferias');
    res.json({ ok: true, id_inserido: id, total_registros: rows[0].total });
  } catch(err) {
    res.status(500).json({ erro: err.message, stack: err.stack });
  }
});

// ── GET /ferias ───────────────────────────────────────────────────
app.get('/ferias', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM ferias ORDER BY data_envio DESC');
    res.json(rows.map(r => ({
      ...r,
      inicio:     fmtDate(r.inicio),
      fim:        fmtDate(r.fim),
      data_envio: fmtDate(r.data_envio),
      dias:       r.dias !== null ? String(r.dias) : ''
    })));
  } catch(err) {
    console.error('GET /ferias:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── POST /ferias ──────────────────────────────────────────────────
app.post('/ferias', async (req, res) => {
  console.log('POST /ferias recebido:', JSON.stringify(req.body).slice(0,120));
  try {
    const r = req.body;
    if (!r || !r.id) return res.status(400).json({ erro: 'id obrigatorio' });

    await pool.execute(
      `INSERT INTO ferias
         (id,matricula,nome,cargo,lotacao,setor,periodo,tipo,
          dias,inicio,fim,obs,status,motivo_negacao,data_envio,mes,ano)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         matricula=VALUES(matricula), nome=VALUES(nome), cargo=VALUES(cargo),
         lotacao=VALUES(lotacao), setor=VALUES(setor), periodo=VALUES(periodo),
         tipo=VALUES(tipo), dias=VALUES(dias), inicio=VALUES(inicio),
         fim=VALUES(fim), obs=VALUES(obs), status=VALUES(status),
         motivo_negacao=VALUES(motivo_negacao), data_envio=VALUES(data_envio),
         mes=VALUES(mes), ano=VALUES(ano)`,
      [
        r.id, r.matricula||'', r.nome||'', r.cargo||'', r.lotacao||'',
        r.setor||'', r.periodo||'', r.tipo||'',
        parseInt(r.dias)||null,
        r.inicio||null, r.fim||null, r.obs||'',
        r.status||'Pendente', r.motivo_negacao||'',
        r.data_envio||null, r.mes||'', r.ano||''
      ]
    );
    console.log('Registro salvo:', r.id);
    res.json({ ok: true, id: r.id });
  } catch(err) {
    console.error('POST /ferias erro:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── PATCH /ferias/:id ─────────────────────────────────────────────
app.patch('/ferias/:id', async (req, res) => {
  console.log('PATCH /ferias/' + req.params.id, req.body);
  try {
    const { status, motivo_negacao } = req.body;
    if (!status) return res.status(400).json({ erro: 'status obrigatorio' });
    const [result] = await pool.execute(
      'UPDATE ferias SET status=?, motivo_negacao=? WHERE id=?',
      [status, motivo_negacao||'', req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ erro: 'Nao encontrado' });
    res.json({ ok: true });
  } catch(err) {
    console.error('PATCH /ferias:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Iniciar ───────────────────────────────────────────────────────
inicializar()
  .then(() => app.listen(PORT, () => console.log('Porta ' + PORT)))
  .catch(err => { console.error('Falha ao iniciar:', err.message); process.exit(1); });
