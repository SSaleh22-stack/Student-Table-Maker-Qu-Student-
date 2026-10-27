import React, { createContext, useContext, ReactNode } from 'react';
import { translations } from '../i18n/translations';
import { Language } from '../types';

// The website is Arabic-only. `language` is typed as the shared Language type so
// the components shared with the extension (which also support English) compile.
interface LanguageContextType {
  language: Language;
  t: typeof translations.ar;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const value: LanguageContextType = {
    language: 'ar',
    t: translations.ar,
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
