import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15 * 60 * 1000, // 15 minutes — matches spec staleness model
      gcTime: 30 * 60 * 1000,
      retry: 1,
    },
  },
});
