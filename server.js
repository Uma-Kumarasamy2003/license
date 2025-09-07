import express from "express";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- MongoDB connection ---
const mongoURI =
  "mongodb+srv://Umakumarasamy:Uma%40radio123@cluster0.o8aiaja.mongodb.net/licenseDB?retryWrites=true&w=majority&appName=Cluster0";
mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ MongoDB Atlas connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// --- License Schema ---
const licenseSchema = new mongoose.Schema({
  key: String, // License Key
  assignedTo: String, // e.g. Alex
  startDate: Date, // subscription start
  endDate: Date, // subscription expiry
  deviceId: String, // bound device
  status: { type: String, default: "Active" }, // Active / Expired
  type: String // "trial" or "subscription"
});

const License = mongoose.model("License", licenseSchema);

// --- Create Subscription License (Admin use) ---
app.post("/createLicense", async (req, res) => {
  try {
    const { key, assignedTo, startDate, endDate } = req.body;

    const license = new License({
      key,
      assignedTo,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      type: "subscription",
      deviceId: null,
      status: "Active"
    });

    await license.save();
    res.json({ success: true, message: "License created", license });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error creating license", error: err.message });
  }
});

// --- Create Trial License ---
app.post("/startTrial", async (req, res) => {
  const { deviceId } = req.body;
  if (!deviceId) return res.json({ success: false, message: "Device ID required" });

  const existing = await License.findOne({ deviceId, type: "trial" });
  if (existing) return res.json({ success: false, message: "Trial already used on this device" });

  const now = new Date();
  const end = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes trial

  const trialKey = "TRIAL-" + Math.random().toString(36).substring(2, 8).toUpperCase();

  const trial = new License({ key: trialKey, type: "trial", startDate: now, endDate: end, deviceId });
  await trial.save();

  res.json({ success: true, message: "Trial started", key: trialKey, expiresAt: end });
});

// --- Activate Subscription Key ---
app.post("/activateKey", async (req, res) => {
  const { licenseKey, deviceId } = req.body;
  if (!deviceId) return res.json({ success: false, message: "Device ID required" });

  const license = await License.findOne({ key: licenseKey, type: "subscription" });
  if (!license) return res.json({ success: false, message: "Invalid subscription key" });

  const now = new Date();
  const endOfDay = new Date(license.endDate);
  endOfDay.setHours(23, 59, 59, 999); // Set to end of day (11:59:59.999 PM)

  if (now.getTime() > endOfDay.getTime()) {
    license.status = "Expired"; // Update status for consistency
    await license.save();
    return res.json({ success: false, message: "Subscription expired. Please contact admin." });
  }

  if (license.deviceId && license.deviceId !== deviceId) {
    return res.json({ success: false, message: "Key already used on another device" });
  }

  if (!license.deviceId) {
    license.deviceId = deviceId;
    await license.save();
  }

  res.json({ success: true, message: "Subscription key activated" });
});

// --- Validate Key (Trial or Subscription) ---
app.post("/validateKey", async (req, res) => {
  const { licenseKey, deviceId } = req.body;
  if (!deviceId) return res.json({ valid: false, message: "Device ID required" });

  const license = await License.findOne({ key: licenseKey });
  if (!license) return res.json({ valid: false, message: "Invalid key" });

  if (license.deviceId && license.deviceId !== deviceId) {
    return res.json({ valid: false, message: "Key already used on another device" });
  }

  const now = new Date();
  const endOfDay = new Date(license.endDate);
  endOfDay.setHours(23, 59, 59, 999); // Set to end of day (11:59:59.999 PM)

  if (now.getTime() > endOfDay.getTime()) {
    license.status = "Expired"; // Update status for consistency
    await license.save();
    return res.json({ valid: false, message: "Subscription expired. Please contact admin." });
  }

  res.json({ valid: true, message: license.type === "trial" ? "Trial active" : "Subscription active" });
});

// --- Extend License (Admin use) ---
app.put("/extendLicense", async (req, res) => {
  try {
    const { key, newEndDate } = req.body;

    const license = await License.findOne({ key });
    if (!license) return res.json({ success: false, message: "License not found" });

    license.endDate = new Date(newEndDate);
    license.status = "Active"; // Reset status if extending
    await license.save();

    res.json({ success: true, message: "License extended", license });
  } catch (err) {
    res.status(500).json({ success: false, message: "Error extending license", error: err.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 License server running on port ${PORT}`));