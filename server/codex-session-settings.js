"use strict";

const accessModes = {
  ":read-only": { name: "Read only", approvalPolicy: "on-request" },
  ":workspace": { name: "Default permissions", approvalPolicy: "on-request" },
  ":danger-full-access": { name: "Full access", approvalPolicy: "never" },
};

function sessionSettings(value) {
  if (typeof value?.model !== "string") return null;
  const profile = value.activePermissionProfile?.id;
  const accessMode = profile && (!accessModes[profile] || value.approvalPolicy === accessModes[profile].approvalPolicy) ? profile : "custom";
  return { model: value.model, effort: value.effort ?? value.reasoningEffort ?? null, accessMode };
}

async function sessionChoices(client, cwd) {
  const [models, permissions] = await Promise.all([
    client.call("model/list", { includeHidden: false }),
    client.call("permissionProfile/list", { cwd }),
  ]);
  return {
    models: models.data.filter(model => !model.hidden).map(model => ({
      id: model.model, name: model.displayName,
      efforts: model.supportedReasoningEfforts.map(option => option.reasoningEffort), defaultEffort: model.defaultReasoningEffort,
    })),
    accessModes: permissions.data.map(profile => ({ id: profile.id, name: accessModes[profile.id]?.name || profile.id, description: profile.description, allowed: profile.allowed })),
  };
}

function settingsPatch(input, current, choices) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["model", "effort", "accessMode", "confirmFullAccess"].includes(key))) throw new Error("不支持的会话设置");
  const patch = {};
  if (input.model !== undefined || input.effort !== undefined) {
    const model = choices.models.find(model => model.id === (input.model ?? current.model));
    if (!model) throw new Error("此模型不在后台可选列表中");
    if (input.model !== undefined) patch.model = model.id;
    if (input.effort !== undefined) {
      if (!model.efforts.includes(input.effort)) throw new Error("此模型不支持这个推理强度");
      patch.effort = input.effort;
    } else if (input.model !== undefined && current.effort && !model.efforts.includes(current.effort)) patch.effort = model.defaultEffort;
  }
  if (input.accessMode !== undefined) {
    const profile = choices.accessModes.find(profile => profile.id === input.accessMode);
    if (!profile?.allowed) throw new Error("此权限模式不可选");
    if (profile.id === ":danger-full-access" && current.accessMode !== profile.id && input.confirmFullAccess !== true) throw new Error("请先确认 Full access 权限范围");
    patch.permissions = profile.id;
    if (accessModes[profile.id]) patch.approvalPolicy = accessModes[profile.id].approvalPolicy;
  }
  if (!Object.keys(patch).length) throw new Error("未选择要更改的设置");
  return patch;
}

module.exports = { sessionSettings, sessionChoices, settingsPatch };
