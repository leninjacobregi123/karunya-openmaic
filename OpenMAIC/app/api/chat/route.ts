/**
 * Stateless Chat API Endpoint
 *
 * POST /api/chat - Send message, receive SSE stream
 *
 * This endpoint:
 * 1. Receives full state from client (messages + storeState)
 * 2. Runs single-pass generation
 * 3. Streams events as SSE (text deltas + tool calls)
 *
 * Fully stateless: interruption is handled by the client aborting
 * the fetch request, which triggers req.signal on the server side.
 */

import { NextRequest } from 'next/server';
import { statelessGenerate } from '@/lib/orchestration/stateless-generate';
import { isProviderKeyRequired } from '@/lib/ai/providers';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModel } from '@/lib/server/resolve-model';
import type { ThinkingConfig } from '@/lib/types/provider';
import { getCurrentUser } from '@/lib/auth/current-user';
import { recordChatMessage } from '@/lib/courses/progress-service';
const log = createLogger('Chat API');

/** Extract plain text from the last user message (UIMessage parts or content). */
function lastUserText(messages: StatelessChatRequest['messages']): string {
  const m = [...messages].reverse().find((x) => x.role === 'user') as
    | { parts?: Array<{ type?: string; text?: string }>; content?: string }
    | undefined;
  if (!m) return '';
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p?.type === 'text' && p.text)
      .map((p) => p.text)
      .join(' ')
      .trim();
  }
  return typeof m.content === 'string' ? m.content.trim() : '';
}

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

/**
 * POST /api/chat
 * Send a message and receive SSE stream of generation events
 *
 * Request body: StatelessChatRequest
 * {
 *   messages: UIMessage[],
 *   storeState: { stage, scenes, currentSceneId, mode },
 *   config: { agentIds, sessionType? },
 *   apiKey: string,
 *   baseUrl?: string,
 *   model?: string
 * }
 *
 * Response: SSE stream of StatelessEvent
 */
export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  let chatModel: string | undefined;
  let chatMessageCount: number | undefined;

  try {
    const body: StatelessChatRequest = await req.json();
    chatModel = body.model;
    chatMessageCount = body.messages?.length;

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
    }

    if (!body.storeState) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: storeState');
    }

    if (!body.config || !body.config.agentIds || body.config.agentIds.length === 0) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: config.agentIds');
    }

    const {
      model: languageModel,
      apiKey: resolvedApiKey,
      providerId,
    } = await resolveModel({
      modelString: body.model,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      providerType: body.providerType,
    });

    if (isProviderKeyRequired(providerId) && !resolvedApiKey) {
      return apiError('MISSING_API_KEY', 401, 'API Key is required');
    }

    log.info('Processing request');
    log.info(
      `Agents: ${body.config.agentIds.join(', ')}, Messages: ${body.messages.length}, Turn: ${body.directorState?.turnCount ?? 0}`,
    );

    // Use the native request signal for abort propagation
    const signal = req.signal;

    // Phase 3 transcript capture (no-op for non-students / non-enrolled, server-side).
    // stage.id equals the published course's sourceClassroomId.
    const sessionUser = await getCurrentUser();
    const chatClassroomId = body.storeState?.stage?.id;
    const chatSceneId = body.storeState?.currentSceneId ?? undefined;
    if (sessionUser && chatClassroomId) {
      const userText = lastUserText(body.messages);
      if (userText) {
        recordChatMessage(sessionUser, {
          classroomId: chatClassroomId,
          sceneId: chatSceneId,
          role: 'student',
          content: userText,
        }).catch(() => {});
      }
    }

    // Create SSE stream
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    // Stream generation in background with heartbeat to prevent connection timeout
    const HEARTBEAT_INTERVAL_MS = 15_000;
    (async () => {
      // Heartbeat: periodically send SSE comments to keep the connection alive.
      // Proxies / browsers may close idle SSE connections after 30-120s of silence.
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            writer.write(encoder.encode(`:heartbeat\n\n`)).catch(() => stopHeartbeat());
          } catch {
            stopHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      try {
        startHeartbeat();

        // Default: thinking disabled for low-latency chat. UI requests send
        // `thinkingConfig`; eval harnesses can still opt in via `thinking`.
        const thinkingConfig: ThinkingConfig = body.thinkingConfig ??
          body.thinking ?? { mode: 'disabled', enabled: false };

        const generator = statelessGenerate(
          {
            ...body,
            apiKey: resolvedApiKey,
          },
          signal,
          languageModel,
          thinkingConfig,
        );

        let assistantText = '';
        for await (const event of generator) {
          if (signal.aborted) {
            log.info('Request was aborted');
            break;
          }

          const ev = event as { type?: string; data?: { content?: string } };
          if (ev.type === 'text_delta' && ev.data?.content) assistantText += ev.data.content;

          const data = `data: ${JSON.stringify(event)}\n\n`;
          await writer.write(encoder.encode(data));
        }

        stopHeartbeat();

        // Persist the AI teacher's reply to the transcript (no-op for non-students).
        if (sessionUser && chatClassroomId && assistantText.trim()) {
          recordChatMessage(sessionUser, {
            classroomId: chatClassroomId,
            sceneId: chatSceneId,
            role: 'teacher_agent',
            content: assistantText.trim(),
          }).catch(() => {});
        }

        await writer.close();
      } catch (error) {
        stopHeartbeat();

        // If aborted, just close the writer silently
        if (signal.aborted) {
          log.info('Request aborted during streaming');
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        log.error(
          `Chat stream error [model=${body.model ?? 'unknown'}, agents=${body.config?.agentIds?.length ?? 0}, messages=${body.messages?.length ?? 0}]:`,
          error,
        );

        // Try to send error event
        try {
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : String(error),
            },
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
        } catch {
          // Writer may already be closed
        }
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error(
      `Chat request failed [model=${chatModel ?? 'unknown'}, messages=${chatMessageCount ?? 0}]:`,
      error,
    );
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to process request',
    );
  }
}
