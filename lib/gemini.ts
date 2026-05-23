import { GoogleGenAI } from "@google/genai";
import { askManagedMentor, managedAgentsEnabled } from "@/lib/managed-agents";
import type { ManagedAgentSession } from "@/lib/types";

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

export async function askMentor(question: string, context: string) {
  const client = getGeminiClient();
  if (!client) {
    return "Gemini is not configured yet. Add GEMINI_API_KEY to .env.local. For the MVP shell, use the graph evidence and task files as the mentor context.";
  }

  const result = await client.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    contents: [
      "You are StackMap's mentor agent. Answer with practical, source-backed onboarding guidance.",
      `Context:\n${context}`,
      `Question:\n${question}`
    ].join("\n\n")
  });

  return result.text ?? "No Gemini response text returned.";
}

export async function askMentorWithManagedSession(
  question: string,
  context: string,
  session?: ManagedAgentSession
) {
  if (managedAgentsEnabled() && session?.interactionId) {
    try {
      const input = [
        "You are StackMap's mentor agent in the same Antigravity remote sandbox used to analyze this repository.",
        "Answer with practical, source-backed onboarding guidance. Prefer files and paths you can inspect in the sandbox.",
        `Graph and mission context:\n${context}`,
        `Question:\n${question}`
      ].join("\n\n");

      const { answer, session: nextSession } = await askManagedMentor(input, session);
      return { answer, session: nextSession, usedManagedAgent: true as const };
    } catch (error) {
      console.warn("Managed mentor failed; falling back to generateContent.", error);
    }
  }

  const answer = await askMentor(question, context);
  return { answer, session, usedManagedAgent: false as const };
}
