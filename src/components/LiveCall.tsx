import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, Phone, PhoneOff, Loader2, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { GeminiLiveClient, LiveClientState } from '../lib/gemini-live-client';
import { useFirebase } from '../components/FirebaseProvider';
import { doc, setDoc, serverTimestamp, collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import emillieImage from '../assets/emillie.png';

export function LiveCall() {
  const [state, setState] = useState<LiveClientState>('disconnected');
  const [isToolCalling, setIsToolCalling] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<{role: string, text: string}[]>([]);
  const [draft, setDraft] = useState<{ patientId: string, type_document: string, destinataire: string, objet?: string, contenu_formate: string } | null>(null);
  const draftRef = useRef<{ patientId: string, type_document: string, destinataire: string, objet?: string, contenu_formate: string } | null>(null);
  const [volumeScale, setVolumeScale] = useState<number>(1);
  
  const [isInterrupted, setIsInterrupted] = useState(false);
  const interruptionTimeoutRef = useRef<any>(null);
  
  const clientRef = useRef<GeminiLiveClient | null>(null);
  const { user, memories, refreshMemories, accessToken, signIn } = useFirebase();

  const callIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(0);
  const interruptionsRef = useRef<number>(0);
  const transcriptStringRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (interruptionTimeoutRef.current) clearTimeout(interruptionTimeoutRef.current);
    };
  }, []);

  const toggleMute = () => {
    if (clientRef.current) {
      const nextMuted = !isMuted;
      clientRef.current.setMute(nextMuted);
      setIsMuted(nextMuted);
    }
  };

  const startCall = async () => {
    try {
      console.log('Starting call...');
      setIsMuted(false);
      callIdRef.current = crypto.randomUUID();
      startTimeRef.current = Date.now();
      interruptionsRef.current = 0;
      transcriptStringRef.current = '';
      setTranscripts([]);
      
      let START_INSTRUCTION = `[RÈGLE CRITIQUE - INITIATIVE] Tu as le contrôle total du début de l'appel. DÈS QUE TU ES CONNECTÉE, tu DOIS parler immédiatement pour saluer le docteur. N'attends pas d'audio, n'attends pas de silence. Ta toute première phrase doit être exactement : "Bonjour, c'est Émilie". NE DIS RIEN D'AUTRE. Ne pose aucune question, ne propose pas ton aide, dis juste cette phrase et attends la réponse du docteur.
[Identity]  
Tu es Émilie, une secrétaire administrative expérimentée travaillant dans un cabinet dentaire. Ta mission principale est de rédiger des courriers professionnels simples et clairs dictés par le praticien ou son équipe.

[Personality & Tone]  
- Ton : Professionnel, efficace, et humainement chaleureux.
- Style : Sois concise mais vivante. Utilise des micro-réactions naturelles ("D'accord", "Parfait", "Je m'en occupe", "C'est tout bon", "Je note ça") au lieu de simples confirmations répétitives. L'objectif est de réduire la fatigue cognitive du docteur en étant une alliée réactive et attentive.

[Workflow Courrier]  
1. **Identifier le patient** : Demande le nom ou cherche-le via l'outil \`rechercher_patient\`.
2. **Rédiger** : Prends la dictée, puis appelle l'outil \`rediger_document\`.
   - Si c'est un e-mail : Utilise \`type_document: 'email'\` et remplis obligatoirement le champ \`objet\`.
   - Si c'est une lettre ou un rapport : Utilise \`type_document: 'courrier'\` ou \`'compte-rendu'\`.
   - Dis oralement : "Le document est prêt à l'écran, dites-moi si vous souhaitez des modifications ou si je l'archive."
3. **Corriger** : Si le praticien demande des modifications vocales, rappelle \`rediger_document\` avec le texte mis à jour.
4. **Archiver** : Si le praticien dit "C'est parfait, tu peux archiver", appelle l'outil \`archiver_document\`.

[Task & Goals]  
- Ne lis pas l'intégralité du document à haute voix, dis simplement qu'il est prêt.
- Utilise des phrases courtes à l'oral.
- **Fin de l'appel** : Quand le praticien a fini ou te dit au revoir, réponds poliment (ex: "Entendu, bonne fin de journée Docteur !") et appelle IMMÉDIATEMENT l'outil \`end_call\`. Le système attendra que tu aies fini de parler pour couper la ligne.

[Gestion des Interruptions et Bruits]
- Un cabinet dentaire est un lieu vivant. Si tu détectes une conversation en arrière-plan qui ne t'est pas adressée (ex: le docteur parle à son assistante ou répond au téléphone), reste en attente et silencieuse.
- N'interviens que si le docteur s'adresse explicitement à toi ou commence une dictée.
- En cas de doute sur une voix en fond, privilégie le silence.

[Formatage des Documents]
- Produis un texte clair, aéré et professionnel.
- Utilise des sauts de ligne logiques pour séparer les paragraphes et les sections (ex: en-tête, corps du texte, conclusion).
- Le texte doit être prêt à être validé par le médecin sans retouches de mise en page.

[Expertise Médicale & SOAP]  
Quand tu rédiges un compte-rendu médical ou une note d'évolution, utilise systématiquement la structure SOAP pour organiser les propos du docteur, même s'ils sont désordonnés :
- S (Subjectif) : Motifs de consultation, symptômes rapportés par le patient.
- O (Objectif) : Constats cliniques, observations du praticien, résultats d'examens.
- A (Analyse) : Diagnostic ou hypothèses diagnostiques.
- P (Plan) : Traitement, prescriptions, conseils, prochain rendez-vous.

[Vigilance & Proactivité]
- Tu es le "second cerveau" du docteur. À la fin de chaque rédaction, vérifie s'il manque une donnée critique (ex: posologie pour un médicament, nom du destinataire, date précise).
- Si une information manque, signale-le poliment après avoir dit que le document est prêt : "Le document est prêt. Souhaitez-vous ajouter la posologie pour [médicament] ?"
- Ne bloque pas la rédaction, propose simplement l'ajout.`;

      if (memories && memories.length > 0) {
         START_INSTRUCTION += `\n\n[Long-term Memory]\nVoici ce que tu as appris lors des précédents appels concernant ce praticien ou la configuration. N'hésite pas à t'en servir pour personnaliser tes réponses :\n` + memories.map(m => `- ${m}`).join('\n');
      }

      clientRef.current = new GeminiLiveClient({
        apiKey: process.env.GEMINI_API_KEY || '',
        systemInstruction: START_INSTRUCTION,
        onStateChange: (newState) => {
          setState(newState);
          if (newState === 'disconnected' || newState === 'error') {
            setVolumeScale(1);
          }
        },
        onVolumeChange: (vol) => {
          setVolumeScale(1 + vol * 0.4); // max scale up to 1.4
        },
        onToolCall: (calling) => {
          setIsToolCalling(calling);
        },
        onInterrupt: () => {
          interruptionsRef.current += 1;
          setIsInterrupted(true);
          if (interruptionTimeoutRef.current) clearTimeout(interruptionTimeoutRef.current);
          interruptionTimeoutRef.current = setTimeout(() => {
            setIsInterrupted(false);
          }, 2000);
        },
        onMessage: (role, text) => {
          setTranscripts(prev => [...prev, { role, text }]);
          const roleName = role === 'model' ? 'Emilie' : 'Docteur';
          transcriptStringRef.current += `[${roleName}] : ${text}\n`;
        },
        onEndCall: () => {
          endCall();
        },
        onSaveMemory: async (fact: string) => {
          if (user) {
             const memoryId = crypto.randomUUID();
             const memoryRef = doc(db, `users/${user.uid}/memories`, memoryId);
             await setDoc(memoryRef, {
               fact,
               createdAt: serverTimestamp()
             });
             await refreshMemories();
          }
        },
        onPatientSearch: async (nom: string, prenom?: string) => {
          if (!user) return null;
          try {
            const patientsRef = collection(db, `users/${user.uid}/patients`);
            const querySnapshot = await getDocs(patientsRef);
            let matchedPatient = null;
            querySnapshot.forEach((docSnap) => {
              const data = docSnap.data();
              if (data.nom.toLowerCase().includes(nom.toLowerCase())) {
                 matchedPatient = { id: docSnap.id, ...data };
              }
            });
            return matchedPatient;
          } catch (e) {
            console.error('Erreur recherche patient:', e);
            return null;
          }
        },
        onDraftDocument: (details) => {
          // Safe sanitization: replace literal \n string with real newline characters
          const sanitizedDetails = {
            ...details,
            contenu_formate: details.contenu_formate.replace(/\\n/g, '\n')
          };
          setDraft(sanitizedDetails);
          draftRef.current = sanitizedDetails;
        },
        onArchiveDocument: async (patientId: string, titre: string) => {
          if (!user || !draftRef.current) throw new Error("Aucun document brouillon à archiver.");
          const currentDraft = draftRef.current;
          
          try {
            const docId = crypto.randomUUID();
            const documentRef = doc(db, `users/${user.uid}/patients/${currentDraft.patientId}/documents`, docId);
            await setDoc(documentRef, {
              titre: titre || currentDraft.type_document || "Sans titre",
              type_document: currentDraft.type_document || "Autre",
              destinataire: currentDraft.destinataire || "",
              contenu_formate: currentDraft.contenu_formate || "",
              createdAt: serverTimestamp(),
              status: 'validé'
            });
            
            // On successful save, clear the draft
            setDraft(null);
            draftRef.current = null;
          } catch (error) {
            console.error("Erreur archive:", error);
            throw error;
          }
        }
      });
      // Patch for API Key issue
      if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
        clientRef.current['config']['apiKey'] = process.env.GEMINI_API_KEY;
      }
      await clientRef.current.connect();
    } catch (err) {
      console.error(err);
    }
  };

  const endCall = async () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    setState('disconnected');

    if (user && callIdRef.current && startTimeRef.current) {
      try {
        const endedAt = Date.now();
        const durationSeconds = Math.round((endedAt - startTimeRef.current) / 1000);
        const callRef = doc(db, `users/${user.uid}/calls`, callIdRef.current);
        await setDoc(callRef, {
          duration: durationSeconds,
          interruptionCount: interruptionsRef.current,
          status: 'completed',
          createdAt: new Date(startTimeRef.current),
          endedAt: new Date(endedAt),
          transcriptText: transcriptStringRef.current
        });
        callIdRef.current = null;
      } catch (err) {
        console.error("Failed to save call analytics:", err);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-start w-full">
      {state === 'disconnected' ? (
        <>
          <div className="text-center space-y-2 mb-10 pt-4 md:pt-8 w-full">
            <h2 className="text-2xl md:text-3xl font-light tracking-tight text-slate-900">Bonjour Docteur, je vous écoute.</h2>
            <p className="text-slate-500 text-sm md:text-base font-medium">Émilie est prête à vous assister.</p>
          </div>

          <div className="relative mb-12">
            <div 
              className="w-40 h-40 md:w-48 md:h-48 rounded-full bg-gradient-to-b from-red-500 to-red-700 shadow-xl shadow-red-500/20 border-4 border-white flex items-center justify-center overflow-hidden z-10 relative transition-transform duration-75"
              style={{ transform: `scale(${volumeScale})` }}
            >
              <div className="absolute inset-1 border-4 border-white/40 rounded-full"></div>
              <img src={emillieImage} alt="Emilie Avatar" className="w-[85%] h-[85%] object-contain" />
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 mt-8">
            <Button onClick={startCall} className="w-full md:w-auto px-6 md:px-8 py-3 md:py-4 h-14 md:h-16 rounded-[2rem] bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg shadow-red-600/20 flex items-center justify-center gap-3 text-base md:text-lg transition-all duration-300 hover:scale-[1.03] hover:shadow-xl hover:shadow-red-600/40 active:scale-95">
              <Phone className="w-5 h-5 md:w-6 md:h-6" /> COMMENCER L'APPEL
            </Button>
          </div>
        </>
      ) : (
        <div className={`flex flex-col ${draft ? 'md:flex-row w-full gap-8' : 'items-center'} w-full justify-center`}>
          <div className={`flex flex-col items-center ${draft ? 'w-full md:w-1/3' : 'w-full'}`}>
            <div className="text-center space-y-2 mb-8 pt-4 md:pt-8 w-full">
              <h2 className="text-2xl md:text-3xl font-light tracking-tight text-slate-900">En cours d'appel...</h2>
              <p className="text-slate-500 text-sm md:text-base font-medium">
                {state === 'connecting' ? 'Connexion à Emilie...' : 
                 state === 'reconnecting' ? 'Problème réseau. Reconnexion en cours...' : 
                 isToolCalling ? (
                   <span className="flex items-center justify-center gap-2 text-red-600 font-bold animate-pulse">
                     <Loader2 className="w-4 h-4 animate-spin" />
                     ÉMILIE EFFECTUE UNE ACTION...
                   </span>
                 ) :
                 isInterrupted ? 'Émilie écoute...' :
                 'Conversation en cours'}
              </p>
            </div>

            <div className="relative mb-10">
              <div 
                className={`w-40 h-40 md:w-48 md:h-48 rounded-full bg-gradient-to-b shadow-xl border-4 border-white flex items-center justify-center overflow-hidden z-10 relative transition-all duration-300 ${isInterrupted ? 'from-amber-400 to-amber-600 shadow-amber-500/40' : 'from-red-500 to-red-700 shadow-red-500/20'}`}
                style={{ transform: `scale(${volumeScale})` }}
              >
                <div className="absolute inset-1 border-4 border-white/40 rounded-full"></div>
                <img src={emillieImage} alt="Emilie Avatar" className="w-[85%] h-[85%] object-contain" />
              </div>
              {state === 'connected' && (
                  <>
                    <div className="absolute -inset-4 border border-red-200 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] opacity-50 pointer-events-none"></div>
                    <div className="absolute -inset-8 border border-red-100/60 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] opacity-30 pointer-events-none hidden md:block"></div>
                  </>
              )}
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 w-full md:w-auto px-4 md:px-0">
              <button 
                onClick={toggleMute}
                className={`flex w-14 h-14 md:w-16 md:h-16 rounded-full shadow-sm border transition-all hover:scale-105 items-center justify-center ${isMuted ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'}`}
                title={isMuted ? "Réactiver le micro" : "Couper le micro"}
              >
                {isMuted ? <MicOff className="w-5 h-5 md:w-6 md:h-6" /> : <Mic className="w-5 h-5 md:w-6 md:h-6" />}
              </button>
              <Button onClick={endCall} variant="destructive" className="w-full md:w-auto px-6 md:px-8 py-3 md:py-4 h-14 md:h-16 rounded-[2rem] bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-500/20 flex items-center justify-center gap-3 text-base md:text-lg transition-all hover:scale-105 active:scale-95">
                <PhoneOff className="w-5 h-5 md:w-6 md:h-6" /> TERMINER L'APPEL
              </Button>
            </div>

            <div className="mt-8 md:mt-12 w-full max-w-xl bg-white/80 backdrop-blur-xl rounded-3xl p-4 md:p-6 border border-white shadow-lg shadow-slate-200/40 h-48 md:h-64 flex flex-col">
               <p className="text-[10px] uppercase tracking-[0.2em] text-red-600 mb-4 font-bold shrink-0 flex items-center gap-2">
                 <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span> Transcription en direct
               </p>
               <ScrollArea className="flex-1 pr-4">
                  <div className="space-y-4">
                      {transcripts.map((t, i) => (
                          <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[90%] md:max-w-[85%] rounded-2xl p-3 text-[13px] md:text-sm font-medium leading-relaxed ${t.role === 'user' ? 'bg-red-600 text-white rounded-br-sm shadow-md shadow-red-600/10' : 'bg-slate-50 border border-slate-100 text-slate-700 rounded-bl-sm'}`}>
                                  {t.text}
                              </div>
                          </div>
                      ))}
                      {isToolCalling && (
                          <div className="flex justify-start">
                              <div className="bg-slate-50 border border-slate-100 text-slate-500 rounded-2xl p-3 text-[13px] md:text-sm font-bold flex items-center gap-2 italic">
                                  <Loader2 className="w-3 h-3 animate-spin text-red-500" />
                                  Emma effectue une action...
                              </div>
                          </div>
                      )}
                      {(state === 'connecting' || state === 'reconnecting') && (
                          <div className="flex flex-col items-center justify-center py-4 gap-2">
                              <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                              {state === 'reconnecting' && <span className="text-[10px] text-red-500 font-bold uppercase animate-pulse">Reconnexion...</span>}
                          </div>
                      )}
                  </div>
               </ScrollArea>
            </div>
          </div>
          
          {draft && (
            <div className="w-full md:w-2/3 h-full flex flex-col animate-in fade-in slide-in-from-right-4 pt-4 md:pt-8 pr-0 md:pr-4">
               <div className="bg-white rounded-3xl border border-slate-200 shadow-xl flex flex-col flex-1 h-[calc(85vh-2rem)] overflow-hidden">
                  <div className="p-4 md:p-6 border-b border-slate-100 flex items-center justify-between bg-white">
                    <div>
                      <h3 className="font-bold text-slate-900 flex items-center gap-2 text-lg">
                        {draft.type_document === 'email' ? 'Nouveau Message' : 'Document Médical'}
                        <span className="text-[10px] uppercase tracking-wider bg-red-100 text-red-700 font-bold px-2.5 py-1 rounded-full border border-red-200">
                          Brouillon
                        </span>
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline"
                        onClick={() => setDraft(null)}
                        className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                      >
                        Annuler
                      </Button>

                      {draft.type_document === 'email' ? (
                        <>
                          <Button 
                            variant="outline"
                            onClick={() => {
                              try {
                                const docId = crypto.randomUUID();
                                const documentRef = doc(db, `users/${user!.uid}/patients/${draft.patientId}/documents`, docId);
                                setDoc(documentRef, {
                                  titre: draft.objet || draft.type_document,
                                  type_document: draft.type_document,
                                  destinataire: draft.destinataire,
                                  contenu_formate: draft.contenu_formate,
                                  createdAt: serverTimestamp(),
                                  status: 'archivé'
                                }).then(() => {
                                  setDraft(null);
                                  draftRef.current = null;
                                  toast.success('Brouillon archivé avec succès.');
                                });
                              } catch (e) {
                                console.error(e);
                                toast.error("Erreur lors de l'archivage.");
                              }
                            }}
                            className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold"
                          >
                            Archiver uniquement
                          </Button>
                          <Button 
                            onClick={async () => {
                              if (!accessToken) {
                                toast.error("Veuillez vous reconnecter pour autoriser l'envoi d'e-mails.");
                                await signIn();
                                return;
                              }

                              toast.promise(
                                fetch('/api/send-email', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    to: draft.destinataire,
                                    subject: draft.objet || 'Document Médical',
                                    body: draft.contenu_formate.replace(/\n/g, '<br/>'),
                                    accessToken: accessToken
                                  })
                                }).then(async (res) => {
                                  if (!res.ok) {
                                    const data = await res.json();
                                    throw new Error(data.error || "Erreur lors de l'envoi");
                                  }
                                  return res.json();
                                }),
                                {
                                  loading: 'Envoi de l\'e-mail réel via Gmail...',
                                  success: () => {
                                    try {
                                      const docId = crypto.randomUUID();
                                      const documentRef = doc(db, `users/${user!.uid}/patients/${draft.patientId}/documents`, docId);
                                      setDoc(documentRef, {
                                        titre: draft.objet || draft.type_document,
                                        type_document: draft.type_document,
                                        destinataire: draft.destinataire,
                                        contenu_formate: draft.contenu_formate,
                                        createdAt: serverTimestamp(),
                                        status: 'envoyé'
                                      });
                                      setDraft(null);
                                      draftRef.current = null;
                                      return 'E-mail envoyé avec succès !';
                                    } catch (e) {
                                      console.error(e);
                                      return 'E-mail envoyé, mais erreur d\'archivage.';
                                    }
                                  },
                                  error: (err) => `Échec de l'envoi: ${err.message}`
                                }
                              );
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md border-0 transition-all font-bold px-6"
                          >
                            ENVOYER L'EMAIL
                          </Button>
                        </>
                      ) : (
                        <Button 
                          onClick={() => {
                            try {
                              const docId = crypto.randomUUID();
                              const documentRef = doc(db, `users/${user!.uid}/patients/${draft.patientId}/documents`, docId);
                              setDoc(documentRef, {
                                titre: draft.objet || draft.type_document,
                                type_document: draft.type_document,
                                destinataire: draft.destinataire,
                                contenu_formate: draft.contenu_formate,
                                createdAt: serverTimestamp(),
                                status: 'validé'
                              }).then(() => {
                                setDraft(null);
                                draftRef.current = null;
                                toast.success('Document archivé avec succès !');
                              });
                            } catch (e) {
                              console.error(e);
                              toast.error("Erreur lors de l'archivage.");
                            }
                          }}
                          className="bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md border-0 transition-all font-bold px-6"
                        >
                          VALIDER & ARCHIVER
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 bg-slate-50/50 p-4 md:p-8 overflow-y-auto">
                    {draft.type_document === 'email' ? (
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/30 space-y-3">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-400 w-12">À :</span>
                            <input 
                              type="text" 
                              className="flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none"
                              value={draft.destinataire}
                              onChange={(e) => setDraft({...draft, destinataire: e.target.value})}
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-400 w-12">Objet :</span>
                            <input 
                              type="text" 
                              className="flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none"
                              value={draft.objet || ''}
                              onChange={(e) => setDraft({...draft, objet: e.target.value})}
                              placeholder="Indiquer un objet..."
                            />
                          </div>
                        </div>
                        <textarea
                          className="w-full p-8 text-sm md:text-base text-slate-700 leading-relaxed min-h-[400px] outline-none resize-none font-medium"
                          value={draft.contenu_formate}
                          onChange={(e) => {
                            const updated = { ...draft, contenu_formate: e.target.value };
                            setDraft(updated);
                            draftRef.current = updated;
                          }}
                        />
                      </div>
                    ) : (
                      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12 min-h-full flex flex-col font-serif relative">
                         {/* Medical Header Style */}
                         <div className="flex justify-between items-start mb-16 border-b pb-8 border-slate-100">
                            <div>
                               <h4 className="text-xl font-bold text-slate-900 tracking-tight">DR {user?.displayName?.toUpperCase() || 'PRATICIEN'}</h4>
                               <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-1">Chirurgien Dentiste</p>
                               <div className="mt-4 space-y-1">
                                  <p className="text-[11px] text-slate-400 font-medium">Cabinet d'Expertise Médicale</p>
                                  <p className="text-[11px] text-slate-400 font-medium tracking-tight">Paris, France</p>
                               </div>
                            </div>
                            <div className="text-right">
                               <p className="text-sm font-bold text-slate-800">{new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                            </div>
                         </div>

                         {/* Recipient / Patient Area */}
                         <div className="mb-12 flex justify-end">
                            <div className="w-1/2 text-left">
                               <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Destinataire :</p>
                               <input 
                                  className="text-sm font-bold text-slate-800 outline-none w-full bg-transparent border-b border-transparent focus:border-red-200"
                                  value={draft.destinataire}
                                  onChange={(e) => setDraft({...draft, destinataire: e.target.value})}
                               />
                            </div>
                         </div>

                         {/* Subject */}
                         <div className="mb-8">
                            <div className="flex gap-2 items-center">
                               <span className="text-xs font-bold text-slate-900 uppercase">Objet :</span>
                               <input 
                                  className="text-sm font-black text-slate-900 underline underline-offset-4 outline-none flex-1 bg-transparent"
                                  value={draft.objet || ''}
                                  onChange={(e) => setDraft({...draft, objet: e.target.value})}
                               />
                            </div>
                         </div>

                         {/* Letter Content */}
                         <textarea
                            className="flex-1 w-full text-base text-slate-800 leading-[1.8] outline-none resize-none font-medium bg-transparent"
                            value={draft.contenu_formate}
                            onChange={(e) => {
                              const updated = { ...draft, contenu_formate: e.target.value };
                              setDraft(updated);
                              draftRef.current = updated;
                            }}
                         />
                         
                         <div className="mt-20 flex justify-end">
                            <div className="text-center w-64 border-t pt-4 border-slate-100">
                               <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-4">Signature</p>
                               <p className="text-sm font-bold text-slate-900 italic">Dr {user?.displayName || 'Praticien'}</p>
                            </div>
                         </div>
                      </div>
                    )}
                  </div>
               </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
