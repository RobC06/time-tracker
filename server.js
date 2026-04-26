require('dotenv').config();
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

// Import models
const TimeEntry = require('./models/TimeEntry');
const ClientName = require('./models/ClientName');
const Settings = require('./models/Settings');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Railway
app.set('trust proxy', 1);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/time-tracker';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Middleware
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'time-tracker-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGODB_URI }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax'
  }
}));

// CORS middleware for browser extension
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Get or create settings
async function getSettings() {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = new Settings();
    await settings.save();
  }
  return settings;
}

// ============ TIME ENTRY API (for Chrome extension) ============

// Get all time entries
app.get('/api/time-entries', async (req, res) => {
  try {
    const timeEntries = await TimeEntry.find().sort({ date: -1, createdAt: -1 });
    const transformed = timeEntries.map(e => ({
      id: e.entryId,
      date: e.date,
      client: e.client,
      time: e.time,
      task: e.task,
      billable: e.billable === false ? false : true
    }));
    res.json(transformed);
  } catch (error) {
    console.error('Error fetching time entries:', error);
    res.status(500).json({ error: 'Failed to fetch time entries' });
  }
});

// Create time entry
app.post('/api/time-entries', async (req, res) => {
  try {
    const entry = new TimeEntry({
      entryId: req.body.id || Date.now(),
      date: req.body.date,
      client: req.body.client,
      time: req.body.time,
      task: req.body.task,
      billable: req.body.billable !== false
    });
    await entry.save();

    // Auto-save client name
    if (req.body.client) {
      const name = req.body.client.trim();
      const existing = await ClientName.findOne({
        name: { $regex: new RegExp(`^${name}$`, 'i') }
      });
      if (!existing) {
        await new ClientName({ name }).save();
      }
    }

    res.status(201).json({
      id: entry.entryId,
      date: entry.date,
      client: entry.client,
      time: entry.time,
      task: entry.task,
      billable: entry.billable === false ? false : true
    });
  } catch (error) {
    console.error('Error creating time entry:', error);
    res.status(500).json({ error: 'Failed to create time entry' });
  }
});

// Update time entry
app.put('/api/time-entries/:id', async (req, res) => {
  try {
    const entry = await TimeEntry.findOne({ entryId: parseInt(req.params.id) });
    if (!entry) {
      return res.status(404).json({ error: 'Time entry not found' });
    }
    if (req.body.date !== undefined) entry.date = req.body.date;
    if (req.body.client !== undefined) entry.client = req.body.client;
    if (req.body.time !== undefined) entry.time = req.body.time;
    if (req.body.task !== undefined) entry.task = req.body.task;
    if (req.body.billable !== undefined) entry.billable = req.body.billable !== false;
    await entry.save();
    res.json({
      id: entry.entryId,
      date: entry.date,
      client: entry.client,
      time: entry.time,
      task: entry.task,
      billable: entry.billable === false ? false : true
    });
  } catch (error) {
    console.error('Error updating time entry:', error);
    res.status(500).json({ error: 'Failed to update time entry' });
  }
});

// Delete time entry
app.delete('/api/time-entries/:id', async (req, res) => {
  try {
    const result = await TimeEntry.findOneAndDelete({ entryId: parseInt(req.params.id) });
    if (!result) {
      return res.status(404).json({ error: 'Time entry not found' });
    }
    res.json({ message: 'Time entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting time entry:', error);
    res.status(500).json({ error: 'Failed to delete time entry' });
  }
});

// Get all client names
app.get('/api/client-names', async (req, res) => {
  try {
    const clientNames = await ClientName.find().sort({ name: 1 });
    res.json(clientNames.map(c => c.name));
  } catch (error) {
    console.error('Error fetching client names:', error);
    res.status(500).json({ error: 'Failed to fetch client names' });
  }
});

// Add client name
app.post('/api/client-names', async (req, res) => {
  try {
    const name = req.body.name?.trim();
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const existing = await ClientName.findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });
    if (existing) {
      return res.json({ name: existing.name, exists: true });
    }
    const clientName = new ClientName({ name });
    await clientName.save();
    res.status(201).json({ name: clientName.name, exists: false });
  } catch (error) {
    console.error('Error saving client name:', error);
    res.status(500).json({ error: 'Failed to save client name' });
  }
});

