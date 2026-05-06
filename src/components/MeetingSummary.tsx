import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, Square, Loader2, CheckCircle2, History, Plus, Pause, Play, Copy, Edit3, Save, Check, FileUp, Trash2, Settings2, ChevronDown, Search, Menu } from 'lucide-react';
import { toast } from 'sonner';
import { ExportModal } from './ExportModal';
import { GoogleGenAI } from '@google/genai';
import { marked } from 'marked';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import DOMPurify from 'dompurify';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { useFirebase } from './FirebaseProvider';
import { doc, setDoc, serverTimestamp, collection, query, orderBy, onSnapshot, deleteDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, signIn } from '../lib/firebase';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export function MeetingSummary() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [meetings, setMeetings] = useState<{id: string, summary: string, createdAt: any, audioUrl?: string}[]>([]);
  const [volume, setVolume] = useState(0);
  const [silenceWarning, setSilenceWarning] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState('');
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [template, setTemplate] = useState('generique');
  const [identifySpeakers, setIdentifySpeakers] = useState(false);
  const [anonymizeData, setAnonymizeData] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { user } = useFirebase();
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const silenceCounterRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    
    const q = query(collection(db, `users/${user.uid}/meetings`), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msData: any[] = [];
      snapshot.forEach(doc => {
        msData.push({ id: doc.id, ...doc.data() });
      });
      setMeetings(msData);
    }, (error) => {
      console.error("Firestore onSnapshot Error:", error);
    });

    return () => {
      unsubscribe();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
    };
  }, [user]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Audio Visualizer Setup
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          if (mediaRecorderRef.current.state === 'recording') {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
            const average = sum / bufferLength;
            setVolume(average);

            if (average < 5) {
              silenceCounterRef.current += 1;
              if (silenceCounterRef.current > 150) { // Approx 2.5s at 60fps
                setSilenceWarning(true);
              }
            } else {
              silenceCounterRef.current = 0;
              setSilenceWarning(false);
            }
          }
          animationRef.current = requestAnimationFrame(updateVolume);
        } else {
          setVolume(0);
          setSilenceWarning(false);
          silenceCounterRef.current = 0;
        }
      };
      updateVolume();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        if (audioContextRef.current) {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        }
        setVolume(0);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(1000); // chunking to ensure data is periodically saved
      setIsRecording(true);
      setIsPaused(false);
      setSummary(null);
    } catch (err) {
      console.error('Failed to start recording:', err);
      toast.error("Veuillez autoriser l'accès au microphone.");
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      setVolume(0);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && (isRecording || isPaused)) {
      if (mediaRecorderRef.current.state === 'paused') {
         // resume before stopping to ensure we capture final chunks
         mediaRecorderRef.current.resume();
      }
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'record.webm');
      formData.append('template', template);
      formData.append('identifySpeakers', identifySpeakers.toString());
      formData.append('anonymizeData', anonymizeData.toString());

      const res = await fetch('/api/process-audio', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`API Error: ${res.statusText}`);
      }

      const data = await res.json();
      let summaryText = data.summary || 'Erreur lors de la génération du compte rendu.';
      
      // Clean up potential markdown code block wrappers
      summaryText = summaryText.replace(/```(?:html|)\n?/gi, '').trim();

      setSummary(summaryText);

      if (user && summaryText && summaryText !== 'Erreur lors de la génération du compte rendu.') {
         try {
           const meetingId = crypto.randomUUID();
           let audioUrl = '';

           try {
             const audioRef = ref(storage, `users/${user.uid}/audio/${meetingId}.webm`);
             await uploadBytes(audioRef, audioBlob);
             audioUrl = await getDownloadURL(audioRef);
           } catch (uploadErr) {
             console.error("Storage Error: Failed to upload audio source", uploadErr);
             toast.error("Le compte rendu a été généré, mais l'enregistrement audio n'a pas pu être sauvegardé (Vérifiez les règles Storage).");
           }

           const meetingRef = doc(db, `users/${user.uid}/meetings`, meetingId);
           await setDoc(meetingRef, {
             summary: summaryText,
             audioUrl: audioUrl || null,
             createdAt: serverTimestamp()
           });
           setCurrentMeetingId(meetingId);
         } catch (saveErr) {
           toast.error("Erreur lors de la sauvegarde du compte rendu.");
         }
      }
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la transcription.");
      setSummary('Nous avons rencontré un problème lors de la transcription de la réunion. (Il se peut que le backend ne soit pas accessible)');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    if (summary) {
      try {
        let htmlStr = summary;
        if (!htmlStr.trim().startsWith('<') && !htmlStr.match(/<h[1-6]|<p|<ul|<ol|<strong|<em/)) {
            htmlStr = DOMPurify.sanitize(marked.parse(htmlStr) as string);
        }
        
        const blobHtml = new Blob([htmlStr], { type: "text/html" });
        const textElement = document.createElement('div');
        textElement.innerHTML = htmlStr;
        const blobText = new Blob([textElement.innerText], { type: "text/plain" });
        
        const clipboardItem = new ClipboardItem({ 
           "text/html": blobHtml,
           "text/plain": blobText 
        });
        
        await navigator.clipboard.write([clipboardItem]);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (err) {
        console.error(err);
        toast.error("Erreur lors de la copie.");
      }
    }
  };

  const handleDownloadPDF = async () => {
    const contentToExport = isEditing ? editedSummary : summary;
    if (!contentToExport) return;

    try {
      // 1. Prepare HTML Content
      let htmlContent = contentToExport;
      if (!htmlContent.trim().startsWith('<') && !htmlContent.match(/<h[1-6]|<p|<ul|<ol|<strong|<em/)) {
          htmlContent = DOMPurify.sanitize(await marked.parse(htmlContent) as string);
      }

      // 2. Create off-screen container
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '800px'; // fixed width for A4 proportions
      container.style.backgroundColor = '#ffffff';
      container.style.padding = '50px';
      container.style.boxSizing = 'border-box';
      container.style.color = '#0f172a';
      container.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      
      const dateStr = format(new Date(), 'dd/MM/yyyy à HH:mm', { locale: fr });

      // 3. Professional Header & Content
      container.innerHTML = `
        <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div>
            <h1 style="margin: 0; font-size: 24px; color: #0f172a; font-weight: 700;">Cabinet Dentaire</h1>
            <p style="margin: 4px 0 0; color: #64748b; font-size: 14px; font-weight: 500;">Dr. Praticien</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; color: #64748b; font-size: 14px; font-weight: 500;">Date : ${dateStr}</p>
          </div>
        </div>
        <div class="markdown-body" style="font-size: 14px; line-height: 1.6; color: #334155;">
          ${htmlContent}
        </div>
        <div style="margin-top: 60px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
          Document généré automatiquement à partir de l'assistant médical.
        </div>
      `;

      document.body.appendChild(container);

      // 4. Generate PDF
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false
      });
      document.body.removeChild(container);

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      let heightLeft = pdfHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }
      
      pdf.save(`Compte_Rendu_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success("PDF téléchargé avec succès.");
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la génération du PDF.");
    }
  };

  const handleDownloadWord = () => {
    if (!summary) return;
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Compte Rendu</title></head><body>";
    const footer = "</body></html>";
    
    let htmlContent = summary;
    if (!htmlContent.trim().startsWith('<') && !htmlContent.match(/<h[1-6]|<p|<ul|<ol|<strong|<em/)) {
        htmlContent = DOMPurify.sanitize(marked.parse(htmlContent) as string);
    }
    
    const sourceHTML = header + htmlContent + footer;
    
    const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
    const fileDownload = document.createElement("a");
    document.body.appendChild(fileDownload);
    fileDownload.href = source;
    fileDownload.download = 'compte-rendu.doc';
    fileDownload.click();
    document.body.removeChild(fileDownload);
  };

  const handleExportDrive = async () => {
    // 1. Get access token
    const token = await signIn();
    if (!token) {
      toast.error("Veuillez vous connecter avec Google pour exporter vers Drive.");
      return;
    }

    // 2. Create file in Google Drive
    try {
      let htmlContent = summary || "";
      if (!htmlContent.trim().startsWith('<') && !htmlContent.match(/<h[1-6]|<p|<ul|<ol|<strong|<em/)) {
          htmlContent = DOMPurify.sanitize(marked.parse(htmlContent) as string);
      }

      const metadata = {
        name: `Compte_rendu_${format(new Date(), 'yyyy-MM-dd_HH-mm')}`,
        mimeType: 'application/vnd.google-apps.document',
      };
      
      const boundary = 'meet_summary_boundary';
      const metadataPart = JSON.stringify(metadata);
      const filePart = htmlContent;

      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        metadataPart,
        `--${boundary}`,
        'Content-Type: text/html',
        '',
        filePart,
        `--${boundary}--`
      ].join('\r\n');
      
      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: body,
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Drive upload failed:', response.status, errorText);
        throw new Error(`Failed to upload to Drive: ${response.status} - ${errorText}`);
      }
      
      toast.success("Rapport exporté vers Google Drive avec succès.");
    } catch (err) {
      console.error(err);
      toast.error(`Erreur lors de l'export vers Google Drive: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async () => {
    if (user && currentMeetingId) {
      if (window.confirm("Êtes-vous sûr de vouloir supprimer ce rapport ?")) {
        try {
          await deleteDoc(doc(db, `users/${user.uid}/meetings`, currentMeetingId));
          toast.success("Rapport supprimé avec succès.");
          setSummary(null);
          setCurrentMeetingId(null);
          setIsEditing(false);
        } catch (err) {
          toast.error("Erreur lors de la suppression.");
        }
      }
    }
  };

  const toggleEdit = async () => {
    if (isEditing) {
      // Enregistrer
      if (user && currentMeetingId && editedSummary !== summary) {
        try {
           await updateDoc(doc(db, `users/${user.uid}/meetings`, currentMeetingId), {
             summary: editedSummary
           });
           toast.success("Mise à jour effectuée.");
           setSummary(editedSummary);
        } catch (err) {
          toast.error("Erreur lors de la mise à jour.");
        }
      }
      setIsEditing(false);
    } else {
      // Passer en mode édition
      let initialContent = summary || '';
      if (!initialContent.trim().startsWith('<') && !initialContent.match(/<h[1-6]|<p|<ul|<ol|<strong|<em/)) {
          initialContent = DOMPurify.sanitize(await marked.parse(initialContent) as string);
      }
      setEditedSummary(initialContent);
      setIsEditing(true);
    }
  };

  const handleExportEmail = async (email: string) => {
    // 1. Get access token
    const token = await signIn();
    if (!token) {
      toast.error("Veuillez vous connecter avec Google pour continuer.");
      return;
    }

    // 2. Call backend to send email
    try {
        let htmlContent = summary || "";
        if (!htmlContent.trim().startsWith('<') && !htmlContent.match(/<h[1-6]|<p|<ul|<ol|<strong|<em/)) {
            htmlContent = DOMPurify.sanitize(marked.parse(htmlContent) as string);
        }

        const response = await fetch('/api/send-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: email,
            subject: 'Compte rendu de réunion',
            body: htmlContent,
            accessToken: token
          }),
        });
        
        if (!response.ok) {
           throw new Error('Failed to send email');
        }
        toast.success("Rapport envoyé par e-mail avec succès.");
        setIsExportModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(`Erreur lors de l'envoi de l'e-mail: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const currentMeeting = currentMeetingId ? meetings.find(m => m.id === currentMeetingId) : null;

  return (
    <div className="flex-1 flex gap-8 w-full h-full pb-8 flex-col md:flex-row p-4 md:p-6">
      <ExportModal 
         isOpen={isExportModalOpen} 
         onClose={() => setIsExportModalOpen(false)}
         onExportPDF={handleDownloadPDF}
         onExportWord={handleDownloadWord}
         onExportDrive={handleExportDrive}
         onExportEmail={handleExportEmail}
      />
      <div className="flex-1 flex flex-col items-center justify-start h-full relative">
        <div className="absolute top-4 right-4 md:hidden z-50">
          <Sheet>
            <SheetTrigger className="inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50 border border-slate-200 bg-white shadow-sm hover:bg-slate-100 hover:text-slate-900 h-10 w-10 text-slate-600 focus:ring-0">
              <Menu className="w-5 h-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] p-0 flex flex-col sm:w-[350px]">
              <div className="p-6 border-b border-slate-100 shrink-0 bg-white relative z-10 flex flex-col gap-4">
                 <div className="flex items-center gap-4">
                   <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center text-red-600 shadow-sm border border-red-100 shrink-0">
                     <History size={18} />
                   </div>
                   <div className="text-left">
                     <SheetTitle className="text-base font-bold tracking-tight text-slate-950 m-0">Vos rapports</SheetTitle>
                     <p className="text-xs text-slate-500 font-medium m-0">Historique complet</p>
                   </div>
                 </div>
                 
                 {meetings.length > 0 && (
                   <div className="relative">
                     <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                     <input 
                       type="text" 
                       placeholder="Chercher un rapport..." 
                       value={searchQuery}
                       onChange={(e) => setSearchQuery(e.target.value)}
                       className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all placeholder:text-slate-400"
                     />
                   </div>
                 )}
              </div>
              <ScrollArea className="flex-1 relative z-10 bg-slate-50/30">
                 <div className="p-4 space-y-3">
                    {meetings.length === 0 ? (
                      <p className="text-sm text-slate-500 font-medium text-center py-12">Aucun rapport enregistré pour l'instant.</p>
                    ) : meetings.filter(m => m.summary.toLowerCase().includes(searchQuery.toLowerCase())).map(m => (
                      <div key={m.id} onClick={() => { setSummary(m.summary); setCurrentMeetingId(m.id); setIsEditing(false); }} className={`p-4 rounded-2xl border ${summary === m.summary ? 'border-red-300 bg-red-50' : 'border-slate-100/60 bg-white'} hover:border-red-200 hover:shadow-sm cursor-pointer transition-all group`}>
                         <div className="flex justify-between items-start mb-2">
                           <h4 className={`font-semibold transition-colors ${summary === m.summary ? 'text-red-800' : 'text-slate-800 group-hover:text-red-700'}`}>
                             Réunion
                           </h4>
                           {m.createdAt?.toDate && (
                               <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{format(m.createdAt.toDate(), "dd MMM HH:mm", { locale: fr })}</span>
                           )}
                         </div>
                         <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                            {m.summary.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ').substring(0, 80).replace(/[#*]/g, '')}...
                         </p>
                      </div>
                    ))}
                 </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>

        <div className="text-center space-y-3 mb-12 pt-8 w-full shrink-0">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tighter text-slate-950">Compte Rendu</h2>
          <p className="text-slate-600 text-base md:text-lg font-medium">Synthétisez vos échanges avec précision</p>
        </div>

        {!summary && !isProcessing && (
            <div className="relative mb-12 shrink-0 flex flex-col items-center">
              {!isRecording && (
                <div className="mb-8 z-10 w-full max-w-md">
                  <button 
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                    className="flex w-full items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
                  >
                    <span className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-slate-500" />
                      Paramètres d'enregistrement
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isSettingsOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {isSettingsOpen && (
                    <div className="mt-2 p-4 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contexte</label>
                        <select
                          value={template}
                          onChange={(e) => setTemplate(e.target.value)}
                          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all cursor-pointer hover:bg-slate-100"
                        >
                          <option value="generique">Standard (Générique)</option>
                          <option value="consultation_initiale">Consultation Initiale</option>
                          <option value="suivi_post_op">Suivi Post-opératoire</option>
                          <option value="reunion_equipe">Réunion d'Équipe</option>
                        </select>
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Options d'IA</label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600 hover:text-slate-800 transition-colors">
                          <input 
                            type="checkbox" 
                            checked={identifySpeakers} 
                            onChange={(e) => setIdentifySpeakers(e.target.checked)}
                            className="w-4 h-4 text-teal-600 bg-slate-100 border-slate-300 rounded focus:ring-teal-500 focus:ring-2"
                          />
                          Diarisation (Séparer les voix Praticien / Patient)
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600 hover:text-slate-800 transition-colors">
                          <input 
                            type="checkbox" 
                            checked={anonymizeData} 
                            onChange={(e) => setAnonymizeData(e.target.checked)}
                            className="w-4 h-4 text-teal-600 bg-slate-100 border-slate-300 rounded focus:ring-teal-500 focus:ring-2"
                          />
                          Anonymisation stricte (RGPD)
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div 
                className={`w-32 h-32 md:w-40 md:h-40 rounded-full shadow-xl shadow-red-500/10 border-4 border-white flex items-center justify-center z-10 relative transition-all duration-150 ${isRecording ? (isPaused ? 'bg-amber-50 border-amber-100' : 'bg-rose-50 border-rose-100') : 'bg-red-50 cursor-pointer hover:scale-105'}`}
                style={isRecording && !isPaused ? { transform: `scale(${1 + Math.min(volume / 255, 1) * 0.15})` } : {}}
              >
                {isPaused ? (
                  <Pause className="w-12 h-12 md:w-16 md:h-16 text-amber-500" />
                ) : (
                  <Mic className={`w-12 h-12 md:w-16 md:h-16 transition-colors ${isRecording ? 'text-rose-500' : 'text-red-600'}`} />
                )}
              </div>
              {isRecording && !isPaused && (
                  <>
                    <div className="absolute top-0 -inset-4 border border-rose-200 rounded-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] opacity-50 pointer-events-none h-32 w-32 md:h-40 md:w-40"></div>
                    <div className="absolute top-0 -inset-8 border border-rose-100 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] opacity-30 pointer-events-none h-32 w-32 md:h-40 md:w-40"></div>
                    
                    {/* Visualizer bars & Audio status */}
                    <div className="mt-8 flex flex-col items-center gap-3">
                      <div className="flex gap-1 items-center justify-center h-12 w-full">
                        {[...Array(12)].map((_, i) => (
                           <div 
                             key={i} 
                             className="w-1.5 bg-red-400 rounded-full transition-all duration-150"
                             style={{ 
                               height: `${Math.max(4, Math.min(48, (volume / 128) * 48 * (1 + Math.sin(Date.now() / 150 + i) * 0.8)))}px`,
                               opacity: silenceWarning ? 0.3 : 0.8
                             }}
                           />
                        ))}
                      </div>
                      {silenceWarning ? (
                        <span className="text-rose-500 text-sm font-medium animate-pulse bg-rose-50 px-3 py-1 rounded-full border border-rose-100 flex items-center gap-2">
                          Extrêmement silencieux... Micro débranché ?
                        </span>
                      ) : (
                        <span className="text-red-600 text-sm font-medium bg-red-50 px-3 py-1 rounded-full border border-red-100">
                          Signal audio détecté
                        </span>
                      )}
                    </div>
                  </>
              )}
            </div>
        )}

        {isProcessing && (
            <div className="relative mb-8 md:mb-12 shrink-0">
              <div className="w-32 h-32 md:w-40 md:h-40 rounded-full shadow-xl shadow-teal-500/10 border-4 border-white bg-slate-50 flex items-center justify-center z-10 relative">
                <Loader2 className="w-12 h-12 md:w-16 md:h-16 text-teal-600 animate-spin" />
              </div>
              <p className="text-center text-slate-500 mt-6 text-sm font-medium">Génération de votre document...</p>
            </div>
        )}

        {!summary && (
          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 mb-8 w-full md:w-auto px-4 md:px-0 shrink-0">
            {(isRecording || isPaused) ? (
               <div className="flex gap-4 w-full md:w-auto">
                 {isPaused ? (
                   <Button onClick={resumeRecording} className="flex-1 md:w-auto px-6 py-3 h-14 rounded-[2rem] bg-teal-600 hover:bg-teal-700 text-white font-bold shadow-lg shadow-teal-600/20 flex items-center justify-center gap-2 text-base md:text-lg transition-all hover:scale-105 active:scale-95">
                      <Play className="w-5 h-5 fill-current" /> REPRENDRE
                   </Button>
                 ) : (
                   <Button onClick={pauseRecording} className="flex-1 md:w-auto px-6 py-3 h-14 rounded-[2rem] bg-amber-500 hover:bg-amber-600 text-white font-bold shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 text-base md:text-lg transition-all hover:scale-105 active:scale-95">
                      <Pause className="w-5 h-5 fill-current" /> PAUSE
                   </Button>
                 )}
                 <Button onClick={stopRecording} variant="destructive" className="flex-1 md:w-auto px-6 py-3 h-14 rounded-[2rem] bg-rose-500 hover:bg-rose-600 text-white font-bold shadow-lg shadow-rose-500/20 flex items-center justify-center gap-2 text-base md:text-lg transition-all hover:scale-105 active:scale-95">
                     <Square className="w-5 h-5 fill-current" /> TERMINER
                 </Button>
               </div>
            ) : !isProcessing && (
                <Button onClick={startRecording} className="w-full md:w-auto px-6 md:px-8 py-3 md:py-4 h-14 md:h-16 rounded-[2rem] bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg shadow-red-600/20 flex items-center justify-center gap-3 text-base md:text-lg transition-all hover:scale-105 active:scale-95">
                    <Mic className="w-5 h-5 md:w-6 md:h-6" /> COMMENCER L'ENREGISTREMENT
                </Button>
            )}
          </div>
        )}

        {summary && !isProcessing && (
            <div className="w-full max-w-2xl bg-white rounded-3xl p-6 md:p-10 border border-slate-100 shadow-xl shadow-slate-200/50 flex flex-col flex-1 mt-4 relative overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-1.5 bg-red-500/10">
                  <div className="h-full bg-red-500/80 w-1/3 rounded-r-full"></div>
                </div>
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100 shrink-0 relative z-10">
                   <div className="text-xs uppercase tracking-[0.25em] text-red-700 font-bold flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      Rapport {meetings.length > 0 && meetings[0].summary === summary ? 'Généré & Sauvegardé' : 'Consulté'}
                   </div>
                   <div className="flex items-center gap-2 text-xs text-red-700 font-bold uppercase tracking-wider bg-red-50 px-4 py-2 rounded-full border border-red-100">
                       <CheckCircle2 className="w-4 h-4" /> Terminé
                   </div>
                </div>
                
                <div className="mb-6 pb-4 border-b border-slate-100/60 flex flex-wrap gap-2 shrink-0 relative z-10 justify-between items-center">
                   <div className="flex flex-wrap gap-2">
                     <Button onClick={handleCopy} variant="outline" size="sm" aria-label="Copier le compte rendu" className="rounded-xl border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors flex items-center gap-2">
                         {copySuccess ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />} Copier
                     </Button>
                     <Button onClick={toggleEdit} variant="outline" size="sm" aria-label={isEditing ? "Enregistrer les modifications" : "Éditer le compte rendu"} className={`rounded-xl border-slate-200 transition-colors flex items-center gap-2 ${isEditing ? 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100' : 'hover:bg-slate-50 text-slate-600'}`}>
                         {isEditing ? <><Save className="w-4 h-4" /> Enregistrer</> : <><Edit3 className="w-4 h-4" /> Éditer</>}
                     </Button>
                     <Button onClick={() => setIsExportModalOpen(true)} variant="outline" size="sm" aria-label="Exporter le rapport" className="rounded-xl border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors flex items-center gap-2">
                         <FileUp className="w-4 h-4" /> Exporter
                     </Button>
                   </div>
                   
                   <div className="flex gap-2">
                     <Button 
                        onClick={() => { setSummary(null); setCurrentMeetingId(null); setIsEditing(false); }} 
                        variant="outline" 
                        size="sm" 
                        aria-label="Créer un nouveau rapport"
                        className="rounded-xl font-medium border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors flex items-center gap-2"
                     >
                        <Plus className="w-4 h-4" /> Nouveau
                     </Button>
                     <Button onClick={handleDelete} variant="outline" size="sm" aria-label="Supprimer ce rapport" className="rounded-xl border-red-100 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex items-center gap-2">
                        <Trash2 className="w-4 h-4" /> Supprimer
                     </Button>
                   </div>
                </div>
                
                {currentMeeting?.audioUrl && !isEditing && (
                  <div className="mb-6 shrink-0 relative z-10 w-full flex flex-col gap-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                     <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Audio Source</p>
                     <audio controls src={currentMeeting.audioUrl} className="w-full h-10 outline-none" />
                  </div>
                )}

                <ScrollArea className="flex-1 pr-2 md:pr-4 relative z-10 min-h-[300px]">
                    {isEditing ? (
                      <ReactQuill
                        theme="snow"
                        value={editedSummary}
                        onChange={setEditedSummary}
                        className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                      />
                    ) : (
                      <ReactQuill
                        theme="snow"
                        value={(!summary?.trim().startsWith('<') && !summary?.match(/<h[1-6]|<p|<ul|<ol|<strong|<em/)) 
                                ? DOMPurify.sanitize(marked.parse(summary || '') as string) 
                                : summary || ''}
                        readOnly={true}
                        modules={{ toolbar: false }}
                        className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden printable-content ql-viewer"
                      />
                    )}
                </ScrollArea>
            </div>
        )}
      </div>

      <div className="hidden md:flex w-80 h-full flex-col bg-white rounded-3xl shadow-lg shadow-slate-100/50 border border-slate-100 overflow-hidden shrink-0">
          <div className="p-6 border-b border-slate-100 shrink-0 bg-white relative z-10 flex flex-col gap-4">
             <div className="flex items-center gap-4">
               <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center text-red-600 shadow-sm border border-red-100 shrink-0">
                 <History size={20} />
               </div>
               <div>
                 <h2 className="text-lg font-bold tracking-tight text-slate-950">Vos rapports</h2>
                 <p className="text-sm text-slate-500 font-medium">Historique complet</p>
               </div>
             </div>
             
             {meetings.length > 0 && (
               <div className="relative">
                 <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                 <input 
                   type="text" 
                   placeholder="Chercher un rapport..." 
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all placeholder:text-slate-400"
                 />
               </div>
             )}
          </div>
          <ScrollArea className="flex-1 relative z-10 bg-slate-50/30">
             <div className="p-4 space-y-3">
                {meetings.length === 0 ? (
                  <p className="text-sm text-slate-500 font-medium text-center py-12">Aucun rapport enregistré pour l'instant.</p>
                ) : meetings.filter(m => m.summary.toLowerCase().includes(searchQuery.toLowerCase())).map(m => (
                  <div key={m.id} onClick={() => { setSummary(m.summary); setCurrentMeetingId(m.id); setIsEditing(false); }} className={`p-4 rounded-2xl border ${summary === m.summary ? 'border-red-300 bg-red-50' : 'border-slate-100/60 bg-white'} hover:border-red-200 hover:shadow-sm cursor-pointer transition-all group`}>
                     <div className="flex justify-between items-start mb-2">
                       <h4 className={`font-semibold transition-colors ${summary === m.summary ? 'text-red-800' : 'text-slate-800 group-hover:text-red-700'}`}>
                         Réunion
                       </h4>
                       {m.createdAt?.toDate && (
                           <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{format(m.createdAt.toDate(), "dd MMM HH:mm", { locale: fr })}</span>
                       )}
                     </div>
                     <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                        {m.summary.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ').substring(0, 80).replace(/[#*]/g, '')}...
                     </p>
                  </div>
                ))}
             </div>
          </ScrollArea>
       </div>
    </div>
  );
}
