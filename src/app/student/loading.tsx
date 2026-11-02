import { LoadingState } from "@/components/ui/states";

/**
 * Route-level loading boundary. The workspace shell (sidebar, top bar) lives in
 * the layout and stays mounted; with this boundary a link click switches to the
 * new route immediately and shows a skeleton while the page streams in, instead
 * of freezing the old page until the server responds. Next.js also prefetches
 * up to this boundary for dynamic routes.
 */
export default function Loading() {
  return <LoadingState variant="page" label="Loading page" />;
}
