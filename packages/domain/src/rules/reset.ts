export type ResetState = "none" | "proposed" | "approved" | "declined";
export interface ResetProposal { readonly state: ResetState; readonly proposedBy: string | null; }

// STUB — phase 3.
export function propose(_by: string): ResetProposal { return { state: "none", proposedBy: null }; }
export function approve(p: ResetProposal, _by: string): ResetProposal { return p; }
export function decline(p: ResetProposal, _by: string): ResetProposal { return p; }
