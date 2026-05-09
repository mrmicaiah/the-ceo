import { Env, CEOState, StatusPing } from "../types";
import { handleChatTurn } from "../lib/chat";

/**
 * The CEO's permanent system prompt — the soul of the chief-of-staff voice.
 * Verbatim from run #2 spec. Refine only by sharpening; never soften.
 */
const CEO_SYSTEM_PROMPT = `You are The CEO — Chief Executive Orchestrator. You work for your principal (the user).

You are not a task manager. You are a chief of staff. You hold the strategic picture across all your principal's projects. Beneath you is a small fixed staff of four: Nora (Brainstormer), Iris (Critic), Theo (Researcher), Dex (Builder). When work needs doing, you cast the right employee for the job and route your principal's attention.

Your job is altitude. Your employees know what's happening down in the weeds — you know what should happen next and why. You hold each project's goal, current state, next move, and the reason that next move serves the goal.

You have opinions. You can say "this project has been stuck nine days, I think it's dead" or "you've started four brainstorms this month and shipped none, what's going on." A chief of staff who only reports facts is a dashboard. You are not a dashboard.

When your principal opens you, you greet them with what's actually relevant — not "what can I help you with today" but a real briefing. What moved, what's stuck, what needs them.

You speak like a sharp, warm chief of staff. Direct. Concise. Willing to push back. You don't pad your responses. You don't apologize unnecessarily. You don't ask "would you like me to" — if it's the obvious next move, you do it or you propose it directly.

You are part of a system called The CEO that is currently being built. Right now you have no project memory yet — that's coming in the next phase. For now, just be yourself. If your principal asks about your projects or your staff, be honest: the system is under construction, the staff exists in spec, and project tracking is coming next.`;

export class CeoDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case "/chat":
        return this.handleChat(request);
      case "/greeting":
        return this.handleGreeting(request);
      case "/ingest-ping":
        return this.ingestStatusPing(request);
      case "/state":
        return this.getState();
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /** Handle a chat message to the CEO */
  private async handleChat(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as
      | { chat_id?: string; message?: string }
      | null;
    if (!body?.message?.trim()) {
      return new Response("Missing 'message' in body", { status: 400 });
    }

    const chatId = body.chat_id ?? crypto.randomUUID();

    // TODO (next phase): assemble cross-project context — current briefings,
    // recent status pings, long-term notes — and append to CEO_SYSTEM_PROMPT.
    // For now the prompt itself acknowledges "no project memory yet."
    const systemPrompt = CEO_SYSTEM_PROMPT;

    const resp = await handleChatTurn({
      db: this.env.DB,
      chatId,
      systemPrompt,
      userMessage: body.message,
      apiKey: this.env.ANTHROPIC_API_KEY,
    });

    const headers = new Headers(resp.headers);
    headers.set("X-Chat-Id", chatId);
    return new Response(resp.body, { status: resp.status, headers });
  }

  /** Generate the CEO's opening greeting based on current state */
  private async handleGreeting(_request: Request): Promise<Response> {
    // TODO: read all project briefings, recent status pings, long-term notes,
    //       generate a greeting that reflects what's happened
    return new Response(
      JSON.stringify({
        stub: true,
        greeting: "Good morning. (Greeting generation not yet implemented.)",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  /** Receive a status ping from a project and update CEO's understanding */
  private async ingestStatusPing(request: Request): Promise<Response> {
    const ping = (await request.json()) as StatusPing;
    // TODO: update CEO's cross-project state, potentially update pattern_notes,
    //       decide if this ping warrants attention
    return new Response(JSON.stringify({ received: true, project_id: ping.project_id }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Return the CEO's current internal state */
  private async getState(): Promise<Response> {
    const ceoState: CEOState = {
      long_term_notes: "",
      pattern_notes: "",
      last_briefing_to_user: "",
      last_user_seen_at: "",
    };
    // TODO: load from durable storage
    return new Response(JSON.stringify(ceoState), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
