import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';

const app = express();
app.use(cors());
app.use(express.json());

const db = new Database('rupeefast.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, mobile TEXT UNIQUE NOT NULL, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount REAL, purpose TEXT, tenure INTEGER, status TEXT DEFAULT 'Pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);`);
const adminExists = db.prepare('SELECT id FROM admins WHERE email = ?').get('admin@rupeefast.com');
if (!adminExists) db.prepare('INSERT INTO admins (email, password) VALUES (?, ?)').run('admin@rupeefast.com', 'Admin@123');

const KEY = '565211TOo53L9VvbO76a914011P1';

app.post('/api/otp/send', async (req, res) => {
  const { mobile, channel = 'WHATSAPP' } = req.body || {};
  if (!mobile) return res.json({ success: false });
  try {
    const r = await fetch(`https://control.msg91.com/api/v5/otp?mobile=91${mobile}&authkey=${KEY}&otp_length=4&otp_expiry=15&channel=${channel}`, { method: 'POST' });
    const data = await r.json();
    res.json({ success: data.type === 'success', message: data.message });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/otp/verify', async (req, res) => {
  const { mobile, otp } = req.body || {};
  try {
    const r = await fetch(`https://control.msg91.com/api/v5/otp/verify?mobile=91${mobile}&otp=${otp}&authkey=${KEY}`);
    const data = await r.json();
    if (data.type === 'success') {
      let user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
      if (!user) { db.prepare('INSERT INTO users (mobile) VALUES (?)').run(mobile); user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile); }
      return res.json({ success: true, user });
    }
    res.json({ success: false });
  } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE email = ? AND password = ?').get(email, password);
  if (!admin) return res.status(401).json({ error: 'Invalid' });
  res.json({ success: true, admin });
});

app.get('/api/admin/stats', (req, res) => {
  res.json({ total: db.prepare('SELECT COUNT(*) as c FROM applications').get().c, pending: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status='Pending'").get().c, approved: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status='Approved'").get().c, rejected: db.prepare("SELECT COUNT(*) as c FROM applications WHERE status='Rejected'").get().c });
});

app.get('/api/admin/applications', (req, res) => res.json(db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all()));
app.put('/api/admin/applications/:id/status', (req, res) => { db.prepare('UPDATE applications SET status=? WHERE id=?').run(req.body.status, req.params.id); res.json({ success: true }); });
app.post('/api/applications', (req, res) => { const r = db.prepare('INSERT INTO applications (user_id, amount, purpose, tenure) VALUES (?,?,?,?)').run(req.body.user_id, req.body.amount, req.body.purpose, req.body.tenure); res.json({ success: true, id: r.lastInsertRowid }); });
app.get('/api/applications/user/:id', (req, res) => res.json(db.prepare('SELECT * FROM applications WHERE user_id=? ORDER BY created_at DESC').all(req.params.id)));
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log('RupeeFast on port', PORT));
