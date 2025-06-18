
// Import the functions you need from the SDKs you need
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics"; // Optional: if you need analytics
// import { getAuth } from "firebase/auth"; // Optional: if you need Firebase Auth
// import { getFirestore } from "firebase/firestore"; // Optional: if you need Firestore
// import { getStorage } from "firebase/storage"; // Optional: if you need Firebase Storage

// Your web app's Firebase configuration
// These values are typically sourced from environment variables
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID, // Optional
};

// Initialize Firebase
let app: FirebaseApp;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Optional: Initialize other Firebase services you might need
// const auth = getAuth(app);
// const firestore = getFirestore(app);
// const storage = getStorage(app);
// const analytics = typeof window !== 'undefined' ? getAnalytics(app) : undefined; // Initialize Analytics only on client

export { app /*, auth, firestore, storage, analytics */ };
