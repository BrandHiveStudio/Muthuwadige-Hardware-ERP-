import React from 'react';
import { AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';

interface OfflineSyncWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncNow: () => Promise<void> | void;
  isSyncing?: boolean;
}

export const OfflineSyncWarningModal: React.FC<OfflineSyncWarningModalProps> = ({
  isOpen,
  onClose,
  onSyncNow,
  isSyncing = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-600/40 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5">
        
        {/* Header Badge */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-6 h-6"/>
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900 dark:text-white">
              Cloud Sync Recommended
            </h3>
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              සමමුහුර්ත කිරීම නිර්දේශ කෙරේ • ஒத்திசைவு பரிந்துரைக்கப்படுகிறது
            </p>
          </div>
        </div>

        {/* Trilingual Copy Body */}
        <div className="space-y-3 bg-amber-50/60 dark:bg-slate-800/60 p-4 rounded-xl border border-amber-100 dark:border-slate-700/60 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
          <div>
            <span className="font-bold text-slate-900 dark:text-white block text-xs uppercase tracking-wider mb-0.5">English</span>
            This computer has not synced with the cloud today. Connect to the internet and sync to avoid duplicate item codes or customer profiles, or continue offline.
          </div>
          <div className="border-t border-amber-200/50 dark:border-slate-700/60 pt-2">
            <span className="font-bold text-slate-900 dark:text-white block text-xs uppercase tracking-wider mb-0.5">සිංහල</span>
            මෙම පරිගණකය අද දින ප්රධාන Cloud පද්ධතිය සමඟ Sync කර නොමැත. භාණ්ඩ කේත (Item Codes) හෝ පාරිභෝගික දත්ත අනුපිටපත් වීම වැළැක්වීමට අන්තර්ජාලයට සම්බන්ධ වී Sync කරන්න, නැතහොත් Offline ලෙස ඉදිරියට යන්න.
          </div>
          <div className="border-t border-amber-200/50 dark:border-slate-700/60 pt-2">
            <span className="font-bold text-slate-900 dark:text-white block text-xs uppercase tracking-wider mb-0.5">தமிழ்</span>
            இந்த கணினி இன்று பிரதான Cloud அமைப்புடன் Sync செய்யப்படவில்லை. பொருட்களின் குறியீடுகள் (Item Codes) அல்லது வாடிக்கையாளர் விபரங்கள் இரட்டிப்பாவதைத் தவிர்க்க இணையத்தை இணைத்து Sync செய்யவும், அல்லது Offline-ல் தொடரவும்.
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 transition"
          >
            <span>Continue Offline / Offline ඉදිරියට යන්න / Offline-ல் தொடரவும்</span>
            <ArrowRight className="w-3.5 h-3.5"/>
          </button>

          <button
            type="button"
            onClick={onSyncNow}
            disabled={isSyncing}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition shadow-md disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Now / දැන් Sync කරන්න / இப்போதே Sync செய்'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
