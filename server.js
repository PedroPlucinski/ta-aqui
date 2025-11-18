// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // se index.html ficar em /public

const PORT = process.env.PORT || 3000;
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'Pedrokong3535#';

// inicializa tabelas
async function init() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      senha TEXT,
      nome TEXT,
      endereco TEXT,
      telefone TEXT,
      email TEXT,
      cidade TEXT,
      vaga TEXT,
      link TEXT,
      prioridade INTEGER DEFAULT 5,
      ativo BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS site_texts (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // inserir textos padrão se vazio
  const { rows } = await db.query(`SELECT COUNT(*)::int as c FROM site_texts`);
  if (rows[0].c === 0) {
    const defaults = {
      title: "Tá Aqui!",
      subtitle: "procure pessoas, negócios, emprego ou palavras",
      btnCadastrar: "Cadastre seu contato aqui",
      btnEditar: "Editar contato",
      placeholderSearch: "Digite o que procura...",
      footer: "Mais informações ou saber como ficar melhor ranqueado na pesquisa,\nentre em contato pelo WhatsApp (54) 98421-4457"
    };
    for (const k of Object.keys(defaults)) {
      await db.query(`INSERT INTO site_texts(key, value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, defaults[k]]);
    }
  }
}

init().catch(err => {
  console.error('Erro ao inicializar DB', err);
  process.exit(1);
});

/* ---------- ROTAS ----------- */

// busca: q opcional (busca por nome, vaga, cidade, telefone, email)
app.get('/api/contacts', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length === 0) {
      const result = await db.query('SELECT * FROM contacts ORDER BY prioridade DESC, created_at DESC LIMIT 1000');
      return res.json(result.rows);
    } else {
      const pat = `%${q}%`;
      const result = await db.query(
        `SELECT * FROM contacts WHERE ativo IS DISTINCT FROM false AND (COALESCE(nome,'') ILIKE $1 OR COALESCE(vaga,'') ILIKE $1 OR COALESCE(endereco,'') ILIKE $1 OR COALESCE(cidade,'') ILIKE $1 OR COALESCE(telefone,'') ILIKE $1 OR COALESCE(email,'') ILIKE $1) ORDER BY prioridade DESC, created_at DESC LIMIT 1000`,
        [pat]
      );
      return res.json(result.rows);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

// pega um contato por id (opcional)
app.get('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM contacts WHERE id=$1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro' });
  }
});

// criar contato
app.post('/api/contacts', async (req, res) => {
  try {
    const { senha, nome, endereco, telefone, email, cidade, vaga, link, prioridade = 5, ativo = true } = req.body;
    const result = await db.query(
      `INSERT INTO contacts (senha, nome, endereco, telefone, email, cidade, vaga, link, prioridade, ativo)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [senha, nome, endereco, telefone, email, cidade, vaga, link, prioridade, ativo]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar contato' });
  }
});

// atualizar contato (parcial)
app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    // montar update dinâmico
    const keys = Object.keys(fields);
    if (keys.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar' });
    }
    const sets = keys.map((k, i) => `${k} = $${i+1}`).join(', ');
    const values = keys.map(k => fields[k]);
    const query = `UPDATE contacts SET ${sets} WHERE id = $${keys.length+1} RETURNING *`;
    const result = await db.query(query, [...values, id]);
    if(result.rows.length===0) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
});

// deletar contato (requer master)
app.delete('/api/contacts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { masterName, masterPass } = req.body || {};
    if (!masterPass || masterPass !== MASTER_PASSWORD) {
      return res.status(403).json({ error: 'Senha mestre inválida' });
    }
    const result = await db.query('DELETE FROM contacts WHERE id=$1 RETURNING *', [id]);
    if(result.rows.length===0) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao excluir' });
  }
});

// login: admin ou usuário
app.post('/api/login', async (req, res) => {
  try {
    const { nome, senha } = req.body;
    if (!nome) return res.status(400).json({ error: 'Informe nome' });

    // admin por senha mestre
    if (senha && senha === MASTER_PASSWORD) {
      return res.json({ admin: true });
    }

    // procurar contato com nome (exato/insensitive) e senha
    const result = await db.query('SELECT * FROM contacts WHERE lower(nome) = lower($1) AND senha = $2 LIMIT 1', [nome, senha]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado ou senha inválida' });
    const contact = result.rows[0];
    return res.json({ admin: false, contact });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no login' });
  }
});

/* ---------- textos do site (GET para todos, POST para atualizar) ---------- */
app.get('/api/texts', async (req, res) => {
  try {
    const r = await db.query('SELECT key, value FROM site_texts');
    const out = {};
    r.rows.forEach(row => out[row.key] = row.value);
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao obter textos' });
  }
});

app.post('/api/texts', async (req, res) => {
  try {
    // para simplicidade, permitimos atualizar textos apenas com senha mestre no header 'x-master-pass'
    const master = req.headers['x-master-pass'] || req.body.masterPass || req.query.masterPass;
    if (!master || master !== MASTER_PASSWORD) {
      return res.status(403).json({ error: 'Permissão negada' });
    }
    const payload = req.body || {};
    const keys = Object.keys(payload);
    for (const k of keys) {
      await db.query(`INSERT INTO site_texts(key, value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, payload[k]]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar textos' });
  }
});

/* ---------- iniciar server ---------- */
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

