import apiClient from "@/api/client";

export interface AgreementStats {
  conversation_id?: string;
  cohens_kappa: number;
  percent_agreement: number;
  n_annotations: number;
  details?: Record<string, unknown>;
}

export async function triggerConsensus(
  conversationId: string
): Promise<{ status: string; message: string }> {
  const response = await apiClient.post<{ status: string; message: string }>(
    `/export/consensus/${conversationId}`
  );
  return response.data;
}

export async function exportPickBestTurn(
  conversationId?: string
): Promise<Blob> {
  const params = conversationId ? { conversation_id: conversationId } : {};
  const response = await apiClient.get("/export/pick-best-turn", {
    params,
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function exportTurnByTurn(
  conversationId?: string
): Promise<Blob> {
  const params = conversationId ? { conversation_id: conversationId } : {};
  const response = await apiClient.get("/export/turn-by-turn", {
    params,
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function exportPrioritized(
  conversationId?: string
): Promise<Blob> {
  const params = conversationId ? { conversation_id: conversationId } : {};
  const response = await apiClient.get("/export/prioritized", {
    params,
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function exportAblation(variant: string): Promise<Blob> {
  const response = await apiClient.get(`/export/ablation/${variant}`, {
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function exportBulk(
  format: "json" | "csv"
): Promise<Blob> {
  const response = await apiClient.get("/export/bulk", {
    params: { format },
    responseType: "blob",
  });
  return response.data as Blob;
}

export async function exportAgreement(
  conversationId?: string
): Promise<AgreementStats> {
  const params = conversationId ? { conversation_id: conversationId } : {};
  const response = await apiClient.get<AgreementStats>(
    "/export/agreement",
    { params }
  );
  return response.data;
}
