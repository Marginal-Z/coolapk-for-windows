import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './desktop-layout.css';
import './user-preferences.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
