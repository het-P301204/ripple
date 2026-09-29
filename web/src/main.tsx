import '@/lib/perf' // sets <html data-motion> before first paint
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MotionRoot, PerfGuard } from '@/components/MotionRoot'
import { ToastProvider } from '@/components/ui/Toast'
import { RippleProvider } from '@/lib/store'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="app">
    <MotionRoot>
      <BrowserRouter>
        <ToastProvider>
          <RippleProvider>
            <App />
            <PerfGuard />
          </RippleProvider>
        </ToastProvider>
      </BrowserRouter>
    </MotionRoot>
    </ErrorBoundary>
  </React.StrictMode>,
)
