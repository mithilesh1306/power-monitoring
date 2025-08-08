require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const admin = require("firebase-admin");

// ====================================================================
// CONFIGURE YOUR SETTINGS HERE
// ====================================================================

// Path to your downloaded Firebase service account key
const serviceAccount = require("./test-001-c3444-firebase-adminsdk-fbsvc-14e01ba8bf.json");
// Your Firebase Realtime Database URL
const firebaseDatabaseURL = "https://test-001-c3444-default-rtdb.asia-southeast1.firebasedatabase.app";
// Your MySQL database connection details
const mysqlConfig = {
    host: 'localhost', // Note: This will be a problem, see below
    user: 'root',
    password: 'password', // This is the new, correct way
    database: 'energy_metrics'
};
const geminiAPIKey = process.env.GEMINI_API_KEY;

// ====================================================================

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: firebaseDatabaseURL
});

const db = admin.database();
const pool = mysql.createPool(mysqlConfig);

// Gemini AI Setup
if (!geminiAPIKey) {
  console.error("GEMINI_API_KEY not found. Please check your .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiAPIKey);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- Helper Function to calculate energy from power readings ---
// This uses the trapezoidal rule for accuracy
const calculateEnergy_kWh = (readings) => {
    let totalEnergy_Wh = 0;
    if (readings.length < 2) {
        return 0;
    }
    for (let i = 1; i < readings.length; i++) {
        const p1 = readings[i - 1];
        const p2 = readings[i];
        
        const avgPower_W = (p1.power_value + p2.power_value) / 2;
        const timeDiff_ms = new Date(p2.timestamp).getTime() - new Date(p1.timestamp).getTime();
        const timeDiff_h = timeDiff_ms / (1000 * 60 * 60); // Convert milliseconds to hours
        
        totalEnergy_Wh += avgPower_W * timeDiff_h;
    }
    return totalEnergy_Wh / 1000; // Convert Watt-hours to Kilo-watt-hours
};

// --- Helper Function for TNEB Bill Calculation ---
function calculateEBbill(totalUnits_kWh) {
    // This function remains the same as your original
    let billAmount = 0;
    if (totalUnits_kWh <= 100) billAmount = 0;
    else if (totalUnits_kWh <= 200) billAmount = (totalUnits_kWh - 100) * 2.25;
    else if (totalUnits_kWh <= 400) billAmount = (100 * 0) + (100 * 2.25) + ((totalUnits_kWh - 200) * 4.50);
    else if (totalUnits_kWh <= 500) billAmount = (100 * 0) + (100 * 2.25) + (200 * 4.50) + ((totalUnits_kWh - 400) * 6.00);
    else if (totalUnits_kWh <= 600) billAmount = (100 * 4.50) + (400 * 6.00) + ((totalUnits_kWh - 500) * 8.00);
    else if (totalUnits_kWh <= 800) billAmount = (100 * 4.50) + (100 * 6.00) + (200 * 8.00) + ((totalUnits_kWh - 600) * 9.00);
    else if (totalUnits_kWh <= 1000) billAmount = (100 * 4.50) + (100 * 6.00) + (200 * 8.00) + (200 * 9.00) + ((totalUnits_kWh - 800) * 10.00);
    else billAmount = (100 * 4.50) + (100 * 6.00) + (200 * 8.00) + (200 * 9.00) + (200 * 10.00) + ((totalUnits_kWh - 1000) * 11.00);
    return billAmount;
}


// --- Firebase data listener to save to MySQL every 30 seconds ---
const saveDataToMySQL = async () => {
    try {
        const powerSnap = await db.ref('POWER').once('value');
        const currentSnap = await db.ref('CURRENT_DATA').once('value');
        
        const power = powerSnap.val() || 0;
        const current = currentSnap.val() || 0;
        const timestamp = new Date();

        if (power !== null && current !== null) {
            const sql = 'INSERT INTO energy_metrics (power_value, current_value, timestamp) VALUES (?, ?, ?)';
            const [result] = await pool.execute(sql, [power, current, timestamp]);
            console.log(`[${timestamp.toLocaleTimeString()}] Saved to MySQL (ID: ${result.insertId}): Power=${power}W, Current=${current}A`);
        }
    } catch (error) {
        console.error('Error saving data to MySQL:', error);
    }
};
// Run it once on start and then every 30 seconds
saveDataToMySQL();
setInterval(saveDataToMySQL, 30000);


// === API ENDPOINTS ===

// --- User Registration Endpoint ---
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
        await pool.execute(sql, [name, email, hashedPassword]);
        res.status(201).json({ message: 'Registration successful! Please login.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Email already exists.' });
        }
        res.status(500).json({ message: 'Server error during registration.' });
    }
});


