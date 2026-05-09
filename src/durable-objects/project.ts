import { Env, Briefing, Report } from "../types";

export class ProjectDO implements DurableObject {
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
      case "/briefing":
        return request.method === "GET" ? this.getBriefing() : this.updateBriefing(request);
      case "/report":
        return this.fileReport(request);
      case "/chat":
        return this.handleChat(request);
      case "/execution/queue":
        return this.queueExecution(request);
      case "/execution/status":
        return this.executionStatus(request);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  /** Get the current project briefing */
  private async getBriefing(): Promise<Response> {
    // TODO: load briefing from durable storage
    const briefing: Briefing = {
      goal: "",
      state: "",
      next_move: "",
      why: "",
      updated_at: new Date().toISOString(),
    };
    return new Response(JSON.stringify(briefing), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Update the project briefing (usually after a report is digested) */
  private async updateBriefing(request: Request): Promise<Response> {
    const briefing = (await request.json()) as Briefing;
    // TODO: persist to durable storage, notify CEO DO via status ping
    return new Response(JSON.stringify({ updated: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Receive a report from an employee */
  private async fileReport(request: Request): Promise<Response> {
    const report = (await request.json()) as Report;
    // TODO: persist report to D1, update briefing based on report content,
    //       generate status ping, send to CEO DO
    return new Response(JSON.stringify({ filed: true, report_id: report.id }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Handle a chat message within this project */
  private async handleChat(request: Request): Promise<Response> {
    // TODO: load chat, build system prompt with project briefing + employee character,
    //       call Claude API, stream response, persist
    return new Response(JSON.stringify({ stub: true, message: "Project chat not yet implemented" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Queue a Claude Code execution job for this project */
  private async queueExecution(request: Request): Promise<Response> {
    // TODO: check if a job is already running for this project,
    //       queue if so, create job record in D1, notify local agent via websocket
    return new Response(JSON.stringify({ stub: true, message: "Execution queue not yet implemented" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Get the status of the current execution job */
  private async executionStatus(_request: Request): Promise<Response> {
    // TODO: look up current/recent jobs for this project
    return new Response(JSON.stringify({ stub: true, active_job: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
