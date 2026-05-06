import { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType, signIn, signOut } from '../lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp, collection, query, getDocs } from 'firebase/firestore';

interface FirebaseContextType {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  memories: string[];
  refreshMemories: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType>({
  user: null,
  accessToken: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
  memories: [],
  refreshMemories: async () => {}
});

export const useFirebase = () => useContext(FirebaseContext);

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<string[]>([]);

  const refreshMemories = async (currentUser: User) => {
    try {
      const q = query(collection(db, `users/${currentUser.uid}/memories`));
      const querySnapshot = await getDocs(q);
      const fetchedMemories: string[] = [];
      querySnapshot.forEach((doc) => {
        fetchedMemories.push(doc.data().fact);
      });
      setMemories(fetchedMemories);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/memories`);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Ensure user profile exists
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              name: currentUser.displayName || 'Unknown',
              email: currentUser.email || 'No email',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          await refreshMemories(currentUser);
        } catch (error) {
           handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
        }
      } else {
        setMemories([]);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const handleSignIn = async () => {
    const token = await signIn();
    if (token) {
      setAccessToken(token);
    }
  };

  return (
    <FirebaseContext.Provider value={{
      user,
      accessToken,
      loading,
      signIn: handleSignIn,
      signOut,
      memories,
      refreshMemories: () => user ? refreshMemories(user) : Promise.resolve()
    }}>
      {children}
    </FirebaseContext.Provider>
  );
}
