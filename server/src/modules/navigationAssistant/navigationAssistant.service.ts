import { env } from "@/config/env";
import { ServiceUnavailableError } from "@/utils/errors";
import { logger } from "@/utils/logger";
import {
  audienceForRole,
  navigationKnowledgeFor,
  roleBoundaryResponse,
  type NavigationAudience,
} from "@/modules/navigationAssistant/navigationAssistant.knowledge";
import { navigationActionsFor, type NavigationAction } from "@/modules/navigationAssistant/navigationAssistant.actions";
import type { RoleName } from "@prisma/client";

const SYSTEM_INSTRUCTION = "You are the URS-QA DMS Navigation Assistant. Your job is to help the authenticated user understand how to navigate and use URS-QA DMS. Use only the provided URS-QA DMS navigation knowledge and the user's authorized role context. Keep answers concise, practical, and easy to follow. Never invent pages, buttons, routes, permissions, or features. Never instruct a user to access functionality outside their role. If functionality is unavailable to the role, explain that briefly. You are guidance-only. You do not perform destructive or administrative actions. You do not read private documents, PDFs, submissions, audit records, or database records.";
const REQUEST_TIMEOUT_MS = 15_000;
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

function safeProviderErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return `status_${status}`;
  }
  return error instanceof Error ? error.name : "unknown_error";
}

/** Generate one navigation-assistant response without persisting context. */
export async function generateResponse(prompt: string): Promise<string> {
  return generateProviderResponse(prompt, SYSTEM_INSTRUCTION);
}

export interface NavigationResponseInput {
  message: string;
  /** Trusted server-side role. Never accept this value directly from a client. */
  role: RoleName;
}

export interface NavigationResponse {
  message: string;
  actions: NavigationAction[];
}

export async function generateNavigationResponse(input: NavigationResponseInput): Promise<NavigationResponse> {
  const normalizedMessage = input.message.trim();
  const audience = audienceForRole(input.role);
  const guarded = roleBoundaryResponse(audience, normalizedMessage);
  if (guarded) return { message: guarded, actions: [] };

  const prompt = `Authorized role audience: ${audience}\n\nCurrent URS-QA DMS navigation knowledge:\n${navigationKnowledgeFor(audience)}\n\nUser question: ${normalizedMessage}`;
  const message = await generateProviderResponse(prompt, `${SYSTEM_INSTRUCTION}\n\nThe trusted role audience for this request is ${audience}. Do not reveal or provide instructions from another audience's knowledge.`);
  return { message, actions: navigationActionsFor(audience, normalizedMessage) };
}

async function generateProviderResponse(prompt: string, systemInstruction: string): Promise<string> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    throw new ServiceUnavailableError("The navigation assistant received an empty prompt.");
  }
  if (!env.DEEPSEEK_API_KEY) {
    throw new ServiceUnavailableError("The navigation assistant is not configured.");
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: normalizedPrompt },
        ],
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw Object.assign(new Error("deepseek_api_error"), { status: response.status });
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("deepseek_empty_response");
    return text;
  } catch (error) {
    logger.warn("Navigation assistant request failed", { code: safeProviderErrorCode(error) });
    throw new ServiceUnavailableError("The navigation assistant is temporarily unavailable.");
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export const navigationAssistantSystemInstruction = SYSTEM_INSTRUCTION;

export type { NavigationAudience };
