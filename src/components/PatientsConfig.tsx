import { useState, useEffect } from "react";
import { useFirebase } from "./FirebaseProvider";
import { db } from "../lib/firebase";
import { collection, doc, setDoc, updateDoc, deleteDoc, getDocs, serverTimestamp, query, orderBy, limit, startAfter, where } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { UserPlus, Trash2, Edit2, User, Loader2, Search, X } from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { toast } from "sonner";

export function PatientsConfig() {
  const { user } = useFirebase();
  const [patients, setPatients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [dateNaissance, setDateNaissance] = useState("");
  const [adresse, setAdresse] = useState("");
  const [medecinTraitant, setMedecinTraitant] = useState("");
  const [numeroDossier, setNumeroDossier] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  // Pagination & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 20;

  // Deletion Confirmation
  const [patientToDelete, setPatientToDelete] = useState<string | null>(null);

  const fetchPatients = async (isLoadMore = false) => {
    if (!user) return;
    if (isLoadMore) setLoadingMore(true);
    else setLoading(true);

    try {
      let q = query(
        collection(db, `users/${user.uid}/patients`),
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE)
      );

      if (isLoadMore && lastDoc) {
        q = query(q, startAfter(lastDoc));
      }

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      if (isLoadMore) {
        setPatients(prev => [...prev, ...data]);
      } else {
        setPatients(data);
      }

      setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (e) {
      console.error("Error fetching patients:", e);
      toast.error("Erreur lors du chargement des patients");
    } finally {
      if (isLoadMore) setLoadingMore(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, [user]);

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !nom) return;
    
    // Validate Form
    if (dateNaissance && !/^\d{4}-\d{2}-\d{2}$/.test(dateNaissance) && !/^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[012])\/\d{4}$/.test(dateNaissance)) {
      toast.error("Le format de la date de naissance est invalide.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (numeroDossier) {
         // Check for duplicate dossier number
         const q = query(collection(db, `users/${user.uid}/patients`), where("numeroDossier", "==", numeroDossier.trim()));
         const snapshot = await getDocs(q);
         const duplicate = snapshot.docs.find(d => d.id !== editingPatientId);
         if (duplicate) {
            toast.error("Ce numéro de dossier existe déjà pour un autre patient.");
            setIsSubmitting(false);
            return;
         }
      }

      if (editingPatientId) {
        // Update existing patient
        const patientRef = doc(db, `users/${user.uid}/patients`, editingPatientId);
        await updateDoc(patientRef, {
          nom: nom.trim(),
          prenom: prenom.trim(),
          dateNaissance: dateNaissance.trim(),
          adresse: adresse.trim(),
          medecinTraitant: medecinTraitant.trim(),
          numeroDossier: numeroDossier.trim(),
          updatedAt: serverTimestamp()
        });
        setEditingPatientId(null);
      } else {
        // Create new patient
        const patientId = crypto.randomUUID();
        const patientRef = doc(db, `users/${user.uid}/patients`, patientId);
        await setDoc(patientRef, {
          nom: nom.trim(),
          prenom: prenom.trim(),
          dateNaissance: dateNaissance.trim(),
          adresse: adresse.trim(),
          medecinTraitant: medecinTraitant.trim(),
          numeroDossier: numeroDossier.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      
      // Reset form
      setNom("");
      setPrenom("");
      setDateNaissance("");
      setAdresse("");
      setMedecinTraitant("");
      setNumeroDossier("");
      setIsSheetOpen(false);
      
      await fetchPatients();
    } catch (error) {
       console.error("Error saving patient:", error);
       alert("Erreur lors de l'enregistrement du patient.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (patient: any) => {
    setEditingPatientId(patient.id);
    setNom(patient.nom || "");
    setPrenom(patient.prenom || "");
    
    // We try to convert the stored date format (DD/MM/YYYY) to YYYY-MM-DD for the date input if needed,
    // though the best is just set it. If it was already YYYY-MM-DD, perfect.
    let dateVal = patient.dateNaissance || "";
    if (dateVal.includes("/")) {
      const parts = dateVal.split('/');
      if(parts.length === 3) {
         dateVal = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    setDateNaissance(dateVal);
    
    setAdresse(patient.adresse || "");
    setMedecinTraitant(patient.medecinTraitant || "");
    setNumeroDossier(patient.numeroDossier || "");
    setIsSheetOpen(true);
  };

  const cancelEdit = () => {
    setEditingPatientId(null);
    setNom("");
    setPrenom("");
    setDateNaissance("");
    setAdresse("");
    setMedecinTraitant("");
    setNumeroDossier("");
    setIsSheetOpen(false);
  };

  const confirmDelete = async () => {
    if (!user || !patientToDelete) return;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/patients`, patientToDelete));
      setPatients(prev => prev.filter(p => p.id !== patientToDelete));
      toast.success("Patient supprimé");
    } catch (e) {
      console.error("Error deleting patient:", e);
      toast.error("Erreur lors de la suppression du patient");
    } finally {
      setPatientToDelete(null);
    }
  };

  const filteredPatients = patients.filter(p => {
    const s = searchQuery.toLowerCase();
    return (
      (p.nom || "").toLowerCase().includes(s) ||
      (p.prenom || "").toLowerCase().includes(s) ||
      (p.numeroDossier || "").toLowerCase().includes(s)
    );
  });

  if (loading && patients.length === 0) {
     return <div className="flex-1 flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-red-500" /></div>;
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-6 md:p-6 lg:max-w-6xl mx-auto">
      <Sheet open={isSheetOpen} onOpenChange={(open) => {
        setIsSheetOpen(open);
        if(!open) cancelEdit();
      }}>
        <SheetContent className="w-full sm:max-w-md p-6 bg-white overflow-y-auto">
          <SheetHeader className="mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                {editingPatientId ? <Edit2 size={20} /> : <UserPlus size={20} />}
              </div>
              <div className="text-left">
                <SheetTitle className="text-xl font-bold text-slate-900 leading-none mb-1">{editingPatientId ? "Modifier le Patient" : "Nouveau Patient"}</SheetTitle>
                <SheetDescription className="text-sm text-slate-500">
                  {editingPatientId ? "Mettez à jour les informations du patient ci-dessous." : "Ajoutez un nouveau patient à votre base de données."}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          
          <form onSubmit={handleSavePatient} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
               <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Nom *</label>
                 <input required value={nom} onChange={e => setNom(e.target.value)} type="text" className="w-full text-sm rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-medium" placeholder="Dupont" />
               </div>
               <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Prénom</label>
                 <input value={prenom} onChange={e => setPrenom(e.target.value)} type="text" className="w-full text-sm rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-medium" placeholder="Éric" />
               </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Date de Naiss.</label>
                 <input value={dateNaissance} onChange={e => setDateNaissance(e.target.value)} type="date" className="w-full text-sm rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-medium text-slate-700" />
               </div>
               <div>
                 <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">N° Dossier</label>
                 <input value={numeroDossier} onChange={e => setNumeroDossier(e.target.value)} type="text" className="w-full text-sm rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-medium" placeholder="LX-90210" />
               </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Adresse complète</label>
              <textarea value={adresse} onChange={e => setAdresse(e.target.value)} rows={2} className="w-full text-sm rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-medium resize-none" placeholder="15 rue des Lilas, 75020 Paris" />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Médecin Traitant</label>
              <input value={medecinTraitant} onChange={e => setMedecinTraitant(e.target.value)} type="text" className="w-full text-sm rounded-xl border border-slate-200 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-medium" placeholder="Dr. Martin" />
            </div>

            <div className="flex gap-3 pt-2">
               {editingPatientId && (
                 <Button type="button" variant="outline" onClick={cancelEdit} className="w-full border-slate-200 text-slate-700 rounded-xl font-semibold">
                   Annuler
                 </Button>
               )}
               <Button type="submit" disabled={isSubmitting} className="w-full bg-red-600 hover:bg-red-700 text-white rounded-xl h-11 font-semibold shadow-sm flex-1">
                 {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sauvegarder"}
               </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* List Section */}
      <div className="w-full flex-1 md:p-0 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm h-[calc(100vh-8rem)] md:h-[calc(100vh-6rem)] flex flex-col">
          <div className="p-4 md:p-6 border-b border-slate-100 flex flex-col md:flex-row items-start md:items-center justify-between shrink-0 bg-slate-50/50 gap-4">
             <div className="flex items-center justify-between w-full md:w-auto">
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-600 text-white flex items-center justify-center shadow-sm">
                   <User size={18} />
                 </div>
                 <div>
                   <h3 className="font-bold text-slate-900 text-xl tracking-tight">Répertoire Patients</h3>
                   <p className="text-slate-500 font-medium text-sm">Gestion de vos dossiers médicaux</p>
                 </div>
               </div>
             </div>
             
             <div className="flex w-full md:w-auto gap-3 items-center">
               <div className="relative flex-1 md:min-w-[280px]">
                 <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                 <input 
                   type="text" 
                   placeholder="Rechercher par nom, IPP..." 
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                   className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all placeholder:text-slate-400 shadow-sm"
                 />
               </div>
               <Button onClick={() => setIsSheetOpen(true)} className="bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-sm hidden sm:flex items-center gap-2">
                 <UserPlus className="w-4 h-4" />
                 Nouveau
               </Button>
               <Button onClick={() => setIsSheetOpen(true)} size="icon" className="bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-sm sm:hidden flex shrink-0">
                 <UserPlus className="w-4 h-4" />
               </Button>
             </div>
          </div>
          
          <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-4">
             {filteredPatients.length === 0 ? (
               <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-4 border border-dashed border-slate-300">
                    <User className="text-slate-400 w-8 h-8" />
                  </div>
                  <p className="text-slate-500 font-medium">Aucun patient trouvé.</p>
               </div>
             ) : (
               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {filteredPatients.map(p => {
                    // Utility to format date display nicely
                    let displayDate = p.dateNaissance || '-';
                    if (displayDate.length === 10 && displayDate.includes("-")) {
                      const [yr, mo, da] = displayDate.split("-");
                      displayDate = `${da}/${mo}/${yr}`;
                    }

                    return (
                    <div key={p.id} className="p-5 rounded-2xl border border-slate-100 hover:border-slate-300 hover:shadow-md transition-all bg-white relative group">
                       <div className="absolute top-4 right-4 flex items-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                         <button onClick={() => handleEdit(p)} className="p-1.5 shadow-sm bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-red-600 hover:border-red-200 transition-colors">
                           <Edit2 size={14} />
                         </button>
                         <button onClick={() => setPatientToDelete(p.id)} className="p-1.5 shadow-sm bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-red-600 hover:border-red-200 transition-colors">
                           <Trash2 size={14} />
                         </button>
                       </div>
                       <div className="flex items-center gap-3 mb-4 pr-16 bg-gradient-to-r from-transparent to-white">
                         <div className="w-11 h-11 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-sm shrink-0 shadow-sm border border-red-200/50">
                            {p.nom?.[0]?.toUpperCase()}{p.prenom?.[0]?.toUpperCase()}
                         </div>
                         <div className="overflow-hidden">
                            <h4 className="font-bold text-slate-900 leading-tight text-base truncate">
                              {p.nom?.toUpperCase()} <span className="font-medium text-slate-600">{p.prenom}</span>
                            </h4>
                            {p.numeroDossier ? (
                              <div className="mt-1">
                                 <span className="font-mono bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded text-[10px] text-slate-600 font-bold tracking-widest uppercase">
                                   IPP: {p.numeroDossier}
                                 </span>
                              </div>
                            ) : null}
                         </div>
                       </div>
                       
                       <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50/50 p-3 rounded-xl border border-slate-100/50">
                         <p className="flex items-center justify-between"><span className="font-medium text-slate-500">Né(e) le</span> <span className="font-semibold text-slate-800">{displayDate}</span></p>
                         <p className="flex items-start justify-between gap-4"><span className="font-medium text-slate-500 shrink-0">Adresse</span> <span className="font-semibold text-slate-800 text-right line-clamp-1" title={p.adresse}>{p.adresse || '-'}</span></p>
                         <p className="flex items-center justify-between"><span className="font-medium text-slate-500">Médecin</span> <span className="font-semibold text-slate-800">{p.medecinTraitant || '-'}</span></p>
                       </div>
                    </div>
                 );
                 })}
               </div>
             )}
              {hasMore && !searchQuery && (
                  <div className="flex justify-center mt-6">
                    <Button 
                      variant="outline" 
                      onClick={() => fetchPatients(true)}
                      disabled={loadingMore}
                      className="bg-white border-slate-200 text-slate-600 rounded-xl"
                    >
                      {loadingMore ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Charger plus
                    </Button>
                  </div>
              )}
          </div>
        </div>
      </div>

      <AlertDialog open={!!patientToDelete} onOpenChange={(open) => !open && setPatientToDelete(null)}>
         <AlertDialogContent className="rounded-2xl bg-white border border-slate-200 p-6 shadow-xl max-w-sm">
           <AlertDialogHeader>
             <AlertDialogTitle className="text-xl font-bold text-slate-900">Êtes-vous sûr ?</AlertDialogTitle>
             <AlertDialogDescription className="text-sm text-slate-500 mt-2">
               Cette action supprime la fiche patient.<br/>Elle est irréversible.
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
