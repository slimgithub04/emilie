# Émilie - Assistante Administrative IA pour Cabinet Médical/Dentaire 🦷🤖

Bienvenue dans le dépôt du projet **Émilie**, une application web full-stack d'assistance vocale en temps réel propulsée par l'API Gemini Live. Ce projet vise à réduire drastiquement la charge administrative des praticiens (médecins, dentistes) en leur permettant de dicter naturellement leurs notes de consultation, courriers et e-mails, tout en générant des documents structurés.

## 🌟 Fonctionnalités Principales

- **🗣️ Assistant Vocal Temps Réel (Live API)** : Communication fluide et bidirectionnelle avec "Émilie" grâce à l'API Gemini Multimodal Live. L'assistant écoute, comprend les interruptions et répond avec une voix naturelle.
- **📝 Structuration Intelligente (Méthode SOAP)** : L'IA est configurée pour transformer une "pensée médicale" désordonnée en un compte-rendu médical parfaitement structuré (Subjectif, Objectif, Analyse, Plan).
- **📧 Gestion et Envoi d'E-mails** : Possibilité de rédiger et d'envoyer de vrais e-mails directement depuis l'interface (via un endpoint backend dédié `/api/send-email`).
- **🗂️ Gestion des Patients et Archives** : Base de données en temps réel connectée à Firebase pour enregistrer les brouillons, archiver les documents finaux et gérer les listes de patients.
- **🧠 Contexte & Mémoire Long-Terme** : Émilie retient les habitudes du praticien pour des réponses toujours plus personnalisées.
- **🛡️ Sécurité & Proactivité** : Émilie agit comme un "second cerveau" en vérifiant si des informations critiques (ex: posologie, nom) manquent avant de finaliser un document.

---

## 🏗️ Architecture du Projet

Le projet repose sur une architecture **Full-Stack (Express + Vite + React)** :

### Frontend (Client-Side)
- **Framework** : React 18 avec TypeScript.
- **Bundler** : Vite.
- **Styling** : Tailwind CSS & composants d'interface modernes.
- **Gestion d'état & IA** : Hooks React personnalisés (ex: `useFirebase`) et intégration WebSocket pour la communication voix-texte via `gemini-live-client.ts`.

### Backend (Server-Side)
- **Serveur** : Node.js avec Express (`server.ts`). Intégré pour servir l'API en développement (via `tsx server.ts`) et en production (SPA routing).
- **Endpoints clés** : 
  - `/api/send-email` : Point d'accès sécurisé pour l'envoi d'e-mails réels (nécessite un jeton d'accès).

### Base de données & Authentification
- **Plateforme** : Firebase (Entreprise/Standard).
- **Services utilisés** : 
  - Firebase Authentication (Google Login).
  - Firestore (Règles de sécurité strictes, approche Zero-Trust, hiérarchie de données par utilisateur).

---

## 📂 Structure du Répertoire

```text
/
├── server.ts                    # Point d'entrée du serveur Express backend
├── src/
│   ├── components/              # Composants React réutilisables (UI & Logique)
│   │   ├── LiveCall.tsx         # Cœur de l'application : Interface de l'appel Gemini Live
│   │   ├── FirebaseProvider.tsx # Contexte d'authentification et base de données
│   │   ├── PatientsConfig.tsx   # Gestion des fiches patients
│   │   ├── HistoryAnalytics.tsx # Historisation et analytique des documents archivés
│   │   └── ...
│   ├── lib/                     # Utilitaires et connecteurs externes
│   │   ├── gemini-live-client.ts# Client WebSocket pour l'API Gemini Live
│   │   ├── audio-utils.ts       # Utilitaires de conversion audio (PCM 16 bits, 16kHz)
│   │   └── firebase.ts          # Initialisation du SDK client Firebase
│   ├── App.tsx                  # Racine de l'application React
│   └── main.tsx                 # Point de montage DOM de React
├── firestore.rules              # Règles de sécurité avancées de la base de données
├── firebase-blueprint.json      # Schéma intermédiaire de la structure Firestore
├── vite.config.ts               # Configuration de Vite
└── package.json                 # Dépendances et scripts du projet
```

---

## 🚀 Installation & Développement

### 1. Prérequis
- [Node.js](https://nodejs.org/) (version 18+ recommandée)
- Un compte [Google AI Studio](https://aistudio.google.com/) pour la clé API Gemini.
- Un projet [Firebase](https://console.firebase.google.com/) avec Firestore et Google Authentication activés.

### 2. Configuration des variables d'environnement
Créez un fichier `.env` à la racine du projet basé sur `.env.example` s'il existe, et ajoutez-y :
```env
GEMINI_API_KEY="votre_clé_api_gemini_ici"
# Autres variables backend nécessaires (ex: config email)
```

*(Note : Firebase utilise le fichier `firebase-applet-config.json` pour l'initialisation côté client).*

### 3. Installation des dépendances
```bash
npm install
```

### 4. Lancer le serveur de développement
Le script de développement exécute à la fois le backend Express et le serveur Vite pour le HMR frontend :
```bash
npm run dev
```
L'application sera accessible sur `http://localhost:3000`.

---

## 🔒 Sécurité Firestore (Règles)

Le projet utilise des règles Firestore durcies qui incorporent :
1. **Zero-Trust globale** : Exigence systématique de l'authentification (`isSignedIn()`).
2. **Isolation PII** : Les données des patients et des utilisateurs sont isolées de manière stricte (`request.auth.uid == userId`).
3. **Anti-Update-Gap** : Validation rigoureuse du typage et des modèles de données (Schémas).
*Les règles peuvent être testées et vérifiées via `@firebase/eslint-plugin-security-rules`.*

---

## 🧠 L'Agent IA "Émilie"

L'agent est injecté via un **System Prompt** complexe au lancement du client WebSocket (`LiveCall.tsx`). Ce prompt définit :
- **Identité** : Secrétaire administrative bienveillante et professionnelle.
- **Workflow** : Comportement de dictée -> Entrée en action des Outils (Function Calling) -> Affichage frontend.
- **Capacités** : Rédaction avec vérification des manques (posologies, etc.), application du format SOAP.
- **Gestion des bruits** : L'IA ignore les bruits de fond du cabinet dentaire.

---

## 💡 Notes pour la production

- **Construction** : Utilisez `npm run build` pour générer le site statique dans le dossier `/dist`, suivi d'un `npm start` pour lancer `server.ts` en mode production (sert le frontend statique et l'API).
- **Hébergement Firebase** : N'oubliez pas de déployer vos index (si nécessaire) et vos règles Firestore : `npm run deploy-rules`.

---

*Créé avec Google Gemini, React, Express, et Firebase.*
