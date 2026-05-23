import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getGeminiClient } from "@/lib/gemini";
import type { OnboardingTask, StackMapGraph, StackMapNode, StoryModeBrief, StoryModeScene } from "@/lib/types";

type StoryModeInput = {
  graph: StackMapGraph;
  node?: StackMapNode;
  task?: OnboardingTask;
  generateVideo: boolean;
};

type GeminiStoryDraft = {
  title?: string;
  narrationScript?: string;
  scenes?: Partial<StoryModeScene>[];
};

const ttsModel = process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-preview-tts";
const storySceneCount = 8;
const storySceneDurationSeconds = 8;

export async function createStoryModeBrief(input: StoryModeInput): Promise<StoryModeBrief> {
  const draft = await generateStoryDraft(input);
  const brief = normalizeStoryDraft(draft ?? fallbackStoryDraft(input), input);

  if (!input.generateVideo) return brief;

  try {
    const audioUrl = await generateNarrationAudio(brief.narrationScript, brief.id);
    return { ...brief, status: "complete", audioUrl };
  } catch (error) {
    return {
      ...brief,
      status: "storyboard",
      error: error instanceof Error ? `Narration audio failed: ${error.message}` : "Narration audio failed."
    };
  }
}

async function generateStoryDraft(input: StoryModeInput): Promise<GeminiStoryDraft | null> {
  const client = getGeminiClient();
  if (!client) return null;

  const relatedEdges = input.node
    ? input.graph.edges.filter((edge) => edge.source === input.node?.id || edge.target === input.node?.id)
    : [];
  const relatedNodeIds = new Set(relatedEdges.flatMap((edge) => [edge.source, edge.target]));
  const relatedNodes = input.graph.nodes.filter((node) => relatedNodeIds.has(node.id));

  const prompt = `
You are StackMap Story Mode, an engineering educator.

Create a one-minute illustrated walkthrough for the selected codebase area.
This will be rendered by StackMap as deterministic animated scenes, not AI video.

Rules:
- The narration must actually teach. Do not write a generic welcome.
- Explain what the selected part owns, which files prove it, how data/control flows, what risk to inspect, and what the engineer should do next.
- Create exactly 8 scenes, each 8 seconds.
- Scene titles should be short and useful.
- Overlay facts must be grounded in the selected node/task/evidence.
- Prefer practical engineering language over cinematic language.

Repo:
${JSON.stringify(input.graph.repo, null, 2)}

Selected node:
${JSON.stringify(input.node, null, 2)}

Selected onboarding task:
${JSON.stringify(input.task, null, 2)}

Related nodes:
${JSON.stringify(relatedNodes, null, 2)}

Related edges:
${JSON.stringify(relatedEdges, null, 2)}

Return strict JSON only:
{
  "title": "One-minute walkthrough title",
  "narrationScript": "Full voiceover script, 220-300 words. Must be source-backed and educational.",
  "scenes": [
    {
      "id": "scene-1",
      "title": "Scene title",
      "durationSeconds": 8,
      "narration": "Scene voiceover line.",
      "aiVisualPrompt": "Short visual direction for deterministic rendering, such as architecture_map, flow_trace, file_cards, risk_checkpoint, mission_path.",
      "overlayTitle": "Accurate title rendered by StackMap",
      "overlayFacts": ["2-4 concise factual overlays"],
      "files": ["source/evidence/path.ts"],
      "highlightedNodeIds": ["node-id"]
    }
  ]
}
`;

  try {
    const response = await client.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      contents: prompt
    });
    return parseJson(response.text ?? "");
  } catch (error) {
    console.error("Story Mode draft generation failed.", error);
    return null;
  }
}

function normalizeStoryDraft(draft: GeminiStoryDraft, input: StoryModeInput): StoryModeBrief {
  const target = input.node ?? input.graph.nodes[0];
  const task = input.task;
  const fallbackScenes = fallbackStoryDraft(input).scenes ?? [];
  const rawScenes = draft.scenes?.length ? draft.scenes : fallbackScenes;
  const scenes = fillScenes(rawScenes, fallbackScenes)
    .slice(0, storySceneCount)
    .map((scene, index): StoryModeScene => ({
      id: scene.id || `scene-${index + 1}`,
      title: scene.title || `Scene ${index + 1}`,
      durationSeconds: storySceneDurationSeconds,
      narration: scene.narration || target?.summary || "Explain the selected codebase area.",
      aiVisualPrompt: scene.aiVisualPrompt || "architecture_map",
      overlayTitle: scene.overlayTitle || target?.label || input.graph.repo.name,
      overlayFacts: cleanStrings(scene.overlayFacts).slice(0, 4),
      files: cleanStrings(scene.files).slice(0, 4),
      highlightedNodeIds: cleanStrings(scene.highlightedNodeIds).slice(0, 5)
    }));

  const narrationScript =
    draft.narrationScript ||
    scenes.map((scene) => scene.narration).join(" ") ||
    `This StackMap story explains ${target?.label ?? input.graph.repo.name} and the files a new engineer should inspect first.`;

  return {
    id: crypto.randomUUID(),
    title: draft.title || `Story Mode: ${target?.label ?? task?.title ?? input.graph.repo.name}`,
    status: "storyboard",
    durationSeconds: scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0),
    narrationScript,
    scenes
  };
}

