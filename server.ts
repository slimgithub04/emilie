import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import multer from "multer";
import os from "os";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: os.tmpdir() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/process-audio", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No audio file provided" });
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Step A/B: Exécuté via le backend en utilisant l'API Files pour de longs audios
      let uploadResult;
      try {
         uploadResult = await ai.files.upload({
           file: req.file.path,
           config: {
             mimeType: req.file.mimetype,
           }
         });
      } catch (uploadErr) {
         console.error('File upload failed', uploadErr);
         return res.status(500).json({ error: "Failed to upload audio to Gemini" });
      }

      const template = req.body.template || 'generique';
      const identifySpeakers = req.body.identifySpeakers === 'true';
      const anonymizeData = req.body.anonymizeData === 'true';

      let promptText = "";
      switch (template) {
        case 'consultation_initiale':
          promptText = "Tu es un assistant médical expert en dentisterie. Écoute cet enregistrement d'une consultation initiale.\n\nRédige un compte rendu structuré avec les sections suivantes :\n- Motif de la consultation\n- Antécédents médicaux et dentaires\n- Examen clinique (Observations détaillées)\n- Diagnostic provisoire\n- Plan de traitement proposé et discuté avec le patient.";
          break;
        case 'suivi_post_op':
          promptText = "Tu es un assistant médical expert en dentisterie. Écoute cet enregistrement d'un suivi post-opératoire.\n\nRédige un compte rendu structuré avec les sections suivantes :\n- Acte initial (Rappel de l'intervention)\n- État actuel (Douleurs, signes inflammatoires, cicatrisation)\n- Observations cliniques\n- Recommandations données au patient\n- Prochain rendez-vous.";
          break;
        case 'reunion_equipe':
          promptText = "Tu es un assistant de cabinet dentaire. Écoute cet enregistrement d'une réunion d'équipe.\n\nRédige un compte rendu structuré avec :\n- Sujets abordés\n- Décisions prises\n- Plan d'action (Tâches à faire et responsables)\n- Prochains objectifs.";
          break;
        case 'generique':
        default:
          promptText = "Tu es un assistant médical de cabinet dentaire expert. Écoute cet enregistrement de la réunion / de la consultation.\n\nFais un compte rendu structuré et très professionnel. Organise le texte avec ces sections (si applicable) :\n- Motifs de la consultation / Sujet de cet audio\n- Observations et données cliniques\n- Actions effectuées ou Décisions prises\n- Plan de traitement ou Prochaines étapes\n\nRédige de manière claire et fluide en français, sans t'adresser à moi directement.";
          break;
      }

      if (identifySpeakers) {
         promptText += "\n\nIMPORTANT : Effectue une diarisation simulée. Dans ton résumé, indique clairement ou résume sous forme de dialogue ce qui est dit par le 'Praticien / Dentiste' et ce qui est dit par le 'Patient / Autre Interlocuteur'. Sépare bien les différentes voix pour plus de clarté clinique.";
      }

      if (anonymizeData) {
         promptText += "\n\nCRITIQUE (RGPD) : Remplace absolument tous les noms de patients, dates de naissance, adresses, ou données très personnelles par des balises comme [PATIENT_A] ou [PII_MASQUÉ] dans l'intégralité du résumé. Ne révèle aucune information permettant d'identifier un patient.";
      }

      promptText += "\n\nCRITIQUE DE FORMAT : Tu DOIS écrire ta réponse EXCLUSIVEMENT en HTML valide. Utilise les balises <h1>, <h2>, <ul>, <li>, <strong>, <em>, <p>. Ne renvoie AUCUNE syntaxe Markdown. N'inclus PAS de bloc de code ` ```html ` ou ` ``` `, renvoie directement le code HTML formaté.";

      // Step C: Meilleur Prompt pour la synthèse structurée
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          {
            role: 'user',
            parts: [
              { fileData: { fileUri: uploadResult.uri, mimeType: uploadResult.mimeType } },
              { text: promptText }
            ]
          }
        ]
      });

      // Cleanup
      try {
        fs.unlinkSync(req.file.path);
        if (uploadResult && uploadResult.name) {
          await ai.files.delete({ name: uploadResult.name });
        }
      } catch (cleanupErr) {
        console.error("Cleanup error:", cleanupErr);
      }

      res.json({ summary: response.text });
    } catch (error) {
      console.error('Audio processing error:', error);
      res.status(500).json({ error: 'Failed to process audio' });
    }
  });

  app.post("/api/send-email", async (req, res) => {
    const { to, subject, body, accessToken } = req.body;
    
    if (!accessToken) {
      return res.status(401).json({ error: "Access token required" });
    }

    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: accessToken });

      const gmail = google.gmail({ version: 'v1', auth });

      const message = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/html; charset="UTF-8"`,
        '',
        body
      ].join('\r\n');

      const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error('Email send error:', error);
      res.status(500).json({ error: error?.message || 'Failed to send email' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
