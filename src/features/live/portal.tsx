"use client";
/**
 * Demo/live switching for pages (Core). A page renders its live (Convex)
 * screen for every school account; the internal demo screen only for demo
 * personas, mounted through DemoSlot so shipped code never imports demo code.
 */
import { Component, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { getAppError } from "@/lib/convex/errors";
import { useSession, type DataSource } from "@/features/auth/session-provider";
import { Button, Card, EmptyState } from "@/components/ui";

/** Renders the demo-data page or the live (Convex) page for the current session. */
export function PortalPage({ demo, live }: { demo: ReactNode; live: ReactNode }) {
  const { dataSource } = useSession();
  return <>{(dataSource as DataSource | null) === "live" ? <LiveBoundary>{live}</LiveBoundary> : demo}</>;
}

/**
 * For screens that handle demo and live data themselves: in live mode, server
 * errors become an in-page message (LiveBoundary) instead of a crashed screen.
 */
export function LiveAware({ children }: { children: ReactNode }) {
  return <PortalPage demo={children} live={children} />;
}

/** Server errors from live queries become an in-page message instead of a crashed screen. */
export class LiveBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    const app = getAppError(this.state.error);
    return (
      <Card className="mx-auto mt-6 max-w-xl">
        <EmptyState
          icon={<Lock className="h-6 w-6" />}
          title={app?.code === "NOT_FOUND" ? "Record not available" : "Something went wrong"}
          description={app?.message ?? "We couldn't load your school records. Please try again, or contact the school office if this continues."}
          action={<Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>}
        />
      </Card>
    );
  }
}
