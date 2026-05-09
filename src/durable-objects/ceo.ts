import { Env, CEOState, StatusPing } from "../types";

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
    // TODO: load chat history, build system prompt with cross-project briefings,
    //       call Claude API, stream response, persist messages
    return new Response(JSON.stringify({ stub: true, message: "CEO chat not yet implemented" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Generate the CEO's opening greeting based on current state */
  private async handleGreeting(_request: Request): Promise<Response> {
    // TODO: read all project briefings, recent status pings, long-term notes,
    //       generate a greeting that reflects what's happened
    return new Response(JSON.stringify({ stub: true, greeting: "Good morning. (Greeting generation not yet implemented.)" }), {
      headers: { "Content-Type": "application/json" },
    });
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
