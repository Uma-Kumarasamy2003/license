import express from "express";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import cors from "cors";
import pkg from "node-machine-id";

const { machineIdSync } = pkg;

const app = express();

// Configure CORS for production
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? true // Allow all origins for Electron apps
    : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5000'],
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint for Vercel
app.get('/', (req, res) => {
  res.json({ 
    message: 'License Server is running', 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Health check for API
app.get('/api/health', (req, res) => {
  res.json({ 
    message: 'License API is healthy', 
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// --- MongoDB connection ---
const mongoURI = process.env.MONGODB_URI || 
  "mongodb+srv://Umakumarasamy:Uma%40radio123@cluster0.o8aiaja.mongodb.net/licenseDB?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Atlas connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// --- License Schema ---
const licenseSchema = new mongoose.Schema({
  key: String,           // License Key
  assignedTo: String,    // e.g. Alex
  startDate: Date,       // subscription start
  endDate: Date,         // subscription expiry
  deviceId: String,      // bound device
  status: { type: String, default: "Active" }, // Active / Expired
  type: String,          // "trial" or "subscription"
  createdAt: { type: Date, default: Date.now },
  lastValidated: { type: Date, default: Date.now },
  validationCount: { type: Number, default: 0 }
});

const License = mongoose.model("License", licenseSchema);

// --- Create Subscription License (Admin use) ---
app.post("/api/createLicense", async (req, res) => {
  try {
    const { key, assignedTo, startDate, endDate } = req.body;

    // Check if license key already exists
    const existingLicense = await License.findOne({ key });
    if (existingLicense) {
      return res.status(400).json({ 
        success: false, 
        message: "License key already exists" 
      });
    }

    const license = new License({
      key,
      assignedTo,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      type: "subscription",
      deviceId: null,
      status: "Active",
      createdAt: new Date()
    });

    await license.save();
    res.json({ success: true, message: "License created", license });
  } catch (err) {
    console.error("Error creating license:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error creating license", 
      error: err.message 
    });
  }
});

// --- Create Trial License ---
app.post("/api/startTrial", async (req, res) => {
  try {
    const deviceId = machineIdSync();

    const existing = await License.findOne({ deviceId, type: "trial" });
    if (existing) {
      return res.json({ 
        success: false, 
        message: "Trial already used on this device" 
      });
    }

    const now = new Date();
    const end = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes trial

    const trialKey = "TRIAL-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    const trial = new License({ 
      key: trialKey, 
      type: "trial", 
      startDate: now, 
      endDate: end, 
      deviceId,
      createdAt: now,
      lastValidated: now,
      validationCount: 1
    });
    
    await trial.save();

    res.json({ 
      success: true, 
      message: "Trial started", 
      key: trialKey, 
      expiresAt: end 
    });
  } catch (err) {
    console.error("Error starting trial:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error starting trial", 
      error: err.message 
    });
  }
});

// --- Activate Subscription Key ---
app.post("/api/activateKey", async (req, res) => {
  try {
    const { licenseKey } = req.body;
    const deviceId = machineIdSync();

    const license = await License.findOne({ key: licenseKey, type: "subscription" });
    if (!license) {
      return res.json({ 
        success: false, 
        message: "Invalid subscription key" 
      });
    }

    const now = new Date();
    const endOfDay = new Date(license.endDate);
    endOfDay.setHours(23, 59, 59, 999);

    if (now.getTime() > endOfDay.getTime()) {
      license.status = "Expired";
      await license.save();
      return res.json({ 
        success: false, 
        message: "Subscription expired. Please contact admin." 
      });
    }

    if (license.deviceId && license.deviceId !== deviceId) {
      return res.json({ 
        success: false, 
        message: "Key already used on another device" 
      });
    }

    if (!license.deviceId) {
      license.deviceId = deviceId;
      license.lastValidated = now;
      await license.save();
    }

    res.json({ 
      success: true, 
      message: "Subscription key activated",
      expiresAt: license.endDate
    });
  } catch (err) {
    console.error("Error activating key:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error activating key", 
      error: err.message 
    });
  }
});

// --- Validate Key (Trial or Subscription) ---
app.post("/api/validateKey", async (req, res) => {
  try {
    const { licenseKey } = req.body;
    const deviceId = machineIdSync();

    const license = await License.findOne({ key: licenseKey });
    if (!license) {
      return res.json({ valid: false, message: "Invalid key" });
    }

    if (license.deviceId && license.deviceId !== deviceId) {
      return res.json({ 
        valid: false, 
        message: "Key already used on another device" 
      });
    }

    const now = new Date();
    const endOfDay = new Date(license.endDate);
    endOfDay.setHours(23, 59, 59, 999);

    if (now.getTime() > endOfDay.getTime()) {
      license.status = "Expired";
      await license.save();
      
      const message = license.type === "trial" 
        ? "Trial expired! Please purchase a subscription to continue using the application."
        : "Subscription expired. Please contact admin to renew.";
        
      return res.json({ valid: false, message });
    }

    // Update validation tracking
    license.lastValidated = now;
    license.validationCount += 1;
    await license.save();

    const timeLeft = endOfDay.getTime() - now.getTime();
    const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));

    res.json({ 
      valid: true, 
      message: license.type === "trial" ? "Trial active" : "Subscription active",
      type: license.type,
      expiresAt: license.endDate,
      timeRemaining: license.type === "trial" 
        ? `${minutesLeft} minutes left`
        : `${hoursLeft} hours remaining`
    });
  } catch (err) {
    console.error("Error validating key:", err);
    res.status(500).json({ 
      valid: false, 
      message: "Validation error", 
      error: err.message 
    });
  }
});

// --- Extend License (Admin use) ---
app.put("/api/extendLicense", async (req, res) => {
  try {
    const { key, newEndDate } = req.body;

    const license = await License.findOne({ key });
    if (!license) {
      return res.json({ success: false, message: "License not found" });
    }

    license.endDate = new Date(newEndDate);
    license.status = "Active";
    await license.save();

    res.json({ 
      success: true, 
      message: "License extended", 
      license: {
        key: license.key,
        assignedTo: license.assignedTo,
        endDate: license.endDate,
        status: license.status,
        type: license.type
      }
    });
  } catch (err) {
    console.error("Error extending license:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error extending license", 
      error: err.message 
    });
  }
});

// --- Admin: Get License Info ---
app.get("/api/licenseInfo/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const license = await License.findOne({ key });
    
    if (!license) {
      return res.json({ success: false, message: "License not found" });
    }

    res.json({
      success: true,
      license: {
        key: license.key,
        assignedTo: license.assignedTo,
        type: license.type,
        status: license.status,
        startDate: license.startDate,
        endDate: license.endDate,
        lastValidated: license.lastValidated,
        validationCount: license.validationCount,
        createdAt: license.createdAt,
        deviceBound: !!license.deviceId
      }
    });
  } catch (err) {
    console.error("Error fetching license info:", err);
    res.status(500).json({ 
      success: false, 
      message: "Error fetching license info", 
      error: err.message 
    });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 License server running on port ${PORT}`));

// Export for Vercel
export default app;