// ============ SETTINGS & AUTH ============

// Check if setup needed
app.get('/api/auth/status', async (req, res) => {
  const settings = await getSettings();
  res.json({
    authenticated: req.session && req.session.authenticated,
    setupNeeded: !settings.password
  });
});

// Setup password (first time)
app.post('/api/auth/setup', async (req, res) => {
  try {
    const settings = await getSettings();
    if (settings.password) {
      return res.status(400).json({ error: 'Already set up' });
    }
    if (!req.body.password || req.body.password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }
    settings.password = await bcrypt.hash(req.body.password, 10);
    await settings.save();
    req.session.authenticated = true;
    req.session.save(() => res.json({ message: 'Setup complete' }));
  } catch (error) {
    res.status(500).json({ error: 'Setup failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.password) {
      return res.status(400).json({ error: 'Setup required' });
    }
    const valid = await bcrypt.compare(req.body.password, settings.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    req.session.authenticated = true;
    req.session.save(() => res.json({ message: 'Login successful' }));
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

// Get settings
app.get('/api/settings', requireAuth, async (req, res) => {
  const settings = await getSettings();
  res.json({
    email: settings.email || '',
    senderEmail: settings.senderEmail || '',
    brevoApiKey: settings.brevoApiKey ? '********' : ''
  });
});

// Update settings
app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    const settings = await getSettings();
    if (req.body.email !== undefined) settings.email = req.body.email;
    if (req.body.senderEmail !== undefined) settings.senderEmail = req.body.senderEmail;
    if (req.body.brevoApiKey && req.body.brevoApiKey !== '********') {
      settings.brevoApiKey = req.body.brevoApiKey;
    }
    await settings.save();
    res.json({ message: 'Settings saved' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ============ EMAIL FUNCTIONS ============

async function sendEmailViaBrevo(settings, subject, htmlContent) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': settings.brevoApiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'Time Tracker', email: settings.senderEmail },
      to: [{ email: settings.email }],
      subject,
      htmlContent
    })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(`Brevo API error: ${response.status} - ${JSON.stringify(data)}`);
  }
  return response.json();
}

// Build weekly backup email HTML
function buildBackupEmailHtml(timeEntries, weekAgo, today) {
  const groupedByDate = {};
  let grandTotal = 0;

  timeEntries.forEach(entry => {
    const dateKey = entry.date;
    const clientKey = entry.client.trim();
    const hours = parseFloat(entry.time) || 0;
    grandTotal += hours;

    if (!groupedByDate[dateKey]) {
      groupedByDate[dateKey] = { clients: {}, total: 0 };
    }
    groupedByDate[dateKey].total += hours;

    if (!groupedByDate[dateKey].clients[clientKey]) {
      groupedByDate[dateKey].clients[clientKey] = { entries: [], total: 0 };
    }
    groupedByDate[dateKey].clients[clientKey].entries.push(entry);
    groupedByDate[dateKey].clients[clientKey].total += hours;
  });

  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #495057; border-bottom: 2px solid #007bff; padding-bottom: 10px;">Weekly Time Entry Backup</h2>
      <p style="color: #6c757d;">Week of ${weekAgo} to ${today}</p>
      <p style="background-color: #007bff; color: white; padding: 10px 15px; border-radius: 4px; font-weight: bold;">
        Total Hours: ${grandTotal.toFixed(2)}
      </p>
  `;

  Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a)).forEach(date => {
    const dateData = groupedByDate[date];
    const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    html += `
      <div style="margin-top: 20px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden;">
        <div style="background-color: #495057; color: white; padding: 10px 15px;">
          <strong>${formattedDate}</strong> - <span style="color: #69F0AE;">${dateData.total.toFixed(2)} hrs</span>
        </div>
    `;

    Object.keys(dateData.clients).sort().forEach(client => {
      const clientData = dateData.clients[client];
      html += `
        <div style="border-bottom: 1px solid #eee;">
          <div style="background-color: #f8f9fa; padding: 8px 15px;">
            <strong>${client}</strong> - <span style="color: #007bff;">${clientData.total.toFixed(2)} hrs</span>
          </div>
          <table style="width: 100%;">
      `;
      clientData.entries.forEach(entry => {
        html += `<tr><td style="padding: 6px 15px;">${entry.task}</td><td style="text-align: right; padding: 6px 15px; width: 60px;">${entry.time} hrs</td></tr>`;
      });
      html += `</table></div>`;
    });

    html += `</div>`;
  });

  html += `<p style="margin-top: 20px; color: #6c757d; font-size: 12px; text-align: center;">Automated backup from Time Tracker</p></div>`;

  return { html, grandTotal };
}

// Test email endpoint
app.post('/api/test-email', requireAuth, async (req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.email || !settings.senderEmail || !settings.brevoApiKey) {
      return res.status(400).json({ error: 'Email not configured. Fill in all fields first.' });
    }

    await sendEmailViaBrevo(settings, 'Time Tracker - Test Email', `
      <h2>Test Email Successful!</h2>
      <p>Your Time Tracker email is configured correctly.</p>
      <p>You will receive weekly backups every Saturday at 10 AM Eastern.</p>
    `);

    res.json({ message: 'Test email sent!' });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test weekly backup endpoint
app.post('/api/test-backup', requireAuth, async (req, res) => {
  try {
    const settings = await getSettings();
    if (!settings.email || !settings.senderEmail || !settings.brevoApiKey) {
      return res.status(400).json({ error: 'Email not configured' });
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const weekAgoDate = new Date();
    weekAgoDate.setDate(weekAgoDate.getDate() - 7);
    const weekAgo = weekAgoDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const timeEntries = await TimeEntry.find({ date: { $gte: weekAgo, $lte: today } }).sort({ date: -1 });

    if (timeEntries.length === 0) {
      return res.status(400).json({ error: `No entries found between ${weekAgo} and ${today}` });
    }

    const { html, grandTotal } = buildBackupEmailHtml(timeEntries, weekAgo, today);
    await sendEmailViaBrevo(settings, `Time Entry Backup (Test) - Week of ${weekAgo}`, html);

    res.json({
      message: 'Backup email sent!',
      entries: timeEntries.length,
      hours: grandTotal.toFixed(2)
    });
  } catch (error) {
    console.error('Test backup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ WEEKLY BACKUP CRON JOB ============

cron.schedule('0 10 * * 6', async () => {
  console.log('[BACKUP] Weekly backup running...');

  try {
    const settings = await getSettings();
    if (!settings.email || !settings.senderEmail || !settings.brevoApiKey) {
      console.log('[BACKUP] Email not configured, skipping');
      return;
    }

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const weekAgoDate = new Date();
    weekAgoDate.setDate(weekAgoDate.getDate() - 7);
    const weekAgo = weekAgoDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const timeEntries = await TimeEntry.find({ date: { $gte: weekAgo, $lte: today } }).sort({ date: -1 });

    if (timeEntries.length === 0) {
      console.log('[BACKUP] No entries this week');
      return;
    }

    const { html } = buildBackupEmailHtml(timeEntries, weekAgo, today);
    await sendEmailViaBrevo(settings, `Time Entry Backup - Week of ${weekAgo}`, html);
    console.log('[BACKUP] Email sent successfully');
  } catch (error) {
    console.error('[BACKUP] Error:', error.message);
  }
}, { timezone: 'America/New_York' });

console.log('[CRON] Weekly backup scheduled for Saturdays 10 AM Eastern');

// ============ SERVE FRONTEND ============

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Time Tracker running on http://localhost:${PORT}`);
});
