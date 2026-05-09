import { Env, CEOState } from "../types";
import { handleChatTurn, getStateWaitUntil } from "../lib/chat";
import { maybeUpdatePatternNotes } from "../lib/digest";

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

const RECENT_PINGS_LIMIT = 20;

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
        return this.handleGreeting();
      case "/ingest-ping":
        return this.ingestStatusPing(request);
      case "/state":
        return this.getState();
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /** Handle a chat message to the CEO — context-aware (loads briefings + pings + state) */
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
    const context = await this.buildContext();
    const systemPrompt = `${context}\n\n${CEO_SYSTEM_PROMPT}`;

    const resp = await handleChatTurn({
      db: this.env.DB,
      chatId,
      systemPrompt,
      userMessage: body.message,
      apiKey: this.env.ANTHROPIC_API_KEY,
      waitUntil: getStateWaitUntil(this.state),
    });

    const headers = new Headers(resp.headers);
    headers.set("X-Chat-Id", chatId);
    return new Response(resp.body, { status: resp.status, headers });
  }

  /**
   * Compose the "current state of the portfolio" block for the CEO's system
   * prompt. Falls back to a "(none yet)" rendering if there are no projects
   * or pings — the prompt acknowledges that condition rather than going silent.
   */
  private async buildContext(): Promise<string> {
    const { results: projectRows } = await this.env.DB.prepare(
      `SELECT p.id, p.name, b.goal, b.state, b.next_move, b.why
       FROM projects p
       LEFT JOIN briefings b ON b.project_id = p.id
       WHERE p.status = 'active'
       ORDER BY p.created_at ASC`,
    ).all<{
      id: string;
      name: string;
      goal: string;
      state: string;
      next_move: string;
      why: string;
    }>();

    const { results: pingRows } = await this.env.DB.prepare(
      `SELECT sp.summary, sp.signal, sp.created_at, p.name AS project_name
       FROM status_pings sp
       JOIN projects p ON p.id = sp.project_id
       ORDER BY sp.created_at DESC, sp.id DESC
       LIMIT ?`,
    )
      .bind(RECENT_PINGS_LIMIT)
      .all<{ summary: string; signal: string; created_at: string; project_name: string }>();

    await this.env.DB.prepare("INSERT OR IGNORE INTO ceo_state (id) VALUES (1)").run();
    const ceoState =
      (await this.env.DB.prepare(
        "SELECT long_term_notes, pattern_notes FROM ceo_state WHERE id = 1",
      ).first<{ long_term_notes: string; pattern_notes: string }>()) ?? {
        long_term_notes: "",
        pattern_notes: "",
      };

    const lines: string[] = [];
    lines.push("CURRENT STATE OF YOUR PORTFOLIO:");
    lines.push("");

    if (projectRows.length === 0) {
      lines.push("Active projects: (none yet — no projects have been created)");
    } else {
      lines.push("Active projects:");
      for (const p of projectRows) {
        lines.push(`- ${p.name} (id: ${p.id})`);
        lines.push(`    Goal: ${p.goal || "(not set)"}`);
        lines.push(`    State: ${p.state || "(not set)"}`);
        lines.push(`    Next move: ${p.next_move || "(not set)"}`);
        lines.push(`    Why: ${p.why || "(not set)"}`);
      }
    }
    lines.push("");

    if (pingRows.length === 0) {
      lines.push("Recent activity: (no reports filed yet)");
    } else {
      lines.push(`Recent activity (last ${pingRows.length} pings, newest first):`);
      for (const ping of pingRows) {
        lines.push(`- [${ping.created_at}] ${ping.project_name}: ${ping.summary} [${ping.signal}]`);
      }
    }
    lines.push("");

    if (ceoState.long_term_notes.trim()) {
      lines.push("Your running notes about your principal:");
      lines.push(ceoState.long_term_notes.trim());
      lines.push("");
    }

    if (ceoState.pattern_notes.trim()) {
      lines.push("Cross-project patterns you've noticed:");
      lines.push(ceoState.pattern_notes.trim());
      lines.push("");
    }

    return lines.join("\n").trim();
  }

  /** Greeting endpoint — stub. /chat is the canonical entry point in v0. */
  private async handleGreeting(): Promise<Response> {
    return new Response(
      JSON.stringify({
        stub: true,
        greeting: "Greeting endpoint not implemented; send a chat message instead.",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  /**
   * Receive a ping from a Project DO. Loads CEO state + recent pings + the
   * new ping, asks Claude whether the running pattern_notes need updating,
   * and persists if so. Idempotent on repeats — Claude returns null when no
   * change is warranted.
   */
  private async ingestStatusPing(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = (await request.json().catch(() => null)) as {
      project_id?: string;
      project_name?: string;
      summary?: string;
      signal?: string;
      created_at?: string;
    } | null;
    if (!body?.project_id || !body.project_name || !body.summary || !body.signal) {
      return new Response(JSON.stringify({ error: "missing ping fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await this.env.DB.prepare("INSERT OR IGNORE INTO ceo_state (id) VALUES (1)").run();
    const ceoState =
      (await this.env.DB.prepare(
        "SELECT pattern_notes FROM ceo_state WHERE id = 1",
      ).first<{ pattern_notes: string }>()) ?? { pattern_notes: "" };

    const { results: recentPings } = await this.env.DB.prepare(
      `SELECT sp.summary, sp.signal, sp.created_at, p.name AS project_name
       FROM status_pings sp
       JOIN projects p ON p.id = sp.project_id
       ORDER BY sp.created_at DESC, sp.id DESC
       LIMIT ?`,
    )
      .bind(RECENT_PINGS_LIMIT)
      .all<{ summary: string; signal: string; created_at: string; project_name: string }>();

    const updated = await maybeUpdatePatternNotes(
      ceoState.pattern_notes,
      recentPings,
      {
        project_name: body.project_name,
        summary: body.summary,
        signal: body.signal,
        created_at: body.created_at,
      },
      this.env.ANTHROPIC_API_KEY,
    );

    if (updated !== null) {
      await this.env.DB.prepare("UPDATE ceo_state SET pattern_notes = ? WHERE id = 1")
        .bind(updated)
        .run();
    }

    return new Response(
      JSON.stringify({ acknowledged: true, pattern_notes_updated: updated !== null }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  /** Return the CEO's current internal state (full row from D1). */
  private async getState(): Promise<Response> {
    await this.env.DB.prepare("INSERT OR IGNORE INTO ceo_state (id) VALUES (1)").run();
    const row = await this.env.DB.prepare(
      "SELECT long_term_notes, pattern_notes, last_briefing_to_user, last_user_seen_at FROM ceo_state WHERE id = 1",
    ).first<CEOState>();
    return new Response(
      JSON.stringify(
        row ?? {
          long_term_notes: "",
          pattern_notes: "",
          last_briefing_to_user: "",
          last_user_seen_at: "",
        },
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  }
}