// --- NEW: User Login Endpoint ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }
    try {
        const sql = 'SELECT * FROM users WHERE email = ?';
        const [rows] = await pool.execute(sql, [email]);

        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (isMatch) {
            res.status(200).json({ message: 'Login successful!' });
        } else {
            res.status(401).json({ message: 'Invalid email or password.' });
        }
    } catch (error) {
        console.error('Login Server Error:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});

// --- REVISED: Cost Calculation Endpoints ---
app.get('/api/costs', async (req, res) => {
    try {
        // Cost for Today
        const [todayReadings] = await pool.execute(
            'SELECT power_value, timestamp FROM energy_metrics WHERE DATE(timestamp) = CURDATE() ORDER BY timestamp ASC'
        );
        const todayEnergy_kWh = calculateEnergy_kWh(todayReadings);
        const costToday = calculateEBbill(todayEnergy_kWh);

        // Cost for This Month
        const [monthReadings] = await pool.execute(
            'SELECT power_value, timestamp FROM energy_metrics WHERE MONTH(timestamp) = MONTH(CURDATE()) AND YEAR(timestamp) = YEAR(CURDATE()) ORDER BY timestamp ASC'
        );
        const monthEnergy_kWh = calculateEnergy_kWh(monthReadings);
        const costMonth = calculateEBbill(monthEnergy_kWh);
        
        res.json({
            cost_today: costToday.toFixed(2),
            cost_month: costMonth.toFixed(2)
        });
    } catch (error) {
        console.error('Error fetching cost data:', error);
        res.status(500).json({ error: 'Failed to fetch cost data.' });
    }
});


// --- NEW: Chart Data Endpoints ---

// Endpoint for the "E-Bill" Bar Chart (last 7 days)
app.get('/api/charts/weekly-bill', async (req, res) => {
    try {
        const [readings] = await pool.execute(
            'SELECT power_value, timestamp FROM energy_metrics WHERE timestamp >= CURDATE() - INTERVAL 7 DAY ORDER BY timestamp ASC'
        );
        
        const dailyData = {};
        for (const r of readings) {
            const date = new Date(r.timestamp).toISOString().split('T')[0];
            if (!dailyData[date]) dailyData[date] = [];
            dailyData[date].push(r);
        }

        const labels = [];
        const data = [];
        // Ensure we have entries for the last 7 days, even if no data
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateKey = d.toISOString().split('T')[0];
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            
            labels.push(dayName);
            
            const energyKwh = dailyData[dateKey] ? calculateEnergy_kWh(dailyData[dateKey]) : 0;
            const bill = calculateEBbill(energyKwh);
            data.push(bill.toFixed(2));
        }

        res.json({ labels, data });
    } catch (error) {
        console.error('Error fetching weekly bill data:', error);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});

// Endpoint for the "Power" Line Chart (last 30 readings)
app.get('/api/charts/power-history', async (req, res) => {
    try {
        const [readings] = await pool.execute(
            'SELECT power_value, timestamp FROM energy_metrics ORDER BY timestamp DESC LIMIT 30'
        );
        const reversed = readings.reverse(); // Show oldest to newest
        const labels = reversed.map(r => new Date(r.timestamp).toLocaleTimeString('en-IN'));
        const data = reversed.map(r => r.power_value);
        res.json({ labels, data });
    } catch (error) {
        console.error('Error fetching power history:', error);
        res.status(500).json({ error: 'Failed to fetch chart data' });
    }
});


// --- AI Insight Endpoint ---
app.post('/api/ai-insight', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        res.json({ insight: response.text() });
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        res.status(500).json({ error: 'Failed to get a response from the AI.' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server is running on http://localhost:${PORT}`);
    console.log('📡 Backend is listening for Firebase updates and saving to MySQL...');
});