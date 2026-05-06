import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveCall } from "./components/LiveCall";
import { MeetingSummary } from "./components/MeetingSummary";
import { HistoryAnalytics } from "./components/HistoryAnalytics";
import { PatientsConfig } from "./components/PatientsConfig";
import { useFirebase } from "./components/FirebaseProvider";
import { Button } from "@/components/ui/button";
import { Mic, History, FileText, Stethoscope, LogOut } from "lucide-react";
import { Toaster, toast } from "sonner";

export default function App() {
  const { user, loading, signIn, signOut } = useFirebase();
  const [activeTab, setActiveTab] = useState("live-call");

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-slate-50"><p className="text-slate-500 animate-pulse">Chargement...</p></div>;
  }

  if (!user) {
    return (
      <div className="h-screen w-full bg-slate-50 flex items-center justify-center overflow-hidden font-sans text-slate-800">
        <div className="bg-white p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/50 text-center space-y-4 max-w-sm w-full">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center text-white shadow-sm shadow-red-600/20">
                <Stethoscope size={20} />
              </div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Émilie AI</h1>
            <p className="text-sm text-slate-500 leading-relaxed">Connectez-vous pour configurer votre assistant dentaire et accéder à votre historique personnalisé.</p>
            <Button onClick={signIn} className="w-full h-12 bg-red-600 hover:bg-red-700 shadow-sm shadow-red-600/20 text-white mt-6 font-medium text-base rounded-xl">
               Continuer avec Google
            </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-slate-50/50 flex overflow-hidden font-sans text-slate-800 selection:bg-red-100 selection:text-red-900">
      {/* Sidebar: Archiving & History */}
      <aside className="w-72 bg-white border-r border-slate-200/60 flex-col hidden md:flex shrink-0">
        <div className="p-6 border-b border-slate-100/60">
          <h1 className="text-xl font-bold tracking-tight text-red-700 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center text-red-600 shadow-sm border border-red-100">
              <Stethoscope size={16} />
            </div>
            Émilie AI
          </h1>
          <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-[0.15em] font-semibold">Assistant Dentaire</p>
        </div>
        
        <nav className="flex-1 p-5 space-y-8">
          <div>
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Dossiers Récents</h2>
            <div className="space-y-1">
              <div 
                onClick={() => { setActiveTab("meeting"); toast.info("Consultez vos notes actuelles dans l'onglet approprié."); }} 
                className="p-3 bg-red-50/50 rounded-xl border border-red-100/50 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <p className="text-sm font-medium text-red-900">Notes en cours</p>
                <p className="text-[11px] text-red-600/70 mt-0.5">Onglet actif</p>
              </div>
              <div 
                onClick={() => { setActiveTab("patients"); toast.info("Ouverture de la base patients..."); }} 
                className="p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-transparent"
              >
                <p className="text-sm font-medium text-slate-700">Base Patients</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Mock Logosw</p>
              </div>
              <div 
                onClick={() => { setActiveTab("history"); toast.info("Ouverture de l'historique complet..."); }} 
                className="p-3 hover:bg-slate-50 rounded-xl cursor-pointer transition-colors border border-transparent"
              >
                <p className="text-sm font-medium text-slate-700">Consulter tous les dossiers</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Voir l'historique complet</p>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Catégories</h2>
            <div className="space-y-3 px-1 text-sm text-slate-500 font-medium">
              <div onClick={() => toast.info("Filtre en cours de construction")} className="flex items-center gap-3 cursor-pointer hover:text-slate-800 transition-colors">
                <span className="w-2 h-2 rounded-full bg-red-400 ring-4 ring-red-400/20"></span> Courriers
              </div>
              <div onClick={() => toast.info("Filtre en cours de construction")} className="flex items-center gap-3 cursor-pointer hover:text-slate-800 transition-colors">
                <span className="w-2 h-2 rounded-full bg-sky-400 ring-4 ring-sky-400/20"></span> Devis
              </div>
              <div onClick={() => toast.info("Filtre en cours de construction")} className="flex items-center gap-3 cursor-pointer hover:text-slate-800 transition-colors">
                <span className="w-2 h-2 rounded-full bg-indigo-400 ring-4 ring-indigo-400/20"></span> Administratif
              </div>
            </div>
          </div>
        </nav>

        <div className="p-5 border-t border-slate-100/60 space-y-5">
          <div className="text-xs text-slate-500 px-1 flex justify-between items-center bg-slate-50 rounded-xl p-3 border border-slate-100 gap-2">
            <span className="truncate font-medium">{user.displayName || user.email}</span>
            <button onClick={signOut} className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0" title="Déconnexion">
              <LogOut size={14} />
            </button>
          </div>
          <div className="bg-slate-900 rounded-2xl p-4 text-white shadow-lg border border-slate-800 relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-red-500/20 blur-2xl rounded-full"></div>
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Statut Système</p>
            <p className="text-sm font-semibold flex items-center gap-2.5 mt-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-20"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
              </span>
              Gemini Live Connecté
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden w-full h-full relative">
         <main className="flex-1 flex flex-col overflow-hidden">
            {/* Header / Status Bar */}
            <header className="h-16 px-4 md:px-8 flex items-center justify-between border-b border-slate-200/60 bg-white/80 backdrop-blur-md shrink-0 z-10 sticky top-0">
              <div className="flex items-center gap-2 md:gap-4">
                  <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shadow-lg border border-red-500 overflow-hidden shrink-0">
                    <img src="/src/assets/emillie.png" alt="Emilie" className="w-5 h-5 object-contain" />
                  </div>
                <div className="flex items-center gap-2 px-2.5 md:px-3 py-1.5 bg-red-50 text-red-700 rounded-full text-[10px] md:text-xs font-semibold uppercase tracking-wider border border-red-100/50">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                  En ligne
                </div>
                <span className="text-slate-400 text-xs md:text-sm hidden sm:block font-medium">Cabinet Central</span>
              </div>
              <div className="flex items-center text-sm font-medium">
                <TabsList className="grid grid-cols-4 bg-slate-100/80 p-1 rounded-xl h-11 w-[400px] md:w-[500px] border border-slate-200/50 shadow-inner">
                  <TabsTrigger value="live-call" className="rounded-lg text-xs md:text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-red-700 flex gap-2 items-center">
                    <Mic size={14} className="hidden md:block" /> Appel
                  </TabsTrigger>
                  <TabsTrigger value="history" className="rounded-lg text-xs md:text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-red-700 flex gap-2 items-center">
                    <History size={14} className="hidden md:block" /> Historique
                  </TabsTrigger>
                  <TabsTrigger value="meeting" className="rounded-lg text-xs md:text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-red-700 flex gap-2 items-center">
                    <FileText size={14} className="hidden md:block" /> Notes
                  </TabsTrigger>
                  <TabsTrigger value="patients" className="rounded-lg text-xs md:text-sm font-medium data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-red-700 flex gap-2 items-center">
                    <Stethoscope size={14} className="hidden md:block" /> Patients
                  </TabsTrigger>
                </TabsList>
              </div>
            </header>

            <div className="flex-1 relative flex flex-col items-center justify-start xl:justify-center p-4 sm:p-8 overflow-y-auto">
                <div className="w-full max-w-5xl flex-1 flex flex-col py-2 md:py-6 h-[80vh]">
                  <TabsContent value="live-call" className="flex-1 m-0 focus-visible:outline-none flex flex-col data-[state=active]:flex">
                    <LiveCall />
                  </TabsContent>
                  
                  <TabsContent value="history" className="flex-1 m-0 focus-visible:outline-none flex flex-col data-[state=active]:flex">
                    <HistoryAnalytics />
                  </TabsContent>
                  
                  <TabsContent value="meeting" className="flex-1 m-0 focus-visible:outline-none flex flex-col data-[state=active]:flex">
                    <MeetingSummary />
                  </TabsContent>

                  <TabsContent value="patients" className="flex-1 m-0 focus-visible:outline-none flex flex-col data-[state=active]:flex">
                    <PatientsConfig />
                  </TabsContent>
                </div>
            </div>
         </main>
      </Tabs>
      <Toaster />
    </div>
  );
}
