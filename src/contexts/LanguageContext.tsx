import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Language, translations } from '../i18n/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: typeof translations.en;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('ar'); // Default to Arabic

  // Load language preference from storage on mount
  useEffect(() => {
    chrome.storage.sync.get(['language'], (result) => {
      if (result.language && (result.language === 'en' || result.language === 'ar')) {
        setLanguageState(result.language);
      }
    });
  }, []);

  // Save language preference to storage when it changes
  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    chrome.storage.sync.set({ language: lang });
  };

  const value: LanguageContextType = {
    language,
    setLanguage,
    t: translations[language],
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

