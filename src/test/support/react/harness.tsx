import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, type RenderHookOptions, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { DialectProvider } from "@/contexts/DialectContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installSupabaseFetch, type InstalledBackend } from "../transports/vitest";
import { isSignedIn, seedPersona, type Persona, type PersonaOptions } from "../personas";
import { TEST_USER_ID } from "../server/session";

/**
 * Renders components and hooks with the providers the app gives them, against
 * the in-memory Supabase backend.
 *
 * The backend is installed as `globalThis.fetch`, so the **real**
 * `@supabase/supabase-js` client runs: the URL a hook builds is the thing under
 * test. That is the difference that matters — a hand-mocked query builder
 * returns whatever the test told it to, so it can never catch a filter applied
 * to the wrong column or a select naming one that no longer exists.
 */

export interface HarnessOptions {
  /** Who is signed in. Defaults to a signed-out visitor. */
  persona?: Persona;
  personaOptions?: PersonaOptions;
  /** Router entry, for components that read the path or params. */
  route?: string;
  /** Seed fixtures before the component mounts. */
  seed?: (backend: InstalledBackend["backend"]) => void;
}

export interface Harness {
  backend: InstalledBackend["backend"];
  cleanup: () => void;
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The app uses retry:1 and a 30s staleTime. Both are wrong for tests:
        // a retry turns one deliberate failure into a slow one, and a stale
        // window lets data leak between tests through the shared cache.
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

function setUp(options: HarnessOptions): Harness & { wrapper: (props: { children: ReactNode }) => ReactElement } {
  // The session has to be in localStorage before the client reads it, which it
  // does at construction — so the persona is resolved first and handed to the
  // installer rather than applied afterwards. Without this `useAuth` sees no
  // user and every data hook short-circuits to an empty result, which looks
  // exactly like a query returning nothing.
  const userId =
    options.persona && isSignedIn(options.persona)
      ? (options.personaOptions?.userId ?? TEST_USER_ID)
      : null;

  const installed = installSupabaseFetch({ signedInAs: userId });
  const { backend } = installed;

  if (options.persona) {
    seedPersona(backend, options.persona, options.personaOptions);
  }
  options.seed?.(backend);

  const queryClient = createTestQueryClient();

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[options.route ?? "/"]}>
        <DialectProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </DialectProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );

  const cleanup = () => {
    queryClient.clear();
    installed.restore();
    // DialectProvider persists to localStorage and writes CSS variables onto
    // documentElement; both would otherwise carry into the next test.
    window.localStorage.clear();
    document.documentElement.removeAttribute("style");
  };

  return { backend, cleanup, wrapper };
}

/** Render a component with the app's providers and the in-memory backend. */
export function renderWithProviders(
  ui: ReactElement,
  options: HarnessOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  const { persona, personaOptions, route, seed, ...renderOptions } = options;
  const { backend, cleanup, wrapper } = setUp({ persona, personaOptions, route, seed });

  const result = render(ui, { wrapper, ...renderOptions });

  return { ...result, backend, cleanup };
}

/** Render a hook with the same providers and backend. */
export function renderHookWithProviders<Result, Props>(
  hook: (initialProps: Props) => Result,
  options: HarnessOptions & Omit<RenderHookOptions<Props>, "wrapper"> = {},
) {
  const { persona, personaOptions, route, seed, ...hookOptions } = options;
  const { backend, cleanup, wrapper } = setUp({ persona, personaOptions, route, seed });

  const result = renderHook(hook, { wrapper, ...hookOptions });

  return { ...result, backend, cleanup };
}

export { TEST_USER_ID };
