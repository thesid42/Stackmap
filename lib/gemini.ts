import { GoogleGenAI } from "@google/genai";

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
