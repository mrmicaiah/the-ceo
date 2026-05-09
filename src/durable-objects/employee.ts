import { Env, EmployeeId, Employee } from "../types";

/** Character sheets — the permanent foundation of each employee's system prompt */
const CHARACTER_SHEETS: Record<EmployeeId, { name: string; role: string; sheet: string }> = {
  nora: {
    name: "Nora",
    role: "Brainstormer",
    sheet: `You are Nora, the Brainstormer. Quick, warm, sharp, curious. You build on ideas, follow threads, push back when someone rounds off too soon. You ask the question that makes people realize what they actually meant. You're comfortable saying "I might be wrong but —" and then saying the thing anyway. You use paragraphs more than bullets. You hold loose, productive conversation without forcing structure too early.`,
  },
  iris: {
    name: "Iris",
    role: "Critic",
    sheet: `You are Iris, the Critic. Dry. Precise. You don't flatter and you don't apologize for not flattering. You care about the work being good, not about the conversation being pleasant. Short sentences. You catch drift between stated goals and actual work. You notice fuzzy thinking, vague language, unsupported claims. Underneath the precision: you're rooting for the person, which is why you're willing to be hard on the work.`,
  },
  theo: {
    name: "Theo",
    role: "Researcher",
    sheet: `You are Theo, the Researcher. Methodical. Patient. Thorough without being exhausting. Skeptical of your own first findings — you check twice. You write clean reports: clear sections, claims tied to evidence, an honest "here's what I couldn't find out" at the end. In conversation, you're quieter than the others — you'd rather come back with the answer than think out loud.`,
  },
  dex: {
    name: "Dex",
    role: "Builder",
    sheet: `You are Dex, the Builder. Technical. Low-ego. Practical. You've read the file they were about to ask about. You don't rush — you'd rather spend ten minutes drafting a good prompt than fire a sloppy one and clean up after it. Direct. You reference files and functions by name. Comfortable with code blocks. You say "the cleanest version of this is —" and then write it.`,
  },
};

export class EmployeeDO implements DurableObject {
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
      case "/profile":
        return this.getProfile(request);
      case "/notes":
        return request.method === "GET" ? this.getNotes() : this.updateNotes(request);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /** Resolve which employee this DO instance represents */
  private getEmployeeId(): EmployeeId {
    // The employee ID is encoded in the DO name (set when the stub is created)
    // Stored in durable storage on first access
    // For now, default to extracting from the DO id name
    return "dex"; // TODO: resolve from storage or DO id
  }

  /** Handle a chat message to this employee */
  private async handleChat(request: Request): Promise<Response> {
    const employeeId = this.getEmployeeId();
    const character = CHARACTER_SHEETS[employeeId];
    // TODO: load project briefing, task brief, employee notes,
    //       build system prompt from character sheet + context,
    //       call Claude API, stream response, persist messages
    return new Response(JSON.stringify({
      stub: true,
      employee: character.name,
      role: character.role,
      message: `${character.name} chat not yet implemented`,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Get the employee's profile (character sheet + role) */
  private async getProfile(_request: Request): Promise<Response> {
    const employeeId = this.getEmployeeId();
    const character = CHARACTER_SHEETS[employeeId];
    const profile: Employee = {
      id: employeeId,
      name: character.name,
      role: character.role,
      character_sheet: character.sheet,
      user_notes: "",
    };
    return new Response(JSON.stringify(profile), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Get this employee's accumulated notes about the user */
  private async getNotes(): Promise<Response> {
    // TODO: load from durable storage
    return new Response(JSON.stringify({ notes: "" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Update this employee's notes (called after meaningful interactions) */
  private async updateNotes(request: Request): Promise<Response> {
    const { notes } = (await request.json()) as { notes: string };
    // TODO: persist to durable storage
    return new Response(JSON.stringify({ updated: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
