index.js:// index.js
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
    host: 'localhost',
    user: 'root',
    password: 'Mithi@1817',
    database: 'energy_metrics'
};
const geminiAPIKey = process.env.GEMINI_API_KEY;

// ====================================================================

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: firebaseDatabaseURL
});

// MySQL Connection Pool Setup
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



// Function to calculate the bill based on TNEB tariff structure
function calculateEBbill(totalUnits_kWh) {
    let billAmount = 0;
    
    if (totalUnits_kWh <= 100) {
        billAmount = 0;
    } else if (totalUnits_kWh <= 200) {
        billAmount = (totalUnits_kWh - 100) * 2.25;
    } else if (totalUnits_kWh <= 400) {
        billAmount = (100 * 0) + (100 * 2.25) + ((totalUnits_kWh - 200) * 4.50);
    } else if (totalUnits_kWh <= 500) {
        billAmount = (100 * 0) + (100 * 2.25) + (200 * 4.50) + ((totalUnits_kWh - 400) * 6.00);
    } else if (totalUnits_kWh <= 600) {
        billAmount = (100 * 4.50) + (400 * 6.00) + ((totalUnits_kWh - 500) * 8.00);
    } else if (totalUnits_kWh <= 800) {
        billAmount = (100 * 4.50) + (100 * 6.00) + (200 * 8.00) + ((totalUnits_kWh - 600) * 9.00);
    } else if (totalUnits_kWh <= 1000) {
        billAmount = (100 * 4.50) + (100 * 6.00) + (200 * 8.00) + (200 * 9.00) + ((totalUnits_kWh - 800) * 10.00);
    } else {
        billAmount = (100 * 4.50) + (100 * 6.00) + (200 * 8.00) + (200 * 9.00) + (200 * 10.00) + ((totalUnits_kWh - 1000) * 11.00);
    }

    return billAmount;
}



app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = 'INSERT INTO users (name, email, password) VALUES (?, ?, ?)';
        
        await pool.execute(sql, [name, email, hashedPassword]);
        
        console.log('User registered successfully:', { name, email });
        return res.status(201).json({ message: 'Registration successful! Please login.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'Email already exists.' });
        }
        console.error('Server error during registration:', error);
        res.status(500).json({ message: 'An internal server error occurred.' });
    }
});




// ==========================================================
// CORRECTED: Firebase Listener for real-time data and MySQL insertion
// ==========================================================

const db = admin.database();

const saveDataToMySQL = async () => {
    try {
        const snapshot = await db.ref('/').once('value');
        const data = snapshot.val();
        
        const power = data.POWER || null;
        const current = data.CURRENT_DATA || null;
        const liveCost = data.POWER || null; 
        const timestamp = new Date();
        
        console.log(Data received: POWER: ${power}, CURRENT: ${current}, COST: ${liveCost} at ${timestamp});
        
        if (power || current || liveCost !== null) { 
            const [rows] = await pool.execute(
                'INSERT INTO energy_metrics (power_value, current_value, live_cost, timestamp) VALUES (?, ?, ?, ?)',
                [power, current, liveCost, timestamp]
            );
            console.log(Data successfully saved to MySQL with ID: ${rows.insertId});
        }
    } catch (error) {
        console.error('Error in timer function:', error);
    }
};

saveDataToMySQL();
const intervalId = setInterval(saveDataToMySQL, 30000);


// NEW: Endpoint to fetch calculated cost for a specified period
app.get('/api/cost-analytics', async (req, res) => {
    const { period } = req.query;

    let interval = null;
    if (period === 'weekly') {
        interval = '7 DAY';
    } else if (period === 'monthly') {
        interval = '30 DAY'; 
    } else {
        return res.status(400).json({ error: 'Invalid period. Use "weekly" or "monthly".' });
    }

    try {
        const query = `
            SELECT SUM(power_value) AS total_energy_mw 
            FROM energy_metrics 
            WHERE timestamp >= NOW() - INTERVAL ${interval}
        `;
        
        const [rows] = await pool.execute(query);
        const totalEnergy_mWh = rows[0].total_energy_mw || 0;

        // Convert total energy from mWh to kWh (divide by 1,000,000)
        const totalUnits_kWh = totalEnergy_mWh / 1000000;
        
        // Use the new function to calculate the bill
        const billAmount = calculateEBbill(totalUnits_kWh);
        
        res.json({ totalCost: billAmount });
    } catch (error) {
        console.error('Error fetching cost data from MySQL:', error);
        res.status(500).json({ error: 'Failed to fetch cost data.' });
    }
});


// NEW: Endpoint to calculate and fetch cost for the current day
app.get('/api/cost-today', async (req, res) => {
    try {
        const query = `
            SELECT SUM(power_value) AS total_energy_mw 
            FROM energy_metrics 
            WHERE DATE(timestamp) = CURDATE()
        `;
        
        const [rows] = await pool.execute(query);
        const totalEnergy_mWh = rows[0].total_energy_mw || 0;

        // Convert total energy from mWh to kWh (divide by 1,000,000)
        const totalUnits_kWh = totalEnergy_mWh / 1000000;
        
        // Use the new function to calculate the bill
        const billAmount = calculateEBbill(totalUnits_kWh);
        
        res.json({ totalCost: billAmount });
    } catch (error) {
        console.error('Error fetching cost for today from MySQL:', error);
        res.status(500).json({ error: 'Failed to fetch cost for today.' });
    }
});

