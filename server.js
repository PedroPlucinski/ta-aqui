const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure table exists with the agreed schema
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS contacts(
        id SERIAL PRIMARY KEY,
        name TEXT,
        nome TEXT,
        senha TEXT,
        endereco TEXT,
        telefone TEXT,
        email TEXT,
        cidade TEXT,
        vaga TEXT,
        link TEXT,
        prioridade INTEGER DEFAULT 5,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT now()
      );
    `);
    console.log("Tabela pronta.");
  } catch (e) {
    console.error("Erro criando tabela:", e);
  }
})();

// --- Helper to map DB row to front-end object ---
function rowToContact(row) {
  return {
    id: row.id,
    name: row.name,
    nome: row.nome,
    senha: row.senha,
    endereco: row.endereco,
    telefone: row.telefone,
    email: row.email,
    cidade: row.cidade,
    vaga: row.vaga,
    link: row.link,
    prioridade: row.prioridade,
    ativo: row.ativo,
    created_at: row.created_at
  };
}

// GET contacts (optional q search, pagination: page, perPage)
app.get('/api/contacts', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 1000; // large by default
    const offset = (page - 1) * perPage;

    let base = 'SELECT * FROM contacts WHERE (ativo IS NULL OR ativo = true)';
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      base += ` AND (lower(name) LIKE $${params.length} OR lower(vaga) LIKE $${params.length})`;
    }
    base += ' ORDER BY prioridade DESC, created_at DESC';
    if (perPage > 0) {
      params.push(perPage);
      params.push(offset);
      base += ` LIMIT $${params.length-1} OFFSET $${params.length}`;
    }

    const result = await db.query(base, params);
    res.json(result.rows.map(rowToContact));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao buscar contatos' });
  }
});

// POST create contact
app.post('/api/contacts', async (req, res) => {
  try {
    const {
      nome, senha, endereco, telefone, email, cidade, vaga, link, prioridade
    } = req.body;

    // Build display name similar to frontend logic
    let displayName = `${nome || ''} - ${endereco || ''} - ${telefone || ''} - ${email || ''} - ${cidade || ''}`.trim();
    if (vaga && String(vaga).toLowerCase().startsWith('emprego')) displayName = vaga;

    const result = await db.query(
      `INSERT INTO contacts (name, nome, senha, endereco, telefone, email, cidade, vaga, link, prioridade, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) RETURNING *`,
      [displayName, nome || '', senha || '', endereco || '', telefone || '', email || '', cidade || '', vaga || '', link || '', prioridade || 5]
    );
    res.json(rowToContact(result.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao salvar contato' });
  }
});

// PUT update contact by id (must provide id)
app.put('/api/contacts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      nome, senha, endereco, telefone, email, cidade, vaga, link, prioridade, ativo
    } = req.body;

    // Fetch existing
    const existing = await db.query('SELECT * FROM contacts WHERE id=$1', [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Contato não encontrado' });

    // Only allow update if password matches OR master credentials provided in body.master === true and masterName/masterPass
    const masterName = (req.body.masterName || '').toLowerCase();
    const masterPass = req.body.masterPass || '';
    const isMaster = (masterName === 'pedro' && masterPass === 'Pedrokong3535#');

    if (!isMaster && senha !== existing.rows[0].senha) {
      return res.status(403).json({ error: 'Senha incorreta para editar este contato' });
    }

    let displayName = `${nome || existing.rows[0].nome || ''} - ${endereco || existing.rows[0].endereco || ''} - ${telefone || existing.rows[0].telefone || ''} - ${email || existing.rows[0].email || ''} - ${cidade || existing.rows[0].cidade || ''}`.trim();
    if ((vaga || existing.rows[0].vaga) && String(vaga || existing.rows[0].vaga).toLowerCase().startsWith('emprego')) displayName = vaga || existing.rows[0].vaga;

    const updated = await db.query(
      `UPDATE contacts SET
        name=$1, nome=$2, senha=$3, endereco=$4, telefone=$5, email=$6, cidade=$7, vaga=$8, link=$9, prioridade=$10, ativo=$11
       WHERE id=$12 RETURNING *`,
      [displayName, nome || existing.rows[0].nome || '', senha || existing.rows[0].senha || '', endereco || existing.rows[0].endereco || '', telefone || existing.rows[0].telefone || '', email || existing.rows[0].email || '', cidade || existing.rows[0].cidade || '', vaga || existing.rows[0].vaga || '', link || existing.rows[0].link || '', prioridade || existing.rows[0].prioridade || 5, (typeof ativo === 'boolean') ? ativo : existing.rows[0].ativo, id]
    );
    res.json(rowToContact(updated.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao atualizar contato' });
  }
});

// DELETE contact by id (only master can delete or if provide correct senha)
app.delete('/api/contacts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { senha, masterName, masterPass } = req.body || {};

    const existing = await db.query('SELECT * FROM contacts WHERE id=$1', [id]);
    if (existing.rowCount === 0) return res.status(404).json({ error: 'Contato não encontrado' });

    const isMaster = (masterName || '').toLowerCase() === 'pedro' && (masterPass || '') === 'Pedrokong3535#';
    if (!isMaster && senha !== existing.rows[0].senha) {
      return res.status(403).json({ error: 'Senha incorreta para excluir este contato' });
    }

    await db.query('DELETE FROM contacts WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao excluir contato' });
  }
});

// POST login (admin or user)
app.post('/api/login', async (req, res) => {
  try {
    const { nome, senha } = req.body;
    if ((nome || '').toLowerCase() === 'pedro' && senha === 'Pedrokong3535#') {
      return res.json({ ok: true, admin: true });
    }
    if (!nome || !senha) return res.status(400).json({ error: 'Nome e senha são obrigatórios' });

    const result = await db.query('SELECT * FROM contacts WHERE lower(nome)=$1 AND senha=$2', [nome.toLowerCase(), senha]);
    if (result.rowCount === 0) return res.status(401).json({ error: 'Nome ou senha incorretos' });

    res.json({ ok: true, admin: false, contact: rowToContact(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro no login' });
  }
});

app.get('/api/test', (req, res) => res.json({ ok: true }));

// Serve frontend (single page app)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port', PORT));
