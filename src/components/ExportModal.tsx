import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, FileText, Cloud, Mail, X } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExportPDF: () => void;
  onExportWord: () => void;
  onExportDrive: () => void;
  onExportEmail: (email: string) => void;
}

export function ExportModal({ isOpen, onClose, onExportPDF, onExportWord, onExportDrive, onExportEmail }: ExportModalProps) {
  const [email, setEmail] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
           <X size={20} />
        </button>
        <h3 className="text-xl font-bold mb-6 text-slate-800">Exporter le rapport</h3>
        <div className="space-y-3">
            <Button onClick={onExportPDF} variant="outline" className="w-full justify-start rounded-xl">
               <Download className="w-4 h-4 mr-2" /> Télécharger en PDF
            </Button>
            <Button onClick={onExportWord} variant="outline" className="w-full justify-start rounded-xl">
               <FileText className="w-4 h-4 mr-2" /> Télécharger en Word
            </Button>
            <Button onClick={onExportDrive} variant="outline" className="w-full justify-start rounded-xl">
               <Cloud className="w-4 h-4 mr-2" /> Exporter vers Google Drive
            </Button>
            
            <div className="pt-4 border-t border-slate-100 mt-4 space-y-2">
                <input 
                    type="email" 
                    placeholder="Email du patient" 
                    className="w-full p-2 border rounded-xl text-sm"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <Button onClick={() => onExportEmail(email)} variant="default" className="w-full justify-start rounded-xl bg-red-600 hover:bg-red-700 text-white">
                   <Mail className="w-4 h-4 mr-2" /> Envoyer par E-mail
                </Button>
            </div>
        </div>
      </div>
    </div>
  );
}
