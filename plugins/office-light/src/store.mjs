import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ACCENTS, UUID, normalizeChatLink } from "./links.mjs";

const roleSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  chatLink: z.string().transform(normalizeChatLink),
  accent: z.enum(Object.keys(ACCENTS)),
  createdAt: z.string().datetime(),
}).strict();

export class RoleStore {
  constructor(directory = process.env.OFFICE_LIGHT_DATA_DIR ||
    path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
      "the-office", "light-plugin")) {
    this.directory = path.join(directory, "roles");
  }

  file(id) {
    if (!UUID.test(id)) throw new Error("Invalid Office role ID.");
    return path.join(this.directory, id.toLowerCase() + ".json");
  }

  async list() {
    let names;
    try { names = await fs.readdir(this.directory); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const roles = [];
    for (const name of names.filter(name => name.endsWith(".json") && UUID.test(name.slice(0, -5)))) {
      try { roles.push(roleSchema.parse(JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8")))); }
      catch (error) {
        if (error.code === "ENOENT") continue; // Another view just removed this role.
        throw new Error("An Office role file could not be read. No files were changed.", { cause: error });
      }
    }
    return roles.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async save(input) {
    let previous;
    if (input.id) {
      try { previous = roleSchema.parse(JSON.parse(await fs.readFile(this.file(input.id), "utf8"))); }
      catch (error) {
        if (error.code === "ENOENT") throw new Error("This role no longer exists. Reload Office.");
        throw error;
      }
    }
    const role = roleSchema.parse({
      version: 1, id: previous?.id || randomUUID(), name: input.name,
      chatLink: input.chatLink, accent: input.accent || "sage",
      createdAt: previous?.createdAt || new Date().toISOString(),
    });
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.file(role.id), temporary = target + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporary, JSON.stringify(role) + "\n", { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
    return role;
  }

  async remove(id) {
    await fs.rm(this.file(id), { force: true });
  }
}
