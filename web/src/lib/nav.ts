import {
  Crosshair, FileText, Gauge, History, Layers, Network, Package, Settings, ShieldAlert, type LucideIcon,
} from 'lucide-react'

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

/** Sidebar navigation. Add new top-level pages here (and a Route in App.tsx). */
export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: Gauge, end: true },
  { to: '/findings', label: 'Findings', icon: ShieldAlert },
  { to: '/graph', label: 'Dependency Graph', icon: Network },
  { to: '/attack-surface', label: 'Attack Surface', icon: Crosshair },
  { to: '/packages', label: 'Packages', icon: Package },
  { to: '/ecosystems', label: 'Ecosystems', icon: Layers },
  { to: '/history', label: 'Scan History', icon: History },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
]
