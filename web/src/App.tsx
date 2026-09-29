import { lazy, Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AppShell, PageTransition } from '@/components/layout/AppShell'
import { LoadingGate } from '@/components/LoadingScreen'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ScanModalProvider } from '@/components/scan/ScanModalContext'
import Overview from '@/pages/Overview'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * ROUTES. One file per page under src/pages/. To add a page:
 *   1. create src/pages/Foo.tsx with a default export
 *   2. add a <Route> below (lazy() optional)
 *   3. add a NAV entry in src/lib/nav.ts if it belongs in the sidebar
 */
const Findings = lazy(() => import('@/pages/Findings'))
const FindingDetail = lazy(() => import('@/pages/FindingDetail'))
const DependencyGraph = lazy(() => import('@/pages/DependencyGraph'))
const AttackSurface = lazy(() => import('@/pages/AttackSurface'))
const Typosquatting = lazy(() => import('@/pages/Typosquatting'))
const Packages = lazy(() => import('@/pages/Packages'))
const Ecosystems = lazy(() => import('@/pages/Ecosystems'))
const History = lazy(() => import('@/pages/History'))
const Reports = lazy(() => import('@/pages/Reports'))
const Settings = lazy(() => import('@/pages/Settings'))
const NotFound = lazy(() => import('@/pages/NotFound'))

function PageFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="mt-6 h-64 w-full rounded-r4" />
    </div>
  )
}

export default function App() {
  const location = useLocation()
  return (
    <LoadingGate>
      <ScanModalProvider>
        <AppShell>
          <PageTransition>
            <ErrorBoundary scope="page" resetKeys={[location.pathname]}>
            <Suspense fallback={<PageFallback />}>
              <Routes location={location}>
                <Route path="/" element={<Overview />} />
                <Route path="/findings" element={<Findings />} />
                <Route path="/findings/:id" element={<FindingDetail />} />
                <Route path="/graph" element={<DependencyGraph />} />
                <Route path="/attack-surface" element={<AttackSurface />} />
                <Route path="/typosquatting" element={<Typosquatting />} />
                <Route path="/typosquatting/:pkg" element={<Typosquatting />} />
                <Route path="/packages" element={<Packages />} />
                <Route path="/ecosystems" element={<Ecosystems />} />
                <Route path="/ecosystems/:eco" element={<Ecosystems />} />
                <Route path="/history" element={<History />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
          </PageTransition>
        </AppShell>
      </ScanModalProvider>
    </LoadingGate>
  )
}
