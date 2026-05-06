import { useState, useEffect } from 'react';
import { useFirebase } from './FirebaseProvider';
import { collection, query, orderBy, getDocs, doc, deleteDoc, limit, startAfter } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Trash2, Loader2, Search } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from 'sonner';

interface CallRecord {
  id: string;
  duration: number;
  interruptionCount: number;
  status: string;
  createdAt: Date;
  endedAt: Date;
  transcriptText: string;
}

export function HistoryAnalytics() {
  const { user } = useFirebase();
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [callToDelete, setCallToDelete] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // Pagination
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 15;

  const confirmDelete = async () => {
    if (!user || !callToDelete) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/calls`, callToDelete));
      setCalls(prev => prev.filter(c => c.id !== callToDelete));
      if (selectedCall?.id === callToDelete) setSelectedCall(null);
      toast.success("Appel supprimé");
    } catch (e) {
      console.error("Error deleting call:", e);
      toast.error("Erreur lors de la suppression de l'appel");
    } finally {
      setCallToDelete(null);
    }
  };

  const handleExportAllTranscripts = async () => {
    if (!user) return;
    setIsExporting(true);
    const toastId = toast.loading("Récupération de tous les appels en cours...");
    
    try {
      // Fetch all calls for export
      const q = query(
        collection(db, `users/${user.uid}/calls`),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      
      const zip = new JSZip();
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const createdAt = data.createdAt?.toDate() || new Date();
        const fileName = `appel_${format(createdAt, "yyyy-MM-dd_HH-mm")}_${docSnap.id}.txt`;
        const content = data.transcriptText || data.transcript || "";
        zip.file(fileName, content);
      });
      
      toast.loading("Génération du fichier ZIP...", { id: toastId });
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'historique_appels.zip');
      toast.success("Archive téléchargée avec succès !", { id: toastId });
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Erreur lors de l'exportation", { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  const fetchCalls = async (isLoadMore = false) => {
    if (!user) return;
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      let q = query(
        collection(db, `users/${user.uid}/calls`),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE)
      );

      if (isLoadMore && lastDoc) {
        q = query(q, startAfter(lastDoc));
      }

      const snapshot = await getDocs(q);
      const fetchedCalls: CallRecord[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        fetchedCalls.push({
          id: doc.id,
          duration: data.duration || 0,
          interruptionCount: data.interruptionCount || 0,
          status: data.status,
          createdAt: data.createdAt?.toDate() || new Date(),
          endedAt: data.endedAt?.toDate() || new Date(),
          transcriptText: data.transcriptText || ''
        });
      });

      if (isLoadMore) {
        setCalls(prev => [...prev, ...fetchedCalls]);
      } else {
        setCalls(fetchedCalls);
      }

      setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `users/${user?.uid}/calls`);
    } finally {
      if (isLoadMore) setLoadingMore(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, [user]);

  if (loading && calls.length === 0) {
     return <div className="p-8 text-center text-slate-500 flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  }

  // Calculate simple analytics
  const totalCalls = calls.length;
  const avgDuration = totalCalls ? Math.round(calls.reduce((acc, c) => acc + c.duration, 0) / totalCalls) : 0;
  const totalInterruptions = calls.reduce((acc, c) => acc + c.interruptionCount, 0);

  if (selectedCall) {
    return (
      <div className="w-full flex flex-col h-full bg-white rounded-3xl shadow-lg shadow-slate-200/40 border border-slate-100/60 overflow-hidden relative">
        <div className="p-6 border-b border-slate-100/60 flex items-center justify-between shrink-0 bg-white/80 backdrop-blur-md relative z-10">
          <div>
            <h3 className="font-bold tracking-tight text-slate-900 text-lg">Détail de l'appel</h3>
            <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">{format(selectedCall.createdAt, "PPP 'à' HH:mm", { locale: fr })}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCallToDelete(selectedCall.id)} className="text-slate-400 hover:text-red-600 rounded-xl">
               <Trash2 className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelectedCall(null)} className="rounded-xl font-medium border-slate-200 hover:bg-slate-50 text-slate-600">
               Retour
            </Button>
          </div>
        </div>
        <div className="p-5 bg-slate-50/50 border-b border-slate-100/60 grid grid-cols-3 gap-4 shrink-0 relative z-10">
           <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
             <p className="text-[10px] uppercase text-teal-600/80 font-bold tracking-widest">Durée</p>
             <p className="text-xl font-semibold text-slate-800">{selectedCall.duration}<span className="text-sm font-medium text-slate-400">s</span></p>
           </div>
           <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
             <p className="text-[10px] uppercase text-teal-600/80 font-bold tracking-widest">Interruptions</p>
             <p className="text-xl font-semibold text-slate-800">{selectedCall.interruptionCount}</p>
           </div>
           <div className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm">
             <p className="text-[10px] uppercase text-teal-600/80 font-bold tracking-widest">Statut</p>
             <p className="text-sm font-semibold text-teal-600 mt-1 capitalize flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-teal-500 rounded-full"></span>{selectedCall.status}</p>
           </div>
        </div>
        <ScrollArea className="flex-1 p-6 relative z-10 bg-white/50">
           <div className="whitespace-pre-wrap text-[13px] md:text-sm text-slate-700 font-medium leading-relaxed bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
             {selectedCall.transcriptText || "Aucune transcription disponible."}
           </div>
        </ScrollArea>
      </div>
    );
  }

  const filteredCalls = calls.filter(call => {
    if (!searchQuery) return true;
    return call.transcriptText && call.transcriptText.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="w-full flex gap-6 h-full flex-col-reverse md:flex-row">
       <div className="flex-1 flex flex-col h-full bg-white rounded-3xl shadow-lg shadow-slate-200/40 border border-slate-100/60 overflow-hidden relative">
          <div className="p-6 border-b border-slate-100/60 shrink-0 bg-white/80 backdrop-blur-md relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">Historique des appels</h2>
              <p className="text-sm text-slate-500 mt-1 font-medium">Vos dernières dictées et interactions avec Emilie.</p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Rechercher par mot-clé..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all placeholder:text-slate-400"
                />
              </div>
              <Button disabled={isExporting} variant="outline" size="sm" onClick={handleExportAllTranscripts} className="rounded-xl font-medium border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center gap-2 shrink-0">
                 {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Exporter (.zip)
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1 relative z-10">
             <div className="p-4 space-y-2">
                {filteredCalls.length === 0 ? (
                  <p className="text-sm text-slate-500 font-medium text-center py-12">Aucun appel trouvé.</p>
                ) : filteredCalls.map(call => (
                  <div key={call.id} onClick={() => setSelectedCall(call)} className="p-4 rounded-2xl border border-slate-100/60 hover:border-teal-200 hover:bg-teal-50/30 hover:shadow-sm cursor-pointer transition-all flex items-center justify-between group">
                    <div>
                      <h4 className="font-semibold text-slate-800 group-hover:text-teal-700 transition-colors line-clamp-1">
                        {call.transcriptText ? (
                            call.transcriptText.length > 50 ? call.transcriptText.substring(0, 50) + "..." : call.transcriptText
                        ) : "Appel avec Emilie"}
                      </h4>
                      <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mt-1">{format(call.createdAt, "PPP 'à' HH:mm", { locale: fr })}</p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <p className="text-sm font-bold text-slate-700">{call.duration}s</p>
                      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mt-1">{call.interruptionCount} interruptions</p>
                      <button 
                         onClick={(e) => { e.stopPropagation(); setCallToDelete(call.id); }} 
                         className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 shadow-sm bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-red-600 hover:border-red-200 transition-colors mt-1"
                      >
                         <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
                {hasMore && !searchQuery && (
                  <div className="flex justify-center mt-6 mb-4">
                    <Button 
                      variant="outline" 
                      onClick={() => fetchCalls(true)}
                      disabled={loadingMore}
                      className="bg-white border-slate-200 text-slate-600 rounded-xl shadow-sm"
                    >
                      {loadingMore ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Charger plus
                    </Button>
                  </div>
                )}
             </div>
          </ScrollArea>
       </div>
       <div className="w-full md:w-64 flex flex-row overflow-x-auto md:flex-col gap-4 shrink-0 px-2 md:px-0">
          <div className="min-w-[140px] md:min-w-0 flex-1 md:flex-none border border-slate-100/60 bg-white rounded-3xl p-5 md:p-6 shadow-sm md:shadow-lg md:shadow-slate-200/40 relative overflow-hidden group hover:border-teal-100 transition-colors">
             <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-teal-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
             <p className="text-[10px] uppercase font-bold text-teal-600/80 tracking-widest mb-1 md:mb-2 relative z-10 leading-tight">Appels affichés</p>
             <p className="text-3xl md:text-4xl font-light tracking-tight text-slate-900 relative z-10">{totalCalls}</p>
          </div>
          <div className="min-w-[140px] md:min-w-0 flex-1 md:flex-none border border-slate-100/60 bg-white rounded-3xl p-5 md:p-6 shadow-sm md:shadow-lg md:shadow-slate-200/40 relative overflow-hidden group hover:border-sky-100 transition-colors">
             <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-sky-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
             <p className="text-[10px] uppercase font-bold text-sky-600/80 tracking-widest mb-1 md:mb-2 relative z-10 leading-tight">Durée moyenne</p>
             <p className="text-3xl md:text-4xl font-light tracking-tight text-slate-900 relative z-10">{avgDuration}<span className="text-sm md:text-xl text-slate-400 font-medium tracking-normal ml-1">s</span></p>
          </div>
          <div className="min-w-[140px] md:min-w-0 flex-1 md:flex-none border border-slate-100/60 bg-white rounded-3xl p-5 md:p-6 shadow-sm md:shadow-lg md:shadow-slate-200/40 relative overflow-hidden group hover:border-indigo-100 transition-colors">
             <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-indigo-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
             <p className="text-[10px] uppercase font-bold text-indigo-600/80 tracking-widest mb-1 md:mb-2 relative z-10 leading-tight">Interruptions (Total)</p>
             <p className="text-3xl md:text-4xl font-light tracking-tight text-slate-900 relative z-10">{totalInterruptions}</p>
          </div>
       </div>
       <AlertDialog open={!!callToDelete} onOpenChange={(open) => !open && setCallToDelete(null)}>
         <AlertDialogContent className="rounded-2xl bg-white border border-slate-200 p-6 shadow-xl max-w-sm">
           <AlertDialogHeader>
             <AlertDialogTitle className="text-xl font-bold text-slate-900">Êtes-vous sûr ?</AlertDialogTitle>
             <AlertDialogDescription className="text-sm text-slate-500 mt-2">
               Cette action supprimera l'enregistrement de cet appel.<br/>Elle est irréversible.
             </AlertDialogDescription>
           </AlertDialogHeader>
           <AlertDialogFooter className="mt-6 flex gap-3 sm:gap-0">
             <AlertDialogCancel className="rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900">Annuler</AlertDialogCancel>
             <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700 text-white rounded-xl border-0 shadow-sm shadow-red-600/20">
               Confirmer
             </AlertDialogAction>
           </AlertDialogFooter>
         </AlertDialogContent>
       </AlertDialog>
    </div>
  );
}
