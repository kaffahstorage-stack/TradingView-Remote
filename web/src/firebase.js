import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
const app = initializeApp({ apiKey: 'AIzaSyCz8MC6vbeI8QEji5LwzQ7dO6rM6vRxxiM', authDomain: 'tradingview-remote.firebaseapp.com', projectId: 'tradingview-remote', storageBucket: 'tradingview-remote.firebasestorage.app', messagingSenderId: '305050754617', appId: '1:305050754617:web:a2315678429892e7c4b7e8', measurementId: 'G-F82RH0C32X' });
export const auth = getAuth(app);
auth.languageCode = 'id';
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt: 'select_account'});
// In-memory Firestore cache: private analysis is not persisted by the PWA.
export const db = getFirestore(app);