// ==========================================================
// NEW: Endpoint to calculate and fetch total energy
// ==========================================================
app.get('/api/total-energy', async (req, res) => {
    try {
        const [powerReadings] = await pool.execute('SELECT power_value, timestamp FROM energy_metrics ORDER BY timestamp ASC');

        let totalEnergy_mWh = 0;
        
        if (powerReadings.length > 1) {
            for (let i = 1; i < powerReadings.length; i++) {
                const currentReading = powerReadings[i];
                const previousReading = powerReadings[i - 1];
                
                const timeDiff_ms = currentReading.timestamp.getTime() - previousReading.timestamp.getTime();
                const timeDiff_h = timeDiff_ms / (1000 * 60 * 60);

                const avgPower_mw = (currentReading.power_value + previousReading.power_value) / 2;
                const energy_mWh = avgPower_mw * timeDiff_h;

                totalEnergy_mWh += energy_mWh;
            }
        }
        res.json({ totalEnergy: totalEnergy_mWh });
    } catch (error) {
        console.error('Error calculating total energy from MySQL:', error);
        res.status(500).json({ error: 'Failed to calculate total energy.' });
    }
});


// ==========================================================
// NEW: Endpoint to fetch power data for a specific day
// ==========================================================
app.get('/api/total-energy-by-day', async (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ error: 'Date parameter is required.' });
    }

    try {
        const sqlDate = new Date(date).toISOString().split('T')[0];

        const [powerReadings] = await pool.execute(
            'SELECT power_value, timestamp FROM energy_metrics WHERE DATE(timestamp) = ? ORDER BY timestamp ASC',
            [sqlDate]
        );

        let totalEnergy_mWh = 0;
        
        if (powerReadings.length > 1) {
            for (let i = 1; i < powerReadings.length; i++) {
                const currentReading = powerReadings[i];
                const previousReading = powerReadings[i - 1];
                
                const timeDiff_ms = currentReading.timestamp.getTime() - previousReading.timestamp.getTime();
                const timeDiff_h = timeDiff_ms / (1000 * 60 * 60);

                const avgPower_mw = (currentReading.power_value + previousReading.power_value) / 2;
                const energy_mWh = avgPower_mw * timeDiff_h;
                totalEnergy_mWh += energy_mWh;
            }
        }

        res.json({
            date: sqlDate,
            totalEnergy: totalEnergy_mWh
        });
    } catch (error) {
        console.error('Error calculating total energy by day from MySQL:', error);
        res.status(500).json({ error: 'Failed to calculate total energy.' });
    }
});


// ==========================================================
// NEW: Endpoint to fetch total energy for the last 7 days
// ==========================================================
// NEW: Endpoint to fetch total energy for the last 7 days (Calculation in JS)
// NEW: Endpoint to fetch total energy for the last 7 days (Calculation in JS)
app.get('/api/weekly-energy', async (req, res) => {
    try {
        // SQL query to get all power values and timestamps for the last 7 days
        // This simplified query will work on all versions of MySQL
        const [powerReadings] = await pool.execute(
            'SELECT power_value, timestamp FROM energy_metrics WHERE timestamp >= DATE(NOW()) - INTERVAL 7 DAY ORDER BY timestamp ASC'
        );

        // Group data by day and calculate total energy per day in JavaScript
        const dailyEnergy = {};
        if (powerReadings.length > 1) {
            for (let i = 1; i < powerReadings.length; i++) {
                const currentReading = powerReadings[i];
                const previousReading = powerReadings[i - 1];
                
                const timeDiff_ms = currentReading.timestamp.getTime() - previousReading.timestamp.getTime();
                const timeDiff_h = timeDiff_ms / (1000 * 60 * 60);

                const avgPower_mw = (currentReading.power_value + previousReading.power_value) / 2;

                const energy_mWh = avgPower_mw * timeDiff_h;

                const dateKey = currentReading.timestamp.toISOString().split('T')[0];

                if (!dailyEnergy[dateKey]) {
                    dailyEnergy[dateKey] = 0;
                }
                dailyEnergy[dateKey] += energy_mWh;
            }
        }
        
        const dates = Object.keys(dailyEnergy).map(date => new Date(date).toLocaleDateString());
        const energies = Object.values(dailyEnergy);

        res.json({ dates, energies });

    } catch (error) {
        console.error('Error fetching weekly energy data from MySQL:', error);
        res.status(500).json({ error: 'Failed to fetch weekly energy data.' });
    }
});

// ==========================================================
// EXISTING: AI Insight Endpoint
// ==========================================================
app.post('/api/ai-insight', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
    }

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        res.json({ insight: text });
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        res.status(500).json({ error: 'Failed to get a response from the AI.' });
    }
});

app.listen(PORT, () => {
    console.log(Server is running on http://localhost:${PORT});
    console.log('Backend is now listening for Firebase updates...');
});