// index.js (with detailed logging)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mysql = require('mysql2/promise');
const admin = require("firebase-admin");
const fs = require('fs');
const path = require('path');

// Auto-find Firebase key
let serviceAccount;
try {
    const files = fs.readdirSync(__dirname);
    const keyFile = files.find(file => file.includes('firebase-adminsdk') && file.endsWith('.json'));
    if (!keyFile) throw new Error("CRITICAL ERROR: Firebase Admin SDK JSON key file not found.");
    const serviceAccountPath = path.join(__dirname, keyFile);
    console.log(`Found and using key file: ${keyFile}`);
    serviceAccount = require(serviceAccountPath);
} catch (e) {
    console.error(e);
    process.exit(1);
}

// Config
const firebaseDatabaseURL = "https://test-001-c3444-default-rtdb.asia-southeast1.firebasedatabase.app";
const mysqlConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};
const geminiAPIKey = process.env.GEMINI_API_KEY;

// Initializations
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: firebaseDatabaseURL
});
const pool = mysql.createPool(mysqlConfig);

if (!geminiAPIKey) {
  console.error("CRITICAL ERROR: GEMINI_API_KEY not found. Please check your .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(geminiAPIKey);
const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

const app = express();
const PORT = process.env.PORT || 3001;

// ==========================================================
// THIS IS THE UPDATED SECTION
// ==========================================================
const corsOptions = {
  origin: ['http://127.0.0.1:5500', 'https://power-monitoring.netlify.app'],
  optionsSuccessStatus: 200
};
// ==========================================================

app.use(cors(corsOptions));
app.use(express.json());
const db = admin.database();

// Main Application Logic - UPDATED WITH DEBUG LOGS
const saveDataToMySQL = async () => {
    console.log("\n[DEBUG] Running saveDataToMySQL function...");
    try {
        const snapshot = await db.ref('/').once('value');
        const data = snapshot.val();

        if (!data) {
            console.log("[DEBUG] No data found at the root of Firebase. Function will exit.");
            return;
        }
        
        console.log("[DEBUG] Data found in Firebase:", data);

        const power = data.POWER || null;
        const current = data.CURRENT_DATA || null;
        console.log(`[DEBUG] Parsed values - Power: ${power}, Current: ${current}`);

        if (power !== null || current !== null) { 
            console.log("[DEBUG] Attempting to insert data into MySQL...");
            const [rows] = await pool.execute(
                'INSERT INTO energy_metrics (power_value, current_value, live_cost, timestamp) VALUES (?, ?, ?, ?)',
                [power, current, power, new Date()]
            );
            console.log(`[SUCCESS] Data successfully saved to MySQL with ID: ${rows.insertId}`);
        } else {
            console.log("[DEBUG] No power or current values to insert. Skipping database write.");
        }
    } catch (error) {
        console.error('[ERROR] An error occurred in the saveDataToMySQL function:', error);
    }
};
setInterval(saveDataToMySQL, 30000);

// AI Insight Endpoint
app.post('/api/ai-insight', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required.' });
        }
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        res.json({ insight: text });
    } catch (error) {
        console.error("Error in /api/ai-insight:", error);
        res.status(500).json({ error: "Failed to fetch AI insight." });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Backend is now listening for Firebase updates and saving to MySQL...');
    saveDataToMySQL(); // Run once on startup
});