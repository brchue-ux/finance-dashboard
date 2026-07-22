import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** A category the user's own spending fell into — offered, not imposed (6c). */
export interface RecognizedCategory {
  name: string;
  totalSpent: number;
  monthlyAverage: number;
  transactionCount: number;
  merchantCount: number;
  sampleMerchants: string[];
  alreadyExists: boolean;
  categoryRules: string[];
}

/** A merchant no built-in rule could place — the gap a fixed list would hide. */
export interface UnrecognizedMerchant {
  merchant: string;
  totalSpent: number;
  transactionCount: number;
}

export interface EnvelopeProposal {
  recognized: RecognizedCategory[];
  unrecognized: UnrecognizedMerchant[];
  monthsObserved: number;
}

/**
 * The proposal is derived from stored transactions and only changes when those
 * do (an import, a sync). It is not hot data, so it is fetched on demand when
 * the suggestions screen opens rather than polled.
 */
export function useEnvelopeProposal() {
  return useQuery({
    queryKey: ["envelope-proposal"],
    queryFn: () => api.get<EnvelopeProposal>("/api/budget/envelopes/proposal"),
    staleTime: 5 * 60 * 1000,
  });
}
