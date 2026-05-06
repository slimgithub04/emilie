import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type } from '@google/genai';
import { base64ToArrayBuffer, arrayBufferToBase64, floatTo16BitPCM } from './audio-utils';

export type LiveClientState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface LiveClientConfig {
  apiKey: string;
  systemInstruction?: string;
  onStateChange?: (state: LiveClientState) => void;
  onMessage?: (role: 'user' | 'model', text: string) => void;
  onEndCall?: () => void;
  onSaveMemory?: (fact: string) => Promise<void>;
  onPatientSearch?: (nom: string, prenom?: string) => Promise<any>;
  onInterrupt?: () => void;
  onDraftDocument?: (details: { patientId: string, type_document: string, destinataire: string, contenu_formate: string }) => void;
  onArchiveDocument?: (patientId: string, titre: string) => Promise<void>;
  onVolumeChange?: (volume: number) => void;
  onToolCall?: (calling: boolean) => void;
}

export class GeminiLiveClient {
  private ai: GoogleGenAI;
  private session: any; // We'll hold the live session here
  private audioContext: AudioContext | null = null;
  private inputAudioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private volumeAnimationFrame: number | null = null;
  private isMuted: boolean = false;
  private reconnectionAttempts = 0;
  private readonly maxReconnectionAttempts = 3;
  private reconnectionTimeout: any = null;
  
  private nextPlayTime = 0;
  private state: LiveClientState = 'disconnected';
  private isPendingDisconnect: boolean = false;
  private config: LiveClientConfig;

