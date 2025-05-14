const express = require("express");
const cors = require("cors");
const multer = require("multer");
const admin = require("firebase-admin");
require("dotenv").config();

// Initialize Express
const app = express();

// Enable CORS
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// Load Firebase Admin SDK
let firebaseCredentials;
if (process.env.FIREBASE_CREDENTIALS) {
  firebaseCredentials = JSON.parse(process.env.FIREBASE_CREDENTIALS);
} else {
  try {
    firebaseCredentials = require("./serviceAccountKey.json");
  } catch (error) {
    console.error("Firebase credentials not found.");
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(firebaseCredentials),
  storageBucket:
    process.env.FIREBASE_BUCKET_URL || "marsosv7.firebasestorage.app",
});

// Firestore and Storage references
const db = admin.firestore();
const bucket = admin.storage().bucket();

// Multer setup for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Utility: Validate phone number
const isValidPhoneNumber = (phone) => /^\+?[1-9]\d{1,14}$/.test(phone);

// Routes
app.get("/", (req, res) => {
  res.send("Marsos API");
});

// Get Supplier by ID
app.get("/api/get-supplier/:id", async (req, res) => {
  try {
    const supplierId = req.params.id;
    const supplierRef = db.collection("users").doc(supplierId);
    const supplierDoc = await supplierRef.get();

    if (!supplierDoc.exists) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    res.status(200).json(supplierDoc.data());
  } catch (error) {
    console.error("Error fetching supplier:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch supplier", details: error.message });
  }
});

// Create Supplier
app.post(
  "/api/create-supplier",
  upload.fields([
    { name: "companyLogo", maxCount: 1 },
    { name: "crLicense", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        name,
        phone,
        email,
        companyName,
        crNumber,
        address,
        city,
        region,
        otherCitiesServed,
        deliveryOption,
      } = req.body;
      const companyLogo = req.files?.companyLogo?.[0];
      const crLicense = req.files?.crLicense?.[0];

      if (!name || !phone || !email || !companyName || !crNumber) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (!isValidPhoneNumber(phone)) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      const userRecord = await admin.auth().createUser({
        phoneNumber: phone,
        displayName: name,
      });

      let logoUrl = null;
      if (companyLogo) {
        const logoPath = `logos/${userRecord.uid}/${Date.now()}_${
          companyLogo.originalname
        }`;
        const logoFile = bucket.file(logoPath);

        await logoFile.save(companyLogo.buffer, {
          metadata: { contentType: companyLogo.mimetype },
        });

        logoUrl = `https://storage.googleapis.com/${bucket.name}/${logoPath}`;
      }

      let crLicenseUrl = null;
      if (crLicense) {
        const licensePath = `licenses/${userRecord.uid}/${Date.now()}_${
          crLicense.originalname
        }`;
        const licenseFile = bucket.file(licensePath);

        await licenseFile.save(crLicense.buffer, {
          metadata: { contentType: crLicense.mimetype },
        });

        crLicenseUrl = `https://storage.googleapis.com/${bucket.name}/${licensePath}`;
      }

      const supplierData = {
        uid: userRecord.uid,
        name,
        phone,
        email,
        companyName,
        crNumber,
        address,
        city,
        region,
        otherCitiesServed: JSON.parse(otherCitiesServed || "[]"),
        deliveryOption,
        logoUrl,
        crLicenseUrl,
        role: "supplier",
        createdAt: new Date(),
      };

      await db.collection("users").doc(userRecord.uid).set(supplierData);
      res
        .status(201)
        .json({ id: userRecord.uid, message: "Supplier created successfully" });
    } catch (error) {
      console.error("Error creating supplier:", error);
      res
        .status(500)
        .json({ error: "Failed to create supplier", details: error.message });
    }
  }
);

