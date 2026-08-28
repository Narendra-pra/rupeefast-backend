import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(express.json());

// File uploads
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.use('/uploads', express.static(uploadsDir));

// SQLite Database setup
const dbPath = path.join(__dirname, 'rupeefast.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mobile TEXT UNIQUE NOT NULL,
    name TEXT,
    dob TEXT,
    address TEXT,
    occupation TEXT,
    monthly_income REAL,
    aadhaar_file TEXT,
    pan_file TEXT,
    photo_file TEXT,
    bank_name TEXT,
    account_number TEXT,
    ifsc TEXT,
    account_holder TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    purpose TEXT,
    tenure INTEGER,
    status TEXT DEFAULT 'Pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`);

const adminExists = db.prepare('SELECT id FROM admins WHERE email = ?').get('admin@rupeefast.com');
if (!adminExists) {
  db.prepare('INSERT INTO admins (email, password) VALUES (?, ?)').run('admin@rupeefast.com', 'Admin@123');
}

console.log('SQLite database initialized successfully');

// ====== AUTH ROUTES ======
app.post('/api/auth/send-otp', (req, res) => {
  const { mobile } = req.body;
  if (!mobile || mobile.length !== 10) {
    return res.status(400).json({ error: 'Invalid mobile number' });
  }
  res.json({ success: true, message: 'OTP sent successfully' });
});

app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (otp !== '123456') {
      return res.status(401).json({ error: 'Invalid OTP' });
    }
    let user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
    if (!user) {
      db.prepare('INSERT INTO users (mobile) VALUES (?)').run(mobile);
      user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
    }
    res.json({ success: true, user });
  } catch (err) {
    console.error('verify-otp error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== USER ROUTES ======
app.get('/api/user/:id', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/user/:id/personal', (req, res) => {
  try {
    const { name, dob, address, occupation, monthly_income } = req.body;
    db.prepare('UPDATE users SET name=?, dob=?, address=?, occupation=?, monthly_income=? WHERE id=?')
      .run(name, dob, address, occupation, monthly_income, req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/user/:id/kyc', upload.fields([
  { name: 'aadhaar', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]), (req, res) => {
  try {
    const updates = [];
    const values = [];

    if (req.files.aadhaar) {
      updates.push('aadhaar_file=?');
      values.push(req.files.aadhaar[0].filename);
    }
    if (req.files.pan) {
      updates.push('pan_file=?');
      values.push(req.files.pan[0].filename);
    }
    if (req.files.photo) {
      updates.push('photo_file=?');
      values.push(req.files.photo[0].filename);
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=?`).run(...values);
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/user/:id/banking', (req, res) => {
  try {
    const { bank_name, account_number, ifsc, account_holder } = req.body;
    db.prepare('UPDATE users SET bank_name=?, account_number=?, ifsc=?, account_holder=? WHERE id=?')
      .run(bank_name, account_number, ifsc, account_holder, req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== LOAN APPLICATION ROUTES ======
app.post('/api/applications', (req, res) => {
  try {
    const { user_id, amount, purpose, tenure } = req.body;
    const result = db.prepare('INSERT INTO applications (user_id, amount, purpose, tenure) VALUES (?, ?, ?, ?)')
      .run(user_id, amount, purpose, tenure);
    const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, application });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/applications/user/:userId', (req, res) => {
  try {
    const applications = db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY created_at DESC').all(req.params.userId);
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== ADMIN ROUTES ======
app.post('/api/admin/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE email = ? AND password = ?').get(email, password);
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ success: true, admin: { id: admin.id, email: admin.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM applications').get().count;
    const pending = db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Pending'").get().count;
    const underReview = db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Under Review'").get().count;
    const approved = db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Approved'").get().count;
    const rejected = db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Rejected'").get().count;
    const disbursed = db.prepare("SELECT COUNT(*) as count FROM applications WHERE status = 'Disbursed'").get().count;
    res.json({ total, pending, underReview, approved, rejected, disbursed });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/applications', (req, res) => {
  try {
    const applications = db.prepare(`
      SELECT a.*, u.name, u.mobile, u.monthly_income
      FROM applications a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
    `).all();
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/applications/:id', (req, res) => {
  try {
    const application = db.prepare(`
      SELECT a.*, u.name, u.mobile, u.dob, u.address, u.occupation, u.monthly_income,
             u.aadhaar_file, u.pan_file, u.photo_file,
             u.bank_name, u.account_number, u.ifsc, u.account_holder
      FROM applications a
      JOIN users u ON a.user_id = u.id
      WHERE a.id = ?
    `).get(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found' });
    res.json(application);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/applications/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Pending', 'Under Review', 'Documents Required', 'Approved', 'Rejected', 'Disbursed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.prepare('UPDATE applications SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.params.id);
    const application = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
    res.json({ success: true, application });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'sqlite' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`RupeeFast Backend running on port ${PORT}`);
});
