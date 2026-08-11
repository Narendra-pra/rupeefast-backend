import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pg from 'pg';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({
  origin: ['https://rupeefast.surge.sh', 'http://localhost:5173', 'http://localhost:3000'],
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

// PostgreSQL Database setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount REAL NOT NULL,
        purpose TEXT,
        tenure INTEGER,
        status TEXT DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
    `);

    // Insert default admin if not exists
    const adminResult = await client.query("SELECT id FROM admins WHERE email = 'admin@rupeefast.com'");
    if (adminResult.rows.length === 0) {
      await client.query("INSERT INTO admins (email, password) VALUES ('admin@rupeefast.com', 'Admin@123')");
    }
    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

// ====== AUTH ROUTES ======
app.post('/api/auth/send-otp', (req, res) => {
  const { mobile } = req.body;
  if (!mobile || mobile.length !== 10) {
    return res.status(400).json({ error: 'Invalid mobile number' });
  }
  res.json({ success: true, message: 'OTP sent successfully' });
});

app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    if (otp !== '123456') {
      return res.status(401).json({ error: 'Invalid OTP' });
    }
    let result = await pool.query('SELECT * FROM users WHERE mobile = $1', [mobile]);
    if (result.rows.length === 0) {
      await pool.query('INSERT INTO users (mobile) VALUES ($1)', [mobile]);
      result = await pool.query('SELECT * FROM users WHERE mobile = $1', [mobile]);
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('verify-otp error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== USER ROUTES ======
app.get('/api/user/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/user/:id/personal', async (req, res) => {
  try {
    const { name, dob, address, occupation, monthly_income } = req.body;
    await pool.query(
      'UPDATE users SET name=$1, dob=$2, address=$3, occupation=$4, monthly_income=$5 WHERE id=$6',
      [name, dob, address, occupation, monthly_income, req.params.id]
    );
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/user/:id/kyc', upload.fields([
  { name: 'aadhaar', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]), async (req, res) => {
  try {
    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (req.files.aadhaar) {
      updates.push(`aadhaar_file=$${paramIdx++}`);
      values.push(req.files.aadhaar[0].filename);
    }
    if (req.files.pan) {
      updates.push(`pan_file=$${paramIdx++}`);
      values.push(req.files.pan[0].filename);
    }
    if (req.files.photo) {
      updates.push(`photo_file=$${paramIdx++}`);
      values.push(req.files.photo[0].filename);
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id=$${paramIdx}`, values);
    }
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/user/:id/banking', async (req, res) => {
  try {
    const { bank_name, account_number, ifsc, account_holder } = req.body;
    await pool.query(
      'UPDATE users SET bank_name=$1, account_number=$2, ifsc=$3, account_holder=$4 WHERE id=$5',
      [bank_name, account_number, ifsc, account_holder, req.params.id]
    );
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== LOAN APPLICATION ROUTES ======
app.post('/api/applications', async (req, res) => {
  try {
    const { user_id, amount, purpose, tenure } = req.body;
    const result = await pool.query(
      'INSERT INTO applications (user_id, amount, purpose, tenure) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, amount, purpose, tenure]
    );
    res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/applications/user/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC',
      [req.params.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== ADMIN ROUTES ======
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ success: true, admin: { id: result.rows[0].id, email: result.rows[0].email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const total = (await pool.query('SELECT COUNT(*) as count FROM applications')).rows[0].count;
    const pending = (await pool.query("SELECT COUNT(*) as count FROM applications WHERE status = 'Pending'")).rows[0].count;
    const underReview = (await pool.query("SELECT COUNT(*) as count FROM applications WHERE status = 'Under Review'")).rows[0].count;
    const approved = (await pool.query("SELECT COUNT(*) as count FROM applications WHERE status = 'Approved'")).rows[0].count;
    const rejected = (await pool.query("SELECT COUNT(*) as count FROM applications WHERE status = 'Rejected'")).rows[0].count;
    const disbursed = (await pool.query("SELECT COUNT(*) as count FROM applications WHERE status = 'Disbursed'")).rows[0].count;
    res.json({ total: +total, pending: +pending, underReview: +underReview, approved: +approved, rejected: +rejected, disbursed: +disbursed });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/applications', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.name, u.mobile, u.monthly_income
      FROM applications a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/applications/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.name, u.mobile, u.dob, u.address, u.occupation, u.monthly_income,
             u.aadhaar_file, u.pan_file, u.photo_file,
             u.bank_name, u.account_number, u.ifsc, u.account_holder
      FROM applications a
      JOIN users u ON a.user_id = u.id
      WHERE a.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Application not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/applications/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Pending', 'Under Review', 'Documents Required', 'Approved', 'Rejected', 'Disbursed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await pool.query('UPDATE applications SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [status, req.params.id]);
    const result = await pool.query('SELECT * FROM applications WHERE id = $1', [req.params.id]);
    res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RupeeFast Backend running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