async function generateNarrationAudio(script: string, id: string) {
  const client = getGeminiClient();
  if (!client) throw new Error("Gemini is not configured.");

  const response = await client.models.generateContent({
    model: ttsModel,
    contents: [
      {
        parts: [
          {
            text: `Read this as a clear senior engineer teaching a new teammate. Be specific, calm, and practical.\n\n${script}`
          }
        ]
      }
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Charon" }
        }
      }
    }
  });

  const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  const data = inlineData?.data;
  if (!data) throw new Error("TTS returned no audio data.");

  const pcm = Buffer.from(data, "base64");
  const wav = pcmToWav(pcm);
  const mediaDir = path.join(process.cwd(), "public", "generated-media");
  await mkdir(mediaDir, { recursive: true });
  const filename = `${id}-narration.wav`;
  await writeFile(path.join(mediaDir, filename), wav);
  return `/generated-media/${filename}`;
}

function fallbackStoryDraft(input: StoryModeInput): GeminiStoryDraft {
  const node = input.node ?? input.graph.nodes[0];
  const task = input.task;
  const files = [...new Set([...(node?.files ?? []), ...(task?.filesToRead ?? [])])].slice(0, 4);
  const risk = node?.risks?.[0] ?? "Inspect the connected files before making changes.";

  return {
    title: `Walkthrough: ${node?.label ?? input.graph.repo.name}`,
    narrationScript: `This walkthrough focuses on ${node?.label ?? input.graph.repo.name}. Start by placing it inside the ${input.graph.repo.name} architecture map. This node is classified as ${node?.type ?? "a codebase area"}, and StackMap connected it to files like ${files.slice(0, 2).join(" and ") || "the listed evidence files"}. The practical onboarding goal is to understand ownership first: what this part controls, which files prove that behavior, and what other nodes depend on it. Next, trace the flow through related edges. Look for routes, calls, reads, writes, or imports that show how data and control move. Then inspect the risk checkpoint: ${risk} Treat that as a question to verify, not an automatic bug. Finally, use the selected mission to turn this mental model into action: read the files, explain the flow, and identify the safest first change.`,
    scenes: [
      scene("scene-1", "Repo Context", `Place ${node?.label ?? "this area"} inside the overall ${input.graph.repo.name} architecture.`, "architecture_map", input.graph.repo.name, [`${input.graph.nodes.length} mapped nodes`, `${input.graph.edges.length} architecture links`], [], input.graph.nodes.slice(0, 4).map((item) => item.id)),
      scene("scene-2", "Selected Node", node?.summary ?? "Zoom into the selected node and explain what it owns.", "node_focus", node?.label ?? "Selected Node", [node?.summary ?? "Selected codebase area"], files, node ? [node.id] : []),
      scene("scene-3", "Evidence Files", task?.description ?? "Use source evidence to anchor the explanation.", "file_cards", "Evidence Files", ["Read files before editing", "Use evidence to explain behavior"], files, task?.relatedNodeIds ?? (node ? [node.id] : [])),
      scene("scene-4", "Control Flow", "Trace how this part connects to upstream and downstream modules.", "flow_trace", "Control Flow", ["Follow connected edges", "Name upstream and downstream modules"], files, task?.relatedNodeIds ?? (node ? [node.id] : [])),
      scene("scene-5", "Data Movement", "Look for reads, writes, route calls, and dependencies.", "data_flow", "Data Movement", ["Watch reads and writes", "Connect code to runtime behavior"], files, task?.relatedNodeIds ?? (node ? [node.id] : [])),
      scene("scene-6", "Risk Checkpoint", `Inspect the riskiest assumption before making changes. ${risk}`, "risk_checkpoint", "Risk Checkpoint", [risk], files, node ? [node.id] : []),
      scene("scene-7", "Onboarding Mission", task?.description ?? "Turn this map into a concrete onboarding mission.", "mission_path", task?.title ?? "Onboarding Mission", task?.successCriteria?.slice(0, 3) ?? ["Read evidence", "Trace flow", "Explain behavior"], files, task?.relatedNodeIds ?? (node ? [node.id] : [])),
      scene("scene-8", "Recap", "Summarize ownership, evidence, flow, risk, and the next safest action.", "recap", "Mental Model", ["Ownership", "Evidence", "Flow", "Next action"], files, input.graph.nodes.slice(0, 5).map((item) => item.id))
    ]
  };
}

function scene(
  id: string,
  title: string,
  narration: string,
  aiVisualPrompt: string,
  overlayTitle: string,
  overlayFacts: string[],
  files: string[],
  highlightedNodeIds: string[]
): StoryModeScene {
  return {
    id,
    title,
    durationSeconds: storySceneDurationSeconds,
    narration,
    aiVisualPrompt,
    overlayTitle,
    overlayFacts,
    files,
    highlightedNodeIds
  };
}

function fillScenes(scenes: Partial<StoryModeScene>[], fallbackScenes: Partial<StoryModeScene>[]) {
  const filled = [...scenes];
  let index = 0;
  while (filled.length < storySceneCount) {
    filled.push(fallbackScenes[index % fallbackScenes.length] ?? { id: `scene-${filled.length + 1}` });
    index++;
  }
  return filled;
}

function parseJson(raw: string): GeminiStoryDraft | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  return JSON.parse(trimmed.slice(start, end + 1)) as GeminiStoryDraft;
}

function cleanStrings(values: unknown) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    )
  ];
}

function pcmToWav(pcm: Buffer, channels = 1, sampleRate = 24000, bitDepth = 16) {
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
