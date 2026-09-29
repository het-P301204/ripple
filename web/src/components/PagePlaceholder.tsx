import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, StateGlyph } from '@/components/ui/States'
import { Card } from '@/components/ui/Card'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { useRipple } from '@/lib/store'

/**
 * Tasteful stand-in for pages that later agents will build.
 * Each page file re-exports its own default component, so replacing one never touches another.
 */
export function PagePlaceholder({ title, subtitle }: { title: string; subtitle: string }) {
  const { scan } = useRipple()
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {scan ? (
        <Card>
          <EmptyState
            glyph={<StateGlyph size={88} />}
            title="This view is coming together"
            description="The data is loaded and ready. The page itself is still being built."
          />
        </Card>
      ) : (
        <Card><NoScanEmptyState /></Card>
      )}
    </>
  )
}
