import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  projectId: "encuesta-bar-zotek",
  appId: "1:933277055492:web:9d0eac1defeed111669351",
  storageBucket: "encuesta-bar-zotek.firebasestorage.app",
  apiKey: "AIzaSyB5rSdZPaQ6BoUls9JDQmNqPv9xB_gzo1A",
  authDomain: "encuesta-bar-zotek.firebaseapp.com",
  messagingSenderId: "933277055492",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
