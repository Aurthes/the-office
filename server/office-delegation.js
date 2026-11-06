"use strict";
const { activeDelegation, handlingAgentId } = require("./office-todos");

// Handoffs use the same task and normal session sender. The task itself is the
// durable inbox; only pending, definitely unsent deliveries may be dispatched.
class OfficeDelegation {
  constructor({ store, todos, company, canSend, send, canRecall = async id => !store.isBusy(id) && store.get(id).status !== "running", stopping = () => false }) {
    Object.assign(this, { store, todos, company, canSend, send, canRecall, stopping });
    this.inflight = new Set();
  }
  async delegate(input) {
    // Definitive preflight refusals must not consume the retry ID. Once dispatch
    // begins, the existing durable operation guard prevents uncertain replay.
    if (!Object.hasOwn(this.store.data.requests, input.requestId || "")) {
      this.company.assertDelegate(input.actorId, input.assigneeId);
      if (this.inflight.has(input.assigneeId) || !await this.canSend(input.assigneeId)) throw new Error("This direct report is busy or waiting for input; no work was delegated");
    }
    return this.store.once(input, async () => {
      this.company.assertDelegate(input.actorId, input.assigneeId);
      if (this.inflight.has(input.assigneeId)) throw new Error("This direct report is receiving another task; refresh before delegating");
      // Recheck the live reporting graph after asynchronous readiness checks.
      this.company.assertDelegate(input.actorId, input.assigneeId);
      const result = this.todos.change(input, "delegate");
      await this.deliver(result.todo.id);
      return this.todos.get({ id: result.todo.id });
    });
  }
  submit(input) {
    return this.store.once(input, () => {
      const result = this.todos.change(input, "submit");
      // The worker's tool must return even if its manager is still working.
      void this.flush(input.id);
      return result;
    });
  }
  review(input) {
    return this.store.once(input, async () => {
      const result = this.todos.change(input, "review");
      if (!input.accept) await this.deliver(result.todo.id);
      return this.todos.get({ id: result.todo.id });
    });
  }
  recall(input) {
    return this.store.once(input, async () => {
      const entry = activeDelegation(this.todos.raw(input.id));
      if (!entry || entry.managerId !== input.actorId) throw new Error("Only the delegating manager can recall this handoff");
      if (this.inflight.has(entry.workerId) || this.inflight.has(entry.managerId) || !await this.canRecall(entry.workerId) || this.inflight.has(entry.workerId) || this.store.starting.has(entry.workerId)) throw new Error("Stop the worker's active turn before recalling this handoff");
      return this.todos.change(input, "recall");
    });
  }
  async deliver(id) {
    const row = this.todos.raw(id), entry = activeDelegation(row), delivery = entry?.delivery;
    if (!delivery || delivery.state !== "pending" || row.archived || row.status === "done" || this.stopping() || this.inflight.has(delivery.recipientId)) return;
    const recipient = delivery.recipientId, requestId = delivery.requestId;
    this.inflight.add(recipient);
    try {
      if (!await this.canSend(recipient) || this.stopping()) return;
      const current = this.todos.raw(id), currentEntry = activeDelegation(current);
      if (current.archived || current.status === "done" || handlingAgentId(current) !== recipient || currentEntry?.delivery?.requestId !== requestId || currentEntry.delivery.state !== "pending") return;
      if (currentEntry.state === "working") this.company.assertDelegate(currentEntry.managerId, recipient);
      const message = currentEntry.state === "review"
        ? `Office delegation submitted for your acceptance. Task ${id}: ${current.title}\nRead office_tasks.todo_get, inspect the report and artifacts, and verify the acceptance criteria. Use todo_review with evidence to accept or return it. Do not mark it complete just because the worker submitted. This is a system task notification, not a new user goal.`
        : `Work on delegated Office task ${id}: ${current.title}\nRead its scope, acceptance criteria and any return feedback with office_tasks.todo_get. Use this existing task, keep evidence current, and use todo_submit to return the result to your manager. Leave the final unfinished phase for manager acceptance. Follow the user's original restrictions; do not expand scope.`;
      this.todos.delivery(id, requestId, "sending");
      this.todos.startForAgent(recipient, id);
      try {
        const result = await this.send(recipient, message, requestId);
        if (result.status === "busy") { this.todos.delivery(id, requestId, "pending"); this.todos.finishTurn(recipient, "waiting for an available session"); }
        else this.todos.delivery(id, requestId, "sent");
      } catch (error) {
        // A timeout may mean the model already received the message. Preserve
        // the report for the next context; never replay an uncertain dispatch.
        this.todos.delivery(id, requestId, "uncertain", error.message);
        this.todos.finishTurn(recipient, "dispatch outcome uncertain");
      }
    } finally { this.inflight.delete(recipient); }
  }
  async flush(id) {
    try {
      const rows = id ? [this.todos.raw(id)] : [...this.todos.rows.values()];
      await Promise.all(rows.filter(row => activeDelegation(row)?.delivery?.state === "pending").map(row => this.deliver(row.id)));
    } catch (error) { console.warn("Office handoff remains in the task inbox:", error.message); }
  }
}
module.exports = { OfficeDelegation };