// Edit Supplier
app.put(
  "/api/edit-supplier/:id",
  upload.fields([
    { name: "companyLogo", maxCount: 1 },
    { name: "crLicense", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const supplierId = req.params.id;
      const supplierRef = db.collection("users").doc(supplierId);
      const supplierDoc = await supplierRef.get();

      if (!supplierDoc.exists) {
        console.error(`Supplier not found for ID: ${supplierId}`);
        return res.status(404).json({ error: "Supplier not found" });
      }

      const existingData = supplierDoc.data();
      const {
        name,
        phone,
        email,
        companyName,
        crNumber,
        address,
        city,
        region,
        otherCitiesServed,
      } = req.body;
      const companyLogo = req.files?.companyLogo?.[0];
      const crLicense = req.files?.crLicense?.[0];

      if (phone) {
        console.log(`Updating phone number for user ${supplierId}: ${phone}`);

        // Validate phone number format
        const isValidPhoneNumber = /^\+?[1-9]\d{1,14}$/.test(phone);
        if (!isValidPhoneNumber) {
          return res.status(400).json({ error: "Invalid phone number format" });
        }

        // Check for duplicate phone number
        try {
          const userWithPhone = await admin.auth().getUserByPhoneNumber(phone);
          if (userWithPhone.uid !== supplierId) {
            return res
              .status(400)
              .json({ error: "Phone number already in use" });
          }
        } catch (error) {
          if (error.code !== "auth/user-not-found") {
            console.error("Error checking phone number:", error);
            return res
              .status(500)
              .json({ error: "Error checking phone number" });
          }
        }

        // Update phone number in Firebase Auth
        try {
          await admin.auth().updateUser(supplierId, { phoneNumber: phone });
          console.log(
            `Phone number updated successfully for user ${supplierId}`
          );
        } catch (authError) {
          console.error(
            "Error updating phone number in Firebase Authentication:",
            authError
          );
          return res.status(500).json({
            error: "Failed to update phone number in Firebase Authentication",
            details: authError.message,
          });
        }
      }

      let logoUrl = existingData.logoUrl;
      if (companyLogo) {
        const logoPath = `logos/${supplierId}/${Date.now()}_${
          companyLogo.originalname
        }`;
        const logoFile = bucket.file(logoPath);

        await logoFile.save(companyLogo.buffer, {
          metadata: { contentType: companyLogo.mimetype },
        });

        logoUrl = `https://storage.googleapis.com/${bucket.name}/${logoPath}`;
      }

      let crLicenseUrl = existingData.crLicenseUrl;
      if (crLicense) {
        const licensePath = `licenses/${supplierId}/${Date.now()}_${
          crLicense.originalname
        }`;
        const licenseFile = bucket.file(licensePath);

        await licenseFile.save(crLicense.buffer, {
          metadata: { contentType: crLicense.mimetype },
        });

        crLicenseUrl = `https://storage.googleapis.com/${bucket.name}/${licensePath}`;
      }

      const updatedData = {
        name: name || existingData.name,
        phone: phone || existingData.phone,
        email: email || existingData.email,
        companyName: companyName || existingData.companyName,
        crNumber: crNumber || existingData.crNumber,
        address: address || existingData.address,
        city: city || existingData.city,
        region: region || existingData.region,
        otherCitiesServed: JSON.parse(otherCitiesServed || "[]"),
        logoUrl,
        crLicenseUrl,
        updatedAt: new Date(),
      };

      await supplierRef.update(updatedData);
      res
        .status(200)
        .json({ message: "Supplier updated successfully", updatedData });
    } catch (error) {
      console.error("Error updating supplier:", error);
      res
        .status(500)
        .json({ error: "Failed to update supplier", details: error.message });
    }
  }
);

app.delete("/api/delete-supplier/:id", async (req, res) => {
  try {
    const supplierId = req.params.id;

    // Fetch supplier document from Firestore
    const supplierRef = db.collection("users").doc(supplierId);
    const supplierDoc = await supplierRef.get();

    if (!supplierDoc.exists) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    // Delete supplier's authentication record
    try {
      await admin.auth().deleteUser(supplierId);
      console.log(`Successfully deleted auth user with ID ${supplierId}`);
    } catch (authError) {
      console.error("Error deleting Firebase Authentication user:", authError);
      return res.status(500).json({
        error: "Failed to delete Firebase Authentication user",
        details: authError.message,
      });
    }

    // Delete supplier document from Firestore
    await supplierRef.delete();
    console.log(
      `Successfully deleted Firestore supplier with ID ${supplierId}`
    );

    res.status(200).json({ message: "Supplier deleted successfully" });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    res
      .status(500)
      .json({ error: "Failed to delete supplier", details: error.message });
  }
});

// Approve Supplier
app.put("/api/approve-supplier/:id", async (req, res) => {
  try {
    const supplierId = req.params.id;
    const supplierRef = db.collection("users").doc(supplierId);

    const supplierDoc = await supplierRef.get();
    if (!supplierDoc.exists) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    await supplierRef.update({
      isApproved: true,
      approvedAt: new Date(),
    });

    res.status(200).json({ message: "Supplier approved successfully." });
  } catch (error) {
    console.error("Error approving supplier:", error);
    res.status(500).json({
      error: "Failed to approve supplier",
      details: error.message,
    });
  }
});

app.post("/api/authenticate-supplier/:id", async (req, res) => {
  try {
    const supplierId = req.params.id;
    const supplierRef = db.collection("users").doc(supplierId);
    const supplierDoc = await supplierRef.get();

    if (!supplierDoc.exists) {
      return res.status(404).json({ error: "Supplier not found" });
    }

    const supplier = supplierDoc.data();
    const phone = supplier.representativePhone || supplier.phone;
    const name = supplier.representativeName || supplier.name;
    const email = supplier.representativeEmail || supplier.email;

    if (!phone) {
      return res.status(400).json({ error: "Supplier missing phone number" });
    }

    try {
      // Try to get user by phone
      await admin.auth().getUserByPhoneNumber(phone);
      return res.status(200).json({ message: "User already authenticated" });
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;

      // Create Firebase Auth user
      const userRecord = await admin.auth().createUser({
        phoneNumber: phone,
        displayName: name || "",
        email: email || undefined,
      });

      // Update Firestore user doc with UID
      await supplierRef.update({
        uid: userRecord.uid,
      });

      return res
        .status(201)
        .json({
          message: "User authenticated successfully",
          uid: userRecord.uid,
        });
    }
  } catch (error) {
    console.error("Error authenticating supplier:", error);
    res
      .status(500)
      .json({
        error: "Failed to authenticate supplier",
        details: error.message,
      });
  }
});

// Port setup
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
