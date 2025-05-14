require("dotenv").config();

try {
  const parsedKey = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  console.log("Successfully parsed FIREBASE_SERVICE_ACCOUNT_KEY:", parsedKey);
} catch (error) {
  console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:", error);
}
