const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Conexão MySQL ────────────────────────────────────────────────
const pool = mysql.createPool({
  uri:              process.env.MYSQL_PUBLIC_URL,
  waitForConnections: true,
  connectionLimit:  10,
  ssl: { rejectUnauthorized: false }   // Railway exige SSL
});

// ── Cria a tabela se não existir ─────────────────────────────────
async function inicializar() {
  const conn = await pool.getConnection();
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ferias (
      id               VARCHAR(50)  PRIMARY KEY,
      matricula        VARCHAR(255),
      nome             TEXT,
      cargo            VARCHAR(255),
      lotacao          VARCHAR(255),
      setor            VARCHAR(255),
      periodo          VARCHAR(255),
      tipo             VARCHAR(255),
      dias             INT,
      inicio           DATE,
      fim              DATE,
      obs              TEXT,
      status           VARCHAR(50)  DEFAULT 'Pendente',
      motivo_negacao   TEXT,
      data_envio       DATE,
      mes              VARCHAR(50),
      ano              VARCHAR(10)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  conn.release();
  console.log('Tabela pronta.');
}

// ── Rota de saúde ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', servico: 'Férias IPC — API', versao: '1.0' });
});

// ── GET /ferias — listar todos os registros ──────────────────────
app.get('/ferias', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM ferias ORDER BY data_envio DESC'
    );
    // Formatar datas para string yyyy-mm-dd (MySQL retorna objetos Date)
    const dados = rows.map(r => ({
      ...r,
      inicio:     r.inicio     ? r.inicio.toISOString().slice(0,10)     : '',
      fim:        r.fim        ? r.fim.toISOString().slice(0,10)        : '',
      data_envio: r.data_envio ? r.data_envio.toISOString().slice(0,10) : '',
      dias:       r.dias ? String(r.dias) : ''
    }));
    res.json(dados);
  } catch (err) {
    console.error('GET /ferias:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── POST /ferias — salvar nova intenção ──────────────────────────
app.post('/ferias', async (req, res) => {
  try {
    const r = req.body;
    if (!r.id || !r.nome) {
      return res.status(400).json({ erro: 'id e nome são obrigatórios' });
    }
    await pool.execute(
      `INSERT INTO ferias
         (id, matricula, nome, cargo, lotacao, setor, periodo, tipo,
          dias, inicio, fim, obs, status, motivo_negacao, data_envio, mes, ano)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         status          = VALUES(status),
         motivo_negacao  = VALUES(motivo_negacao)`,
      [
        r.id, r.matricula||'', r.nome||'', r.cargo||'', r.lotacao||'',
        r.setor||'', r.periodo||'', r.tipo||'',
        parseInt(r.dias)||null,
        r.inicio||null, r.fim||null, r.obs||'',
        r.status||'Pendente', r.motivo_negacao||'',
        r.data_envio||null, r.mes||'', r.ano||''
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /ferias:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── PATCH /ferias/:id — atualizar status pelo gestor ────────────
app.patch('/ferias/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, motivo_negacao } = req.body;
    if (!status) return res.status(400).json({ erro: 'status é obrigatório' });
    await pool.execute(
      'UPDATE ferias SET status=?, motivo_negacao=? WHERE id=?',
      [status, motivo_negacao||'', id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /ferias:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ── Iniciar ──────────────────────────────────────────────────────
inicializar()
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
  })
  .catch(err => {
    console.error('Erro ao conectar ao banco:', err.message);
    process.exit(1);
  });