  constructor(config: LiveClientConfig) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
  }

  public async connect(isReconnect = false) {
    if (isReconnect) {
      this.updateState('reconnecting');
    } else {
      this.reconnectionAttempts = 0;
      this.updateState('connecting');
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000 });
      this.outputAnalyser = this.audioContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;
      this.outputAnalyser.connect(this.audioContext.destination);
      this.nextPlayTime = this.audioContext.currentTime;
      this.startVolumeLoop();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    try {
      this.session = await this.ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          systemInstruction: this.config.systemInstruction ? 
            `${this.config.systemInstruction}\n\n[Information système] : Nous sommes le ${new Date().toLocaleString('fr-FR', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}.` : undefined,
          tools: [
            {
              functionDeclarations: [
                {
                  name: "end_call",
                  description: "Termine l'appel uniquement après confirmation que l'utilisateur n'a plus de demande. Déclenche si l'utilisateur exprime clairement la fin (au revoir, merci c'est tout) ou après avoir demandé confirmation ('Puis-je vous aider avec autre chose ?') et que la réponse est négative.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {}
                  }
                },
                {
                  name: "save_memory",
                  description: "Sauvegarde un fait, une préférence ou une information importante concernant l'utilisateur. Appeler cet outil pour mémoriser des choses à long terme.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      fact: {
                        type: Type.STRING,
                        description: "Le fait à mémoriser (ex: 'Mon nom est Slim', 'J\\'aime la programmation', etc.)"
                      }
                    },
                    required: ["fact"]
                  }
                },
                {
                  name: "rechercher_patient",
                  description: "Recherche un patient dans la base de données Logosw pour récupérer ses informations (adresse, médecin traitant, date de naissance, etc.) afin de préparer l'en-tête d'une lettre ou d'un rapport.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      nom: {
                        type: Type.STRING,
                        description: "Le nom de famille du patient (ex: 'Dupont')."
                      },
                      prenom: {
                        type: Type.STRING,
                        description: "Le prénom du patient (optionnel, ex: 'Éric')."
                      }
                    },
                    required: ["nom"]
                  }
                },
                {
                  name: "rediger_document",
                  description: "Rédige et formate un courrier, un e-mail ou un compte-rendu. Affiche le brouillon sur l'écran de l'utilisateur pour relecture.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      patientId: { type: Type.STRING, description: "L'ID du patient." },
                      type_document: { type: Type.STRING, description: "Type: 'email', 'courrier', 'ordonnance', 'compte-rendu'." },
                      objet: { type: Type.STRING, description: "L'objet du document (ex: 'Rapport de consultation', 'Demande de rendez-vous'). Obligatoire pour les e-mails." },
                      destinataire: { type: Type.STRING, description: "Destinataire (ex: 'Dr. Martin' ou un e-mail)." },
                      contenu_formate: { type: Type.STRING, description: "Le texte structuré et formaté." }
                    },
                    required: ["patientId", "type_document", "destinataire", "contenu_formate"]
                  }
                },
                {
                  name: "archiver_document",
                  description: "Archive le document en cours dans le dossier du patient, après validation verbale du praticien (ex: 'C'est parfait, archive').",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      patientId: { type: Type.STRING, description: "L'ID du patient." },
                      titre: { type: Type.STRING, description: "Titre du document pour l'archive." }
                    },
                    required: ["patientId", "titre"]
                  }
                }
              ]
            } as any
          ],
        },
        callbacks: {
          onopen: () => {
            this.reconnectionAttempts = 0;
            this.updateState('connected');
          },
          onmessage: async (message: any) => {
            console.log('Live message received:', message);
            if (message.setupComplete) {
               console.log('Setup complete, triggering first message...');
               if (this.session && this.session.sendRealtimeInput) {
                  this.session.sendRealtimeInput({
                    text: "Action : Dis UNIQUEMENT 'Bonjour, c'est Émilie' pour démarrer l'appel, puis attends ma réponse sans rien ajouter."
                  });
               }
               // Attendre un court instant pour que le texte soit traité comme déclencheur de tour
               setTimeout(() => {
                 this.startAudioInput();
               }, 300);
            }
            if (message.serverContent) {
              const content = message.serverContent;
              if (content.interrupted) {
                console.log('Model interrupted, stopping audio playback');
                this.clearAudioPlayback();
                this.config.onInterrupt?.();
              }
              if (content.modelTurn && content.modelTurn.parts) {
                content.modelTurn.parts.forEach((part: any) => {
                  if (part.inlineData && part.inlineData.data) {
                    console.log('Received audio chunk, length:', part.inlineData.data.length);
                    this.playAudio(part.inlineData.data);
                  }
                  if (part.text) {
                    console.log('Received text:', part.text);
                    this.config.onMessage?.('model', part.text);
                  }
                });
              }
            }
            if (message.toolCall) {
              this.config.onToolCall?.(true);
              const calls = message.toolCall.functionCalls.map((fc: any) => {
                console.log('Received tool call:', fc);
                return this.handleFunctionCall(fc);
              });
              Promise.all(calls).finally(() => {
                this.config.onToolCall?.(false);
              });
            }
          },
          onclose: () => {
            if (this.state === 'connected' || this.state === 'reconnecting') {
              this.handleReconnection();
            } else {
              this.updateState('disconnected');
              this.stopAudio();
            }
          },
          onerror: (err) => {
            console.error('Live API Error:', err);
            this.handleReconnection();
          }
        }
      });
    } catch (e) {
      console.error('Failed to connect', e);
      this.updateState('error');
    }
  }

  private handleReconnection() {
    if (this.reconnectionAttempts < this.maxReconnectionAttempts) {
      this.reconnectionAttempts++;
      const delay = Math.pow(2, this.reconnectionAttempts) * 1000;
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectionAttempts}/${this.maxReconnectionAttempts})...`);
      
      if (this.reconnectionTimeout) clearTimeout(this.reconnectionTimeout);
      this.reconnectionTimeout = setTimeout(() => {
        this.connect(true);
      }, delay);
      
      this.updateState('reconnecting');
    } else {
      console.error('Max reconnection attempts reached');
      this.updateState('error');
      this.stopAudio();
    }
  }

  public disconnect() {
    this.isPendingDisconnect = false;
    this.reconnectionAttempts = this.maxReconnectionAttempts; // prevent auto-reconnect
    if (this.reconnectionTimeout) clearTimeout(this.reconnectionTimeout);
    if (this.session) {
      this.session.close?.();
      this.session = null;
    }
    this.stopAudio();
    this.updateState('disconnected');
  }

  private updateState(newState: LiveClientState) {
    this.state = newState;
    this.config.onStateChange?.(newState);
  }

  private async handleFunctionCall(fc: any) {
    if (fc.name === 'end_call') {
       this.session?.sendToolResponse({
         functionResponses: [{
           id: fc.id,
           name: fc.name,
           response: { result: "Success. End the call now." }
         }]
       });
       this.isPendingDisconnect = true;
    } else if (fc.name === 'save_memory') {
       const args = fc.args as { fact: string };
       let result = "Failed to save.";
       try {
         if (this.config.onSaveMemory) {
           await this.config.onSaveMemory(args.fact);
           result = "Success. Memory saved.";
         } else {
           result = "Memory system not configured in client.";
         }
       } catch (err) {
         result = `Error: ${err instanceof Error ? err.message : String(err)}`;
       }
       
       this.session?.sendToolResponse({
         functionResponses: [{
           id: fc.id,
           name: fc.name,
           response: { result }
         }]
       });
    } else if (fc.name === 'rechercher_patient') {
       const args = fc.args as { nom: string, prenom?: string };
       console.log('Recherche patient dans Logosw:', args);
       let result: any = {};
       
       try {
         if (this.config.onPatientSearch) {
           const patientData = await this.config.onPatientSearch(args.nom, args.prenom);
           if (patientData) {
              result = { status: "success", patient: patientData };
           } else {
              result = { status: "not_found", message: "Aucun patient trouvé avec ce nom dans Logosw." };
           }
         } else {
           result = { status: "error", message: "Recherche patient non configurée." };
         }
       } catch (err) {
         console.error('Error in onPatientSearch:', err);
         result = { status: "error", message: "Erreur lors de la recherche du patient." };
       }

       this.session?.sendToolResponse({
         functionResponses: [{
           id: fc.id,
           name: fc.name,
           response: result
         }]
       });
    } else if (fc.name === 'rediger_document') {
       const args = fc.args as { patientId: string, type_document: string, destinataire: string, objet?: string, contenu_formate: string };
       if (this.config.onDraftDocument) {
         this.config.onDraftDocument(args);
       }
       this.session?.sendToolResponse({
         functionResponses: [{
           id: fc.id,
           name: fc.name,
           response: { result: "Brouillon affiché à l'écran. Demandez à l'utilisateur de le relire ou de confirmer." }
         }]
       });
    } else if (fc.name === 'archiver_document') {
       const args = fc.args as { patientId: string, titre: string };
       let resultMsg = "Erreur lors de l'archivage.";
       try {
         if (this.config.onArchiveDocument) {
           await this.config.onArchiveDocument(args.patientId, args.titre);
           resultMsg = "Archivage réussi.";
         } else {
           resultMsg = "Erreur : onArchiveDocument non configuré.";
         }
       } catch (e: any) {
         resultMsg = "Erreur Catch: " + e.message;
       }
       this.session?.sendToolResponse({
         functionResponses: [{
           id: fc.id,
           name: fc.name,
           response: { result: resultMsg }
         }]
       });
    }
  }

  private async startAudioInput() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000 }});
      this.inputAudioContext = new AudioContext({ sampleRate: 16000 });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
      
      this.inputAnalyser = this.inputAudioContext.createAnalyser();
      this.inputAnalyser.fftSize = 256;
      this.sourceNode.connect(this.inputAnalyser);

      this.scriptProcessor.onaudioprocess = (event) => {
         if (this.state !== 'connected' || !this.session || this.isMuted) return;
         
         const inputData = event.inputBuffer.getChannelData(0);
         const pcmData = floatTo16BitPCM(inputData);
         const base64 = arrayBufferToBase64(pcmData.buffer);
         
         this.session.sendRealtimeInput({
             audio: { mimeType: "audio/pcm;rate=16000", data: base64 }
         });
      };

      this.sourceNode.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputAudioContext.destination);

    } catch (e) {
      console.error('Error recording audio', e);
      this.updateState('error');
    }
  }

  private playAudio(base64: string) {
    if (!this.audioContext) {
       this.audioContext = new AudioContext({ sampleRate: 24000 });
       this.outputAnalyser = this.audioContext.createAnalyser();
       this.outputAnalyser.fftSize = 256;
       this.outputAnalyser.connect(this.audioContext.destination);
       this.nextPlayTime = this.audioContext.currentTime;
       this.startVolumeLoop();
    }

    const pcmBuffer = base64ToArrayBuffer(base64);
    const int16Array = new Int16Array(pcmBuffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
       float32Array[i] = int16Array[i] / 0x8000;
    }

    const audioBuffer = this.audioContext.createBuffer(1, float32Array.length, 24000);
    audioBuffer.getChannelData(0).set(float32Array);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    if (this.outputAnalyser) {
      source.connect(this.outputAnalyser);
    } else {
      source.connect(this.audioContext.destination);
    }

    const currentTime = this.audioContext.currentTime;
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime + 0.1;
    }
    
    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;
  }

  private clearAudioPlayback() {
    if (this.audioContext) {
       this.audioContext.close();
       this.audioContext = null;
    }
  }

  private startVolumeLoop() {
    const loop = () => {
      // Check for graceful disconnect
      if (this.isPendingDisconnect && this.audioContext && this.audioContext.currentTime >= this.nextPlayTime) {
        console.log('Graceful disconnect: audio finished playing');
        this.disconnect();
        this.config.onEndCall?.();
        return; // Stop loop
      }

      let maxVolume = 0;

      if (this.outputAnalyser) {
        const array = new Uint8Array(this.outputAnalyser.frequencyBinCount);
        this.outputAnalyser.getByteFrequencyData(array);
        let sum = 0;
        for (let i = 0; i < array.length; i++) {
          sum += array[i];
        }
        const avg = sum / array.length;
        const volume = avg / 255;
        if (volume > maxVolume) maxVolume = volume;
      }

      if (this.inputAnalyser && maxVolume < 0.05) { // If output is quiet, check input
        const array = new Uint8Array(this.inputAnalyser.frequencyBinCount);
        this.inputAnalyser.getByteFrequencyData(array);
        let sum = 0;
        for (let i = 0; i < array.length; i++) {
          sum += array[i];
        }
        const avg = sum / array.length;
        const volume = avg / 255;
        if (volume > maxVolume) maxVolume = volume;
      }

      if (this.config.onVolumeChange) {
        this.config.onVolumeChange(Math.min(1, maxVolume * 2.5)); // Scale up a bit
      }

      this.volumeAnimationFrame = requestAnimationFrame(loop);
    };
    if (this.volumeAnimationFrame === null) {
       this.volumeAnimationFrame = requestAnimationFrame(loop);
    }
  }

  private stopVolumeLoop() {
    if (this.volumeAnimationFrame !== null) {
      cancelAnimationFrame(this.volumeAnimationFrame);
      this.volumeAnimationFrame = null;
    }
  }

  private stopAudio() {
    this.stopVolumeLoop();
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.inputAnalyser) {
      this.inputAnalyser.disconnect();
      this.inputAnalyser = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.inputAudioContext) {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    if (this.outputAnalyser) {
      this.outputAnalyser.disconnect();
      this.outputAnalyser = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
